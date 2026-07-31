import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { configFromEnv } from "./config.mjs";
import { handleHook } from "./engine.mjs";
import { LiveEventStore } from "./live-event-store.mjs";
import { hash } from "./utils.mjs";
import { workerInvocationCompatible } from "./helper-worker-handshake.mjs";

const HOOK_INPUT_MAX_BYTES = 1024 * 1024;
const WORKER_COMPATIBILITY_WARNING =
  "AWF worker compatibility check failed open: this event was not checked.\n";
const HOOK_PROCESSING_WARNING =
  "AWF hook failed open: processing failed; this event was not checked.\n";
const FAIL_OPEN_SYSTEM_MESSAGE =
  "AWF failed open: this event was not checked. Run `agent-waste-firewall doctor`.";
const COMPATIBILITY_FAIL_OPEN_OUTPUT = Object.freeze({
  systemMessage: FAIL_OPEN_SYSTEM_MESSAGE,
});

async function readStdin() {
  let input = "";
  let bytes = 0;
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    bytes += Buffer.byteLength(chunk, "utf8");
    if (bytes > HOOK_INPUT_MAX_BYTES) {
      throw new Error("Hook input exceeded the bounded in-memory limit.");
    }
    input += chunk;
  }
  return input;
}

function failOpenMarker(env, suffix = "warning") {
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  const dataKey = hash(env.AGENT_WASTE_FIREWALL_DATA_DIR ?? "default").slice(0, 12);
  const directory = path.join(os.tmpdir(), `agent-waste-firewall-${uid}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (typeof uid === "number" && stat.uid !== uid)
  ) {
    throw new Error("Unsafe fail-open warning directory.");
  }
  return path.join(directory, `${dataKey}.${suffix}`);
}

function failOpenOutput(env = process.env) {
  const interval = 5 * 60 * 1000;
  let shouldWarn = true;
  try {
    const marker = failOpenMarker(env);
    if (fs.existsSync(marker)) {
      shouldWarn = Date.now() - fs.statSync(marker).mtimeMs >= interval;
    }
    if (shouldWarn) {
      fs.writeFileSync(marker, String(Date.now()), { mode: 0o600 });
    }
  } catch {
    // If rate limiting itself fails, warning once is safer than silent disablement.
  }
  return shouldWarn
    ? { systemMessage: FAIL_OPEN_SYSTEM_MESSAGE }
    : {};
}

function recorderWarningOutput(output, env = process.env) {
  const interval = 5 * 60 * 1000;
  let shouldWarn = true;
  try {
    const marker = failOpenMarker(env, "recorder-warning");
    if (fs.existsSync(marker)) {
      shouldWarn = Date.now() - fs.statSync(marker).mtimeMs >= interval;
    }
    if (shouldWarn) {
      fs.writeFileSync(marker, String(Date.now()), { mode: 0o600 });
    }
  } catch {
    // A local recorder warning is safer than silently claiming recording succeeded.
  }
  if (!shouldWarn) return output;
  const message =
    "AWF explicit trace recording failed for this event; the guard decision still applied. Run `agent-waste-firewall doctor`.";
  return {
    ...output,
    systemMessage: output.systemMessage
      ? `${output.systemMessage}\n${message}`
      : message,
  };
}

function warnLiveSpoolFailure(env = process.env) {
  const interval = 5 * 60 * 1000;
  let shouldWarn = true;
  try {
    const marker = failOpenMarker(env, "live-spool-warning");
    if (fs.existsSync(marker)) {
      shouldWarn = Date.now() - fs.statSync(marker).mtimeMs >= interval;
    }
    if (shouldWarn) {
      fs.writeFileSync(marker, String(Date.now()), { mode: 0o600 });
    }
  } catch {
    // The live spool is optional presentation transport; the guard still runs.
  }
  if (shouldWarn) {
    process.stderr.write(
      "AWF live monitor degraded: one semantic presentation event was dropped. The guard decision still applied.\n",
    );
  }
}

async function traceStoreFor(options, root, env) {
  if (options.traceStore) {
    return options.traceStore;
  }
  if (!fs.existsSync(path.join(path.resolve(root), "active-trace.json"))) {
    return null;
  }
  const { TraceStore } = await import("./trace-store.mjs");
  return new TraceStore({ root, env });
}

export async function runHookPayload(payload, options = {}) {
  const env = options.env ?? process.env;
  const baseConfig = {
    ...configFromEnv(env),
    ...(options.config ?? {}),
  };
  const traceStore = await traceStoreFor(options, baseConfig.dataDir, env);
  const liveStore =
    options.liveStore ??
    new LiveEventStore({
      root: baseConfig.dataDir,
      env,
      maxEvents: baseConfig.liveMaxEvents,
      maxBytes: baseConfig.liveMaxBytes,
      maxAgeMs: baseConfig.liveMaxAgeMinutes * 60 * 1000,
    });
  let config = baseConfig;
  let recorderFailed = false;
  let activeTrace = null;
  if (traceStore) {
    try {
      activeTrace = traceStore.activeFor(payload.cwd ?? process.cwd());
      if (activeTrace?.metadata?.mode) {
        config = { ...baseConfig, mode: activeTrace.metadata.mode };
      }
    } catch {
      recorderFailed = true;
    }
  }

  const decisionStartedAt = performance.now();
  const result = handleHook(payload, {
    ...options,
    env,
    config,
  });
  const decisionLatencyMs = performance.now() - decisionStartedAt;
  try {
    const publication = liveStore.publish(payload, result, config, {
      decisionLatencyMs,
    });
    if (
      publication?.published === false &&
      publication.reason !== "unsupported"
    ) {
      warnLiveSpoolFailure(env);
    }
  } catch {
    warnLiveSpoolFailure(env);
  }
  if (traceStore && !recorderFailed) {
    try {
      traceStore.appendHook(payload, result, config, activeTrace);
    } catch {
      recorderFailed = true;
    }
  }
  return recorderFailed
    ? recorderWarningOutput(result.output, env)
    : result.output;
}

export async function runHookStdio(options = {}) {
  const workerArguments = options.arguments ?? [];
  const env = options.env ?? process.env;
  const workerProvider = env.AGENT_WASTE_FIREWALL_PLATFORM;
  if (
    !workerInvocationCompatible({
      arguments: workerArguments,
      nodeVersion: options.nodeVersion ?? process.versions.node,
    }) ||
    (workerProvider !== "codex" && workerProvider !== "claude")
  ) {
    process.stderr.write(WORKER_COMPATIBILITY_WARNING);
    process.stdout.write(
      `${JSON.stringify(COMPATIBILITY_FAIL_OPEN_OUTPUT)}\n`,
    );
    return;
  }
  try {
    const input = await readStdin();
    const output = await runHookPayload(JSON.parse(input), {
      ...options,
      env,
    });
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch {
    if (env.AGENT_WASTE_FIREWALL_DEBUG === "1") {
      process.stderr.write(HOOK_PROCESSING_WARNING);
    }
    process.stdout.write(`${JSON.stringify(failOpenOutput(env))}\n`);
  }
}

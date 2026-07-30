#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { LiveEventStore } from "../src/live-event-store.mjs";
import { TraceStore } from "../src/trace-store.mjs";

function integerArgument(name, fallback, maximum) {
  const index = process.argv.indexOf(name);
  const raw = index >= 0 ? process.argv[index + 1] : fallback;
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}.`);
  }
  return value;
}

function absoluteFileArgument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (!path.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute file path.`);
  }
  const status = fs.lstatSync(value);
  if (
    !status.isFile() ||
    status.isSymbolicLink() ||
    (status.mode & 0o111) === 0
  ) {
    throw new Error(`${name} must be a regular executable file.`);
  }
  return value;
}

function optionalAbsoluteFileArgument(name, fallback) {
  if (!process.argv.includes(name)) {
    return fallback;
  }
  return absoluteFileArgument(name);
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function copyRuntime(source, destination) {
  try {
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_FICLONE);
  } catch {
    fs.rmSync(destination, { force: true });
    fs.copyFileSync(source, destination);
  }
  fs.chmodSync(destination, 0o700);
}

if (process.platform !== "darwin") {
  throw new Error("The native hook benchmark requires macOS.");
}

const sampleCount = integerArgument("--samples", 100, 10_000);
const warmupCount = integerArgument("--warmups", 10, 1_000);
const p95LimitMs = integerArgument("--p95-ms", 100, 60_000);
const activeSemanticTrace = !process.argv.includes("--no-trace");
const builtHelper = absoluteFileArgument("--helper");
const builtRuntime = optionalAbsoluteFileArgument(
  "--runtime",
  process.execPath,
);
const runtimeSource = process.argv.includes("--runtime")
  ? "explicit_runtime_clone"
  : "temporary_node_clone";
const runtimeReadinessMarker = "AWF_RUNTIME_READY\n";
const runtimeReadinessScript =
  'process.stdout.write("AWF_RUNTIME_READY\\n")';
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "awf-native-hook-benchmark-"),
);
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const launcher = path.join(projectRoot, "scripts", "hook-launcher.sh");
const home = path.join(temporaryRoot, "home");
const integrationRoot = path.join(
  home,
  "Library",
  "Application Support",
  "io.github.thisisun.agent-waste-firewall",
  "integration-v1",
);
const releaseID = "rel_0123456789abcdef0123456789abcdef";
const releaseRoot = path.join(integrationRoot, "versions", releaseID);
const helper = path.join(integrationRoot, "awf-hook");
const runtime = path.join(releaseRoot, "awf-node");
const dataDir = path.join(temporaryRoot, "data");
const workspace = path.join(temporaryRoot, "workspace");

fs.mkdirSync(releaseRoot, { recursive: true, mode: 0o700 });
fs.mkdirSync(workspace, { mode: 0o700 });
fs.mkdirSync(path.join(workspace, ".git"), { mode: 0o700 });
fs.copyFileSync(builtHelper, helper);
fs.chmodSync(helper, 0o700);
copyRuntime(builtRuntime, runtime);
fs.writeFileSync(
  path.join(integrationRoot, "activation.json"),
  `{"v":1,"releaseId":"${releaseID}","workerProtocol":1}\n`,
  { mode: 0o600 },
);

const env = {
  HOME: home,
  TMPDIR: os.tmpdir(),
  LANG: process.env.LANG ?? "C",
  PATH: "/usr/bin:/bin",
  PLUGIN_ROOT: projectRoot,
  AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
  AGENT_WASTE_FIREWALL_MODE: "observe",
  AGENT_WASTE_FIREWALL_PLATFORM: "claude",
};
function prewarmRuntime() {
  const startedAt = performance.now();
  const result = spawnSync(
    runtime,
    [
      "--no-addons",
      "--disable-proto=throw",
      "-e",
      runtimeReadinessScript,
    ],
    {
      encoding: "utf8",
      env: {
        HOME: home,
        TMPDIR: os.tmpdir(),
        LANG: "C",
        PATH: "/usr/bin:/bin",
      },
      input: "",
      maxBuffer: 4 * 1024,
      timeout: 10_000,
    },
  );
  const elapsedMs = performance.now() - startedAt;
  if (
    result.status !== 0
    || result.stdout !== runtimeReadinessMarker
    || result.stderr !== ""
  ) {
    throw new Error(
      "Native hook runtime prewarm failed "
        + `(status=${result.status ?? "none"}, `
        + `stdoutBytes=${Buffer.byteLength(result.stdout ?? "", "utf8")}, `
        + `stderrBytes=${Buffer.byteLength(result.stderr ?? "", "utf8")}).`,
    );
  }
  return elapsedMs;
}
const traceStore = new TraceStore({ root: dataDir, env });

function invokeHook(index) {
  const payload = {
    session_id: "synthetic-native-benchmark-session",
    cwd: workspace,
    hook_event_name: "PreToolUse",
    turn_id: "synthetic-native-benchmark-turn",
    tool_name: "Bash",
    tool_use_id: `synthetic-native-call-${index}`,
    tool_input: { command: "git status --short" },
  };
  const startedAt = performance.now();
  const result = spawnSync("/bin/sh", ["-p", launcher, projectRoot], {
    encoding: "utf8",
    env,
    input: JSON.stringify(payload),
  });
  const elapsedMs = performance.now() - startedAt;
  if (result.status !== 0) {
    throw new Error("Native hook benchmark subprocess failed.");
  }
  try {
    JSON.parse(result.stdout);
  } catch {
    throw new Error(
      "Native hook benchmark subprocess returned invalid JSON "
        + `(stdoutBytes=${Buffer.byteLength(result.stdout ?? "", "utf8")}, `
        + `stderrBytes=${Buffer.byteLength(result.stderr ?? "", "utf8")}).`,
    );
  }
  return elapsedMs;
}

try {
  const runtimePrewarmMs = prewarmRuntime();
  if (activeSemanticTrace) {
    traceStore.start({
      workspace,
      label: "native-hook-benchmark",
      mode: "observe",
    });
  }
  for (let index = 0; index < warmupCount; index += 1) {
    invokeHook(index);
  }

  const latencies = [];
  for (let index = 0; index < sampleCount; index += 1) {
    latencies.push(invokeHook(warmupCount + index));
  }

  const p95 = percentile(latencies, 0.95);
  const p95WithinLimit = p95 < p95LimitMs;
  const liveStore = new LiveEventStore({ root: dataDir, env });
  const liveStatus = liveStore.status();
  const expectedEventCount = sampleCount + warmupCount;
  if (liveStatus?.committedSeq !== expectedEventCount) {
    throw new Error("Native hook did not publish every benchmark event.");
  }
  const traceStatus = traceStore.status();
  if (
    activeSemanticTrace
      ? traceStatus?.eventCount !== expectedEventCount
      : traceStatus !== null
  ) {
    throw new Error(
      activeSemanticTrace
        ? "Native explicit trace did not record every benchmark event."
        : "Native no-trace benchmark unexpectedly created an explicit trace.",
    );
  }
  const liveEvents = liveStore.readEvents();
  if (
    liveEvents.length !== expectedEventCount ||
    liveEvents.some((event) => event.platform !== "codex")
  ) {
    throw new Error("Native hook did not preserve the validated provider.");
  }
  console.log(
    JSON.stringify(
      {
        sampleCount,
        warmupCount,
        executionPath: "native_hook_launcher",
        nativeHelperIncluded: true,
        providerShellIncluded: false,
        innerShellShimIncluded: true,
        runtimeSource,
        runtimePrewarmIncludedInLatency: false,
        runtimePrewarmMs,
        activeSemanticTrace,
        traceEventCount: traceStatus?.eventCount ?? 0,
        alwaysOnLiveSpool: true,
        liveCommittedSequence: liveStatus.committedSeq,
        liveRetainedEventCount: liveStatus.eventCount,
        p95LimitMs,
        latencyMs: {
          p50: percentile(latencies, 0.5),
          p95,
          p99: percentile(latencies, 0.99),
          maximum: Math.max(...latencies),
        },
        p95WithinLimit,
      },
      null,
      2,
    ),
  );
  if (!p95WithinLimit) {
    process.exitCode = 1;
  }
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

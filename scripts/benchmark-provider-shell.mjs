#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { LiveEventStore } from "../src/live-event-store.mjs";
import { TraceStore } from "../src/trace-store.mjs";

const PROVIDERS = new Set(["codex", "claude"]);
const VALUE_ARGUMENTS = new Set([
  "--provider",
  "--samples",
  "--warmups",
  "--p95-ms",
  "--shell",
]);
const FLAG_ARGUMENTS = new Set(["--no-trace"]);
const CODEX_COMMAND =
  '/bin/sh -p "${PLUGIN_ROOT}/scripts/hook-launcher.sh" "${PLUGIN_ROOT}" codex';
const CLAUDE_COMMAND = "/bin/sh";
const CLAUDE_ARGUMENTS = [
  "-p",
  "${CLAUDE_PLUGIN_ROOT}/scripts/hook-launcher.sh",
  "${CLAUDE_PLUGIN_ROOT}",
  "claude",
];
const MANIFEST_EVENTS = {
  codex: ["UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"],
  claude: [
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "Stop",
  ],
};
const MANIFEST_DESCRIPTIONS = {
  codex:
    "Checks prompts and detects no-progress coding-agent loops locally in Codex.",
  claude:
    "Checks prompts and detects no-progress coding-agent loops locally in Claude Code.",
};
const CONTEXT_EVENTS = new Set([
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
]);

class SafeBenchmarkError extends Error {}

function fail(message) {
  throw new SafeBenchmarkError(message);
}

function parsePositiveInteger(value, name, maximum) {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]*$/u.test(value) ||
    value.length > 8
  ) {
    fail(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    fail(`${name} is outside the supported range.`);
  }
  return parsed;
}

function parseArguments(argv, env) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (FLAG_ARGUMENTS.has(argument)) {
      if (flags.has(argument)) fail("Duplicate benchmark argument.");
      flags.add(argument);
      continue;
    }
    if (!VALUE_ARGUMENTS.has(argument)) {
      fail("Unknown benchmark argument.");
    }
    if (values.has(argument)) fail("Duplicate benchmark argument.");
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      fail("Benchmark argument value is missing.");
    }
    values.set(argument, value);
    index += 1;
  }

  const provider = values.get("--provider");
  if (!PROVIDERS.has(provider)) {
    fail("--provider must be codex or claude.");
  }
  if (provider === "claude" && values.has("--shell")) {
    fail("--shell is valid only for the codex benchmark.");
  }
  const shell = provider === "codex"
    ? values.get("--shell") ?? env.SHELL ?? ""
    : null;
  if (provider === "codex" && shell === "") {
    fail("The codex benchmark requires an absolute user shell.");
  }

  return {
    provider,
    shell,
    sampleCount: values.has("--samples")
      ? parsePositiveInteger(values.get("--samples"), "--samples", 2_000)
      : 100,
    warmupCount: values.has("--warmups")
      ? parsePositiveInteger(values.get("--warmups"), "--warmups", 500)
      : 10,
    p95LimitMs: values.has("--p95-ms")
      ? parsePositiveInteger(values.get("--p95-ms"), "--p95-ms", 60_000)
      : 250,
    activeSemanticTrace: !flags.has("--no-trace"),
  };
}

function validateUserShell(shell) {
  if (!path.isAbsolute(shell)) {
    fail("The codex user shell must be an absolute path.");
  }
  let status;
  try {
    status = fs.lstatSync(shell);
  } catch {
    fail("The codex user shell is unavailable.");
  }
  const currentUser = typeof process.getuid === "function"
    ? process.getuid()
    : null;
  if (
    !status.isFile() ||
    status.isSymbolicLink() ||
    (status.mode & 0o111) === 0 ||
    (status.mode & 0o022) !== 0 ||
    (
      currentUser !== null &&
      status.uid !== 0 &&
      status.uid !== currentUser
    )
  ) {
    fail("The codex user shell failed executable-file validation.");
  }
  return shell;
}

function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    actual.every((key) => expected.includes(key)) &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function readProductionInvocation(projectRoot, provider) {
  const manifestFile = provider === "codex"
    ? path.join(projectRoot, "hooks", "hooks.json")
    : path.join(projectRoot, "hooks", "claude-hooks.json");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  } catch {
    fail("The production hook manifest could not be read.");
  }
  const expectedEvents = MANIFEST_EVENTS[provider];
  if (
    !hasExactKeys(manifest, ["description", "hooks"]) ||
    manifest.description !== MANIFEST_DESCRIPTIONS[provider] ||
    !isRecord(manifest.hooks) ||
    Object.keys(manifest.hooks).length !== expectedEvents.length ||
    expectedEvents.some(
      (eventName) => !Object.hasOwn(manifest.hooks, eventName),
    )
  ) {
    fail("The production hook manifest shape is not recognized.");
  }

  let selected = null;
  for (const eventName of expectedEvents) {
    const groups = manifest.hooks[eventName];
    if (
      !Array.isArray(groups) ||
      groups.length !== 1 ||
      !hasExactKeys(groups[0], ["hooks"]) ||
      !Array.isArray(groups[0].hooks) ||
      groups[0].hooks.length !== 1 ||
      !isRecord(groups[0].hooks[0])
    ) {
      fail("The production hook manifest shape is not recognized.");
    }
    const hook = groups[0].hooks[0];
    const expectedHookKeys = provider === "codex"
      ? CONTEXT_EVENTS.has(eventName)
        ? ["type", "command", "timeout", "additionalContextLimit"]
        : ["type", "command", "timeout"]
      : ["type", "command", "args", "timeout"];
    const valid = provider === "codex"
      ? hasExactKeys(hook, expectedHookKeys) &&
        hook.type === "command" &&
        hook.command === CODEX_COMMAND &&
        hook.timeout === 3 &&
        (
          CONTEXT_EVENTS.has(eventName)
            ? hook.additionalContextLimit === 2_500
            : hook.additionalContextLimit === undefined
        )
      : hasExactKeys(hook, expectedHookKeys) &&
        hook.type === "command" &&
        hook.command === CLAUDE_COMMAND &&
        JSON.stringify(hook.args) === JSON.stringify(CLAUDE_ARGUMENTS) &&
        hook.timeout === 3;
    if (!valid) {
      fail("The production hook command does not match the audited form.");
    }
    if (eventName === "PreToolUse") selected = hook;
  }
  return selected;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function privateDirectoryIdentity(directory) {
  const status = fs.lstatSync(directory);
  const currentUser = typeof process.getuid === "function"
    ? process.getuid()
    : null;
  if (
    !status.isDirectory() ||
    status.isSymbolicLink() ||
    (currentUser !== null && status.uid !== currentUser)
  ) {
    fail("The benchmark temporary directory failed ownership validation.");
  }
  return { dev: status.dev, ino: status.ino };
}

function samePrivateDirectory(directory, identity) {
  try {
    const current = privateDirectoryIdentity(directory);
    return current.dev === identity.dev && current.ino === identity.ino;
  } catch {
    return false;
  }
}

function invokeProductionHook({
  provider,
  shell,
  hook,
  projectRoot,
  env,
  workspace,
  index,
}) {
  const payload = {
    session_id: "synthetic-provider-shell-session",
    cwd: workspace,
    hook_event_name: "PreToolUse",
    turn_id: "synthetic-provider-shell-turn",
    tool_name: "Bash",
    tool_use_id: `synthetic-provider-shell-call-${index}`,
    tool_input: {
      command: `git status --short -- synthetic-${index}.txt`,
    },
  };
  const command = provider === "codex" ? shell : hook.command;
  const args = provider === "codex"
    ? ["-lc", hook.command]
    : hook.args.map((argument) =>
      argument.replaceAll("${CLAUDE_PLUGIN_ROOT}", projectRoot)
    );
  const startedAt = performance.now();
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env,
    input: JSON.stringify(payload),
    maxBuffer: 1024 * 1024,
    timeout: 10_000,
  });
  const elapsedMs = performance.now() - startedAt;
  if (result.error || result.status !== 0 || result.signal !== null) {
    fail("The production hook command did not complete successfully.");
  }
  try {
    const output = JSON.parse(result.stdout);
    if (!isRecord(output)) fail("The hook response was not a JSON object.");
  } catch (error) {
    if (error instanceof SafeBenchmarkError) throw error;
    fail("The production hook command returned invalid JSON.");
  }
  return elapsedMs;
}

function run() {
  const options = parseArguments(process.argv.slice(2), process.env);
  const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const hook = readProductionInvocation(projectRoot, options.provider);
  const shell = options.provider === "codex"
    ? validateUserShell(options.shell)
    : null;
  const previousUmask = process.umask(0o077);
  let temporaryRoot = null;
  let temporaryRootIdentity = null;
  let benchmarkResult = null;

  try {
    temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "awf-provider-shell-benchmark-"),
    );
    fs.chmodSync(temporaryRoot, 0o700);
    temporaryRootIdentity = privateDirectoryIdentity(temporaryRoot);
    const home = path.join(temporaryRoot, "home");
    const temporaryDirectory = path.join(temporaryRoot, "tmp");
    const dataDir = path.join(temporaryRoot, "data");
    const workspace = path.join(
      temporaryRoot,
      "workspace with spaces 한글",
    );
    for (const directory of [home, temporaryDirectory, dataDir, workspace]) {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    fs.mkdirSync(path.join(workspace, ".git"), { mode: 0o700 });

    const providerRootVariable = options.provider === "codex"
      ? {
          PLUGIN_ROOT: projectRoot,
          CLAUDE_PLUGIN_ROOT: projectRoot,
        }
      : { CLAUDE_PLUGIN_ROOT: projectRoot };
    const env = {
      HOME: home,
      TMPDIR: temporaryDirectory,
      LANG: "C",
      PATH: "/usr/bin:/bin",
      SHELL: shell ?? "/bin/sh",
      AWF_NODE_PATH: process.execPath,
      AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
      AGENT_WASTE_FIREWALL_MODE: "observe",
      ...providerRootVariable,
    };
    const traceStore = new TraceStore({ root: dataDir, env });
    if (options.activeSemanticTrace) {
      traceStore.start({
        workspace,
        label: "provider-shell-benchmark",
        mode: "observe",
      });
    }
    for (let index = 0; index < options.warmupCount; index += 1) {
      invokeProductionHook({
        ...options,
        hook,
        projectRoot,
        env,
        workspace,
        index,
      });
    }
    const latencies = [];
    for (let index = 0; index < options.sampleCount; index += 1) {
      latencies.push(
        invokeProductionHook({
          ...options,
          hook,
          projectRoot,
          env,
          workspace,
          index: options.warmupCount + index,
        }),
      );
    }

    const expectedEventCount =
      options.sampleCount + options.warmupCount;
    const liveStore = new LiveEventStore({ root: dataDir, env });
    const liveStatus = liveStore.status();
    const liveEvents = liveStore.readEvents();
    if (
      liveStatus?.committedSeq !== expectedEventCount ||
      liveStatus.eventCount !== expectedEventCount ||
      liveEvents.length !== expectedEventCount ||
      liveEvents.some(
        (event) =>
          event.platform !== options.provider ||
          event.kind !== "tool" ||
          event.ruleId !== null,
      )
    ) {
      fail("Semantic live-event verification failed.");
    }
    const traceStatus = traceStore.status();
    if (
      options.activeSemanticTrace
        ? traceStatus?.eventCount !== expectedEventCount ||
          traceStatus.incidentCount !== 0
        : traceStatus !== null
    ) {
      fail("Semantic trace verification failed.");
    }

    const p95 = percentile(latencies, 0.95);
    const p95WithinLimit = p95 < options.p95LimitMs;
    benchmarkResult = {
      benchmark: "provider_shell",
      provider: options.provider,
      sampleCount: options.sampleCount,
      warmupCount: options.warmupCount,
      executionPath: options.provider === "codex"
        ? "codex_manifest_via_user_login_shell"
        : "claude_manifest_exec_form",
      manifestCommandVerified: true,
      providerCreatedProcessIncluded: false,
      providerDispatchIncluded: false,
      innerShellShimIncluded: true,
      outerShellSemanticsIncluded: options.provider === "codex",
      codexDualRootEnvironmentIncluded: options.provider === "codex",
      workspacePathVariant: "spaces_and_unicode",
      activeSemanticTrace: options.activeSemanticTrace,
      traceEventCount: traceStatus?.eventCount ?? 0,
      semanticEventCount: liveStatus.committedSeq,
      semanticIncidentCount: liveStatus.incidentCount,
      p95LimitMs: options.p95LimitMs,
      latencyMs: {
        p50: percentile(latencies, 0.5),
        p95,
        p99: percentile(latencies, 0.99),
        maximum: Math.max(...latencies),
      },
      p95WithinLimit,
    };
  } finally {
    let cleanupFailed = false;
    try {
      if (temporaryRoot !== null) {
        if (
          temporaryRootIdentity !== null &&
          samePrivateDirectory(temporaryRoot, temporaryRootIdentity)
        ) {
          fs.rmSync(temporaryRoot, { recursive: true, force: true });
          cleanupFailed = fs.existsSync(temporaryRoot);
        } else {
          cleanupFailed = true;
        }
      }
    } catch {
      cleanupFailed = true;
    }
    process.umask(previousUmask);
    if (cleanupFailed) {
      fail("The benchmark temporary directory could not be cleaned safely.");
    }
  }
  process.stdout.write(`${JSON.stringify(benchmarkResult, null, 2)}\n`);
  if (!benchmarkResult.p95WithinLimit) process.exitCode = 1;
}

try {
  run();
} catch (error) {
  const message = error instanceof SafeBenchmarkError
    ? error.message
    : "The provider-shell benchmark failed unexpectedly.";
  process.stderr.write(`Provider-shell benchmark failed: ${message}\n`);
  process.exitCode = 1;
}

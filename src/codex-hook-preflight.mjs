import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const PLUGIN_NAME = "agent-waste-firewall";
const EXPECTED_PLUGIN_ID = `${PLUGIN_NAME}@${PLUGIN_NAME}`;
const EXPECTED_COMMAND =
  "/bin/sh -p \"${PLUGIN_ROOT}/scripts/hook-launcher.sh\" \"${PLUGIN_ROOT}\" codex";
const MAX_RESPONSE_BYTES = 256 * 1_024;
const MAX_COUNT = 1_000;
const MAX_WAIT_MS = 10_000;
const DEFAULT_WAIT_MS = 3_000;
const TRUST_STATES = new Set([
  "managed",
  "untrusted",
  "trusted",
  "modified",
]);
const HOOK_EVENTS = new Set([
  "preToolUse",
  "permissionRequest",
  "postToolUse",
  "preCompact",
  "postCompact",
  "sessionStart",
  "sessionEnd",
  "userPromptSubmit",
  "subagentStart",
  "subagentStop",
  "stop",
]);
const HANDLER_TYPES = new Set(["command", "prompt", "agent"]);
const HOOK_SOURCES = new Set([
  "system",
  "user",
  "project",
  "mdm",
  "sessionFlags",
  "plugin",
  "cloudRequirements",
  "cloudManagedConfig",
  "legacyManagedConfigFile",
  "legacyManagedConfigMdm",
  "unknown",
]);
const EVENT_STATES = new Set([
  "ready",
  "missing",
  "mismatch",
  "duplicate",
  "disabled",
  "untrusted",
  "modified",
]);
const RESULTS = new Set(["ready", "not_ready", "unavailable"]);
const REASONS = new Set([
  "exact_hooks_ready",
  "provider_not_found",
  "timed_out",
  "protocol_error",
  "provider_plugin_not_found",
  "discovery_errors",
  "discovery_warnings",
  "unexpected_hooks",
  "missing_hooks",
  "manifest_mismatch",
  "duplicate_hooks",
  "disabled_hooks",
  "modified_hooks",
  "untrusted_hooks",
]);
const RESULT_REASONS = Object.freeze({
  ready: new Set(["exact_hooks_ready"]),
  not_ready: new Set([
    "provider_plugin_not_found",
    "discovery_errors",
    "discovery_warnings",
    "unexpected_hooks",
    "missing_hooks",
    "manifest_mismatch",
    "duplicate_hooks",
    "disabled_hooks",
    "modified_hooks",
    "untrusted_hooks",
  ]),
  unavailable: new Set([
    "provider_not_found",
    "timed_out",
    "protocol_error",
  ]),
});
const ROOT_KEYS = [
  "v",
  "kind",
  "provider",
  "result",
  "reason",
  "checkedMs",
  "expectedHookCount",
  "discoveredHookCount",
  "unexpectedHookCount",
  "readyHookCount",
  "errorCount",
  "warningCount",
  "events",
];
const EVENT_KEYS = ["event", "state"];
const PROVIDER_ENVIRONMENT_KEYS = Object.freeze([
  "PATH",
  "Path",
  "HOME",
  "CODEX_HOME",
  "XDG_CONFIG_HOME",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "ComSpec",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
]);

export const CODEX_HOOK_PREFLIGHT_DEFAULT_WAIT_MS = DEFAULT_WAIT_MS;
export const CODEX_HOOK_PREFLIGHT_MAX_WAIT_MS = MAX_WAIT_MS;
export const CODEX_EXPECTED_HOOK_COMMAND = EXPECTED_COMMAND;
export const CODEX_EXPECTED_HOOKS = Object.freeze([
  Object.freeze({
    event: "userPromptSubmit",
    timeoutSec: 3,
    additionalContextLimit: 2_500,
  }),
  Object.freeze({
    event: "preToolUse",
    timeoutSec: 3,
    additionalContextLimit: 2_500,
  }),
  Object.freeze({
    event: "postToolUse",
    timeoutSec: 3,
    additionalContextLimit: 2_500,
  }),
  Object.freeze({
    event: "stop",
    timeoutSec: 3,
    additionalContextLimit: null,
  }),
]);

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(field) {
  throw new TypeError(`Invalid CodexHookPreflightV1 at ${field}.`);
}

function exactKeys(value, expected, field) {
  if (!isRecord(value)) fail(field);
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    actual.some((key) => !expected.includes(key)) ||
    expected.some(
      (key) => !Object.prototype.hasOwnProperty.call(value, key),
    )
  ) {
    fail(field);
  }
}

function boundedCount(value, field) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_COUNT
  ) {
    fail(field);
  }
}

export function validateCodexHookPreflight(value) {
  exactKeys(value, ROOT_KEYS, "preflight");
  if (value.v !== 1) fail("preflight.v");
  if (value.kind !== "codex_hook_preflight") fail("preflight.kind");
  if (value.provider !== "codex") fail("preflight.provider");
  if (!RESULTS.has(value.result)) fail("preflight.result");
  if (!REASONS.has(value.reason)) fail("preflight.reason");
  if (
    !Number.isSafeInteger(value.checkedMs) ||
    value.checkedMs < 0 ||
    value.checkedMs > MAX_WAIT_MS
  ) {
    fail("preflight.checkedMs");
  }
  for (const key of [
    "expectedHookCount",
    "discoveredHookCount",
    "unexpectedHookCount",
    "readyHookCount",
    "errorCount",
    "warningCount",
  ]) {
    boundedCount(value[key], `preflight.${key}`);
  }
  if (value.expectedHookCount !== CODEX_EXPECTED_HOOKS.length) {
    fail("preflight.expectedHookCount");
  }
  if (
    !Array.isArray(value.events) ||
    ![0, CODEX_EXPECTED_HOOKS.length].includes(value.events.length)
  ) {
    fail("preflight.events");
  }
  for (const [index, event] of value.events.entries()) {
    exactKeys(event, EVENT_KEYS, `preflight.events[${index}]`);
    if (event.event !== CODEX_EXPECTED_HOOKS[index].event) {
      fail(`preflight.events[${index}].event`);
    }
    if (!EVENT_STATES.has(event.state)) {
      fail(`preflight.events[${index}].state`);
    }
  }

  const readyEvents = value.events.filter(
    (event) => event.state === "ready",
  ).length;
  if (
    value.readyHookCount !== readyEvents ||
    value.readyHookCount > value.expectedHookCount ||
    value.discoveredHookCount < value.readyHookCount ||
    value.unexpectedHookCount > value.discoveredHookCount
  ) {
    fail("preflight");
  }
  if (
    value.result === "not_ready" &&
    value.events.length !== CODEX_EXPECTED_HOOKS.length
  ) {
    fail("preflight.events");
  }
  const requiredReasons = RESULT_REASONS[value.result];
  if (requiredReasons && !requiredReasons.has(value.reason)) {
    fail("preflight.reason");
  }
  if (
    value.result === "ready" &&
    (
      value.events.length !== CODEX_EXPECTED_HOOKS.length ||
      value.readyHookCount !== CODEX_EXPECTED_HOOKS.length ||
      value.discoveredHookCount !== CODEX_EXPECTED_HOOKS.length ||
      value.unexpectedHookCount !== 0 ||
      value.errorCount !== 0 ||
      value.warningCount !== 0
    )
  ) {
    fail("preflight");
  }
  if (
    value.result === "unavailable" &&
    (
      value.events.length !== 0 ||
      value.discoveredHookCount !== 0 ||
      value.unexpectedHookCount !== 0 ||
      value.readyHookCount !== 0 ||
      value.errorCount !== 0 ||
      value.warningCount !== 0
    )
  ) {
    fail("preflight");
  }
  if (
    value.result !== "unavailable" &&
    value.reason !== overallReason({
      errorCount: value.errorCount,
      warningCount: value.warningCount,
      discoveredHookCount: value.discoveredHookCount,
      unexpectedHookCount: value.unexpectedHookCount,
      states: value.events.map((event) => event.state),
    })
  ) {
    fail("preflight.reason");
  }
  return value;
}

function safeElapsed(startedAt, clock) {
  const elapsed = Number(clock()) - startedAt;
  if (!Number.isFinite(elapsed) || elapsed < 0) return 0;
  return Math.min(MAX_WAIT_MS, Math.max(0, Math.round(elapsed)));
}

function resultRecord({
  result,
  reason,
  checkedMs,
  discoveredHookCount = 0,
  unexpectedHookCount = 0,
  readyHookCount = 0,
  errorCount = 0,
  warningCount = 0,
  events = [],
}) {
  return validateCodexHookPreflight({
    v: 1,
    kind: "codex_hook_preflight",
    provider: "codex",
    result,
    reason,
    checkedMs,
    expectedHookCount: CODEX_EXPECTED_HOOKS.length,
    discoveredHookCount,
    unexpectedHookCount,
    readyHookCount,
    errorCount,
    warningCount,
    events,
  });
}

function boundedLength(value) {
  return Array.isArray(value)
    ? Math.min(MAX_COUNT, value.length)
    : 0;
}

function pluginIdentity(value) {
  return value === EXPECTED_PLUGIN_ID;
}

function expandedExpectedCommand(sourcePath) {
  if (
    typeof sourcePath !== "string" ||
    !path.isAbsolute(sourcePath) ||
    path.normalize(sourcePath) !== sourcePath ||
    /[\u0000-\u001f\u007f"\\$`]/u.test(sourcePath) ||
    path.basename(sourcePath) !== "hooks.json"
  ) {
    return null;
  }
  const hooksDirectory = path.dirname(sourcePath);
  if (path.basename(hooksDirectory) !== "hooks") return null;
  const pluginRoot = path.dirname(hooksDirectory);
  if (
    pluginRoot === path.parse(pluginRoot).root ||
    path.join(pluginRoot, "hooks", "hooks.json") !== sourcePath
  ) {
    return null;
  }
  return `/bin/sh -p "${pluginRoot}/scripts/hook-launcher.sh" "${pluginRoot}" codex`;
}

function exactHook(candidate, expected, expectedSourcePath) {
  const expandedCommand = expandedExpectedCommand(
    candidate.sourcePath,
  );
  return (
    candidate.sourcePath === expectedSourcePath &&
    candidate.handlerType === "command" &&
    typeof expandedCommand === "string" &&
    candidate.command === expandedCommand &&
    candidate.isManaged === false &&
    typeof candidate.currentHash === "string" &&
    candidate.currentHash.length > 0 &&
    candidate.currentHash.length <= 256 &&
    candidate.timeoutSec === expected.timeoutSec &&
    (candidate.additionalContextLimit ?? null) ===
      expected.additionalContextLimit &&
    (candidate.matcher ?? null) === null
  );
}

function optionalStringOrNull(value) {
  return (
    value === undefined ||
    value === null ||
    typeof value === "string"
  );
}

function validHookMetadata(hook) {
  return (
    isRecord(hook) &&
    typeof hook.currentHash === "string" &&
    Number.isSafeInteger(hook.displayOrder) &&
    typeof hook.enabled === "boolean" &&
    HOOK_EVENTS.has(hook.eventName) &&
    HANDLER_TYPES.has(hook.handlerType) &&
    typeof hook.isManaged === "boolean" &&
    typeof hook.key === "string" &&
    HOOK_SOURCES.has(hook.source) &&
    typeof hook.sourcePath === "string" &&
    Number.isSafeInteger(hook.timeoutSec) &&
    hook.timeoutSec >= 0 &&
    TRUST_STATES.has(hook.trustStatus) &&
    (
      hook.additionalContextLimit === undefined ||
      hook.additionalContextLimit === null ||
      (
        Number.isSafeInteger(hook.additionalContextLimit) &&
        hook.additionalContextLimit >= 0
      )
    ) &&
    optionalStringOrNull(hook.command) &&
    optionalStringOrNull(hook.matcher) &&
    optionalStringOrNull(hook.pluginId) &&
    optionalStringOrNull(hook.statusMessage)
  );
}

function eventState(candidates, expected, expectedSourcePath) {
  if (candidates.length === 0) return "missing";
  if (candidates.length !== 1) return "duplicate";
  const [candidate] = candidates;
  if (!exactHook(candidate, expected, expectedSourcePath)) {
    return "mismatch";
  }
  if (candidate.enabled !== true) return "disabled";
  if (candidate.trustStatus === "modified") return "modified";
  if (candidate.trustStatus !== "trusted") return "untrusted";
  return "ready";
}

function overallReason({
  errorCount,
  warningCount,
  discoveredHookCount,
  unexpectedHookCount,
  states,
}) {
  if (errorCount > 0) return "discovery_errors";
  if (warningCount > 0) return "discovery_warnings";
  if (discoveredHookCount === 0) return "provider_plugin_not_found";
  if (unexpectedHookCount > 0) return "unexpected_hooks";
  if (states.includes("duplicate")) return "duplicate_hooks";
  if (states.includes("missing")) return "missing_hooks";
  if (states.includes("mismatch")) return "manifest_mismatch";
  if (states.includes("disabled")) return "disabled_hooks";
  if (states.includes("modified")) return "modified_hooks";
  if (states.includes("untrusted")) return "untrusted_hooks";
  return "exact_hooks_ready";
}

export function projectCodexHookDiscovery(
  response,
  {
    checkedMs = 0,
    expectedCwd,
    expectedPluginRoot = null,
  } = {},
) {
  if (!isRecord(response) || !Array.isArray(response.data)) {
    return resultRecord({
      result: "unavailable",
      reason: "protocol_error",
      checkedMs,
    });
  }
  if (response.data.length !== 1 || !isRecord(response.data[0])) {
    return resultRecord({
      result: "unavailable",
      reason: "protocol_error",
      checkedMs,
    });
  }
  const entry = response.data[0];
  if (
    typeof expectedCwd !== "string" ||
    entry.cwd !== expectedCwd ||
    !Array.isArray(entry.hooks) ||
    !Array.isArray(entry.errors) ||
    !Array.isArray(entry.warnings) ||
    entry.hooks.some((hook) => !validHookMetadata(hook))
  ) {
    return resultRecord({
      result: "unavailable",
      reason: "protocol_error",
      checkedMs,
    });
  }
  const pluginHooks = entry.hooks.filter(
    (hook) =>
      isRecord(hook) &&
      hook.source === "plugin" &&
      pluginIdentity(hook.pluginId) &&
      TRUST_STATES.has(hook.trustStatus),
  );
  const expectedEvents = new Set(
    CODEX_EXPECTED_HOOKS.map((expected) => expected.event),
  );
  const unexpectedHookCount = pluginHooks.filter(
    (hook) => !expectedEvents.has(hook.eventName),
  ).length;
  const sourcePaths = new Set(
    pluginHooks.map((hook) => hook.sourcePath),
  );
  const sharedSourcePath =
    sourcePaths.size === 1 ? sourcePaths.values().next().value : null;
  const expectedSourcePath =
    typeof expectedPluginRoot === "string"
      ? path.join(expectedPluginRoot, "hooks", "hooks.json")
      : sharedSourcePath;
  const sourcePathMatches =
    sharedSourcePath !== null &&
    sharedSourcePath === expectedSourcePath;
  const events = CODEX_EXPECTED_HOOKS.map((expected) => {
    const candidates = pluginHooks.filter(
      (hook) => hook.eventName === expected.event,
    );
    return {
      event: expected.event,
      state: eventState(
        candidates,
        expected,
        sourcePathMatches ? expectedSourcePath : null,
      ),
    };
  });
  const states = events.map((event) => event.state);
  const errorCount = boundedLength(entry.errors);
  const warningCount = boundedLength(entry.warnings);
  const discoveredHookCount = Math.min(MAX_COUNT, pluginHooks.length);
  const readyHookCount = states.filter((state) => state === "ready").length;
  const reason = overallReason({
    errorCount,
    warningCount,
    discoveredHookCount,
    unexpectedHookCount: Math.min(MAX_COUNT, unexpectedHookCount),
    states,
  });
  return resultRecord({
    result: reason === "exact_hooks_ready" ? "ready" : "not_ready",
    reason,
    checkedMs,
    discoveredHookCount,
    unexpectedHookCount: Math.min(MAX_COUNT, unexpectedHookCount),
    readyHookCount,
    errorCount,
    warningCount,
    events,
  });
}

function sanitizedProviderEnvironment(source) {
  const environment = {};
  for (const key of PROVIDER_ENVIRONMENT_KEYS) {
    let value;
    try {
      value = source?.[key];
    } catch {
      continue;
    }
    if (typeof value === "string") environment[key] = value;
  }
  return environment;
}

function normalizedTimeout(value) {
  if (value === undefined) return DEFAULT_WAIT_MS;
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_WAIT_MS
  ) {
    throw new TypeError("Invalid Codex hook preflight timeout.");
  }
  return value;
}

function normalizedWorkspace(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Invalid Codex hook preflight workspace.");
  }
  let workspace;
  try {
    workspace = fs.realpathSync.native(path.resolve(value));
    if (!fs.statSync(workspace).isDirectory()) {
      throw new TypeError();
    }
  } catch {
    throw new TypeError("Invalid Codex hook preflight workspace.");
  }
  return workspace;
}

function normalizedPluginRoot(value) {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Invalid Codex hook preflight plugin root.");
  }
  let pluginRoot;
  try {
    pluginRoot = fs.realpathSync.native(path.resolve(value));
    if (!fs.statSync(pluginRoot).isDirectory()) {
      throw new TypeError();
    }
  } catch {
    throw new TypeError("Invalid Codex hook preflight plugin root.");
  }
  return pluginRoot;
}

function writeMessage(child, value) {
  if (!child.stdin || child.stdin.destroyed) return false;
  try {
    child.stdin.write(`${JSON.stringify(value)}\n`);
    return true;
  } catch {
    return false;
  }
}

function queryCodexHooks({
  cwd,
  env,
  timeoutMs,
  signal,
  command = "codex",
  commandArgs = ["app-server", "--stdio"],
  spawnImpl = spawn,
}) {
  return new Promise((resolve) => {
    let child;
    const useProcessGroup =
      process.platform !== "win32" && spawnImpl === spawn;
    try {
      child = spawnImpl(command, [...commandArgs], {
        cwd,
        env: sanitizedProviderEnvironment(env),
        detached: useProcessGroup,
        shell: false,
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      resolve({ outcome: "protocol_error" });
      return;
    }
    let settled = false;
    let phase = "await_initialize";
    let buffered = "";
    let receivedBytes = 0;
    let forceTimer = null;
    let finalOutcome = null;
    let finalValue;
    let completed = false;
    const complete = () => {
      if (completed) return;
      completed = true;
      if (forceTimer !== null) clearTimeout(forceTimer);
      resolve({ outcome: finalOutcome, value: finalValue });
    };
    const signalGroup = (childSignal) => {
      if (
        !useProcessGroup ||
        !Number.isSafeInteger(child.pid) ||
        child.pid <= 0
      ) {
        return false;
      }
      try {
        process.kill(-child.pid, childSignal);
        return true;
      } catch {
        return false;
      }
    };
    const signalChild = (childSignal) => {
      if (
        !Number.isSafeInteger(child.pid) ||
        child.pid <= 0 ||
        child.exitCode !== null ||
        child.signalCode !== null
      ) {
        return;
      }
      if (signalGroup(childSignal)) return;
      try {
        child.kill(childSignal);
      } catch {
        // The process may already have exited.
      }
    };
    const onAbort = () => finish("protocol_error");
    const finish = (outcome, value = undefined) => {
      if (settled) return;
      settled = true;
      finalOutcome = outcome;
      finalValue = value;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      try {
        child.stdin?.end();
      } catch {
        // The process may already have exited.
      }
      if (
        Number.isSafeInteger(child.pid) &&
        child.pid > 0 &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        signalChild("SIGTERM");
        forceTimer = setTimeout(() => {
          if (!signalGroup("SIGKILL")) signalChild("SIGKILL");
          complete();
        }, 250);
        forceTimer.unref?.();
      } else {
        if (useProcessGroup) signalGroup("SIGKILL");
        complete();
      }
    };
    const timer = setTimeout(() => finish("timed_out"), timeoutMs);
    timer.unref?.();

    child.once("error", (error) => {
      finish(error?.code === "ENOENT" ? "not_found" : "protocol_error");
    });
    child.stdin?.once("error", () => finish("protocol_error"));
    child.once("exit", () => {
      if (!settled) {
        finish("protocol_error");
      } else {
        if (useProcessGroup) signalGroup("SIGKILL");
        complete();
      }
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      if (settled) return;
      receivedBytes += Buffer.byteLength(chunk, "utf8");
      if (receivedBytes > MAX_RESPONSE_BYTES) {
        finish("protocol_error");
        return;
      }
      buffered += chunk;
      while (buffered.includes("\n")) {
        const newline = buffered.indexOf("\n");
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          finish("protocol_error");
          return;
        }
        if (!isRecord(message)) {
          finish("protocol_error");
          return;
        }
        if (message.id === 1) {
          if (
            phase !== "await_initialize" ||
            !isRecord(message.result) ||
            message.error !== undefined
          ) {
            finish("protocol_error");
            return;
          }
          phase = "await_hooks";
          if (
            !writeMessage(child, {
              method: "initialized",
              params: {},
            }) ||
            !writeMessage(child, {
              id: 2,
              method: "hooks/list",
              params: { cwds: [cwd] },
            })
          ) {
            finish("protocol_error");
          }
        } else if (message.id === 2) {
          if (
            phase !== "await_hooks" ||
            !isRecord(message.result) ||
            message.error !== undefined
          ) {
            finish("protocol_error");
            return;
          }
          phase = "done";
          finish("ok", message.result);
        }
      }
    });

    if (
      !writeMessage(child, {
        id: 1,
        method: "initialize",
        params: {
          clientInfo: {
            name: PLUGIN_NAME,
            version: "0.1.0",
          },
          capabilities: {
            experimentalApi: false,
            requestAttestation: false,
          },
        },
      })
    ) {
      finish("protocol_error");
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export async function runCodexHookPreflight({
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = DEFAULT_WAIT_MS,
  expectedPluginRoot,
  signal,
  query = queryCodexHooks,
  queryOptions = {},
  clock = () => performance.now(),
} = {}) {
  const normalizedWait = normalizedTimeout(timeoutMs);
  const workspace = normalizedWorkspace(cwd);
  const pluginRoot = normalizedPluginRoot(expectedPluginRoot);
  const startedAt = Number(clock());
  if (!Number.isFinite(startedAt)) {
    throw new TypeError("Invalid Codex hook preflight clock.");
  }
  let queryResult;
  try {
    queryResult = await query({
      ...queryOptions,
      cwd: workspace,
      env,
      timeoutMs: normalizedWait,
      signal,
    });
  } catch {
    queryResult = { outcome: "protocol_error" };
  }
  const checkedMs = safeElapsed(startedAt, clock);
  if (queryResult?.outcome === "ok") {
    return projectCodexHookDiscovery(queryResult.value, {
      checkedMs,
      expectedCwd: workspace,
      expectedPluginRoot: pluginRoot,
    });
  }
  const reason = queryResult?.outcome === "not_found"
    ? "provider_not_found"
    : queryResult?.outcome === "timed_out"
      ? "timed_out"
      : "protocol_error";
  return resultRecord({
    result: "unavailable",
    reason,
    checkedMs,
  });
}

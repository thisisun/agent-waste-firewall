import { execFile, spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const PROVIDERS = ["codex", "claude"];
const STATES = new Set([
  "not_detected",
  "needs_install",
  "needs_enable",
  "installed_unverified",
  "active",
  "unknown",
]);
const ACTIVITIES = new Set([
  "not_observed",
  "observed",
  "unknown",
]);
const STATUS_KEYS = ["v", "kind", "providers"];
const PROVIDER_KEYS = ["provider", "state", "version", "activity"];
const VERSION_KEYS = ["major", "minor", "patch"];
const MAX_VERSION_COMPONENT = 999_999;
const MAX_VERSION_OUTPUT_BYTES = 256;
const MAX_PLUGIN_OUTPUT_BYTES = 256 * 1_024;
const PROVIDER_PROBE_TIMEOUT_MS = 3_000;
const PLUGIN_NAME = "agent-waste-firewall";
const PROVIDER_ENVIRONMENT_KEYS = Object.freeze([
  "PATH",
  "Path",
  "HOME",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
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
  "ProgramData",
  "PROGRAMDATA",
  "ProgramFiles",
  "PROGRAMFILES",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "HOMEDRIVE",
  "HOMEPATH",
  "SystemDrive",
  "SYSTEMDRIVE",
]);

function fail(field) {
  throw new TypeError(`Invalid ProviderIntegrationStatusV1 at ${field}.`);
}

function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
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

function validateVersion(value, field) {
  if (value === null) return;
  exactKeys(value, VERSION_KEYS, field);
  for (const key of VERSION_KEYS) {
    if (
      !Number.isSafeInteger(value[key]) ||
      value[key] < 0 ||
      value[key] > MAX_VERSION_COMPONENT
    ) {
      fail(`${field}.${key}`);
    }
  }
}

function validateProvider(value, expectedProvider, index) {
  const field = `status.providers[${index}]`;
  exactKeys(value, PROVIDER_KEYS, field);
  if (value.provider !== expectedProvider) fail(`${field}.provider`);
  if (!STATES.has(value.state)) fail(`${field}.state`);
  if (!ACTIVITIES.has(value.activity)) fail(`${field}.activity`);
  validateVersion(value.version, `${field}.version`);

  const detected = value.state !== "not_detected" &&
    value.state !== "unknown";
  if (
    (value.state === "not_detected" && value.version !== null) ||
    (detected && value.version === null) ||
    (value.state === "active" && value.activity !== "observed") ||
    (value.activity === "observed" &&
      !["active", "unknown"].includes(value.state))
  ) {
    fail(field);
  }
}

export function validateProviderIntegrationStatus(value) {
  exactKeys(value, STATUS_KEYS, "status");
  if (value.v !== 1) fail("status.v");
  if (value.kind !== "provider_integration_status") {
    fail("status.kind");
  }
  if (!Array.isArray(value.providers) || value.providers.length !== 2) {
    fail("status.providers");
  }
  for (const [index, provider] of PROVIDERS.entries()) {
    validateProvider(value.providers[index], provider, index);
  }
  return value;
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
    if (typeof value === "string") {
      environment[key] = value;
    }
  }
  return Object.freeze(environment);
}

function providerRunnerMetadata(source) {
  return Object.freeze({
    env: sanitizedProviderEnvironment(source),
  });
}

function defaultRunner(
  command,
  args,
  metadata,
  timeoutMs = PROVIDER_PROBE_TIMEOUT_MS,
) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...metadata.env },
    shell: false,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: MAX_PLUGIN_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error?.code === "ENOENT") {
    return { outcome: "not_found" };
  }
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") {
    return { outcome: "failed" };
  }
  return { outcome: "ok", output: result.stdout };
}

function defaultAsyncRunner(
  command,
  args,
  metadata,
  timeoutMs = PROVIDER_PROBE_TIMEOUT_MS,
  signal = undefined,
) {
  return new Promise((resolve) => {
    let settled = false;
    let timeout = null;
    let child = null;
    const abort = () => {
      try {
        child?.kill("SIGKILL");
      } catch {
        // The child may already have exited.
      }
      finish({ outcome: "failed" });
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timeout !== null) clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      resolve(value);
    };
    if (signal?.aborted) {
      finish({ outcome: "failed" });
      return;
    }
    child = execFile(
      command,
      args,
      {
        encoding: "utf8",
        env: { ...metadata.env },
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: MAX_PLUGIN_OUTPUT_BYTES,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error?.code === "ENOENT") {
          finish({ outcome: "not_found" });
        } else if (error || typeof stdout !== "string") {
          finish({ outcome: "failed" });
        } else {
          finish({ outcome: "ok", output: stdout });
        }
      },
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    timeout = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The child may already have exited.
      }
      finish({ outcome: "failed" });
    }, timeoutMs);
    timeout.unref?.();
  });
}

function normalizedRunResult(result, maximumBytes) {
  if (!isRecord(result)) return { outcome: "failed" };
  if (result.outcome === "not_found") {
    return { outcome: "not_found" };
  }
  if (
    result.outcome !== "ok" ||
    typeof result.output !== "string" ||
    Buffer.byteLength(result.output, "utf8") > maximumBytes
  ) {
    return { outcome: "failed" };
  }
  return { outcome: "ok", output: result.output };
}

function run(
  runner,
  command,
  args,
  maximumBytes,
  metadata,
  timeoutMs,
) {
  try {
    return normalizedRunResult(
      runner(
        command,
        [...args],
        metadata,
        Object.freeze({ timeoutMs }),
      ),
      maximumBytes,
    );
  } catch {
    return { outcome: "failed" };
  }
}

async function runAsync(
  runner,
  command,
  args,
  maximumBytes,
  metadata,
  timeoutMs,
  signal,
) {
  let timeout = null;
  let abort = null;
  try {
    if (signal?.aborted) return { outcome: "failed" };
    const timeoutResult = new Promise((resolve) => {
      timeout = setTimeout(
        () => resolve({ outcome: "failed" }),
        timeoutMs,
      );
    });
    const abortResult = new Promise((resolve) => {
      if (!signal) return;
      abort = () => resolve({ outcome: "failed" });
      signal.addEventListener("abort", abort, { once: true });
    });
    return normalizedRunResult(
      await Promise.race([
        Promise.resolve(
          runner(
            command,
            [...args],
            metadata,
            Object.freeze({ timeoutMs, signal }),
          ),
        ),
        timeoutResult,
        abortResult,
      ]),
      maximumBytes,
    );
  } catch {
    return { outcome: "failed" };
  } finally {
    if (timeout !== null) clearTimeout(timeout);
    if (abort !== null) signal?.removeEventListener("abort", abort);
  }
}

function probeTimeout(value) {
  if (value === undefined) return PROVIDER_PROBE_TIMEOUT_MS;
  const numeric = Number(value);
  if (
    !Number.isSafeInteger(numeric) ||
    numeric < 1 ||
    numeric > PROVIDER_PROBE_TIMEOUT_MS
  ) {
    throw new TypeError("Invalid provider probe timeout.");
  }
  return numeric;
}

function parseVersion(provider, output) {
  const value = output.trim();
  const prefix = provider === "codex"
    ? "(?:codex-cli\\s+)?"
    : "(?:claude(?:\\s+code)?\\s+)?";
  const suffix = provider === "claude"
    ? "(?:\\s+\\(Claude Code\\))?"
    : "";
  const match = new RegExp(
    `^${prefix}v?([0-9]{1,6})\\.([0-9]{1,6})\\.([0-9]{1,6})(?:-[0-9A-Za-z.-]{1,64})?${suffix}$`,
    "iu",
  ).exec(value);
  if (!match) return null;
  const version = {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
  return Object.values(version).every(
    (component) => component <= MAX_VERSION_COMPONENT,
  )
    ? version
    : null;
}

function pluginEntries(value, provider) {
  if (Array.isArray(value)) {
    // `claude plugin list --json` returns the installed collection directly
    // in current releases, without repeating `installed: true` per entry.
    return {
      entries: value,
      installedCollection: provider === "claude",
      canonicalIdentityRequired: provider === "claude",
    };
  }
  if (!isRecord(value)) return null;
  if (Array.isArray(value.installed)) {
    return {
      entries: value.installed,
      installedCollection: true,
      canonicalIdentityRequired: false,
    };
  }
  if (Array.isArray(value.plugins)) {
    return {
      entries: value.plugins,
      installedCollection: false,
      canonicalIdentityRequired: false,
    };
  }
  return null;
}

function codexPluginIdentity(value) {
  return (
    value === PLUGIN_NAME ||
    (typeof value === "string" &&
      value.startsWith(`${PLUGIN_NAME}@`) &&
      value.length > PLUGIN_NAME.length + 1)
  );
}

function pluginEntryIdentity(
  provider,
  entry,
  canonicalIdentityRequired,
) {
  if (provider === "claude") {
    const qualifiedIdentities = [entry.id, entry.pluginId].filter(
      (value) => typeof value === "string",
    );
    if (qualifiedIdentities.length > 0) {
      return qualifiedIdentities.every(
        (value) => value === `${PLUGIN_NAME}@${PLUGIN_NAME}`,
      );
    }
    return !canonicalIdentityRequired && entry.name === PLUGIN_NAME;
  }
  return [entry.name, entry.id, entry.pluginId].some(codexPluginIdentity);
}

function statusFlags(status) {
  switch (status) {
    case "enabled":
    case "installed_enabled":
      return { installed: true, enabled: true };
    case "disabled":
    case "installed_disabled":
      return { installed: true, enabled: false };
    case "installed":
      return { installed: true, enabled: null };
    case "not_installed":
      return { installed: false, enabled: false };
    default:
      return { installed: null, enabled: null };
  }
}

function parsePluginList(provider, output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  const collection = pluginEntries(parsed, provider);
  if (
    collection === null ||
    collection.entries.some((entry) => !isRecord(entry))
  ) {
    return null;
  }
  const matches = collection.entries.filter((entry) =>
    pluginEntryIdentity(
      provider,
      entry,
      collection.canonicalIdentityRequired,
    )
  );
  if (matches.length === 0) {
    return { installed: false, enabled: false };
  }
  if (matches.length !== 1) return null;

  const entry = matches[0];
  const flags = statusFlags(entry.status);
  const installed = typeof entry.installed === "boolean"
    ? entry.installed
    : flags.installed ?? (collection.installedCollection ? true : null);
  const enabled = typeof entry.enabled === "boolean"
    ? entry.enabled
    : flags.enabled;
  if (installed === null) return null;
  return {
    installed,
    enabled: installed ? enabled : false,
  };
}

function normalizedActivity(activityByProvider, provider) {
  const value = activityByProvider?.[provider] ?? "unknown";
  return ACTIVITIES.has(value) ? value : "unknown";
}

function evaluateVersionResult(provider, activity, versionResult) {
  if (versionResult.outcome === "not_found") {
    return {
      status: {
        provider,
        state: activity === "observed" ? "unknown" : "not_detected",
        version: null,
        activity,
      },
    };
  }
  if (versionResult.outcome !== "ok") {
    return {
      status: {
        provider,
        state: "unknown",
        version: null,
        activity,
      },
    };
  }

  const version = parseVersion(provider, versionResult.output);
  if (version === null) {
    return {
      status: {
        provider,
        state: "unknown",
        version: null,
        activity,
      },
    };
  }
  return { version };
}

function evaluatePluginResult(provider, activity, version, listResult) {
  if (listResult.outcome !== "ok") {
    return { provider, state: "unknown", version, activity };
  }
  const plugin = parsePluginList(provider, listResult.output);
  if (plugin === null) {
    return { provider, state: "unknown", version, activity };
  }
  if (!plugin.installed) {
    return {
      provider,
      state: activity === "observed" ? "unknown" : "needs_install",
      version,
      activity,
    };
  }
  if (plugin.enabled === false) {
    return {
      provider,
      state: activity === "observed" ? "unknown" : "needs_enable",
      version,
      activity,
    };
  }
  return {
    provider,
    state: activity === "observed" ? "active" : "installed_unverified",
    version,
    activity,
  };
}

function probeProvider(
  provider,
  runner,
  activityByProvider,
  metadata,
  timeoutMs,
) {
  const deadline = performance.now() + timeoutMs;
  const remainingBudget = () =>
    Math.max(0, Math.ceil(deadline - performance.now()));
  const activity = normalizedActivity(activityByProvider, provider);
  const versionResult = run(
    runner,
    provider,
    ["--version"],
    MAX_VERSION_OUTPUT_BYTES,
    metadata,
    Math.max(1, remainingBudget()),
  );
  const evaluated = evaluateVersionResult(
    provider,
    activity,
    versionResult,
  );
  if (evaluated.status) return evaluated.status;
  const listBudget = remainingBudget();
  if (listBudget < 1) {
    return evaluatePluginResult(
      provider,
      activity,
      evaluated.version,
      { outcome: "failed" },
    );
  }
  const listResult = run(
    runner,
    provider,
    ["plugin", "list", "--json"],
    MAX_PLUGIN_OUTPUT_BYTES,
    metadata,
    listBudget,
  );
  return evaluatePluginResult(
    provider,
    activity,
    evaluated.version,
    listResult,
  );
}

async function probeProviderAsync(
  provider,
  runner,
  activityByProvider,
  metadata,
  timeoutMs,
  signal,
) {
  const deadline = performance.now() + timeoutMs;
  const remainingBudget = () =>
    Math.max(0, Math.ceil(deadline - performance.now()));
  const activity = normalizedActivity(activityByProvider, provider);
  const versionResult = await runAsync(
    runner,
    provider,
    ["--version"],
    MAX_VERSION_OUTPUT_BYTES,
    metadata,
    Math.max(1, remainingBudget()),
    signal,
  );
  const evaluated = evaluateVersionResult(
    provider,
    activity,
    versionResult,
  );
  if (evaluated.status) return evaluated.status;
  if (signal?.aborted) {
    return evaluatePluginResult(
      provider,
      activity,
      evaluated.version,
      { outcome: "failed" },
    );
  }
  const listBudget = remainingBudget();
  if (listBudget < 1) {
    return evaluatePluginResult(
      provider,
      activity,
      evaluated.version,
      { outcome: "failed" },
    );
  }
  const listResult = await runAsync(
    runner,
    provider,
    ["plugin", "list", "--json"],
    MAX_PLUGIN_OUTPUT_BYTES,
    metadata,
    listBudget,
    signal,
  );
  return evaluatePluginResult(
    provider,
    activity,
    evaluated.version,
    listResult,
  );
}

export function providerIntegrationStatus(options = {}) {
  const timeoutMs = probeTimeout(options.probeTimeoutMs);
  const runner =
    options.runner ??
    ((command, args, metadata, runOptions) =>
      defaultRunner(
        command,
        args,
        metadata,
        runOptions?.timeoutMs ?? timeoutMs,
      ));
  const metadata = providerRunnerMetadata(options.env ?? process.env);
  return validateProviderIntegrationStatus({
    v: 1,
    kind: "provider_integration_status",
    providers: PROVIDERS.map((provider) =>
      probeProvider(
        provider,
        runner,
        options.activityByProvider,
        metadata,
        timeoutMs,
      )
    ),
  });
}

export async function providerIntegrationStatusAsync(options = {}) {
  const timeoutMs = probeTimeout(options.probeTimeoutMs);
  const signal = options.signal;
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError("Invalid provider probe signal.");
  }
  const runner =
    options.runner ??
    ((command, args, metadata, runOptions) =>
      defaultAsyncRunner(
        command,
        args,
        metadata,
        runOptions?.timeoutMs ?? timeoutMs,
        runOptions?.signal,
      ));
  const metadata = providerRunnerMetadata(options.env ?? process.env);
  const providers = await Promise.all(
    PROVIDERS.map((provider) =>
      probeProviderAsync(
        provider,
        runner,
        options.activityByProvider,
        metadata,
        timeoutMs,
        signal,
      )
    ),
  );
  return validateProviderIntegrationStatus({
    v: 1,
    kind: "provider_integration_status",
    providers,
  });
}

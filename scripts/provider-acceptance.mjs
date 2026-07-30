#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { LiveEventStore } from "../src/live-event-store.mjs";
import {
  CODEX_EXPECTED_HOOKS,
  validateCodexHookPreflight,
} from "../src/codex-hook-preflight.mjs";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const MARKETPLACE_NAME = "agent-waste-firewall";
const PLUGIN_NAME = "agent-waste-firewall";
const CODEX_APP_BINARY =
  "/Applications/ChatGPT.app/Contents/Resources/codex";
const REQUIRED_HOOK_EVENTS = Object.freeze([
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
]);
const CONTEXT_HOOK_EVENTS = new Set([
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
]);
const EXPECTED_HOOK_COMMAND =
  '/bin/sh -p "${PLUGIN_ROOT}/scripts/hook-launcher.sh" "${PLUGIN_ROOT}" codex';
const PREFLIGHT_PROBE = path.join(
  PROJECT_ROOT,
  "scripts",
  "codex-hook-preflight-probe.mjs",
);
const MAX_COMMAND_OUTPUT_BYTES = 256 * 1024;
const MAX_AUDIT_BYTES = 32 * 1024 * 1024;
const MAX_AUDIT_FILES = 2_048;
const MAX_STAGE_BYTES = 8 * 1024 * 1024;
const MAX_STAGE_FILES = 256;
const MAX_DURATION_MS = 10 * 60 * 1_000;
const SAFE_ENVIRONMENT_KEYS = Object.freeze([
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NO_COLOR",
  "TERM",
  "TZ",
]);

const ACCEPTANCE_BUNDLE_PATHS = Object.freeze([
  ".codex-plugin/plugin.json",
  "hooks/hooks.json",
  "scripts/hook-launcher.sh",
  "scripts/hook.mjs",
  "src",
  "package.json",
  "LICENSE",
]);

const FAILURE_CODES = new Set([
  "none",
  "codex_unavailable",
  "codex_probe_failed",
  "package_stage_failed",
  "marketplace_add_failed",
  "plugin_install_failed",
  "plugin_list_failed",
  "installed_hook_missing",
  "provider_hook_discovery_failed",
  "provider_scratch_cleanup_failed",
  "hook_failed",
  "event_missing",
  "privacy_violation",
  "cleanup_failed",
  "internal_failure",
]);
const RESULTS = new Set(["passed", "failed", "skipped"]);
const CODEX_STATES = new Set(["available", "unavailable", "unknown"]);
const REPORT_KEYS = [
  "v",
  "kind",
  "result",
  "failure",
  "codex",
  "checks",
  "durationsMs",
];
const CHECK_KEYS = [
  "codexDetected",
  "packageStaged",
  "marketplaceAdded",
  "pluginInstalled",
  "pluginListed",
  "installedHookFound",
  "providerHooksDiscovered",
  "hookExecuted",
  "eventProduced",
  "privacyPreserved",
  "cleanupSucceeded",
];
const DURATION_KEYS = [
  "total",
  "probe",
  "packageStage",
  "marketplaceAdd",
  "pluginInstall",
  "pluginList",
  "hookDiscovery",
  "hook",
  "audit",
  "cleanup",
];

function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(value, expected) {
  return (
    isRecord(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => expected.includes(key))
  );
}

function fail(field) {
  throw new TypeError(`Invalid CodexProviderAcceptanceV1 at ${field}.`);
}

export function validateProviderAcceptanceReport(value) {
  if (!hasExactKeys(value, REPORT_KEYS)) fail("report");
  if (value.v !== 1) fail("report.v");
  if (value.kind !== "codex_provider_acceptance") fail("report.kind");
  if (!RESULTS.has(value.result)) fail("report.result");
  if (!FAILURE_CODES.has(value.failure)) fail("report.failure");
  if (!CODEX_STATES.has(value.codex)) fail("report.codex");
  if (!hasExactKeys(value.checks, CHECK_KEYS)) fail("report.checks");
  for (const key of CHECK_KEYS) {
    if (typeof value.checks[key] !== "boolean") {
      fail(`report.checks.${key}`);
    }
  }
  if (!hasExactKeys(value.durationsMs, DURATION_KEYS)) {
    fail("report.durationsMs");
  }
  for (const key of DURATION_KEYS) {
    const duration = value.durationsMs[key];
    if (
      !Number.isSafeInteger(duration) ||
      duration < 0 ||
      duration > MAX_DURATION_MS
    ) {
      fail(`report.durationsMs.${key}`);
    }
  }
  if (
    (value.result === "passed" && value.failure !== "none") ||
    (value.result !== "passed" && value.failure === "none") ||
    (value.result === "passed" &&
      CHECK_KEYS.some((key) => value.checks[key] !== true)) ||
    (value.result === "skipped" &&
      value.failure !== "codex_unavailable")
  ) {
    fail("report.consistency");
  }
  const checks = value.checks;
  const prerequisitePairs = [
    ["packageStaged", "codexDetected"],
    ["marketplaceAdded", "packageStaged"],
    ["pluginInstalled", "marketplaceAdded"],
    ["pluginListed", "pluginInstalled"],
    ["installedHookFound", "pluginListed"],
    ["providerHooksDiscovered", "installedHookFound"],
    ["hookExecuted", "providerHooksDiscovered"],
    ["eventProduced", "hookExecuted"],
    ["privacyPreserved", "hookExecuted"],
  ];
  if (
    prerequisitePairs.some(
      ([current, prerequisite]) =>
        checks[current] && !checks[prerequisite],
    ) ||
    checks.codexDetected !== (value.codex === "available") ||
    (!checks.cleanupSucceeded && value.failure !== "cleanup_failed") ||
    (checks.cleanupSucceeded && value.failure === "cleanup_failed") ||
    (value.failure === "codex_unavailable" &&
      (value.result !== "skipped" || value.codex !== "unavailable")) ||
    (value.result === "skipped" &&
      (value.codex !== "unavailable" ||
        CHECK_KEYS.slice(0, -1).some((key) => checks[key]) ||
        !checks.cleanupSucceeded))
  ) {
    fail("report.consistency");
  }
  return value;
}

function emptyReport() {
  return {
    v: 1,
    kind: "codex_provider_acceptance",
    result: "failed",
    failure: "internal_failure",
    codex: "unknown",
    checks: Object.fromEntries(CHECK_KEYS.map((key) => [key, false])),
    durationsMs: Object.fromEntries(
      DURATION_KEYS.map((key) => [key, 0]),
    ),
  };
}

function durationSince(clock, startedAt) {
  const elapsed = Number(clock()) - Number(startedAt);
  if (!Number.isFinite(elapsed)) return 0;
  return Math.min(MAX_DURATION_MS, Math.max(0, Math.round(elapsed)));
}

function markFailed(report, failure) {
  report.result = "failed";
  report.failure = FAILURE_CODES.has(failure) ? failure : "internal_failure";
}

export function runProviderAcceptanceCommand({
  command,
  args,
  cwd,
  env,
  input,
  timeoutMs,
  maxOutputBytes,
  killSignal = "SIGKILL",
}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    input,
    encoding: "utf8",
    shell: false,
    timeout: timeoutMs,
    killSignal,
    maxBuffer: maxOutputBytes,
    windowsHide: true,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
  });
  if (result.error?.code === "ENOENT") {
    return { outcome: "not_found", stdout: "" };
  }
  if (result.error || result.status !== 0) {
    return { outcome: "failed", stdout: "" };
  }
  return {
    outcome: "ok",
    stdout: typeof result.stdout === "string" ? result.stdout : "",
  };
}

function runBounded(runner, specification) {
  let result;
  try {
    result = runner({
      ...specification,
      args: [...specification.args],
      maxOutputBytes:
        specification.maxOutputBytes ?? MAX_COMMAND_OUTPUT_BYTES,
    });
  } catch {
    return { outcome: "failed", stdout: "" };
  }
  if (
    !isRecord(result) ||
    !["ok", "failed", "not_found"].includes(result.outcome)
  ) {
    return { outcome: "failed", stdout: "" };
  }
  if (result.outcome !== "ok") {
    return { outcome: result.outcome, stdout: "" };
  }
  if (
    typeof result.stdout !== "string" ||
    Buffer.byteLength(result.stdout, "utf8") >
      (specification.maxOutputBytes ?? MAX_COMMAND_OUTPUT_BYTES)
  ) {
    return { outcome: "failed", stdout: "" };
  }
  return { outcome: "ok", stdout: result.stdout };
}

function assertPrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (uid !== null && stat.uid !== uid)
  ) {
    throw new Error("Unsafe acceptance directory.");
  }
  if ((stat.mode & 0o077) !== 0) fs.chmodSync(directory, 0o700);
}

function acceptanceTempParent(candidate = os.tmpdir()) {
  const systemTemp = fs.realpathSync(os.tmpdir());
  const supplied = path.resolve(candidate);
  const suppliedStat = fs.lstatSync(supplied);
  const resolved = fs.realpathSync(supplied);
  const relative = path.relative(systemTemp, resolved);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    !suppliedStat.isDirectory() ||
    suppliedStat.isSymbolicLink() ||
    (uid !== null && suppliedStat.uid !== uid) ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Unsafe acceptance temp parent.");
  }
  return resolved;
}

function privateDirectoryIdentity(directory) {
  const stat = fs.lstatSync(directory);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (uid !== null && stat.uid !== uid)
  ) {
    throw new Error("Unsafe acceptance directory identity.");
  }
  return { dev: stat.dev, ino: stat.ino };
}

function samePrivateDirectory(directory, identity) {
  try {
    const current = privateDirectoryIdentity(directory);
    return current.dev === identity.dev && current.ino === identity.ino;
  } catch {
    return false;
  }
}

function packagePathAllowed(relativePath, packageFiles) {
  if (relativePath === "package.json" || relativePath === "LICENSE") {
    return true;
  }
  return packageFiles.some((entry) => {
    const normalized = String(entry).replace(/\/+$/u, "");
    return (
      relativePath === normalized ||
      relativePath.startsWith(`${normalized}/`)
    );
  });
}

function copyClosedEntry(source, destination, budget) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    throw new Error("Acceptance bundle rejected a symlink.");
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") {
        throw new Error("Acceptance bundle rejected an unexpected directory.");
      }
      copyClosedEntry(
        path.join(source, entry.name),
        path.join(destination, entry.name),
        budget,
      );
    }
    return;
  }
  if (!stat.isFile()) {
    throw new Error("Acceptance bundle rejected a special file.");
  }
  budget.files += 1;
  budget.bytes += stat.size;
  if (budget.files > MAX_STAGE_FILES || budget.bytes > MAX_STAGE_BYTES) {
    throw new Error("Acceptance bundle exceeded its closed size budget.");
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, stat.mode & 0o111 ? 0o700 : 0o600);
}

function defaultStageBundle({ marketplaceRoot, projectRoot }) {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
  );
  if (
    !isRecord(packageJson) ||
    packageJson.name !== PLUGIN_NAME ||
    typeof packageJson.version !== "string" ||
    !Array.isArray(packageJson.files) ||
    packageJson.files.some((entry) => typeof entry !== "string")
  ) {
    throw new Error("Invalid package manifest.");
  }
  for (const relativePath of ACCEPTANCE_BUNDLE_PATHS) {
    if (!packagePathAllowed(relativePath, packageJson.files)) {
      throw new Error("Acceptance bundle path is not package-allowlisted.");
    }
  }

  const stagedPluginRoot = path.join(marketplaceRoot, "plugin");
  const budget = { files: 0, bytes: 0 };
  for (const relativePath of ACCEPTANCE_BUNDLE_PATHS) {
    copyClosedEntry(
      path.join(projectRoot, relativePath),
      path.join(stagedPluginRoot, relativePath),
      budget,
    );
  }
  const marketplaceManifest = {
    name: MARKETPLACE_NAME,
    interface: {
      displayName: "AWF — Agent Waste Firewall",
    },
    plugins: [
      {
        name: PLUGIN_NAME,
        source: {
          source: "local",
          path: "./plugin",
        },
        policy: {
          installation: "AVAILABLE",
          authentication: "ON_INSTALL",
        },
        category: "Productivity",
      },
    ],
  };
  const manifestPath = path.join(
    marketplaceRoot,
    ".agents",
    "plugins",
    "marketplace.json",
  );
  fs.mkdirSync(path.dirname(manifestPath), {
    recursive: true,
    mode: 0o700,
  });
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(marketplaceManifest, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function pluginIdentity(value) {
  return (
    value === PLUGIN_NAME ||
    (typeof value === "string" &&
      value.startsWith(`${PLUGIN_NAME}@`) &&
      value.length > PLUGIN_NAME.length + 1)
  );
}

function installedPluginListed(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    return false;
  }
  let entries;
  let installedCollection = false;
  if (Array.isArray(parsed)) {
    entries = parsed;
  } else if (isRecord(parsed) && Array.isArray(parsed.installed)) {
    entries = parsed.installed;
    installedCollection = true;
  } else if (isRecord(parsed) && Array.isArray(parsed.plugins)) {
    entries = parsed.plugins;
  } else {
    return false;
  }
  const matches = entries.filter(
    (entry) =>
      isRecord(entry) &&
      [entry.name, entry.id, entry.pluginId].some(pluginIdentity),
  );
  if (matches.length !== 1) return false;
  const entry = matches[0];
  if (
    entry.enabled === false ||
    ["disabled", "installed_disabled"].includes(entry.status)
  ) {
    return false;
  }
  if (typeof entry.installed === "boolean") return entry.installed;
  if (installedCollection) return true;
  return ["installed", "enabled", "installed_enabled"].includes(entry.status);
}

function installedHooksUseExpectedLauncher(hookManifest) {
  if (
    !isRecord(hookManifest) ||
    !isRecord(hookManifest.hooks) ||
    !hasExactKeys(hookManifest.hooks, REQUIRED_HOOK_EVENTS)
  ) {
    return false;
  }

  return REQUIRED_HOOK_EVENTS.every((eventName) => {
    const groups = hookManifest.hooks[eventName];
    if (
      !Array.isArray(groups) ||
      groups.length !== 1 ||
      !hasExactKeys(groups[0], ["hooks"])
    ) {
      return false;
    }
    const hooks = groups[0].hooks;
    const expectedHookKeys = CONTEXT_HOOK_EVENTS.has(eventName)
      ? ["type", "command", "timeout", "additionalContextLimit"]
      : ["type", "command", "timeout"];
    if (
      !Array.isArray(hooks) ||
      hooks.length !== 1 ||
      !hasExactKeys(hooks[0], expectedHookKeys)
    ) {
      return false;
    }
    const hook = hooks[0];
    return (
      hook.type === "command" &&
      hook.command === EXPECTED_HOOK_COMMAND &&
      hook.timeout === 3 &&
      (CONTEXT_HOOK_EVENTS.has(eventName)
        ? hook.additionalContextLimit === 2500
        : hook.additionalContextLimit === undefined)
    );
  });
}

function providerDiscoveredInstalledHooks(output) {
  let result;
  try {
    result = validateCodexHookPreflight(JSON.parse(output));
  } catch {
    return false;
  }
  if (
    result.discoveredHookCount !== CODEX_EXPECTED_HOOKS.length ||
    result.unexpectedHookCount !== 0 ||
    result.errorCount !== 0 ||
    result.warningCount !== 0 ||
    result.events.length !== CODEX_EXPECTED_HOOKS.length
  ) {
    return false;
  }
  return result.events.every(
    (event) =>
      event.state === "ready" || event.state === "untrusted",
  );
}

function validateInstalledPluginRoot(candidate, codexHome) {
  const relative = path.relative(
    path.join(codexHome, "plugins", "cache", MARKETPLACE_NAME),
    candidate,
  );
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative.split(path.sep).includes(".git")
  ) {
    return null;
  }
  for (const filename of [
    ".codex-plugin/plugin.json",
    "hooks/hooks.json",
    "scripts/hook-launcher.sh",
    "scripts/hook.mjs",
    "package.json",
  ]) {
    const target = path.join(candidate, filename);
    let stat;
    try {
      stat = fs.lstatSync(target);
    } catch {
      return null;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
  }
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(candidate, ".codex-plugin/plugin.json"), "utf8"),
    );
    const hookManifest = JSON.parse(
      fs.readFileSync(path.join(candidate, "hooks/hooks.json"), "utf8"),
    );
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(candidate, "package.json"), "utf8"),
    );
    if (
      !isRecord(manifest) ||
      !isRecord(hookManifest) ||
      !isRecord(packageJson) ||
      manifest.name !== PLUGIN_NAME ||
      packageJson.name !== PLUGIN_NAME ||
      manifest.version !== packageJson.version ||
      !installedHooksUseExpectedLauncher(hookManifest)
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return candidate;
}

function defaultLocateInstalledPlugin(codexHome) {
  const cacheRoot = path.join(
    codexHome,
    "plugins",
    "cache",
    MARKETPLACE_NAME,
  );
  if (!fs.existsSync(cacheRoot)) return null;
  const pending = [{ directory: cacheRoot, depth: 0 }];
  let visited = 0;
  const candidates = [];
  while (pending.length > 0 && visited <= MAX_AUDIT_FILES) {
    const { directory, depth } = pending.shift();
    visited += 1;
    if (depth > 8) continue;
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return null;
    }
    if (entries.some((entry) => entry.isSymbolicLink())) return null;
    if (
      entries.some(
        (entry) => entry.isDirectory() && entry.name === ".codex-plugin",
      )
    ) {
      const candidate = validateInstalledPluginRoot(directory, codexHome);
      if (candidate) candidates.push(candidate);
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        pending.push({
          directory: path.join(directory, entry.name),
          depth: depth + 1,
        });
      }
    }
  }
  if (visited > MAX_AUDIT_FILES || candidates.length !== 1) return null;
  return candidates[0];
}

function scanForCanaries(root, canaries) {
  const pending = [root];
  let files = 0;
  let bytes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    const relative = path.relative(root, current);
    if (relative && containsCanary(relative, canaries)) return false;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) return false;
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        pending.push(path.join(current, entry));
      }
      continue;
    }
    if (!stat.isFile()) return false;
    files += 1;
    bytes += stat.size;
    if (files > MAX_AUDIT_FILES || bytes > MAX_AUDIT_BYTES) return false;
    const value = fs.readFileSync(current);
    for (const canary of canaries) {
      if (value.includes(Buffer.from(canary, "utf8"))) return false;
    }
  }
  return true;
}

function clearModelFreeProviderScratch(codexHome) {
  const tempDirectory = path.join(codexHome, "tmp");
  const argumentScratch = path.join(tempDirectory, "arg0");
  try {
    if (!fs.existsSync(tempDirectory)) return true;
    const tempStat = fs.lstatSync(tempDirectory);
    if (
      !tempStat.isDirectory() ||
      tempStat.isSymbolicLink()
    ) {
      return false;
    }
    if (!fs.existsSync(argumentScratch)) return true;
    const scratchStat = fs.lstatSync(argumentScratch);
    if (
      !scratchStat.isDirectory() ||
      scratchStat.isSymbolicLink()
    ) {
      return false;
    }
    fs.rmSync(argumentScratch, { recursive: true, force: true });
    return !fs.existsSync(argumentScratch);
  } catch {
    return false;
  }
}

function acceptanceCanary(nonce, field) {
  const digest = crypto
    .createHash("sha256")
    .update(`${nonce}:${field}`, "utf8")
    .digest("hex")
    .slice(0, 12);
  return `AWF${digest}`;
}

function containsCanary(value, canaries) {
  return canaries.some((canary) => value.includes(canary));
}

function isEmptyHookOutput(value) {
  return isRecord(value) && Object.keys(value).length === 0;
}

function safeBaseEnvironment(baseEnv) {
  const safe = {
    PATH:
      typeof baseEnv.PATH === "string"
        ? baseEnv.PATH
        : "/usr/bin:/bin:/usr/sbin:/sbin",
  };
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    if (typeof baseEnv[key] === "string") safe[key] = baseEnv[key];
  }
  return safe;
}

function codexEnvironment(baseEnv, isolatedHome, codexHome, tempRoot) {
  return {
    ...safeBaseEnvironment(baseEnv),
    HOME: isolatedHome,
    CODEX_HOME: codexHome,
    XDG_CONFIG_HOME: path.join(isolatedHome, ".config"),
    TMPDIR: path.join(tempRoot, "tmp"),
  };
}

function hookEnvironment(
  baseEnv,
  isolatedHome,
  codexHome,
  installedPluginRoot,
  dataDir,
  tempRoot,
) {
  return {
    ...safeBaseEnvironment(baseEnv),
    HOME: isolatedHome,
    CODEX_HOME: codexHome,
    PLUGIN_ROOT: installedPluginRoot,
    CLAUDE_PLUGIN_ROOT: installedPluginRoot,
    XDG_CONFIG_HOME: path.join(isolatedHome, ".config"),
    TMPDIR: path.join(tempRoot, "tmp"),
    AWF_NODE_PATH: process.execPath,
    AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
    AGENT_WASTE_FIREWALL_MODE: "observe",
  };
}

export function runProviderAcceptance(options = {}) {
  const clock = options.clock ?? (() => performance.now());
  const runner = options.runner ?? runProviderAcceptanceCommand;
  const stageBundle = options.stageBundle ?? defaultStageBundle;
  const locateInstalledPlugin =
    options.locateInstalledPlugin ?? defaultLocateInstalledPlugin;
  const baseEnv = options.env ?? process.env;
  const totalStartedAt = clock();
  const report = emptyReport();
  let tempRoot = null;
  let tempRootIdentity = null;

  try {
    const tempParent = acceptanceTempParent(options.tempParent);
    tempRoot = fs.mkdtempSync(
      path.join(tempParent, "awf-codex-acceptance-"),
    );
    assertPrivateDirectory(tempRoot);
    tempRootIdentity = privateDirectoryIdentity(tempRoot);
    const nonce = crypto.randomBytes(12).toString("hex");
    const isolatedHome = path.join(tempRoot, "home");
    const codexHome = path.join(tempRoot, "codex-home");
    const marketplaceRoot = path.join(tempRoot, "marketplace");
    const workspace = path.join(tempRoot, "workspace");
    const dataDir = path.join(tempRoot, "awf-data");
    for (const directory of [
      isolatedHome,
      codexHome,
      marketplaceRoot,
      workspace,
      path.join(tempRoot, "tmp"),
    ]) {
      assertPrivateDirectory(directory);
    }
    fs.mkdirSync(path.join(workspace, ".git"), { mode: 0o700 });
    const codexEnv = codexEnvironment(
      baseEnv,
      isolatedHome,
      codexHome,
      tempRoot,
    );
    const candidates = options.codexCommand
      ? [options.codexCommand]
      : [
          "codex",
          ...(fs.existsSync(CODEX_APP_BINARY) ? [CODEX_APP_BINARY] : []),
        ];
    let codexCommand = null;
    let probeFailed = false;
    const probeStartedAt = clock();
    for (const candidate of [...new Set(candidates)]) {
      const probe = runBounded(runner, {
        command: candidate,
        args: ["plugin", "--help"],
        cwd: tempRoot,
        env: codexEnv,
        timeoutMs: 5_000,
      });
      if (probe.outcome === "ok") {
        codexCommand = candidate;
        break;
      }
      if (probe.outcome === "failed") probeFailed = true;
    }
    report.durationsMs.probe = durationSince(clock, probeStartedAt);
    if (codexCommand === null) {
      if (probeFailed) {
        report.codex = "unknown";
        markFailed(report, "codex_probe_failed");
      } else {
        report.codex = "unavailable";
        report.result = "skipped";
        report.failure = "codex_unavailable";
      }
    } else {
      report.codex = "available";
      report.checks.codexDetected = true;
    }

    if (report.checks.codexDetected) {
      const stageStartedAt = clock();
      try {
        stageBundle({ marketplaceRoot, projectRoot: PROJECT_ROOT });
        report.checks.packageStaged = true;
      } catch {
        markFailed(report, "package_stage_failed");
      }
      report.durationsMs.packageStage = durationSince(clock, stageStartedAt);
    }

    if (report.checks.packageStaged) {
      const marketplaceStartedAt = clock();
      const added = runBounded(runner, {
        command: codexCommand,
        args: ["plugin", "marketplace", "add", marketplaceRoot, "--json"],
        cwd: tempRoot,
        env: codexEnv,
        timeoutMs: 30_000,
      });
      report.durationsMs.marketplaceAdd = durationSince(
        clock,
        marketplaceStartedAt,
      );
      if (added.outcome === "ok") {
        report.checks.marketplaceAdded = true;
      } else {
        markFailed(report, "marketplace_add_failed");
      }
    }

    if (report.checks.marketplaceAdded) {
      const installStartedAt = clock();
      const installed = runBounded(runner, {
        command: codexCommand,
        args: [
          "plugin",
          "add",
          `${PLUGIN_NAME}@${MARKETPLACE_NAME}`,
          "--json",
        ],
        cwd: tempRoot,
        env: codexEnv,
        timeoutMs: 30_000,
      });
      report.durationsMs.pluginInstall = durationSince(
        clock,
        installStartedAt,
      );
      if (installed.outcome === "ok") {
        report.checks.pluginInstalled = true;
      } else {
        markFailed(report, "plugin_install_failed");
      }
    }

    if (report.checks.pluginInstalled) {
      const listStartedAt = clock();
      const listed = runBounded(runner, {
        command: codexCommand,
        args: ["plugin", "list", "--json"],
        cwd: tempRoot,
        env: codexEnv,
        timeoutMs: 10_000,
      });
      report.durationsMs.pluginList = durationSince(clock, listStartedAt);
      if (
        listed.outcome === "ok" &&
        installedPluginListed(listed.stdout)
      ) {
        report.checks.pluginListed = true;
      } else {
        markFailed(report, "plugin_list_failed");
      }
    }

    let installedPluginRoot = null;
    if (report.checks.pluginListed) {
      try {
        installedPluginRoot = locateInstalledPlugin(codexHome);
      } catch {
        installedPluginRoot = null;
      }
      if (installedPluginRoot) {
        report.checks.installedHookFound = true;
      } else {
        markFailed(report, "installed_hook_missing");
      }
    }

    if (report.checks.installedHookFound) {
      const discoveryStartedAt = clock();
      const discovery = runBounded(runner, {
        command: process.execPath,
        args: [
          PREFLIGHT_PROBE,
          tempRoot,
          codexCommand,
          installedPluginRoot,
        ],
        cwd: tempRoot,
        env: codexEnv,
        timeoutMs: 6_000,
        killSignal: "SIGTERM",
      });
      const scratchCleaned =
        clearModelFreeProviderScratch(codexHome);
      report.durationsMs.hookDiscovery = durationSince(
        clock,
        discoveryStartedAt,
      );
      if (!scratchCleaned) {
        markFailed(report, "provider_scratch_cleanup_failed");
      } else if (
        discovery.outcome === "ok" &&
        providerDiscoveredInstalledHooks(discovery.stdout)
      ) {
        report.checks.providerHooksDiscovered = true;
      } else {
        markFailed(report, "provider_hook_discovery_failed");
      }
    }

    const promptMarker = acceptanceCanary(nonce, "prompt");
    const promptInteriorMarker =
      acceptanceCanary(nonce, "prompt-interior");
    const rawPrompt =
      `${promptMarker} Please ensure ${promptInteriorMarker} everything ` +
      `works across the whole ` +
      `repository. ${promptMarker}`;
    const sessionMarker = acceptanceCanary(nonce, "session");
    const sessionInteriorMarker =
      acceptanceCanary(nonce, "session-interior");
    const turnMarker = acceptanceCanary(nonce, "turn");
    const turnInteriorMarker =
      acceptanceCanary(nonce, "turn-interior");
    const toolUseMarker = acceptanceCanary(nonce, "tool-use");
    const toolUseInteriorMarker =
      acceptanceCanary(nonce, "tool-use-interior");
    const toolInputMarker = acceptanceCanary(nonce, "tool-input");
    const toolInputInteriorMarker =
      acceptanceCanary(nonce, "tool-input-interior");
    const toolOutputMarker = acceptanceCanary(nonce, "tool-output");
    const toolOutputInteriorMarker =
      acceptanceCanary(nonce, "tool-output-interior");
    const assistantMarker = acceptanceCanary(nonce, "assistant");
    const assistantInteriorMarker =
      acceptanceCanary(nonce, "assistant-interior");
    const rawSession =
      `${sessionMarker}:session:${sessionInteriorMarker}:` +
      `${sessionMarker}`;
    const rawTurn =
      `${turnMarker}:turn:${turnInteriorMarker}:${turnMarker}`;
    const rawToolUse =
      `${toolUseMarker}:tool-use:${toolUseInteriorMarker}:` +
      `${toolUseMarker}`;
    const rawToolInput =
      `${toolInputMarker}:tool-input:${toolInputInteriorMarker}:` +
      `${toolInputMarker}`;
    const rawToolOutput =
      `${toolOutputMarker}:tool-output:${toolOutputInteriorMarker}:` +
      `${toolOutputMarker}`;
    const canaries = [
      promptMarker,
      promptInteriorMarker,
      sessionMarker,
      sessionInteriorMarker,
      turnMarker,
      turnInteriorMarker,
      workspace,
      toolUseMarker,
      toolUseInteriorMarker,
      toolInputMarker,
      toolInputInteriorMarker,
      toolOutputMarker,
      toolOutputInteriorMarker,
      assistantMarker,
      assistantInteriorMarker,
    ];
    const hookEnv = hookEnvironment(
      baseEnv,
      isolatedHome,
      codexHome,
      installedPluginRoot,
      dataDir,
      tempRoot,
    );
    if (report.checks.providerHooksDiscovered) {
      const hookStartedAt = clock();
      const hookPayloads = [
        {
          session_id: rawSession,
          cwd: workspace,
          hook_event_name: "UserPromptSubmit",
          turn_id: rawTurn,
          prompt: rawPrompt,
        },
        {
          session_id: rawSession,
          cwd: workspace,
          hook_event_name: "PreToolUse",
          turn_id: rawTurn,
          tool_name: "Bash",
          tool_use_id: rawToolUse,
          tool_input: {
            command: `${rawToolInput} printf acceptance`,
          },
        },
        {
          session_id: rawSession,
          cwd: workspace,
          hook_event_name: "PostToolUse",
          turn_id: rawTurn,
          tool_name: "Bash",
          tool_use_id: rawToolUse,
          tool_input: {
            command: `${rawToolInput} printf acceptance`,
          },
          tool_response: {
            exit_code: 0,
            stdout: rawToolOutput,
          },
        },
        {
          session_id: rawSession,
          cwd: workspace,
          hook_event_name: "Stop",
          turn_id: rawTurn,
          stop_hook_active: false,
          last_assistant_message:
            `${assistantMarker}:assistant:${assistantInteriorMarker}:` +
            `${assistantMarker}`,
        },
      ];
      let validHookOutput = true;
      for (const payload of hookPayloads) {
        const hookResult = runBounded(runner, {
          command: "/bin/sh",
          args: [
            "-p",
            path.join(
              installedPluginRoot,
              "scripts",
              "hook-launcher.sh",
            ),
            installedPluginRoot,
            "codex",
          ],
          cwd: workspace,
          env: hookEnv,
          input: JSON.stringify(payload),
          timeoutMs: 5_000,
          maxOutputBytes: 64 * 1024,
        });
        if (hookResult.outcome !== "ok") {
          validHookOutput = false;
          break;
        }
        try {
          validHookOutput = isEmptyHookOutput(
            JSON.parse(hookResult.stdout),
          );
        } catch {
          validHookOutput = false;
        }
        if (!validHookOutput) break;
      }
      report.durationsMs.hook = durationSince(clock, hookStartedAt);
      if (validHookOutput) {
        report.checks.hookExecuted = true;
      } else {
        markFailed(report, "hook_failed");
      }
    }

    if (report.checks.hookExecuted) {
      const auditStartedAt = clock();
      let events = [];
      try {
        events = new LiveEventStore({
          root: dataDir,
          env: hookEnv,
        }).readEvents();
      } catch {
        events = [];
      }
      report.checks.eventProduced =
        events.length > 0 &&
        events.every(
          (event) =>
            isRecord(event) &&
            event.v === 1 &&
            event.platform === "codex",
        ) &&
        events.some(
          (event) =>
            event.kind === "incident" &&
            event.ruleId === "prompt_contract",
        );
      try {
        report.checks.privacyPreserved = scanForCanaries(
          tempRoot,
          canaries,
        );
      } catch {
        report.checks.privacyPreserved = false;
      }
      report.durationsMs.audit = durationSince(clock, auditStartedAt);
      if (!report.checks.privacyPreserved) {
        markFailed(report, "privacy_violation");
      } else if (!report.checks.eventProduced) {
        markFailed(report, "event_missing");
      }
    }

    if (
      report.checks.codexDetected &&
      CHECK_KEYS.slice(0, -1).every((key) => report.checks[key])
    ) {
      report.result = "passed";
      report.failure = "none";
    }
  } catch {
    markFailed(report, "internal_failure");
  } finally {
    const cleanupStartedAt = clock();
    if (tempRoot !== null) {
      try {
        if (!fs.existsSync(tempRoot)) {
          report.checks.cleanupSucceeded = false;
        } else if (
          tempRootIdentity !== null &&
          samePrivateDirectory(tempRoot, tempRootIdentity)
        ) {
          fs.rmSync(tempRoot, { recursive: true, force: true });
          report.checks.cleanupSucceeded = !fs.existsSync(tempRoot);
        } else {
          report.checks.cleanupSucceeded = false;
        }
      } catch {
        report.checks.cleanupSucceeded = false;
      }
    } else {
      report.checks.cleanupSucceeded = true;
    }
    report.durationsMs.cleanup = durationSince(clock, cleanupStartedAt);
    if (!report.checks.cleanupSucceeded) {
      markFailed(report, "cleanup_failed");
    } else if (
      report.result === "failed" &&
      report.failure === "internal_failure" &&
      report.codex === "unavailable"
    ) {
      report.result = "skipped";
      report.failure = "codex_unavailable";
    }
    report.durationsMs.total = durationSince(clock, totalStartedAt);
  }

  return validateProviderAcceptanceReport(report);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const report = runProviderAcceptance();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.result === "failed") process.exitCode = 1;
}

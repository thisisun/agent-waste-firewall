import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROCESS_TIMEOUT_MS = 8_000;
const MAX_CHILD_OUTPUT_BYTES = 2_048;
const MAX_LEDGER_RELEASE_COUNT = 4;
const RETAINED_RELEASE_COUNT = 3;
const REPEATED_RELEASE_CRASH_COUNT = MAX_LEDGER_RELEASE_COUNT + 2;
const EXPECTED_SCENARIO_COUNT = 30;
const EXPECTED_KILL_COUNT = 34;

const SUMMARY_KEYS = [
  "canRollback",
  "condition",
  "knownTransactionCount",
  "ledgerReleaseCount",
  "mutation",
  "operation",
  "reason",
  "type",
  "v",
];
const MUTATIONS = new Set([
  "installed",
  "upgraded",
  "repaired",
  "rolledBack",
  "uninstalled",
  "uninstalledWithResidue",
  "noChange",
]);
const CONDITIONS = new Set([
  "notInstalled",
  "healthy",
  "needsRepair",
  "unsafeLayout",
]);
const REASONS = new Set([
  "helperMissing",
  "helperInvalid",
  "activationMissing",
  "activationInvalid",
  "ledgerMissing",
  "ledgerInvalid",
  "runtimeMissing",
  "runtimeInvalid",
  "unsupportedProtocol",
]);
const FAILURE_CODES = new Set([
  "invalid_arguments",
  "harness_unavailable",
  "temporary_root_failed",
  "payload_failed",
  "harness_launch_failed",
  "child_output_limit",
  "checkpoint_timeout",
  "checkpoint_protocol_failed",
  "sigkill_failed",
  "operation_failed",
  "summary_protocol_failed",
  "recovery_failed",
  "capacity_failed",
  "invalid_checkpoint_failed",
  "privacy_failed",
  "unknown_transaction_failed",
  "cleanup_failed",
  "internal_failure",
]);
const INSTALL_CHECKPOINTS = [
  "afterStagingComplete",
  "afterLedgerPublish",
  "afterReleasePublish",
  "afterHelperPublish",
  "afterActivationPublish",
  "afterValidation",
];
const ROLLBACK_CHECKPOINTS = [
  "afterStagingComplete",
  "afterActivationPublish",
  "afterValidation",
];
const UNINSTALL_CHECKPOINTS = [
  "afterHelperRemoval",
  "afterActivationRemoval",
  "afterRuntimeRemoval",
  "afterReleaseRemoval",
  "afterLedgerRemoval",
];
const REPORT_CHECK_KEYS = [
  "harnessValidated",
  "freshInstallRecovered",
  "upgradeRecovered",
  "repairRecovered",
  "rollbackRecovered",
  "uninstallRecovered",
  "capacityRecovered",
  "invalidCheckpointRejected",
  "rawCanaryExcluded",
  "knownTransactionsConverged",
  "unknownTransactionPreserved",
  "cleanupSucceeded",
];

class CrashSafetyFailure extends Error {
  constructor(code) {
    super(code);
    this.code = FAILURE_CODES.has(code) ? code : "internal_failure";
  }
}

function fail(code) {
  throw new CrashSafetyFailure(code);
}

function emptyReport() {
  return {
    v: 1,
    kind: "native_integration_crash_safety",
    result: "failed",
    failure: "internal_failure",
    scenarios: 0,
    killedProcesses: 0,
    checks: Object.fromEntries(REPORT_CHECK_KEYS.map((key) => [key, false])),
  };
}

function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const status = fs.lstatSync(directory);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    !status.isDirectory() ||
    status.isSymbolicLink() ||
    (uid !== null && status.uid !== uid) ||
    (status.mode & 0o077) !== 0
  ) {
    fail("temporary_root_failed");
  }
}

function validateHarness(candidate) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) {
    fail("invalid_arguments");
  }
  try {
    const status = fs.statSync(candidate);
    if (!status.isFile()) fail("harness_unavailable");
    fs.accessSync(candidate, fs.constants.X_OK);
  } catch (error) {
    if (error instanceof CrashSafetyFailure) throw error;
    fail("harness_unavailable");
  }
  return candidate;
}

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--harness") {
    fail("invalid_arguments");
  }
  return validateHarness(argv[1]);
}

function createScenarioRoot(temporaryRoot, index) {
  const scenarioRoot = path.join(
    temporaryRoot,
    `scenario-${String(index).padStart(2, "0")}`,
  );
  privateDirectory(scenarioRoot);
  return {
    scenarioRoot,
    productRoot: path.join(scenarioRoot, "product"),
  };
}

function createPayload(scenarioRoot, index) {
  try {
    const payloadRoot = path.join(
      scenarioRoot,
      `payload-${String(index).padStart(2, "0")}`,
    );
    privateDirectory(payloadRoot);
    const helper = path.join(payloadRoot, "awf-hook");
    const runtime = path.join(payloadRoot, "awf-node");
    const helperSource = `#!/bin/sh\n# synthetic helper ${index}\nexec /bin/cat\n`;
    const runtimeSource = `#!/bin/sh
if [ "\${1-}" = "--version" ]; then
  printf '%s\\n' 'v22.0.0'
  exit 0
fi
if [ "\${1-}" = "--no-addons" ] &&
  [ "\${2-}" = "--disable-proto=throw" ] &&
  [ "\${3-}" = "-e" ]
then
  printf '%s\\n' 'AWF_RUNTIME_READY'
  exit 0
fi
# synthetic runtime ${index}
exec /bin/cat
`;
    fs.writeFileSync(helper, helperSource, { mode: 0o700 });
    fs.writeFileSync(runtime, runtimeSource, { mode: 0o700 });
    fs.chmodSync(helper, 0o700);
    fs.chmodSync(runtime, 0o700);

    const canary = Buffer.concat([
      Buffer.from("RAW_PROVIDER_ENVELOPE_", "ascii"),
      crypto.randomBytes(48),
    ]);
    const canaryFile = path.join(payloadRoot, "raw-provider-envelope.bin");
    fs.writeFileSync(canaryFile, canary, { mode: 0o600 });
    fs.chmodSync(canaryFile, 0o600);
    return { helper, runtime, canary };
  } catch (error) {
    if (error instanceof CrashSafetyFailure) throw error;
    fail("payload_failed");
  }
}

function harnessArguments(operation, checkpoint, productRoot, payload) {
  return [
    operation,
    checkpoint,
    productRoot,
    payload.helper,
    payload.runtime,
  ];
}

function closedEnvironment() {
  return {
    LANG: "C",
    LC_ALL: "C",
    PATH: "/usr/bin:/bin",
  };
}

function startHarness(harness, args, cwd) {
  try {
    return spawn(harness, args, {
      cwd,
      env: closedEnvironment(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch {
    fail("harness_launch_failed");
  }
}

function terminate(child) {
  try {
    child.kill("SIGKILL");
  } catch {
    // The bounded close handler maps the final state to a closed failure.
  }
}

function runCaptured(harness, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = startHarness(harness, args, cwd);
    let stdout = Buffer.alloc(0);
    let failure = null;
    let timedOut = false;
    let launchFailed = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, PROCESS_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      if (stdout.length + chunk.length > MAX_CHILD_OUTPUT_BYTES) {
        failure = "child_output_limit";
        terminate(child);
        return;
      }
      stdout = Buffer.concat([stdout, chunk]);
    });
    child.stderr.on("data", () => {});
    child.on("error", () => {
      launchFailed = true;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (launchFailed) {
        reject(new CrashSafetyFailure("harness_launch_failed"));
      } else if (timedOut) {
        reject(new CrashSafetyFailure("operation_failed"));
      } else if (failure !== null) {
        reject(new CrashSafetyFailure(failure));
      } else {
        resolve({ code, signal, stdout });
      }
    });
  });
}

function expectedCheckpointMarker(operation, checkpoint) {
  return Buffer.from(
    `${JSON.stringify({
      v: 1,
      type: "checkpoint",
      operation,
      checkpoint,
    })}\n`,
    "utf8",
  );
}

function runToCheckpoint(
  harness,
  operation,
  checkpoint,
  productRoot,
  payload,
) {
  return new Promise((resolve, reject) => {
    const expected = expectedCheckpointMarker(operation, checkpoint);
    const args = harnessArguments(
      operation,
      checkpoint,
      productRoot,
      payload,
    );
    const child = startHarness(harness, args, path.dirname(productRoot));
    let stdout = Buffer.alloc(0);
    let failure = null;
    let killSent = false;
    let launchFailed = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, PROCESS_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      if (failure !== null || killSent) {
        if (chunk.length > 0) failure = "checkpoint_protocol_failed";
        terminate(child);
        return;
      }
      if (
        stdout.length + chunk.length > expected.length ||
        stdout.length + chunk.length > MAX_CHILD_OUTPUT_BYTES
      ) {
        failure = "checkpoint_protocol_failed";
        terminate(child);
        return;
      }
      stdout = Buffer.concat([stdout, chunk]);
      if (!expected.subarray(0, stdout.length).equals(stdout)) {
        failure = "checkpoint_protocol_failed";
        terminate(child);
        return;
      }
      if (stdout.length === expected.length) {
        try {
          killSent = child.kill("SIGKILL");
        } catch {
          killSent = false;
        }
        if (!killSent) {
          failure = "sigkill_failed";
          terminate(child);
        }
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", () => {
      launchFailed = true;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (launchFailed) {
        reject(new CrashSafetyFailure("harness_launch_failed"));
      } else if (timedOut) {
        reject(new CrashSafetyFailure("checkpoint_timeout"));
      } else if (failure !== null) {
        reject(new CrashSafetyFailure(failure));
      } else if (
        !killSent ||
        !stdout.equals(expected) ||
        code !== null ||
        signal !== "SIGKILL"
      ) {
        reject(new CrashSafetyFailure("sigkill_failed"));
      } else {
        resolve();
      }
    });
  });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return (
    actual.length === required.length &&
    actual.every((key, index) => key === required[index])
  );
}

function parseSummary(stdout, operation) {
  if (
    stdout.length === 0 ||
    stdout.length > MAX_CHILD_OUTPUT_BYTES ||
    stdout.at(-1) !== 0x0a ||
    stdout.subarray(0, -1).includes(0x0a) ||
    stdout.includes(0x0d) ||
    stdout.includes(0x00)
  ) {
    fail("summary_protocol_failed");
  }
  let summary;
  try {
    summary = JSON.parse(stdout.subarray(0, -1).toString("utf8"));
  } catch {
    fail("summary_protocol_failed");
  }
  if (
    !exactKeys(summary, SUMMARY_KEYS) ||
    summary.v !== 1 ||
    summary.type !== "summary" ||
    summary.operation !== operation ||
    !MUTATIONS.has(summary.mutation) ||
    !CONDITIONS.has(summary.condition) ||
    (summary.reason !== null && !REASONS.has(summary.reason)) ||
    typeof summary.canRollback !== "boolean" ||
    !Number.isSafeInteger(summary.ledgerReleaseCount) ||
    summary.ledgerReleaseCount < 0 ||
    summary.ledgerReleaseCount > MAX_LEDGER_RELEASE_COUNT ||
    !Number.isSafeInteger(summary.knownTransactionCount) ||
    summary.knownTransactionCount < 0 ||
    summary.knownTransactionCount > MAX_LEDGER_RELEASE_COUNT
  ) {
    fail("summary_protocol_failed");
  }
  return summary;
}

async function runSummary(
  harness,
  operation,
  productRoot,
  payload,
) {
  const result = await runCaptured(
    harness,
    harnessArguments(operation, "none", productRoot, payload),
    path.dirname(productRoot),
  );
  if (result.code !== 0 || result.signal !== null) {
    fail("operation_failed");
  }
  return parseSummary(result.stdout, operation);
}

function requireHealthy(summary, failure = "recovery_failed") {
  if (
    summary.condition !== "healthy" ||
    summary.reason !== null ||
    summary.ledgerReleaseCount < 1 ||
    summary.ledgerReleaseCount > RETAINED_RELEASE_COUNT ||
    summary.knownTransactionCount !== 0
  ) {
    fail(failure);
  }
}

function requireNotInstalled(summary) {
  if (
    summary.condition !== "notInstalled" ||
    summary.reason !== null ||
    summary.canRollback ||
    summary.ledgerReleaseCount !== 0 ||
    summary.knownTransactionCount !== 0
  ) {
    fail("recovery_failed");
  }
}

function requireNeedsRepair(summary, reason) {
  if (
    summary.condition !== "needsRepair" ||
    summary.reason !== reason ||
    summary.knownTransactionCount !== 0
  ) {
    fail("recovery_failed");
  }
}

function fileContainsAnyCanary(file, canaries) {
  const data = fs.readFileSync(file);
  return canaries.some((canary) => data.indexOf(canary) !== -1);
}

function treeContainsAnyCanary(root, canaries) {
  if (!fs.existsSync(root)) return false;
  const status = fs.lstatSync(root);
  if (status.isSymbolicLink()) {
    const target = Buffer.from(fs.readlinkSync(root), "utf8");
    return canaries.some((canary) => target.indexOf(canary) !== -1);
  }
  if (status.isDirectory()) {
    return fs
      .readdirSync(root)
      .some((name) => treeContainsAnyCanary(path.join(root, name), canaries));
  }
  if (status.isFile()) return fileContainsAnyCanary(root, canaries);
  return false;
}

function requireCanariesExcluded(productRoot, canaries) {
  try {
    if (treeContainsAnyCanary(productRoot, canaries)) fail("privacy_failed");
  } catch (error) {
    if (error instanceof CrashSafetyFailure) throw error;
    fail("privacy_failed");
  }
}

async function installHealthy(harness, productRoot, payload) {
  const installed = await runSummary(harness, "install", productRoot, payload);
  requireHealthy(installed);
  return installed;
}

async function inspectHealthy(harness, productRoot, payload, failure) {
  const inspected = await runSummary(harness, "inspect", productRoot, payload);
  requireHealthy(inspected, failure);
  return inspected;
}

async function runInvalidCheckpointScenario(
  harness,
  temporaryRoot,
  scenarioIndex,
) {
  const { scenarioRoot, productRoot } = createScenarioRoot(
    temporaryRoot,
    scenarioIndex,
  );
  const payload = createPayload(scenarioRoot, 1);
  const result = await runCaptured(
    harness,
    harnessArguments(
      "install",
      "invalidCheckpoint",
      productRoot,
      payload,
    ),
    scenarioRoot,
  );
  const expected = Buffer.from(
    '{"v":1,"type":"error","code":"invalid_arguments"}\n',
    "utf8",
  );
  if (
    result.code !== 64 ||
    result.signal !== null ||
    !result.stdout.equals(expected) ||
    fs.existsSync(productRoot)
  ) {
    fail("invalid_checkpoint_failed");
  }
  requireCanariesExcluded(productRoot, [payload.canary]);
}

async function runFreshInstallScenarios(
  harness,
  temporaryRoot,
  nextScenario,
  counters,
) {
  for (const checkpoint of INSTALL_CHECKPOINTS) {
    const { scenarioRoot, productRoot } = createScenarioRoot(
      temporaryRoot,
      nextScenario(),
    );
    const payload = createPayload(scenarioRoot, 1);
    await runToCheckpoint(
      harness,
      "install",
      checkpoint,
      productRoot,
      payload,
    );
    counters.killed += 1;
    requireCanariesExcluded(productRoot, [payload.canary]);
    await installHealthy(harness, productRoot, payload);
    await inspectHealthy(harness, productRoot, payload, "recovery_failed");
    requireCanariesExcluded(productRoot, [payload.canary]);
    counters.scenarios += 1;
  }
}

async function runUpgradeScenarios(
  harness,
  temporaryRoot,
  nextScenario,
  counters,
) {
  for (const checkpoint of INSTALL_CHECKPOINTS) {
    const { scenarioRoot, productRoot } = createScenarioRoot(
      temporaryRoot,
      nextScenario(),
    );
    const first = createPayload(scenarioRoot, 1);
    const second = createPayload(scenarioRoot, 2);
    await installHealthy(harness, productRoot, first);
    await runToCheckpoint(
      harness,
      "install",
      checkpoint,
      productRoot,
      second,
    );
    counters.killed += 1;
    requireCanariesExcluded(productRoot, [first.canary, second.canary]);
    await installHealthy(harness, productRoot, second);
    await inspectHealthy(harness, productRoot, second, "recovery_failed");
    requireCanariesExcluded(productRoot, [first.canary, second.canary]);
    counters.scenarios += 1;
  }
}

async function runFinalLedgerScenario(
  harness,
  temporaryRoot,
  scenarioIndex,
  counters,
) {
  const { scenarioRoot, productRoot } = createScenarioRoot(
    temporaryRoot,
    scenarioIndex,
  );
  const payloads = [1, 2, 3, 4].map((index) =>
    createPayload(scenarioRoot, index),
  );
  for (const payload of payloads.slice(0, 3)) {
    await installHealthy(harness, productRoot, payload);
  }
  await runToCheckpoint(
    harness,
    "install",
    "afterFinalLedgerPublish",
    productRoot,
    payloads[3],
  );
  counters.killed += 1;
  requireCanariesExcluded(
    productRoot,
    payloads.map((payload) => payload.canary),
  );
  await installHealthy(harness, productRoot, payloads[3]);
  await inspectHealthy(
    harness,
    productRoot,
    payloads[3],
    "recovery_failed",
  );
  requireCanariesExcluded(
    productRoot,
    payloads.map((payload) => payload.canary),
  );
  counters.scenarios += 1;
}

async function runRepairScenarios(
  harness,
  temporaryRoot,
  nextScenario,
  counters,
) {
  for (const checkpoint of INSTALL_CHECKPOINTS) {
    const { scenarioRoot, productRoot } = createScenarioRoot(
      temporaryRoot,
      nextScenario(),
    );
    const first = createPayload(scenarioRoot, 1);
    const repair = createPayload(scenarioRoot, 2);
    await installHealthy(harness, productRoot, first);
    try {
      fs.unlinkSync(path.join(productRoot, "integration-v1", "awf-hook"));
    } catch {
      fail("recovery_failed");
    }
    requireNeedsRepair(
      await runSummary(harness, "inspect", productRoot, repair),
      "helperMissing",
    );
    await runToCheckpoint(
      harness,
      "repair",
      checkpoint,
      productRoot,
      repair,
    );
    counters.killed += 1;
    requireCanariesExcluded(productRoot, [first.canary, repair.canary]);
    const recovered = await runSummary(
      harness,
      "repair",
      productRoot,
      repair,
    );
    requireHealthy(recovered);
    await inspectHealthy(harness, productRoot, repair, "recovery_failed");
    requireCanariesExcluded(productRoot, [first.canary, repair.canary]);
    counters.scenarios += 1;
  }
}

async function runRollbackScenarios(
  harness,
  temporaryRoot,
  nextScenario,
  counters,
) {
  for (const checkpoint of ROLLBACK_CHECKPOINTS) {
    const { scenarioRoot, productRoot } = createScenarioRoot(
      temporaryRoot,
      nextScenario(),
    );
    const first = createPayload(scenarioRoot, 1);
    const second = createPayload(scenarioRoot, 2);
    await installHealthy(harness, productRoot, first);
    await installHealthy(harness, productRoot, second);
    await runToCheckpoint(
      harness,
      "rollback",
      checkpoint,
      productRoot,
      second,
    );
    counters.killed += 1;
    requireCanariesExcluded(productRoot, [first.canary, second.canary]);
    const recovered = await runSummary(
      harness,
      "install",
      productRoot,
      second,
    );
    requireHealthy(recovered);
    await inspectHealthy(harness, productRoot, second, "recovery_failed");
    requireCanariesExcluded(productRoot, [first.canary, second.canary]);
    counters.scenarios += 1;
  }
}

async function runUninstallScenarios(
  harness,
  temporaryRoot,
  nextScenario,
  counters,
) {
  for (const checkpoint of UNINSTALL_CHECKPOINTS) {
    const { scenarioRoot, productRoot } = createScenarioRoot(
      temporaryRoot,
      nextScenario(),
    );
    const first = createPayload(scenarioRoot, 1);
    const second = createPayload(scenarioRoot, 2);
    await installHealthy(harness, productRoot, first);
    await installHealthy(harness, productRoot, second);
    await runToCheckpoint(
      harness,
      "uninstall",
      checkpoint,
      productRoot,
      second,
    );
    counters.killed += 1;
    requireCanariesExcluded(productRoot, [first.canary, second.canary]);
    const recovered = await runSummary(
      harness,
      "uninstall",
      productRoot,
      second,
    );
    requireNotInstalled(recovered);
    const inspected = await runSummary(
      harness,
      "inspect",
      productRoot,
      second,
    );
    requireNotInstalled(inspected);
    requireCanariesExcluded(productRoot, [first.canary, second.canary]);
    counters.scenarios += 1;
  }
}

async function runCapacityScenario(
  harness,
  temporaryRoot,
  scenarioIndex,
  counters,
) {
  const { scenarioRoot, productRoot } = createScenarioRoot(
    temporaryRoot,
    scenarioIndex,
  );
  const payloads = [createPayload(scenarioRoot, 1)];
  await installHealthy(harness, productRoot, payloads[0]);
  for (let index = 0; index < REPEATED_RELEASE_CRASH_COUNT; index += 1) {
    const payload = createPayload(scenarioRoot, index + 2);
    payloads.push(payload);
    await runToCheckpoint(
      harness,
      "install",
      "afterReleasePublish",
      productRoot,
      payload,
    );
    counters.killed += 1;
    requireCanariesExcluded(
      productRoot,
      payloads.map((item) => item.canary),
    );
  }
  const finalPayload = createPayload(
    scenarioRoot,
    REPEATED_RELEASE_CRASH_COUNT + 2,
  );
  payloads.push(finalPayload);
  const recovered = await installHealthy(harness, productRoot, finalPayload);
  if (recovered.ledgerReleaseCount > RETAINED_RELEASE_COUNT) {
    fail("capacity_failed");
  }
  await inspectHealthy(harness, productRoot, finalPayload, "capacity_failed");
  requireCanariesExcluded(
    productRoot,
    payloads.map((payload) => payload.canary),
  );
  counters.scenarios += 1;
}

async function runUnknownTransactionScenario(
  harness,
  temporaryRoot,
  scenarioIndex,
  counters,
) {
  const { scenarioRoot, productRoot } = createScenarioRoot(
    temporaryRoot,
    scenarioIndex,
  );
  const first = createPayload(scenarioRoot, 1);
  const second = createPayload(scenarioRoot, 2);
  await installHealthy(harness, productRoot, first);

  const unknownDirectory = path.join(
    productRoot,
    "integration-v1",
    ".transactions",
    "unknown-entry",
  );
  privateDirectory(unknownDirectory);
  const unknownFile = path.join(unknownDirectory, "owned-data");
  const unknownBytes = crypto.randomBytes(48);
  fs.writeFileSync(unknownFile, unknownBytes, { mode: 0o600 });
  fs.chmodSync(unknownFile, 0o600);

  await runToCheckpoint(
    harness,
    "install",
    "afterStagingComplete",
    productRoot,
    second,
  );
  counters.killed += 1;
  requireCanariesExcluded(productRoot, [first.canary, second.canary]);
  await installHealthy(harness, productRoot, second);
  await inspectHealthy(harness, productRoot, second, "recovery_failed");
  let preserved = false;
  try {
    const status = fs.lstatSync(unknownFile);
    preserved =
      status.isFile() &&
      !status.isSymbolicLink() &&
      fs.readFileSync(unknownFile).equals(unknownBytes);
  } catch {
    preserved = false;
  }
  if (!preserved) fail("unknown_transaction_failed");
  requireCanariesExcluded(productRoot, [first.canary, second.canary]);
  counters.scenarios += 1;
}

async function runCrashSafety(harness, temporaryRoot, report) {
  let scenarioNumber = 0;
  const nextScenario = () => {
    scenarioNumber += 1;
    return scenarioNumber;
  };
  const counters = { scenarios: 0, killed: 0 };

  await runInvalidCheckpointScenario(
    harness,
    temporaryRoot,
    nextScenario(),
  );
  counters.scenarios += 1;
  report.checks.invalidCheckpointRejected = true;
  report.checks.harnessValidated = true;

  await runFreshInstallScenarios(
    harness,
    temporaryRoot,
    nextScenario,
    counters,
  );
  report.checks.freshInstallRecovered = true;

  await runUpgradeScenarios(
    harness,
    temporaryRoot,
    nextScenario,
    counters,
  );
  await runFinalLedgerScenario(
    harness,
    temporaryRoot,
    nextScenario(),
    counters,
  );
  report.checks.upgradeRecovered = true;

  await runRepairScenarios(
    harness,
    temporaryRoot,
    nextScenario,
    counters,
  );
  report.checks.repairRecovered = true;

  await runRollbackScenarios(
    harness,
    temporaryRoot,
    nextScenario,
    counters,
  );
  report.checks.rollbackRecovered = true;

  await runUninstallScenarios(
    harness,
    temporaryRoot,
    nextScenario,
    counters,
  );
  report.checks.uninstallRecovered = true;

  await runCapacityScenario(
    harness,
    temporaryRoot,
    nextScenario(),
    counters,
  );
  report.checks.capacityRecovered = true;

  await runUnknownTransactionScenario(
    harness,
    temporaryRoot,
    nextScenario(),
    counters,
  );
  report.checks.unknownTransactionPreserved = true;
  report.checks.knownTransactionsConverged = true;
  report.checks.rawCanaryExcluded = true;
  if (
    counters.scenarios !== EXPECTED_SCENARIO_COUNT ||
    counters.killed !== EXPECTED_KILL_COUNT
  ) {
    fail("internal_failure");
  }
  report.scenarios = counters.scenarios;
  report.killedProcesses = counters.killed;
}

const report = emptyReport();
let temporaryRoot = null;
try {
  const harness = parseArguments(process.argv.slice(2));
  try {
    temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "awf-native-crash-safety-"),
    );
    privateDirectory(temporaryRoot);
  } catch (error) {
    if (error instanceof CrashSafetyFailure) throw error;
    fail("temporary_root_failed");
  }
  await runCrashSafety(harness, temporaryRoot, report);
  report.result = "passed";
  report.failure = null;
} catch (error) {
  report.result = "failed";
  report.failure =
    error instanceof CrashSafetyFailure ? error.code : "internal_failure";
} finally {
  if (temporaryRoot !== null) {
    try {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
      report.checks.cleanupSucceeded = !fs.existsSync(temporaryRoot);
    } catch {
      report.checks.cleanupSucceeded = false;
    }
  } else {
    report.checks.cleanupSucceeded = true;
  }
  if (!report.checks.cleanupSucceeded) {
    report.result = "failed";
    report.failure = "cleanup_failed";
  }
}

process.stdout.write(`${JSON.stringify(report)}\n`);
if (report.result !== "passed") process.exitCode = 1;

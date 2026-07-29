const STATUS_KEYS = [
  "v",
  "connected",
  "source",
  "sourceState",
  "streamHealth",
  "traceHealth",
  "coverage",
  "generation",
  "streamAlias",
  "mode",
  "state",
  "traceId",
  "traceAlias",
  "metrics",
  "lastSequence",
  "currentWarning",
  "promptCoach",
];
const METRIC_KEYS = [
  "events",
  "incidents",
  "avoidableCalls",
  "elapsedMs",
];
const WARNING_KEYS = [
  "ruleId",
  "severity",
  "attribution",
  "occurrences",
  "issueIds",
];
const PROMPT_COACH_KEYS = ["issueIds"];
const SOURCES = new Set(["live", "trace"]);
const SOURCE_STATES = new Set(["empty", "active"]);
const HEALTH = new Set(["healthy", "stale", "degraded"]);
const COVERAGE = new Set(["complete", "incomplete", "unknown"]);
const MODES = new Set(["observe", "warn", "block"]);
const STATES = new Set([
  "idle",
  "active",
  "recording",
  "stopped",
]);
const RULE_IDS = new Set([
  "prompt_contract",
  "exact_tool_repeat",
  "unchanged_reread",
  "retry_after_same_failure",
  "repeated_failure_result",
  "status_polling_loop",
  "edit_revert_oscillation",
]);
const SEVERITIES = new Set(["low", "medium", "high"]);
const ATTRIBUTIONS = new Set([
  "user_instruction",
  "agent",
  "environment",
  "harness",
]);
const ISSUE_IDS = new Set([
  "broad",
  "target",
  "success",
  "verify",
  "stop",
  "conflict",
]);
const STREAM_ALIAS = /^generation_[0-9a-f]{32}$/u;
const SESSION_ALIAS = /^session_[0-9a-f]{32}$/u;
const TRACE_ALIAS = /^trace_[0-9a-f]{24}$/u;

function fail(field) {
  throw new TypeError(`Invalid DashboardStatusV1 at ${field}.`);
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

function integer(value, field, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(field);
  }
}

function issueIds(value, field) {
  if (!Array.isArray(value) || value.length > ISSUE_IDS.size) fail(field);
  const seen = new Set();
  for (const issueId of value) {
    if (!ISSUE_IDS.has(issueId) || seen.has(issueId)) fail(field);
    seen.add(issueId);
  }
}

function validateMetrics(value) {
  exactKeys(value, METRIC_KEYS, "status.metrics");
  for (const key of METRIC_KEYS) {
    integer(value[key], `status.metrics.${key}`);
  }
  if (
    value.incidents > value.events ||
    value.avoidableCalls > value.incidents
  ) {
    fail("status.metrics");
  }
}

function validateWarning(value) {
  if (value === null) return;
  exactKeys(value, WARNING_KEYS, "status.currentWarning");
  if (!RULE_IDS.has(value.ruleId)) fail("status.currentWarning.ruleId");
  if (!SEVERITIES.has(value.severity)) {
    fail("status.currentWarning.severity");
  }
  if (!ATTRIBUTIONS.has(value.attribution)) {
    fail("status.currentWarning.attribution");
  }
  integer(
    value.occurrences,
    "status.currentWarning.occurrences",
    1,
    1_000_000,
  );
  issueIds(
    value.issueIds,
    "status.currentWarning.issueIds",
  );
}

export function validateDashboardStatus(value) {
  exactKeys(value, STATUS_KEYS, "status");
  if (value.v !== 1) fail("status.v");
  if (typeof value.connected !== "boolean") fail("status.connected");
  if (!SOURCES.has(value.source)) fail("status.source");
  if (!SOURCE_STATES.has(value.sourceState)) {
    fail("status.sourceState");
  }
  if (!HEALTH.has(value.streamHealth)) fail("status.streamHealth");
  if (
    !HEALTH.has(value.traceHealth) ||
    value.traceHealth !== value.streamHealth
  ) {
    fail("status.traceHealth");
  }
  if (!COVERAGE.has(value.coverage)) fail("status.coverage");
  if (
    (value.streamHealth === "healthy" &&
      value.coverage === "unknown") ||
    (value.streamHealth !== "healthy" &&
      value.coverage !== "unknown")
  ) {
    fail("status.coverage");
  }
  integer(value.generation, "status.generation");
  if (
    value.streamAlias !== null &&
    (typeof value.streamAlias !== "string" ||
      !STREAM_ALIAS.test(value.streamAlias))
  ) {
    fail("status.streamAlias");
  }
  if (!MODES.has(value.mode)) fail("status.mode");
  if (!STATES.has(value.state)) fail("status.state");
  if (
    value.traceId !== null &&
    (typeof value.traceId !== "string" ||
      !TRACE_ALIAS.test(value.traceId))
  ) {
    fail("status.traceId");
  }
  if (
    value.traceAlias !== null &&
    (typeof value.traceAlias !== "string" ||
      (!TRACE_ALIAS.test(value.traceAlias) &&
        !SESSION_ALIAS.test(value.traceAlias)))
  ) {
    fail("status.traceAlias");
  }
  validateMetrics(value.metrics);
  integer(value.lastSequence, "status.lastSequence");
  validateWarning(value.currentWarning);
  exactKeys(value.promptCoach, PROMPT_COACH_KEYS, "status.promptCoach");
  issueIds(value.promptCoach.issueIds, "status.promptCoach.issueIds");

  if (
    (value.sourceState === "empty") !==
      (value.metrics.events === 0) ||
    (value.metrics.events === 0 && value.lastSequence !== 0) ||
    (value.currentWarning !== null && value.metrics.incidents === 0)
  ) {
    fail("status");
  }

  if (value.source === "live") {
    if (
      value.traceId !== null ||
      (value.traceAlias !== null &&
        !SESSION_ALIAS.test(value.traceAlias)) ||
      !(
        (value.generation === 0 && value.streamAlias === null) ||
        (value.generation > 0 &&
          typeof value.streamAlias === "string")
      ) ||
      !["idle", "active"].includes(value.state) ||
      (value.state === "idle") !== (value.sourceState === "empty")
    ) {
      fail("status");
    }
  } else if (
    value.generation < 1 ||
    value.streamAlias !== null ||
    (value.connected &&
      (value.traceId === null ||
        value.traceAlias !== value.traceId ||
        !["recording", "stopped"].includes(value.state))) ||
    (!value.connected &&
      (value.traceId !== null ||
        value.traceAlias !== null ||
        value.state !== "idle"))
  ) {
    fail("status");
  }

  return value;
}

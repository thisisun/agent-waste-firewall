const KINDS = new Set(["prompt", "tool", "incident", "progress", "system"]);
const PLATFORMS = new Set(["codex", "claude"]);
const MODES = new Set(["observe", "warn", "block"]);
const FAMILIES = new Set([
  "prompt",
  "read",
  "search",
  "write",
  "shell",
  "wait",
  "subagent",
  "system",
  "other",
]);
const OPERATIONS = new Set([
  "prompt",
  "command",
  "test",
  "build",
  "verify",
  "release",
  "deploy",
  "sign",
  "submit",
  "migrate",
  "inspect",
  "wait",
  "read",
  "search",
  "write",
  "subagent",
  "progress",
  "other",
]);
const OUTCOMES = new Set([
  "started",
  "failed",
  "interrupted",
  "succeeded",
  "observed",
  "blocked",
  "warned",
  "allowed",
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
const SEVERITIES = new Set(["none", "low", "medium", "high"]);
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
const KEYS = [
  "v",
  "seq",
  "elapsedMs",
  "kind",
  "platform",
  "sessionAlias",
  "mode",
  "family",
  "operation",
  "outcome",
  "ruleId",
  "severity",
  "attribution",
  "occurrences",
  "progressVersion",
  "issueIds",
  "incidentCountDelta",
  "avoidableCallsDelta",
  "decisionLatencyMs",
];

export const LIVE_EVENT_MAX_BYTES = 2 * 1024;
export const LIVE_EVENT_MAX_EVENTS = 4096;
export const LIVE_SPOOL_MAX_BYTES = 8 * 1024 * 1024;

class LiveEventValidationError extends TypeError {
  constructor(code, field) {
    super(`Invalid LiveEventV1 (${code}) at ${field}.`);
    this.name = "LiveEventValidationError";
    this.code = code;
    this.field = field;
  }
}

function fail(code, field) {
  throw new LiveEventValidationError(code, field);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateKeys(value) {
  if (!isRecord(value)) fail("expected_object", "event");
  const actual = Object.keys(value);
  if (
    actual.length !== KEYS.length ||
    actual.some((key) => !KEYS.includes(key))
  ) {
    fail("closed_shape_required", "event");
  }
  for (const key of KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail("missing_field", `event.${key}`);
    }
  }
}

function validateEnum(value, allowed, field) {
  if (typeof value !== "string" || !allowed.has(value)) {
    fail("invalid_enum", field);
  }
}

function validateInteger(value, field, minimum = 0, maximum = null) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    (maximum !== null && value > maximum)
  ) {
    fail("invalid_integer", field);
  }
}

function validateNullableEnum(value, allowed, field) {
  if (value !== null) validateEnum(value, allowed, field);
}

function validateSessionAlias(value) {
  if (
    typeof value !== "string" ||
    !/^session_[0-9a-f]{32}$/u.test(value)
  ) {
    fail("invalid_alias", "event.sessionAlias");
  }
}

function validateIssueIds(value) {
  if (!Array.isArray(value) || value.length > ISSUE_IDS.size) {
    fail("invalid_issue_ids", "event.issueIds");
  }
  const seen = new Set();
  for (const issueId of value) {
    validateEnum(issueId, ISSUE_IDS, "event.issueIds");
    if (seen.has(issueId)) fail("duplicate_issue_id", "event.issueIds");
    seen.add(issueId);
  }
}

export function validateLiveEvent(event) {
  validateKeys(event);
  if (event.v !== 1) fail("unsupported_version", "event.v");
  validateInteger(event.seq, "event.seq", 1);
  validateInteger(event.elapsedMs, "event.elapsedMs");
  validateEnum(event.kind, KINDS, "event.kind");
  validateEnum(event.platform, PLATFORMS, "event.platform");
  validateSessionAlias(event.sessionAlias);
  validateEnum(event.mode, MODES, "event.mode");
  validateEnum(event.family, FAMILIES, "event.family");
  validateEnum(event.operation, OPERATIONS, "event.operation");
  validateEnum(event.outcome, OUTCOMES, "event.outcome");
  validateNullableEnum(event.ruleId, RULE_IDS, "event.ruleId");
  validateEnum(event.severity, SEVERITIES, "event.severity");
  validateNullableEnum(event.attribution, ATTRIBUTIONS, "event.attribution");
  validateInteger(event.occurrences, "event.occurrences", 1, 1_000_000);
  validateInteger(event.progressVersion, "event.progressVersion");
  validateIssueIds(event.issueIds);
  validateInteger(
    event.incidentCountDelta,
    "event.incidentCountDelta",
    0,
    1,
  );
  validateInteger(
    event.avoidableCallsDelta,
    "event.avoidableCallsDelta",
    0,
    1,
  );
  validateInteger(
    event.decisionLatencyMs,
    "event.decisionLatencyMs",
    0,
    60_000,
  );

  const hasIncident = event.ruleId !== null;
  if (
    hasIncident !== (event.kind === "incident") ||
    hasIncident !== (event.severity !== "none") ||
    hasIncident !== (event.attribution !== null)
  ) {
    fail("inconsistent_incident", "event");
  }
  if (!hasIncident && event.occurrences !== 1) {
    fail("unexpected_occurrences", "event.occurrences");
  }
  if (event.incidentCountDelta === 1 && !hasIncident) {
    fail("unexpected_incident_delta", "event.incidentCountDelta");
  }
  if (event.avoidableCallsDelta > event.incidentCountDelta) {
    fail("unexpected_avoidable_delta", "event.avoidableCallsDelta");
  }
  if (event.issueIds.length > 0 && event.family !== "prompt") {
    fail("unexpected_issue_ids", "event.issueIds");
  }
  return event;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function serializeLiveEvent(event) {
  validateLiveEvent(event);
  const serialized = `${JSON.stringify(stableValue(event))}\n`;
  if (Buffer.byteLength(serialized, "utf8") > LIVE_EVENT_MAX_BYTES) {
    fail("event_too_large", "event");
  }
  return serialized;
}

export function auditLiveEventText(
  text,
  {
    maxBytes = LIVE_SPOOL_MAX_BYTES,
    maxEvents = LIVE_EVENT_MAX_EVENTS,
    allowEmpty = true,
  } = {},
) {
  const findings = [];
  if (typeof text !== "string") {
    return {
      ok: false,
      eventCount: 0,
      findings: [{ line: 0, code: "expected_text" }],
    };
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    return {
      ok: false,
      eventCount: 0,
      findings: [{ line: 0, code: "spool_too_large" }],
    };
  }

  let eventCount = 0;
  let previousSeq = null;
  let previousElapsedMs = null;
  for (const [index, lineText] of text.split(/\r?\n/u).entries()) {
    if (!lineText.trim()) continue;
    const line = index + 1;
    if (eventCount >= maxEvents) {
      findings.push({ line, code: "too_many_events" });
      break;
    }
    let event;
    try {
      event = JSON.parse(lineText);
    } catch {
      findings.push({ line, code: "invalid_json" });
      continue;
    }
    try {
      validateLiveEvent(event);
      if (Buffer.byteLength(`${lineText}\n`, "utf8") > LIVE_EVENT_MAX_BYTES) {
        fail("event_too_large", "event");
      }
    } catch (error) {
      findings.push({
        line,
        code:
          error instanceof LiveEventValidationError
            ? error.code
            : "invalid_event",
      });
      continue;
    }
    eventCount += 1;
    if (previousSeq !== null && event.seq <= previousSeq) {
      findings.push({ line, code: "sequence_not_increasing" });
    }
    if (
      previousElapsedMs !== null &&
      event.elapsedMs < previousElapsedMs
    ) {
      findings.push({ line, code: "elapsed_time_decreased" });
    }
    previousSeq = event.seq;
    previousElapsedMs = event.elapsedMs;
  }
  if (!allowEmpty && eventCount === 0 && findings.length === 0) {
    findings.push({ line: 0, code: "empty_spool" });
  }
  return {
    ok: findings.length === 0,
    eventCount,
    findings,
  };
}

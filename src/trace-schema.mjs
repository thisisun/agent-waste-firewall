const EVENT_KINDS = new Set(["prompt", "tool_pre", "tool_post", "stop"]);
const PLATFORMS = new Set(["codex", "claude"]);
const DECISIONS = new Set(["allow", "warn", "block", "observe"]);
const SEVERITIES = new Set(["none", "low", "medium", "high"]);
const INCIDENT_SEVERITIES = new Set(["low", "medium", "high"]);
const CONFIDENCES = new Set(["low", "medium", "high"]);
const LOCALES = new Set(["ko", "en", "other"]);
const ISSUE_IDS = new Set([
  "broad",
  "target",
  "success",
  "verify",
  "stop",
  "conflict",
]);
const TOOL_FAMILIES = new Set([
  "read",
  "search",
  "write",
  "shell",
  "wait",
  "subagent",
  "other",
]);
const OPERATIONS = new Set([
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
  "other",
]);
const RISKS = new Set([
  "none",
  "external_change",
  "production_change",
  "credential_access",
  "signing",
  "submission",
]);
const FILE_TYPES = new Set([
  "source",
  "data",
  "document",
  "image",
  "config",
  "binary",
  "directory",
  "other",
]);
const TARGET_SCOPES = new Set(["workspace", "external"]);
const CONTENT_STATES = new Set([
  "present",
  "missing",
  "unavailable",
  "not_observed",
]);
const OUTCOMES = new Set(["success", "failure", "interrupted", "unknown"]);
const FAILURE_CLASSES = new Set([
  "agent",
  "environment",
  "harness",
  "user_instruction",
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
const ATTRIBUTIONS = new Set([
  "user_instruction",
  "agent",
  "environment",
  "harness",
]);

const COMMON_KEYS = [
  "v",
  "seq",
  "elapsedMs",
  "kind",
  "platform",
  "sessionAlias",
  "decision",
  "progressVersion",
];
const OPTIONAL_COMMON_KEYS = ["turnAlias", "incident"];
const PROMPT_KEYS = [
  "promptAlias",
  "locale",
  "score",
  "severity",
  "shouldWarn",
  "isAction",
  "isFollowUp",
  "issueIds",
];
const TOOL_KEYS = [
  "callAlias",
  "signatureAlias",
  "family",
  "operation",
  "risk",
  "targets",
];
const POST_KEYS = [
  "resultAlias",
  "outcome",
  "failureClass",
  "madeProgress",
];
const TARGET_KEYS = [
  "pathAlias",
  "fileType",
  "scope",
  "contentAlias",
  "contentState",
];
const INCIDENT_KEYS = [
  "ruleId",
  "attribution",
  "severity",
  "confidence",
  "repeatCount",
  "blockable",
  "notified",
];

const MAX_TARGETS = 64;
const MAX_ALIAS_HEX_LENGTH = 64;
const MAX_TRACE_BYTES = 64 * 1024 * 1024;
const MAX_TRACE_EVENTS = 1_000_000;

class TraceValidationError extends TypeError {
  constructor(code, field) {
    super(`Invalid semantic trace event (${code}) at ${field}.`);
    this.name = "TraceValidationError";
    this.code = code;
    this.field = field;
  }
}

function fail(code, field) {
  throw new TraceValidationError(code, field);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validateKeys(value, required, optional, field) {
  if (!isRecord(value)) {
    fail("expected_object", field);
  }

  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      // Do not include the untrusted key name in diagnostics.
      fail("unknown_field", field);
    }
  }
  for (const key of required) {
    if (!own(value, key)) {
      fail("missing_field", `${field}.${key}`);
    }
  }
}

function validateEnum(value, allowed, field) {
  if (typeof value !== "string" || !allowed.has(value)) {
    fail("invalid_enum", field);
  }
}

function validateBoolean(value, field) {
  if (typeof value !== "boolean") {
    fail("expected_boolean", field);
  }
}

function validateInteger(value, field, { minimum = 0, maximum = null } = {}) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    (maximum !== null && value > maximum)
  ) {
    fail("invalid_integer", field);
  }
}

function validateAlias(value, domain, field) {
  if (typeof value !== "string") {
    fail("invalid_alias", field);
  }
  const prefix = `${domain}_`;
  const digest = value.startsWith(prefix) ? value.slice(prefix.length) : "";
  if (
    digest.length < 32 ||
    digest.length > MAX_ALIAS_HEX_LENGTH ||
    !/^[0-9a-f]+$/u.test(digest)
  ) {
    fail("invalid_alias", field);
  }
}

function validateNullableAlias(value, domain, field) {
  if (value !== null) {
    validateAlias(value, domain, field);
  }
}

function validateIncident(value, field) {
  validateKeys(value, INCIDENT_KEYS, [], field);
  validateEnum(value.ruleId, RULE_IDS, `${field}.ruleId`);
  validateEnum(value.attribution, ATTRIBUTIONS, `${field}.attribution`);
  validateEnum(value.severity, INCIDENT_SEVERITIES, `${field}.severity`);
  validateEnum(value.confidence, CONFIDENCES, `${field}.confidence`);
  validateInteger(value.repeatCount, `${field}.repeatCount`, { minimum: 1 });
  validateBoolean(value.blockable, `${field}.blockable`);
  validateBoolean(value.notified, `${field}.notified`);
}

function validateTarget(value, index) {
  const field = `event.targets[${index}]`;
  validateKeys(value, TARGET_KEYS, [], field);
  validateAlias(value.pathAlias, "path", `${field}.pathAlias`);
  validateEnum(value.fileType, FILE_TYPES, `${field}.fileType`);
  validateEnum(value.scope, TARGET_SCOPES, `${field}.scope`);
  validateNullableAlias(value.contentAlias, "content", `${field}.contentAlias`);
  validateEnum(value.contentState, CONTENT_STATES, `${field}.contentState`);

  if (value.contentState === "present" && value.contentAlias === null) {
    fail("missing_content_alias", `${field}.contentAlias`);
  }
  if (value.contentState !== "present" && value.contentAlias !== null) {
    fail("unexpected_content_alias", `${field}.contentAlias`);
  }
}

function validateTargets(value) {
  if (!Array.isArray(value) || value.length > MAX_TARGETS) {
    fail("invalid_targets", "event.targets");
  }
  const pathAliases = new Set();
  for (const [index, target] of value.entries()) {
    validateTarget(target, index);
    if (pathAliases.has(target.pathAlias)) {
      fail("duplicate_target", `event.targets[${index}].pathAlias`);
    }
    pathAliases.add(target.pathAlias);
  }
}

function validatePrompt(value) {
  validateAlias(value.promptAlias, "prompt", "event.promptAlias");
  validateEnum(value.locale, LOCALES, "event.locale");
  validateInteger(value.score, "event.score", { maximum: 100 });
  validateEnum(value.severity, SEVERITIES, "event.severity");
  validateBoolean(value.shouldWarn, "event.shouldWarn");
  validateBoolean(value.isAction, "event.isAction");
  validateBoolean(value.isFollowUp, "event.isFollowUp");

  if (!Array.isArray(value.issueIds) || value.issueIds.length > ISSUE_IDS.size) {
    fail("invalid_issue_ids", "event.issueIds");
  }
  const issueIds = new Set();
  for (const issueId of value.issueIds) {
    validateEnum(issueId, ISSUE_IDS, "event.issueIds");
    if (issueIds.has(issueId)) {
      fail("duplicate_issue_id", "event.issueIds");
    }
    issueIds.add(issueId);
  }
}

function validateTool(value) {
  validateAlias(value.callAlias, "call", "event.callAlias");
  validateAlias(value.signatureAlias, "signature", "event.signatureAlias");
  validateEnum(value.family, TOOL_FAMILIES, "event.family");
  validateEnum(value.operation, OPERATIONS, "event.operation");
  validateEnum(value.risk, RISKS, "event.risk");
  validateTargets(value.targets);
  validateInteger(value.progressVersion, "event.progressVersion");
}

function validatePost(value) {
  validateNullableAlias(value.resultAlias, "result", "event.resultAlias");
  validateEnum(value.outcome, OUTCOMES, "event.outcome");
  if (value.failureClass !== null) {
    validateEnum(value.failureClass, FAILURE_CLASSES, "event.failureClass");
  }
  validateBoolean(value.madeProgress, "event.madeProgress");

  if (value.outcome === "failure" && value.failureClass === null) {
    fail("missing_failure_class", "event.failureClass");
  }
  if (value.outcome !== "failure" && value.failureClass !== null) {
    fail("unexpected_failure_class", "event.failureClass");
  }
}

export function validateTraceEvent(event) {
  if (!isRecord(event)) {
    fail("expected_object", "event");
  }
  if (!own(event, "kind")) {
    fail("missing_field", "event.kind");
  }
  validateEnum(event.kind, EVENT_KINDS, "event.kind");

  const kindKeys =
    event.kind === "prompt"
      ? PROMPT_KEYS
      : event.kind === "tool_pre"
        ? TOOL_KEYS
        : event.kind === "tool_post"
          ? [...TOOL_KEYS, ...POST_KEYS]
          : [];
  validateKeys(
    event,
    [...COMMON_KEYS, ...kindKeys],
    OPTIONAL_COMMON_KEYS,
    "event",
  );

  if (event.v !== 1) {
    fail("unsupported_version", "event.v");
  }
  validateInteger(event.seq, "event.seq");
  validateInteger(event.elapsedMs, "event.elapsedMs");
  validateEnum(event.platform, PLATFORMS, "event.platform");
  validateAlias(event.sessionAlias, "session", "event.sessionAlias");
  validateInteger(event.progressVersion, "event.progressVersion");
  if (own(event, "turnAlias")) {
    validateAlias(event.turnAlias, "turn", "event.turnAlias");
  }
  validateEnum(event.decision, DECISIONS, "event.decision");
  if (own(event, "incident")) {
    validateIncident(event.incident, "event.incident");
  }

  if (event.kind === "prompt") {
    validatePrompt(event);
  } else if (event.kind === "tool_pre" || event.kind === "tool_post") {
    validateTool(event);
    if (event.kind === "tool_post") {
      validatePost(event);
    }
  }

  return event;
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function serializeTraceEvent(event) {
  validateTraceEvent(event);
  return `${JSON.stringify(stableValue(event))}\n`;
}

function inspectString(value, codes) {
  const checks = [
    ["possible_posix_path", /(?:^|[\s"'=:])\/(?:Users|home|private|var|tmp|opt|etc)\/[^\s"',}]+/iu],
    ["possible_home_path", /(?:^|[\s"'=:])~\/[^\s"',}]+/u],
    ["possible_windows_path", /(?:^|[\s"'=:])[a-z]:[\\/]{1,2}(?:Users|Documents|Windows)[\\/]/iu],
    ["possible_unc_path", /\\\\[A-Za-z0-9._-]+\\[A-Za-z0-9$._-]+/u],
    ["possible_url", /\b(?:https?|ssh):\/\/|(?:^|[\s"'=])git@[A-Za-z0-9.-]+:/iu],
    ["possible_email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu],
    ["possible_private_key", /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/u],
    ["possible_jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u],
    [
      "possible_secret",
      /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/u,
    ],
    [
      "possible_secret_assignment",
      /\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?)\s*=/u,
    ],
  ];
  for (const [code, pattern] of checks) {
    if (pattern.test(value)) {
      codes.add(code);
    }
  }
}

function inspectStrings(value, codes) {
  if (typeof value === "string") {
    inspectString(value, codes);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      inspectStrings(child, codes);
    }
    return;
  }
  if (isRecord(value)) {
    for (const child of Object.values(value)) {
      inspectStrings(child, codes);
    }
  }
}

export function auditTraceText(text) {
  const findings = [];
  const seenFindings = new Set();
  const addFinding = (line, code, field = null) => {
    const key = `${line}:${code}:${field ?? ""}`;
    if (seenFindings.has(key)) {
      return;
    }
    seenFindings.add(key);
    findings.push(field === null ? { line, code } : { line, code, field });
  };

  if (typeof text !== "string") {
    return {
      ok: false,
      eventCount: 0,
      findings: [{ line: 0, code: "expected_text" }],
    };
  }
  if (Buffer.byteLength(text, "utf8") > MAX_TRACE_BYTES) {
    return {
      ok: false,
      eventCount: 0,
      findings: [{ line: 0, code: "trace_too_large" }],
    };
  }

  let eventCount = 0;
  let priorSeq = null;
  let priorElapsedMs = null;
  const lines = text.split(/\r?\n/u);

  for (const [index, lineText] of lines.entries()) {
    const line = index + 1;
    if (!lineText.trim()) {
      continue;
    }
    if (eventCount >= MAX_TRACE_EVENTS) {
      addFinding(line, "too_many_events");
      break;
    }

    let event;
    try {
      event = JSON.parse(lineText);
    } catch {
      addFinding(line, "invalid_json");
      continue;
    }

    const privacyCodes = new Set();
    inspectStrings(event, privacyCodes);
    for (const code of privacyCodes) {
      addFinding(line, code);
    }

    try {
      validateTraceEvent(event);
    } catch (error) {
      if (error instanceof TraceValidationError) {
        addFinding(line, error.code, error.field);
      } else {
        addFinding(line, "invalid_event");
      }
      continue;
    }

    eventCount += 1;
    if (priorSeq !== null && event.seq <= priorSeq) {
      addFinding(line, "sequence_not_increasing", "event.seq");
    }
    if (priorElapsedMs !== null && event.elapsedMs < priorElapsedMs) {
      addFinding(line, "elapsed_time_decreased", "event.elapsedMs");
    }
    priorSeq = event.seq;
    priorElapsedMs = event.elapsedMs;
  }

  if (eventCount === 0 && findings.length === 0) {
    addFinding(0, "empty_trace");
  }

  return {
    ok: findings.length === 0,
    eventCount,
    findings,
  };
}

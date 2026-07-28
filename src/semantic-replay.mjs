import { validateTraceEvent } from "./trace-schema.mjs";

const MODES = new Set(["observe", "warn", "block"]);
const ACTIONS = ["allow", "observe", "warn", "block"];
const EVENT_KINDS = new Set(["prompt", "tool_pre", "tool_post", "stop"]);
const ATTRIBUTIONS = new Set([
  "user_instruction",
  "agent",
  "environment",
  "harness",
]);
const SEVERITIES = new Set(["none", "low", "medium", "high"]);
const CONFIDENCES = new Set(["low", "medium", "high"]);
const SAFE_RULE_ID = /^[a-z][a-z0-9_]{0,63}$/u;

function replayOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Semantic replay options must be an object.");
  }

  const mode = options.mode ?? "warn";
  if (!MODES.has(mode)) {
    throw new TypeError("Semantic replay mode must be observe, warn, or block.");
  }

  const promptBlockScore = options.promptBlockScore ?? 35;
  if (
    !Number.isInteger(promptBlockScore) ||
    promptBlockScore < 0 ||
    promptBlockScore > 100
  ) {
    throw new TypeError(
      "Semantic replay promptBlockScore must be an integer from 0 to 100.",
    );
  }

  return { mode, promptBlockScore };
}

function assertSafeIncident(incident, index) {
  if (!incident) {
    return;
  }

  if (
    !SAFE_RULE_ID.test(incident.ruleId) ||
    !ATTRIBUTIONS.has(incident.attribution) ||
    !SEVERITIES.has(incident.severity) ||
    !CONFIDENCES.has(incident.confidence) ||
    !Number.isInteger(incident.repeatCount) ||
    incident.repeatCount < 1 ||
    typeof incident.blockable !== "boolean" ||
    typeof incident.notified !== "boolean"
  ) {
    throw new TypeError(
      `Semantic trace event ${index + 1} has an unsafe incident summary.`,
    );
  }
}

function validateEvent(event, index) {
  try {
    const validation = validateTraceEvent(event);
    if (
      validation === false ||
      validation?.ok === false ||
      validation?.valid === false
    ) {
      throw new TypeError("Trace schema validation failed.");
    }
  } catch {
    // Avoid echoing validator diagnostics because they could contain source data.
    throw new TypeError(`Invalid semantic trace event at index ${index}.`);
  }

  if (!EVENT_KINDS.has(event.kind) || !ACTIONS.includes(event.decision)) {
    throw new TypeError(
      `Semantic trace event ${index + 1} has an unsafe event summary.`,
    );
  }
  assertSafeIncident(event.incident, index);
}

function blockableAtPreflight(event, promptBlockScore) {
  const incident = event.incident;
  if (!incident?.blockable) {
    return false;
  }
  if (event.kind === "tool_pre") {
    return true;
  }
  return (
    event.kind === "prompt" &&
    Number.isInteger(event.score) &&
    event.score <= promptBlockScore
  );
}

function simulatedDecision(event, mode, promptBlockScore) {
  const incident = event.incident;
  if (!incident) {
    return "allow";
  }

  if (mode === "observe") {
    return "observe";
  }

  if (
    mode === "block" &&
    blockableAtPreflight(event, promptBlockScore)
  ) {
    // A deduplicated intervention remains enforceable. `notified` controls
    // summary emission, not whether a high-confidence preflight is blocked.
    return "block";
  }

  return incident.notified ? "warn" : "allow";
}

function incidentSummary(event, simulated) {
  const incident = event.incident;
  return {
    seq: event.seq,
    kind: event.kind,
    ruleId: incident.ruleId,
    attribution: incident.attribution,
    severity: incident.severity,
    confidence: incident.confidence,
    repeatCount: incident.repeatCount,
    blockable: incident.blockable,
    capturedDecision: event.decision,
    simulatedDecision: simulated,
    drift: event.decision !== simulated,
  };
}

function driftSummary(event, simulated, fallbackSeq) {
  return {
    seq: Number.isInteger(event.seq) ? event.seq : fallbackSeq,
    kind: event.kind,
    capturedDecision: event.decision,
    simulatedDecision: simulated,
    ruleId: event.incident?.ruleId ?? null,
  };
}

/**
 * Replays already-normalized semantic events.
 *
 * The function intentionally consumes no hook payloads and performs no I/O.
 * Its result contains only bounded enums, numbers, booleans, and trace-local
 * identifiers already accepted by the trace schema.
 */
export function replaySemanticEvents(
  events,
  options = {},
) {
  if (!Array.isArray(events)) {
    throw new TypeError("Semantic replay events must be an array.");
  }
  const normalizedOptions = replayOptions(options);

  // Validate the complete input before deriving any replay output.
  for (const [index, event] of events.entries()) {
    validateEvent(event, index);
  }

  const decisions = [];
  const drifts = [];
  const actionCounts = {
    allow: 0,
    observe: 0,
    warn: 0,
    block: 0,
  };
  let incidentCount = 0;
  let notifiedIncidentCount = 0;

  for (const [index, event] of events.entries()) {
    const simulated = simulatedDecision(
      event,
      normalizedOptions.mode,
      normalizedOptions.promptBlockScore,
    );
    actionCounts[simulated] += 1;

    if (event.incident) {
      incidentCount += 1;
      if (event.incident.notified) {
        notifiedIncidentCount += 1;
        decisions.push(incidentSummary(event, simulated));
      }
    }

    if (event.decision !== simulated) {
      drifts.push(driftSummary(event, simulated, index + 1));
    }
  }

  return {
    mode: normalizedOptions.mode,
    promptBlockScore: normalizedOptions.promptBlockScore,
    eventCount: events.length,
    incidentCount,
    notifiedIncidentCount,
    decisionCount: decisions.length,
    driftCount: drifts.length,
    actionCounts,
    decisions,
    drifts,
  };
}

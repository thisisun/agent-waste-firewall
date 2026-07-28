import crypto from "node:crypto";

import { validateLiveEvent } from "./live-event-schema.mjs";
import { resolveWorkspaceRoot } from "./trace-store.mjs";
import { detectPlatform } from "./tool-event.mjs";

const SUPPORTED_EVENTS = new Set([
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
]);
const AVOIDABLE_RULES = new Set([
  "exact_tool_repeat",
  "unchanged_reread",
  "retry_after_same_failure",
  "repeated_failure_result",
  "status_polling_loop",
  "edit_revert_oscillation",
]);

function sessionAlias(key, platform, workspaceRoot, sessionId) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new TypeError("Live alias key must be 32 bytes.");
  }
  const digest = crypto
    .createHmac("sha256", key)
    .update("awf-live-v1\0session\0")
    .update(platform)
    .update("\0")
    .update(workspaceRoot)
    .update("\0")
    .update(sessionId)
    .digest("hex")
    .slice(0, 32);
  return `session_${digest}`;
}

function outputWasBlocked(output) {
  return (
    output?.decision === "block" ||
    output?.hookSpecificOutput?.permissionDecision === "deny"
  );
}

function outcomeFor(eventName, result, mode) {
  if (outputWasBlocked(result?.output)) return "blocked";
  if (result?.incident) {
    return mode === "observe" || result.incident.shouldNotify === false
      ? "observed"
      : "warned";
  }
  if (eventName === "PreToolUse") return "started";
  if (eventName === "PostToolUse" || eventName === "PostToolUseFailure") {
    if (result?.tool?.interrupted) return "interrupted";
    if (result?.tool?.failed) return "failed";
    return result?.tool ? "succeeded" : "observed";
  }
  return "allowed";
}

function kindFor(eventName, result) {
  if (result?.incident) return "incident";
  if (result?.observed?.madeProgress === true) return "progress";
  if (eventName === "UserPromptSubmit") return "prompt";
  if (eventName === "Stop") return "system";
  return "tool";
}

function familyFor(eventName, result) {
  if (eventName === "UserPromptSubmit") return "prompt";
  if (eventName === "Stop") return "system";
  return result?.tool?.family ?? "other";
}

function operationFor(eventName, result) {
  if (eventName === "UserPromptSubmit") return "prompt";
  if (eventName === "Stop" || result?.observed?.madeProgress === true) {
    return "progress";
  }
  return result?.tool?.operation ?? "other";
}

function promptIssueIds(eventName, result) {
  if (eventName !== "UserPromptSubmit") return [];
  return Array.isArray(result?.evaluation?.issues)
    ? result.evaluation.issues.map((issue) => String(issue.id))
    : [];
}

function boundedLatency(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(60_000, Math.max(0, Math.round(numeric)));
}

export function projectLiveEvent({
  payload,
  result,
  config,
  key,
  seq,
  elapsedMs,
  decisionLatencyMs = 0,
  env = process.env,
}) {
  const eventName = String(payload?.hook_event_name ?? "");
  if (!SUPPORTED_EVENTS.has(eventName)) return null;

  const platform = detectPlatform(payload, env);
  const workspaceRoot = resolveWorkspaceRoot(
    String(payload?.cwd ?? process.cwd()),
  );
  const incident = result?.incident ?? null;
  const notified = incident?.shouldNotify !== false;
  const event = {
    v: 1,
    seq,
    elapsedMs,
    kind: kindFor(eventName, result),
    platform,
    sessionAlias: sessionAlias(
      key,
      platform,
      workspaceRoot,
      String(payload?.session_id ?? "unknown"),
    ),
    mode: config.mode,
    family: familyFor(eventName, result),
    operation: operationFor(eventName, result),
    outcome: outcomeFor(eventName, result, config.mode),
    ruleId: incident ? String(incident.ruleId) : null,
    severity: incident ? String(incident.severity) : "none",
    attribution: incident ? String(incident.category) : null,
    occurrences: incident
      ? Math.max(1, Number(incident.occurrences ?? 1))
      : 1,
    progressVersion: Math.max(
      0,
      Number(result?.observed?.progressVersion ?? 0),
    ),
    issueIds: promptIssueIds(eventName, result),
    incidentCountDelta: incident && notified ? 1 : 0,
    avoidableCallsDelta:
      incident && notified && AVOIDABLE_RULES.has(incident.ruleId) ? 1 : 0,
    decisionLatencyMs: boundedLatency(decisionLatencyMs),
  };
  validateLiveEvent(event);
  return event;
}

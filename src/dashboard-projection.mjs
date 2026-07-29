const AVOIDABLE_RULES = new Set([
  "exact_tool_repeat",
  "unchanged_reread",
  "retry_after_same_failure",
  "repeated_failure_result",
  "status_polling_loop",
  "edit_revert_oscillation",
]);

const SEVERITY_RANK = {
  low: 1,
  medium: 2,
  high: 3,
};
const MODES = new Set(["observe", "warn", "block"]);
const TRACE_STATES = new Set(["recording", "stopped"]);

function safeTraceStatus(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.traceId !== "string" ||
    !/^trace_[0-9a-f]{24}$/u.test(value.traceId) ||
    !MODES.has(value.mode) ||
    !TRACE_STATES.has(value.status)
  ) {
    return null;
  }
  for (const key of [
    "eventCount",
    "incidentCount",
    "avoidableCallCount",
    "elapsedMs",
  ]) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) return null;
  }
  if (
    value.incidentCount > value.eventCount ||
    value.avoidableCallCount > value.incidentCount
  ) {
    return null;
  }
  return value;
}

function selectHighestWarning(events, describe) {
  const sessions = new Map();
  for (const event of events) {
    const current = sessions.get(event.sessionAlias);
    const description = describe(event);
    if (!current || event.progressVersion > current.progressVersion) {
      sessions.set(event.sessionAlias, {
        progressVersion: event.progressVersion,
        warning: description.warning,
      });
      continue;
    }
    if (
      event.progressVersion === current.progressVersion &&
      description.warning
    ) {
      current.warning = description.warning;
      continue;
    }
    if (
      event.progressVersion === current.progressVersion &&
      description.clearsPromptContract &&
      current.warning?.ruleId === "prompt_contract"
    ) {
      current.warning = null;
    }
  }

  let selected = null;
  for (const session of sessions.values()) {
    const candidate = session.warning;
    if (!candidate) continue;
    const candidateRank = SEVERITY_RANK[candidate.severity] ?? 0;
    const selectedRank = selected
      ? (SEVERITY_RANK[selected.severity] ?? 0)
      : -1;
    if (
      !selected ||
      candidateRank > selectedRank ||
      (candidateRank === selectedRank && candidate.seq > selected.seq)
    ) {
      selected = candidate;
    }
  }
  return selected;
}

function traceWarning(events) {
  return selectHighestWarning(events, (event) => ({
    warning: event.incident
      ? {
          seq: event.seq,
          ruleId: event.incident.ruleId,
          severity: event.incident.severity,
          attribution: event.incident.attribution,
          occurrences: event.incident.repeatCount,
          issueIds:
            event.kind === "prompt" &&
            event.incident.ruleId === "prompt_contract"
              ? event.issueIds
              : [],
        }
      : null,
    clearsPromptContract:
      event.kind === "prompt" && event.shouldWarn === false,
  }));
}

function liveWarning(events) {
  return selectHighestWarning(events, (event) => ({
    warning:
      event.kind === "incident"
        ? {
            seq: event.seq,
            ruleId: event.ruleId,
            severity: event.severity,
            attribution: event.attribution,
            occurrences: event.occurrences,
            issueIds: event.family === "prompt" ? event.issueIds : [],
          }
        : null,
    clearsPromptContract:
      event.kind === "prompt" && event.issueIds.length === 0,
  }));
}

function publicWarning(warning) {
  if (!warning) return null;
  return {
    ruleId: warning.ruleId,
    severity: warning.severity,
    attribution: warning.attribution,
    occurrences: warning.occurrences,
    issueIds: warning.issueIds,
  };
}

export function projectTraceDashboardStatus({
  storeStatus,
  events,
  health,
  generation,
}) {
  const safeStatus = safeTraceStatus(storeStatus);
  if (!safeStatus) {
    const rejected = storeStatus !== null && storeStatus !== undefined;
    const effectiveHealth = rejected ? "degraded" : health;
    return {
      v: 1,
      connected: false,
      source: "trace",
      sourceState: "empty",
      streamHealth: effectiveHealth,
      traceHealth: effectiveHealth,
      coverage:
        effectiveHealth === "healthy" ? "complete" : "unknown",
      generation,
      streamAlias: null,
      mode: "observe",
      state: "idle",
      traceId: null,
      metrics: {
        events: 0,
        incidents: 0,
        avoidableCalls: 0,
        elapsedMs: 0,
      },
      lastSequence: 0,
      currentWarning: null,
      promptCoach: { issueIds: [] },
    };
  }
  const warning = traceWarning(events);
  const latestPrompt =
    events.findLast((event) => event.kind === "prompt") ?? null;
  return {
    v: 1,
    connected: true,
    source: "trace",
    sourceState: events.length > 0 ? "active" : "empty",
    streamHealth: health,
    traceHealth: health,
    coverage: health === "healthy" ? "complete" : "unknown",
    generation,
    streamAlias: null,
    mode: safeStatus.mode,
    state: safeStatus.status,
    traceId: safeStatus.traceId,
    traceAlias: safeStatus.traceId,
    metrics: {
      events: safeStatus.eventCount,
      incidents: safeStatus.incidentCount,
      avoidableCalls: safeStatus.avoidableCallCount,
      elapsedMs: safeStatus.elapsedMs,
    },
    lastSequence: events.at(-1)?.seq ?? 0,
    currentWarning: publicWarning(warning),
    promptCoach: {
      issueIds: latestPrompt?.issueIds ?? [],
    },
  };
}

export function projectLiveDashboardStatus(snapshot) {
  const status = snapshot.status;
  const events = snapshot.events;
  const warning = liveWarning(events);
  const latestPrompt =
    events.findLast((event) => event.family === "prompt") ?? null;
  const hasGap =
    (status?.gapCount ?? 0) > 0 ||
    status?.publicationDropped === 1;
  const coverage =
    snapshot.health === "healthy"
      ? hasGap
        ? "incomplete"
        : "complete"
      : "unknown";
  return {
    v: 1,
    connected: snapshot.initialized,
    source: "live",
    sourceState: events.length > 0 ? "active" : "empty",
    streamHealth: snapshot.health,
    traceHealth: snapshot.health,
    coverage,
    generation: snapshot.generation,
    streamAlias: snapshot.streamAlias,
    mode: snapshot.mode,
    state: events.length > 0 ? "active" : "idle",
    traceId: null,
    traceAlias: events.at(-1)?.sessionAlias ?? null,
    metrics: {
      events: status?.eventCount ?? 0,
      incidents: status?.incidentCount ?? 0,
      avoidableCalls: status?.avoidableCallCount ?? 0,
      elapsedMs: status?.lastElapsedMs ?? 0,
    },
    lastSequence: events.at(-1)?.seq ?? 0,
    currentWarning: publicWarning(warning),
    promptCoach: {
      issueIds: latestPrompt?.issueIds ?? [],
    },
  };
}

export function projectLiveDashboardEvent(event) {
  return {
    kind: event.kind,
    family: event.family,
    operation: event.operation,
    outcome: event.outcome,
    ruleId: event.ruleId,
    severity: event.severity,
    attribution: event.attribution,
    alias: event.sessionAlias,
    elapsedMs: event.elapsedMs,
    issueIds: event.issueIds,
    occurrences: event.occurrences,
    incidentCountDelta: event.incidentCountDelta,
    avoidableCallsDelta: event.avoidableCallsDelta,
  };
}

export function projectTraceDashboardEvent(event) {
  const incident = event.incident;
  const kind = incident
    ? "incident"
    : event.madeProgress === true
      ? "progress"
      : event.kind === "prompt"
        ? "prompt"
        : event.kind === "stop"
          ? "system"
          : "tool";
  const outcome =
    event.kind === "tool_pre"
      ? "started"
      : event.kind === "tool_post"
        ? event.outcome === "failure"
          ? "failed"
          : event.outcome === "interrupted"
            ? "interrupted"
            : event.outcome === "success"
              ? "succeeded"
              : "observed"
        : event.decision === "block"
          ? "blocked"
          : event.decision === "warn"
            ? "warned"
            : event.decision === "observe"
              ? "observed"
              : "allowed";
  return {
    kind,
    family:
      event.kind === "prompt"
        ? "prompt"
        : event.kind === "stop"
          ? "system"
          : event.family,
    operation:
      event.kind === "prompt"
        ? "prompt"
        : event.kind === "stop"
          ? "progress"
          : event.operation,
    outcome,
    ruleId: incident?.ruleId ?? null,
    severity: incident?.severity ?? "none",
    attribution: incident?.attribution ?? null,
    alias: event.callAlias ?? event.sessionAlias,
    elapsedMs: event.elapsedMs,
    issueIds: event.kind === "prompt" ? event.issueIds : [],
    occurrences: incident?.repeatCount ?? 1,
    incidentCountDelta: incident?.notified === true ? 1 : 0,
    avoidableCallsDelta:
      incident?.notified && AVOIDABLE_RULES.has(incident.ruleId) ? 1 : 0,
  };
}

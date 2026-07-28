import { configFromEnv } from "./config.mjs";
import { applyPostTool, applyPreTool } from "./detectors.mjs";
import { evaluatePrompt } from "./prompt-contract.mjs";
import { StateStore } from "./state-store.mjs";
import { detectPlatform, normalizeToolEvent } from "./tool-event.mjs";
import { hash } from "./utils.mjs";

function shortEvidence(incident) {
  return Object.entries(incident.evidence ?? {})
    .filter(([, value]) => ["boolean", "number", "string"].includes(typeof value))
    .slice(0, 3)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function incidentContext(incident) {
  return [
    `[AWF: ${incident.ruleId}]`,
    incident.message,
    `Evidence: ${shortEvidence(incident)}`,
    `Recommended next step: ${incident.recommendation}`,
    "Do not claim this was caused by the user's instruction unless category=user_instruction.",
  ].join("\n");
}

function warningOutput(eventName, incident) {
  return {
    systemMessage: `AWF: ${incident.message}`,
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: incidentContext(incident),
    },
  };
}

function denyPreTool(incident) {
  const escalation =
    incident.occurrences > 1
      ? " This denial has repeated. Do not retry it again; end the current task and report the blocker."
      : "";
  return {
    systemMessage: `AWF blocked a no-progress repeat: ${incident.message}`,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `${incident.message} ${incident.recommendation}${escalation}`,
    },
  };
}

function recordPromptIncident(state, evaluation, now) {
  if (!evaluation.shouldWarn) {
    return null;
  }
  const message = evaluation.issues.map((current) => current.message).join(" ");
  const recommendation = evaluation.issues
    .map((current) => current.recommendation)
    .join(" ");
  const dedupeKey = `incident_${hash(
    `prompt_contract:${evaluation.promptHash}:${state.progressVersion}`,
  ).slice(0, 32)}`;
  const existing = state.incidents.find((item) => item.dedupeKey === dedupeKey);
  if (existing) {
    existing.occurrences = (existing.occurrences ?? 1) + 1;
    existing.lastSeenAt = now;
    return {
      ...existing,
      message,
      recommendation,
      shouldNotify: false,
    };
  }
  const created = {
    id: evaluation.promptHash.slice(0, 16),
    dedupeKey,
    ruleId: "prompt_contract",
    category: "user_instruction",
    severity: evaluation.severity,
    confidence: "medium",
    at: now,
    lastSeenAt: now,
    occurrences: 1,
    evidence: {
      score: evaluation.score,
      issueIds: evaluation.issues.map((current) => current.id),
    },
    blockable: evaluation.severity === "high",
  };
  state.incidents.push(created);
  return {
    ...created,
    message,
    recommendation,
    shouldNotify: true,
  };
}

function promptOutput(evaluation, incident, config) {
  if (!incident || config.mode === "observe") {
    return {};
  }

  if (
    config.mode === "block" &&
    incident.blockable &&
    evaluation.score <= config.promptBlockScore
  ) {
    return {
      decision: "block",
      reason: [
        `AWF preflight score: ${evaluation.score}/100.`,
        incident.message,
        "",
        evaluation.suggestedPrompt,
      ].join("\n"),
    };
  }

  if (incident.shouldNotify === false) {
    return {};
  }

  return {
    systemMessage: `AWF preflight ${evaluation.score}/100: ${incident.message}`,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: [
        `[AWF preflight: ${evaluation.score}/100]`,
        incident.message,
        incident.recommendation,
        "Resolve facts from the repository first. Ask the user only about high-impact choices that cannot be discovered.",
      ].join("\n"),
    },
  };
}

export function handleHook(payload, options = {}) {
  if (!payload || typeof payload !== "object") {
    throw new TypeError("Hook payload must be a JSON object.");
  }

  const env = options.env ?? process.env;
  const config = options.config ?? configFromEnv(env);
  const store =
    options.store ??
    new StateStore({
      root: config.dataDir,
      clock: options.clock,
    });
  const eventName = String(payload.hook_event_name ?? "");
  const cwd = String(payload.cwd ?? process.cwd());
  const hashScope = String(payload.session_id ?? "unknown");

  return store.mutate(payload, config, (state, now) => {
    state.platform = detectPlatform(payload, env);

    if (eventName === "UserPromptSubmit") {
      const evaluation = evaluatePrompt(payload.prompt ?? "", {
        cwd,
        hashScope,
      });
      state.locale = evaluation.locale;
      state.prompt = {
        at: now,
        promptHash: evaluation.promptHash,
        score: evaluation.score,
        severity: evaluation.severity,
        issueIds: evaluation.issues.map((current) => current.id),
      };
      const detected = recordPromptIncident(state, evaluation, now);
      return {
        output: promptOutput(evaluation, detected, config),
        incident: detected,
        evaluation,
        observed: {
          progressVersion: state.progressVersion,
          madeProgress: false,
        },
      };
    }

    if (eventName === "PreToolUse") {
      const tool = normalizeToolEvent(payload, { platform: state.platform, env });
      const detected = applyPreTool(
        state,
        tool,
        config,
        now,
        cwd,
        hashScope,
      );
      const shouldBlock =
        config.mode === "block" && detected?.blockable === true;
      const shouldWarn =
        detected &&
        detected.shouldNotify !== false &&
        config.mode !== "observe";
      return {
        output: shouldBlock
          ? denyPreTool(detected)
          : shouldWarn
            ? warningOutput("PreToolUse", detected)
            : {},
        incident: detected,
        tool,
        observed: {
          progressVersion: state.toolEvents.at(-1)?.progressVersion ?? state.progressVersion,
          madeProgress: false,
        },
      };
    }

    if (eventName === "PostToolUse" || eventName === "PostToolUseFailure") {
      const tool = normalizeToolEvent(payload, { platform: state.platform, env });
      const detected = applyPostTool(
        state,
        tool,
        config,
        now,
        cwd,
        hashScope,
      );
      return {
        output:
          detected &&
          detected.shouldNotify !== false &&
          config.mode !== "observe"
            ? warningOutput(eventName, detected)
            : {},
        incident: detected,
        tool,
        observed: {
          progressVersion: state.toolEvents.at(-1)?.progressVersion ?? state.progressVersion,
          madeProgress: state.toolEvents.at(-1)?.madeProgress === true,
        },
      };
    }

    if (eventName === "Stop") {
      state.counters.stops += 1;
      state.lastStop = {
        at: now,
        stopHookActive: payload.stop_hook_active === true,
      };
      // The MVP never auto-continues a turn. This avoids creating a guard loop.
      return {
        output: {},
        incident: null,
        observed: {
          progressVersion: state.progressVersion,
          madeProgress: false,
        },
      };
    }

    return {
      output: {},
      incident: null,
      observed: {
        progressVersion: state.progressVersion,
        madeProgress: false,
      },
    };
  });
}

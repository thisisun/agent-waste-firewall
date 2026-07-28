import assert from "node:assert/strict";
import test from "node:test";

import { replaySemanticEvents } from "../src/semantic-replay.mjs";

function alias(domain, digit = "a") {
  return `${domain}_${digit.repeat(32)}`;
}

function incident(overrides = {}) {
  return {
    ruleId: "exact_tool_repeat",
    attribution: "agent",
    severity: "medium",
    confidence: "high",
    repeatCount: 3,
    blockable: false,
    notified: true,
    ...overrides,
  };
}

function common(kind, seq, decision, currentIncident) {
  const event = {
    v: 1,
    seq,
    elapsedMs: seq * 100,
    kind,
    platform: "codex",
    sessionAlias: alias("session"),
    decision,
  };
  if (currentIncident) {
    event.incident = currentIncident;
  }
  return event;
}

function promptEvent({
  seq,
  decision,
  score = 20,
  currentIncident,
}) {
  return {
    ...common("prompt", seq, decision, currentIncident),
    promptAlias: alias("prompt", "b"),
    locale: "ko",
    score,
    severity: currentIncident?.severity ?? "none",
    shouldWarn: Boolean(currentIncident),
    isAction: true,
    isFollowUp: false,
    issueIds: currentIncident ? ["broad"] : [],
    progressVersion: 0,
  };
}

function toolEvent({
  kind = "tool_pre",
  seq,
  decision,
  currentIncident,
  digit = "c",
}) {
  const event = {
    ...common(kind, seq, decision, currentIncident),
    callAlias: alias("call", digit),
    signatureAlias: alias("signature", digit),
    family: "shell",
    operation: "test",
    risk: "none",
    targets: [],
    progressVersion: 0,
  };
  if (kind === "tool_post") {
    event.resultAlias = alias("result", digit);
    event.outcome = "success";
    event.failureClass = null;
    event.madeProgress = false;
  }
  return event;
}

function stopEvent(seq) {
  return {
    ...common("stop", seq, "allow", null),
    progressVersion: 0,
  };
}

test("observe mode records incidents without warning or blocking", () => {
  const first = incident({ ruleId: "prompt_contract", attribution: "user_instruction" });
  const duplicate = incident({
    ruleId: "prompt_contract",
    attribution: "user_instruction",
    repeatCount: 4,
    notified: false,
  });
  const result = replaySemanticEvents(
    [
      promptEvent({ seq: 1, decision: "observe", currentIncident: first }),
      promptEvent({ seq: 2, decision: "observe", currentIncident: duplicate }),
      stopEvent(3),
    ],
    { mode: "observe" },
  );

  assert.equal(result.eventCount, 3);
  assert.equal(result.incidentCount, 2);
  assert.equal(result.notifiedIncidentCount, 1);
  assert.equal(result.decisionCount, 1);
  assert.deepEqual(result.actionCounts, {
    allow: 1,
    observe: 2,
    warn: 0,
    block: 0,
  });
  assert.equal(result.decisions[0].simulatedDecision, "observe");
  assert.equal(result.driftCount, 0);
});

test("warn mode warns only incidents marked as notified", () => {
  const detected = incident({ ruleId: "unchanged_reread" });
  const duplicate = incident({
    ruleId: "unchanged_reread",
    repeatCount: 4,
    notified: false,
  });
  const result = replaySemanticEvents(
    [
      toolEvent({
        seq: 1,
        decision: "warn",
        currentIncident: detected,
      }),
      toolEvent({
        seq: 2,
        decision: "allow",
        currentIncident: duplicate,
        digit: "d",
      }),
      toolEvent({ seq: 3, decision: "allow", digit: "e" }),
    ],
    { mode: "warn" },
  );

  assert.equal(result.decisionCount, 1);
  assert.deepEqual(result.actionCounts, {
    allow: 2,
    observe: 0,
    warn: 1,
    block: 0,
  });
  assert.equal(result.decisions[0].ruleId, "unchanged_reread");
  assert.equal(result.driftCount, 0);
});

test("block mode blocks only eligible prompt and pre-tool incidents", () => {
  const promptBlock = incident({
    ruleId: "prompt_contract",
    attribution: "user_instruction",
    severity: "high",
    blockable: true,
  });
  const toolBlock = incident({
    ruleId: "exact_tool_repeat",
    severity: "high",
    blockable: true,
  });
  const result = replaySemanticEvents(
    [
      promptEvent({
        seq: 1,
        decision: "block",
        score: 20,
        currentIncident: promptBlock,
      }),
      promptEvent({
        seq: 2,
        decision: "warn",
        score: 80,
        currentIncident: promptBlock,
      }),
      toolEvent({
        seq: 3,
        decision: "block",
        currentIncident: toolBlock,
      }),
      toolEvent({
        kind: "tool_post",
        seq: 4,
        decision: "warn",
        currentIncident: toolBlock,
        digit: "d",
      }),
      toolEvent({
        seq: 5,
        decision: "warn",
        currentIncident: incident(),
        digit: "e",
      }),
      toolEvent({
        seq: 6,
        decision: "block",
        currentIncident: incident({
          severity: "high",
          blockable: true,
          notified: false,
          repeatCount: 4,
        }),
        digit: "f",
      }),
    ],
    { mode: "block", promptBlockScore: 35 },
  );

  assert.equal(result.decisionCount, 5);
  assert.deepEqual(result.actionCounts, {
    allow: 0,
    observe: 0,
    warn: 3,
    block: 3,
  });
  assert.deepEqual(
    result.decisions.map((current) => current.simulatedDecision),
    ["block", "warn", "block", "warn", "warn"],
  );
  assert.equal(result.driftCount, 0);
});

test("reports captured-versus-simulated drift using safe summaries", () => {
  const currentIncident = incident({ ruleId: "status_polling_loop" });
  const result = replaySemanticEvents(
    [
      toolEvent({
        seq: 1,
        decision: "block",
        currentIncident,
      }),
      toolEvent({ seq: 2, decision: "observe", digit: "d" }),
    ],
    { mode: "warn" },
  );

  assert.equal(result.driftCount, 2);
  assert.deepEqual(result.drifts, [
    {
      seq: 1,
      kind: "tool_pre",
      capturedDecision: "block",
      simulatedDecision: "warn",
      ruleId: "status_polling_loop",
    },
    {
      seq: 2,
      kind: "tool_pre",
      capturedDecision: "observe",
      simulatedDecision: "allow",
      ruleId: null,
    },
  ]);
});

test("rejects source-bearing fields without echoing their contents", () => {
  const secretPath = "/Users/private/Documents/샘플프로젝트/secret.ts";
  const tainted = {
    ...promptEvent({
      seq: 1,
      decision: "warn",
      currentIncident: incident({
        ruleId: "prompt_contract",
        attribution: "user_instruction",
      }),
    }),
    cwd: secretPath,
  };

  assert.throws(
    () => replaySemanticEvents([tainted]),
    (error) => {
      assert.equal(error instanceof TypeError, true);
      assert.equal(error.message.includes(secretPath), false);
      assert.equal(error.message.includes("샘플프로젝트"), false);
      return true;
    },
  );
});

test("projects valid events to source-independent fields only", () => {
  const sourceAliases = {
    prompt: alias("prompt", "b"),
    session: alias("session"),
    call: alias("call", "c"),
    signature: alias("signature", "c"),
  };
  const result = replaySemanticEvents([
    promptEvent({
      seq: 1,
      decision: "warn",
      currentIncident: incident({
        ruleId: "prompt_contract",
        attribution: "user_instruction",
      }),
    }),
    toolEvent({
      seq: 2,
      decision: "warn",
      currentIncident: incident(),
    }),
  ]);
  const serialized = JSON.stringify(result);

  for (const value of Object.values(sourceAliases)) {
    assert.equal(serialized.includes(value), false);
  }
  assert.equal(serialized.includes("targets"), false);
  assert.equal(serialized.includes("promptAlias"), false);
  assert.equal(serialized.includes("sessionAlias"), false);
  assert.equal(serialized.includes("callAlias"), false);
  assert.equal(serialized.includes("signatureAlias"), false);
});

test("rejects invalid replay controls before simulation", () => {
  assert.throws(
    () => replaySemanticEvents([], { mode: "enforce" }),
    /mode must be observe, warn, or block/u,
  );
  assert.throws(
    () => replaySemanticEvents([], { promptBlockScore: 101 }),
    /integer from 0 to 100/u,
  );
  assert.throws(
    () => replaySemanticEvents(null),
    /events must be an array/u,
  );
});

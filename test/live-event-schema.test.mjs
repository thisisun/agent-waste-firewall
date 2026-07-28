import assert from "node:assert/strict";
import test from "node:test";

import {
  auditLiveEventText,
  serializeLiveEvent,
  validateLiveEvent,
} from "../src/live-event-schema.mjs";

function incident(overrides = {}) {
  return {
    v: 1,
    seq: 42,
    elapsedMs: 3120,
    kind: "incident",
    platform: "codex",
    sessionAlias: `session_${"a".repeat(32)}`,
    mode: "warn",
    family: "shell",
    operation: "test",
    outcome: "warned",
    ruleId: "exact_tool_repeat",
    severity: "medium",
    attribution: "agent",
    occurrences: 2,
    progressVersion: 3,
    issueIds: [],
    incidentCountDelta: 1,
    avoidableCallsDelta: 1,
    decisionLatencyMs: 11,
    ...overrides,
  };
}

test("serializes the closed LiveEventV1 incident shape", () => {
  const serialized = serializeLiveEvent(incident());
  const audit = auditLiveEventText(serialized, { allowEmpty: false });

  assert.deepEqual(audit, { ok: true, eventCount: 1, findings: [] });
  assert.deepEqual(validateLiveEvent(JSON.parse(serialized)), incident());
});

test("accepts a productive progress event without inventing an incident", () => {
  const event = incident({
    kind: "progress",
    family: "write",
    operation: "progress",
    outcome: "succeeded",
    ruleId: null,
    severity: "none",
    attribution: null,
    occurrences: 1,
    incidentCountDelta: 0,
    avoidableCallsDelta: 0,
  });

  assert.equal(validateLiveEvent(event), event);
});

test("rejects unknown prose before serialization without echoing it", () => {
  const rawCanary =
    "SECRET-LIVE-PROMPT /Users/private/customer command --danger";
  const unsafe = { ...incident(), message: rawCanary };

  assert.throws(
    () => serializeLiveEvent(unsafe),
    (error) => {
      assert.equal(error.message.includes(rawCanary), false);
      return /closed_shape_required/u.test(error.message);
    },
  );
  const audit = auditLiveEventText(`${JSON.stringify(unsafe)}\n`);
  assert.equal(audit.ok, false);
  assert.equal(JSON.stringify(audit).includes(rawCanary), false);
});

test("rejects inconsistent incident and prompt-coach fields", () => {
  assert.throws(
    () =>
      validateLiveEvent(
        incident({
          kind: "tool",
        }),
      ),
    /inconsistent_incident/u,
  );
  assert.throws(
    () =>
      validateLiveEvent(
        incident({
          issueIds: ["broad"],
        }),
      ),
    /unexpected_issue_ids/u,
  );
});

test("audits sequence and elapsed-time monotonicity", () => {
  const text = [
    serializeLiveEvent(incident({ seq: 5, elapsedMs: 20 })),
    serializeLiveEvent(incident({ seq: 4, elapsedMs: 10 })),
  ].join("");
  const audit = auditLiveEventText(text);

  assert.equal(audit.ok, false);
  assert.deepEqual(
    audit.findings.map((finding) => finding.code),
    ["sequence_not_increasing", "elapsed_time_decreased"],
  );
});

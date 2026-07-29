import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LiveEventStore } from "../src/live-event-store.mjs";
import {
  PROVIDER_DELIVERY_MAX_WAIT_MS,
  validateProviderDeliveryVerification,
  verifyProviderDelivery,
} from "../src/provider-delivery-verification.mjs";

const STREAM_A = `generation_${"a".repeat(32)}`;
const STREAM_B = `generation_${"b".repeat(32)}`;
const RAW_PROMPT = "SECRET-PROVIDER-DELIVERY-PROMPT";

function liveEvent(sequence, overrides = {}) {
  const kind = overrides.kind ?? "prompt";
  const incident = kind === "incident";
  return {
    v: 1,
    seq: sequence,
    elapsedMs: sequence * 10,
    kind,
    platform: overrides.platform ?? "codex",
    sessionAlias: `session_${"c".repeat(32)}`,
    mode: "warn",
    family: overrides.family ?? "prompt",
    operation: overrides.operation ?? "prompt",
    outcome: overrides.outcome ?? "allowed",
    ruleId: incident ? "prompt_contract" : null,
    severity: incident ? "medium" : "none",
    attribution: incident ? "user_instruction" : null,
    occurrences: 1,
    progressVersion: 0,
    issueIds: incident ? ["target"] : [],
    incidentCountDelta: incident ? 1 : 0,
    avoidableCallsDelta: 0,
    decisionLatencyMs: 1,
  };
}

function snapshot(
  events,
  {
    streamAlias = STREAM_A,
    health = "healthy",
    initialized = true,
  } = {},
) {
  return {
    events,
    generation: streamAlias === null ? 0 : 1,
    streamAlias,
    health,
    initialized,
    mode: "warn",
    status: null,
  };
}

function cursorFrom(snapshots) {
  let index = 0;
  return {
    readSnapshot() {
      const selected =
        snapshots[Math.min(index, snapshots.length - 1)];
      index += 1;
      return selected;
    },
  };
}

async function runVerification({
  provider = "codex",
  snapshots,
  timeoutMs = 20,
  pollIntervalMs = 10,
  signal,
  onSleep,
}) {
  let now = 1_000;
  return verifyProviderDelivery({
    provider,
    cursor: cursorFrom(snapshots),
    timeoutMs,
    pollIntervalMs,
    signal,
    clock: () => now,
    async sleep(durationMs) {
      now += durationMs;
      onSleep?.();
    },
  });
}

test("observes only a fresh audited prompt event for the selected provider", async () => {
  const event = liveEvent(1);
  const result = await runVerification({
    snapshots: [
      snapshot([], { streamAlias: null }),
      snapshot([event]),
    ],
  });

  assert.deepEqual(result, {
    v: 1,
    kind: "provider_delivery_verification",
    provider: "codex",
    result: "observed",
    reason: "fresh_prompt_event",
    waitedMs: 10,
    event: {
      kind: "prompt",
      family: "prompt",
      operation: "prompt",
      outcome: "allowed",
    },
  });
  assert.equal(JSON.stringify(result).includes(RAW_PROMPT), false);
  assert.equal(validateProviderDeliveryVerification(result), result);
});

test("observes a real post-baseline publication through the read-only store surface", async (context) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-delivery-verification-"),
  );
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-delivery-workspace-"),
  );
  fs.mkdirSync(path.join(workspace, ".git"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  context.after(() =>
    fs.rmSync(workspace, { recursive: true, force: true }),
  );

  const writableStore = new LiveEventStore({ root });
  let readCount = 0;
  const readOnlyStore = Object.freeze({
    readWindow(checkpoint) {
      readCount += 1;
      return writableStore.readWindow(checkpoint);
    },
  });
  let now = 5_000;
  const result = await verifyProviderDelivery({
    provider: "codex",
    store: readOnlyStore,
    timeoutMs: 20,
    pollIntervalMs: 10,
    clock: () => now,
    sleep: async (durationMs) => {
      now += durationMs;
    },
    onBaseline() {
      writableStore.publish(
        {
          hook_event_name: "UserPromptSubmit",
          session_id: "delivery-session",
          turn_id: "delivery-turn",
          cwd: workspace,
          prompt: RAW_PROMPT,
        },
        {
          output: {},
          incident: null,
          evaluation: { issues: [] },
          observed: {
            progressVersion: 0,
            madeProgress: false,
          },
        },
        { mode: "warn" },
      );
    },
  });

  assert.equal(result.result, "observed");
  assert.equal(result.provider, "codex");
  assert.ok(readCount >= 2);
  assert.equal(JSON.stringify(result).includes(RAW_PROMPT), false);
  assert.deepEqual(Object.keys(readOnlyStore), ["readWindow"]);
});

test("times out read-only without creating a missing live data root", async (context) => {
  const parent = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-delivery-read-only-"),
  );
  const dataRoot = path.join(parent, "must-stay-missing");
  context.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  let now = 8_000;
  const result = await verifyProviderDelivery({
    provider: "claude",
    store: new LiveEventStore({ root: dataRoot }),
    timeoutMs: 20,
    pollIntervalMs: 10,
    clock: () => now,
    async sleep(durationMs) {
      now += durationMs;
    },
  });

  assert.equal(result.result, "timed_out");
  assert.equal(result.reason, "deadline_elapsed");
  assert.equal(fs.existsSync(dataRoot), false);
});

test("does not mistake a retained pre-baseline prompt for fresh delivery", async () => {
  const retained = liveEvent(1);
  const result = await runVerification({
    snapshots: [
      snapshot([retained]),
      snapshot([retained]),
      snapshot([retained]),
    ],
  });

  assert.deepEqual(result, {
    v: 1,
    kind: "provider_delivery_verification",
    provider: "codex",
    result: "timed_out",
    reason: "deadline_elapsed",
    waitedMs: 20,
    event: null,
  });
});

test("does not accept a prompt first read after the deadline", async () => {
  let now = 1_000;
  const result = await verifyProviderDelivery({
    provider: "codex",
    cursor: cursorFrom([
      snapshot([], { streamAlias: null }),
      snapshot([liveEvent(1)]),
    ]),
    timeoutMs: 20,
    pollIntervalMs: 10,
    clock: () => now,
    async sleep() {
      now += 70;
    },
  });

  assert.deepEqual(result, {
    v: 1,
    kind: "provider_delivery_verification",
    provider: "codex",
    result: "timed_out",
    reason: "deadline_elapsed",
    waitedMs: 70,
    event: null,
  });
});

test("does not count a fresh prompt delivered by the other provider", async () => {
  const result = await runVerification({
    snapshots: [
      snapshot([], { streamAlias: null }),
      snapshot([liveEvent(1, { platform: "claude" })]),
      snapshot([liveEvent(1, { platform: "claude" })]),
    ],
  });

  assert.equal(result.result, "timed_out");
  assert.equal(result.reason, "deadline_elapsed");
  assert.equal(result.event, null);
});

test("does not count a same-provider tool event as prompt delivery", async () => {
  const toolEvent = liveEvent(1, {
    kind: "tool",
    family: "shell",
    operation: "inspect",
    outcome: "observed",
  });
  const result = await runVerification({
    snapshots: [
      snapshot([], { streamAlias: null }),
      snapshot([toolEvent]),
      snapshot([toolEvent]),
    ],
  });

  assert.equal(result.result, "timed_out");
  assert.equal(result.reason, "deadline_elapsed");
  assert.equal(result.event, null);
});

test("reports an audited stream reset instead of claiming hook delivery", async () => {
  const result = await runVerification({
    snapshots: [
      snapshot([]),
      snapshot([], { streamAlias: STREAM_B }),
    ],
  });

  assert.deepEqual(result, {
    v: 1,
    kind: "provider_delivery_verification",
    provider: "codex",
    result: "unavailable",
    reason: "stream_reset",
    waitedMs: 10,
    event: null,
  });
});

test("accepts a fresh prompt across a monotonic generation rotation", async () => {
  const baselineTool = liveEvent(1, {
    kind: "tool",
    family: "shell",
    operation: "inspect",
    outcome: "observed",
  });
  const freshPrompt = liveEvent(2);
  const result = await runVerification({
    snapshots: [
      snapshot([baselineTool]),
      snapshot([freshPrompt], { streamAlias: STREAM_B }),
    ],
  });

  assert.equal(result.result, "observed");
  assert.equal(result.reason, "fresh_prompt_event");
  assert.deepEqual(result.event, {
    kind: "prompt",
    family: "prompt",
    operation: "prompt",
    outcome: "allowed",
  });
});

test("reports sequence regression as a stream reset", async () => {
  const result = await runVerification({
    snapshots: [
      snapshot([liveEvent(2)]),
      snapshot([liveEvent(1)]),
    ],
  });

  assert.equal(result.result, "unavailable");
  assert.equal(result.reason, "stream_reset");
  assert.equal(result.event, null);
});

test("reports an unavailable live spool without waiting or exposing details", async () => {
  const result = await runVerification({
    provider: "claude",
    snapshots: [
      snapshot([], { health: "degraded", initialized: false }),
    ],
  });

  assert.deepEqual(result, {
    v: 1,
    kind: "provider_delivery_verification",
    provider: "claude",
    result: "unavailable",
    reason: "live_spool_unavailable",
    waitedMs: 0,
    event: null,
  });
});

test("returns bounded cancellation evidence when interrupted", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runVerification({
    snapshots: [snapshot([])],
    signal: controller.signal,
  });

  assert.deepEqual(result, {
    v: 1,
    kind: "provider_delivery_verification",
    provider: "codex",
    result: "cancelled",
    reason: "interrupted",
    waitedMs: 0,
    event: null,
  });
});

test("validator rejects unknown fields and inconsistent result evidence", () => {
  assert.equal(PROVIDER_DELIVERY_MAX_WAIT_MS, 300_000);
  const observed = {
    v: 1,
    kind: "provider_delivery_verification",
    provider: "codex",
    result: "observed",
    reason: "fresh_prompt_event",
    waitedMs: 1,
    event: {
      kind: "prompt",
      family: "prompt",
      operation: "prompt",
      outcome: "allowed",
    },
  };

  assert.throws(
    () =>
      validateProviderDeliveryVerification({
        ...observed,
        rawPrompt: RAW_PROMPT,
      }),
    /Invalid ProviderDeliveryVerificationV1/u,
  );
  assert.throws(
    () =>
      validateProviderDeliveryVerification({
        ...observed,
        event: null,
      }),
    /Invalid ProviderDeliveryVerificationV1/u,
  );
});

import { performance } from "node:perf_hooks";

import { DashboardLiveCursor } from "./dashboard-live-cursor.mjs";

const PROVIDERS = new Set(["codex", "claude"]);
const RESULTS = new Set([
  "observed",
  "timed_out",
  "cancelled",
  "unavailable",
]);
const REASONS = new Set([
  "fresh_prompt_event",
  "deadline_elapsed",
  "interrupted",
  "live_spool_unavailable",
  "stream_reset",
]);
const EVENT_KINDS = new Set(["prompt", "incident"]);
const EVENT_OUTCOMES = new Set([
  "allowed",
  "warned",
  "blocked",
  "observed",
]);
const ROOT_KEYS = [
  "v",
  "kind",
  "provider",
  "result",
  "reason",
  "waitedMs",
  "event",
];
const EVENT_KEYS = [
  "kind",
  "family",
  "operation",
  "outcome",
];
const RESULT_REASONS = Object.freeze({
  observed: "fresh_prompt_event",
  timed_out: "deadline_elapsed",
  cancelled: "interrupted",
});

export const PROVIDER_DELIVERY_MAX_WAIT_MS = 300_000;
export const PROVIDER_DELIVERY_DEFAULT_WAIT_MS = 60_000;
export const PROVIDER_DELIVERY_DEFAULT_POLL_MS = 100;

function fail(field) {
  throw new TypeError(
    `Invalid ProviderDeliveryVerificationV1 at ${field}.`,
  );
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

function validateEvent(value) {
  if (value === null) return;
  exactKeys(value, EVENT_KEYS, "verification.event");
  if (!EVENT_KINDS.has(value.kind)) fail("verification.event.kind");
  if (value.family !== "prompt") fail("verification.event.family");
  if (value.operation !== "prompt") {
    fail("verification.event.operation");
  }
  if (!EVENT_OUTCOMES.has(value.outcome)) {
    fail("verification.event.outcome");
  }
}

export function validateProviderDeliveryVerification(value) {
  exactKeys(value, ROOT_KEYS, "verification");
  if (value.v !== 1) fail("verification.v");
  if (value.kind !== "provider_delivery_verification") {
    fail("verification.kind");
  }
  if (!PROVIDERS.has(value.provider)) fail("verification.provider");
  if (!RESULTS.has(value.result)) fail("verification.result");
  if (!REASONS.has(value.reason)) fail("verification.reason");
  if (
    !Number.isSafeInteger(value.waitedMs) ||
    value.waitedMs < 0 ||
    value.waitedMs > PROVIDER_DELIVERY_MAX_WAIT_MS
  ) {
    fail("verification.waitedMs");
  }
  validateEvent(value.event);

  if (
    (value.result === "unavailable" &&
      !["live_spool_unavailable", "stream_reset"].includes(value.reason)) ||
    (value.result !== "unavailable" &&
      value.reason !== RESULT_REASONS[value.result]) ||
    (value.result === "observed" && value.event === null) ||
    (value.result !== "observed" && value.event !== null)
  ) {
    fail("verification");
  }
  return value;
}

function boundedInteger(value, minimum, maximum, label) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`Invalid ${label}.`);
  }
  return value;
}

function clockValue(clock) {
  const value = Number(clock());
  if (!Number.isFinite(value)) {
    throw new TypeError("Provider delivery verification clock is invalid.");
  }
  return value;
}

function waitedMilliseconds(startedAt, clock) {
  const elapsed = clockValue(clock) - startedAt;
  if (elapsed < 0) {
    throw new TypeError(
      "Provider delivery verification clock moved backwards.",
    );
  }
  return Math.min(
    PROVIDER_DELIVERY_MAX_WAIT_MS,
    Math.max(0, Math.round(elapsed)),
  );
}

function resultRecord({
  provider,
  result,
  reason,
  waitedMs,
  event = null,
}) {
  return validateProviderDeliveryVerification({
    v: 1,
    kind: "provider_delivery_verification",
    provider,
    result,
    reason,
    waitedMs,
    event,
  });
}

function unavailable(provider, reason, startedAt, clock) {
  return resultRecord({
    provider,
    result: "unavailable",
    reason,
    waitedMs: waitedMilliseconds(startedAt, clock),
  });
}

function snapshotSequence(snapshot) {
  const committed = snapshot?.status?.committedSeq;
  if (Number.isSafeInteger(committed) && committed >= 0) {
    return committed;
  }
  const lastSequence = snapshot?.events?.at(-1)?.seq;
  return Number.isSafeInteger(lastSequence) && lastSequence >= 0
    ? lastSequence
    : 0;
}

function snapshotAvailable(snapshot) {
  return (
    isRecord(snapshot) &&
    snapshot.initialized === true &&
    Array.isArray(snapshot.events) &&
    snapshot.health !== "degraded"
  );
}

function freshPromptEvent(events, provider, baselineSequence) {
  for (const event of events) {
    if (
      Number.isSafeInteger(event?.seq) &&
      event.seq > baselineSequence &&
      event.platform === provider &&
      EVENT_KINDS.has(event.kind) &&
      event.family === "prompt" &&
      event.operation === "prompt" &&
      EVENT_OUTCOMES.has(event.outcome)
    ) {
      return {
        kind: event.kind,
        family: "prompt",
        operation: "prompt",
        outcome: event.outcome,
      };
    }
  }
  return null;
}

function defaultSleep(milliseconds, signal) {
  return new Promise((resolve) => {
    let timer = null;
    const finish = () => {
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    timer = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", finish, { once: true });
    if (signal?.aborted) finish();
  });
}

export async function verifyProviderDelivery({
  provider,
  store = undefined,
  cursor = undefined,
  timeoutMs = PROVIDER_DELIVERY_DEFAULT_WAIT_MS,
  pollIntervalMs = PROVIDER_DELIVERY_DEFAULT_POLL_MS,
  clock = () => performance.now(),
  sleep = defaultSleep,
  signal = undefined,
  onBaseline = undefined,
} = {}) {
  if (!PROVIDERS.has(provider)) {
    throw new TypeError("Provider must be codex or claude.");
  }
  boundedInteger(
    timeoutMs,
    1,
    PROVIDER_DELIVERY_MAX_WAIT_MS,
    "provider delivery timeout",
  );
  boundedInteger(
    pollIntervalMs,
    1,
    1_000,
    "provider delivery poll interval",
  );
  if (typeof sleep !== "function") {
    throw new TypeError("Provider delivery sleep must be a function.");
  }
  if (onBaseline !== undefined && typeof onBaseline !== "function") {
    throw new TypeError(
      "Provider delivery baseline callback must be a function.",
    );
  }
  if (!cursor && !store) {
    throw new TypeError(
      "Provider delivery verification requires a live event store.",
    );
  }

  const startedAt = clockValue(clock);
  const liveCursor = cursor ?? new DashboardLiveCursor(store);
  let baseline;
  try {
    baseline = liveCursor.readSnapshot();
  } catch {
    return unavailable(
      provider,
      "live_spool_unavailable",
      startedAt,
      clock,
    );
  }
  if (!snapshotAvailable(baseline)) {
    return unavailable(
      provider,
      "live_spool_unavailable",
      startedAt,
      clock,
    );
  }

  const baselineSequence = snapshotSequence(baseline);
  const baselineStreamAlias = baseline.streamAlias ?? null;
  if (onBaseline) await onBaseline();

  while (true) {
    if (signal?.aborted) {
      return resultRecord({
        provider,
        result: "cancelled",
        reason: "interrupted",
        waitedMs: waitedMilliseconds(startedAt, clock),
      });
    }
    const elapsed = clockValue(clock) - startedAt;
    if (elapsed < 0) {
      throw new TypeError(
        "Provider delivery verification clock moved backwards.",
      );
    }
    if (elapsed >= timeoutMs) {
      return resultRecord({
        provider,
        result: "timed_out",
        reason: "deadline_elapsed",
        waitedMs: waitedMilliseconds(startedAt, clock),
      });
    }

    try {
      await sleep(
        Math.max(1, Math.min(pollIntervalMs, timeoutMs - elapsed)),
        signal,
      );
    } catch (error) {
      if (!signal?.aborted) throw error;
    }
    if (signal?.aborted) continue;
    const afterSleepElapsed = clockValue(clock) - startedAt;
    if (afterSleepElapsed < 0) {
      throw new TypeError(
        "Provider delivery verification clock moved backwards.",
      );
    }
    if (afterSleepElapsed >= timeoutMs) {
      return resultRecord({
        provider,
        result: "timed_out",
        reason: "deadline_elapsed",
        waitedMs: waitedMilliseconds(startedAt, clock),
      });
    }

    let snapshot;
    try {
      snapshot = liveCursor.readSnapshot();
    } catch {
      return unavailable(
        provider,
        "live_spool_unavailable",
        startedAt,
        clock,
      );
    }
    if (!snapshotAvailable(snapshot)) {
      return unavailable(
        provider,
        "live_spool_unavailable",
        startedAt,
        clock,
      );
    }
    if (snapshot.health !== "healthy") continue;

    const currentSequence = snapshotSequence(snapshot);
    const currentStreamAlias = snapshot.streamAlias ?? null;
    if (
      currentSequence < baselineSequence ||
      (baselineStreamAlias !== null && currentStreamAlias === null) ||
      (baselineStreamAlias !== null &&
        currentStreamAlias !== baselineStreamAlias &&
        currentSequence <= baselineSequence)
    ) {
      return unavailable(provider, "stream_reset", startedAt, clock);
    }
    const event = freshPromptEvent(
      snapshot.events,
      provider,
      baselineSequence,
    );
    if (event) {
      return resultRecord({
        provider,
        result: "observed",
        reason: "fresh_prompt_event",
        waitedMs: waitedMilliseconds(startedAt, clock),
        event,
      });
    }
  }
}

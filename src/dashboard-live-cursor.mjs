import {
  LIVE_EVENT_MAX_EVENTS,
  LIVE_SPOOL_MAX_BYTES,
  validateLiveEvent,
} from "./live-event-schema.mjs";

const MODES = new Set(["observe", "warn", "block"]);
const DEFAULT_FULL_AUDIT_INTERVAL_MS = 30_000;

function validNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function milliseconds(clock) {
  const value = clock();
  const numeric = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error("Dashboard live cursor clock is invalid.");
  }
  return Math.trunc(numeric);
}

function validateStatus(status, generation) {
  if (
    !status ||
    typeof status !== "object" ||
    Array.isArray(status) ||
    status.v !== 1 ||
    status.generation !== generation
  ) {
    throw new Error("Dashboard rejected an invalid live spool status.");
  }
  for (const key of [
    "nextSeq",
    "eventCount",
    "totalBytes",
    "oldestSeq",
    "committedSeq",
    "lastElapsedMs",
    "incidentCount",
    "avoidableCallCount",
    "generationFirstSeq",
    "gapCount",
    "publicationDropped",
    "maxEvents",
    "maxBytes",
    "maxAgeMs",
  ]) {
    if (!validNonNegativeInteger(status[key])) {
      throw new Error("Dashboard rejected an invalid live spool status.");
    }
  }
  if (
    status.generation < 0 ||
    status.nextSeq < 1 ||
    status.oldestSeq < 1 ||
    status.generationFirstSeq < 1 ||
    status.eventCount > status.maxEvents ||
    status.eventCount > LIVE_EVENT_MAX_EVENTS ||
    status.totalBytes > status.maxBytes ||
    status.totalBytes > LIVE_SPOOL_MAX_BYTES ||
    status.incidentCount > status.eventCount ||
    status.avoidableCallCount > status.incidentCount ||
    status.publicationDropped > 1 ||
    status.gapCount !==
      status.nextSeq - status.generationFirstSeq - status.eventCount
  ) {
    throw new Error("Dashboard rejected an inconsistent live spool status.");
  }
}

function validateWindow(window) {
  if (
    !window ||
    typeof window !== "object" ||
    Array.isArray(window) ||
    window.v !== 1 ||
    !Number.isSafeInteger(window.generation) ||
    window.generation < 0 ||
    (window.freshness !== "current" &&
      window.freshness !== "expired") ||
    typeof window.reset !== "boolean" ||
    !Array.isArray(window.events) ||
    window.events.length > LIVE_EVENT_MAX_EVENTS
  ) {
    throw new Error("Dashboard rejected an invalid live event window.");
  }
  const validStreamAlias =
    typeof window.streamAlias === "string" &&
    /^generation_[0-9a-f]{32}$/u.test(window.streamAlias);
  if (
    (window.generation === 0 && window.streamAlias !== null) ||
    (window.generation > 0 && !validStreamAlias)
  ) {
    throw new Error("Dashboard rejected an invalid live stream alias.");
  }
  validateStatus(window.status, window.generation);
  let previousSeq = 0;
  let previousElapsedMs = 0;
  for (const event of window.events) {
    validateLiveEvent(event);
    if (
      event.seq <= previousSeq ||
      event.elapsedMs < previousElapsedMs
    ) {
      throw new Error("Dashboard rejected an unordered live event window.");
    }
    previousSeq = event.seq;
    previousElapsedMs = event.elapsedMs;
  }
  return window;
}

export class DashboardLiveCursor {
  constructor(
    store,
    {
      mode = "warn",
      clock = () => Date.now(),
      fullAuditIntervalMs = DEFAULT_FULL_AUDIT_INTERVAL_MS,
    } = {},
  ) {
    this.store = store;
    this.fallbackMode = MODES.has(mode) ? mode : "warn";
    this.clock = clock;
    this.fullAuditIntervalMs =
      Number.isSafeInteger(fullAuditIntervalMs) &&
      fullAuditIntervalMs >= 0
        ? fullAuditIntervalMs
        : DEFAULT_FULL_AUDIT_INTERVAL_MS;
    this.lastFullAuditAt = 0;
    this.events = [];
    this.generation = 0;
    this.streamAlias = null;
    this.health = "healthy";
    this.status = null;
    this.initialized = false;
  }

  checkpoint() {
    const currentTime = milliseconds(this.clock);
    return {
      streamAlias: this.initialized ? this.streamAlias : null,
      forceFull:
        !this.initialized ||
        currentTime - this.lastFullAuditAt >= this.fullAuditIntervalMs,
      afterSeq: this.events.at(-1)?.seq ?? 0,
      lastElapsedMs:
        this.events.at(-1)?.elapsedMs ?? this.status?.lastElapsedMs ?? 0,
      eventCount: this.status?.eventCount ?? 0,
      totalBytes: this.status?.totalBytes ?? 0,
      incidentCount: this.status?.incidentCount ?? 0,
      avoidableCallCount: this.status?.avoidableCallCount ?? 0,
    };
  }

  refresh() {
    const checkpoint = this.checkpoint();
    const window = validateWindow(this.store.readWindow(checkpoint));
    const reset =
      window.reset ||
      !this.initialized ||
      window.streamAlias !== this.streamAlias;
    const previous = reset ? null : this.events.at(-1);
    const first = window.events[0];
    if (
      previous &&
      first &&
      (first.seq <= previous.seq ||
        first.elapsedMs < previous.elapsedMs)
    ) {
      throw new Error("Dashboard rejected an invalid live event boundary.");
    }
    const nextEvents = reset
      ? [...window.events]
      : [...this.events, ...window.events];
    if (
      reset &&
      this.initialized &&
      window.streamAlias === this.streamAlias
    ) {
      const sharedLength = Math.min(
        this.events.length,
        nextEvents.length,
      );
      for (let index = 0; index < sharedLength; index += 1) {
        if (
          JSON.stringify(this.events[index]) !==
          JSON.stringify(nextEvents[index])
        ) {
          throw new Error(
            "Dashboard rejected a mutated committed live event.",
          );
        }
      }
    }
    if (nextEvents.length !== window.status.eventCount) {
      throw new Error("Dashboard rejected an inconsistent live event count.");
    }
    this.events = nextEvents;
    this.generation = window.generation;
    this.streamAlias = window.streamAlias;
    this.status = { ...window.status };
    this.health =
      window.freshness === "expired" ? "stale" : "healthy";
    if (reset) this.lastFullAuditAt = milliseconds(this.clock);
    this.initialized = true;
  }

  readEvents() {
    try {
      this.refresh();
    } catch (error) {
      // Preserve the last fully audited semantic snapshot.
      this.health =
        error?.code === "LIVE_WINDOW_RACE" ? "stale" : "degraded";
    }
    return this.events;
  }

  readSnapshot() {
    this.readEvents();
    return this.currentSnapshot();
  }

  currentSnapshot() {
    return {
      events: this.events,
      generation: this.generation,
      streamAlias: this.streamAlias,
      health: this.health,
      initialized: this.initialized,
      mode: this.events.at(-1)?.mode ?? this.fallbackMode,
      status: this.status,
    };
  }

  readEventsAfter(sequence) {
    return this.readWindowAfter(sequence).events;
  }

  readWindowAfter(sequence) {
    const events = this.readEvents();
    return this.windowFromEvents(events, sequence);
  }

  readFrameAfter(sequence) {
    const events = this.readEvents();
    return {
      allEvents: events,
      snapshot: this.currentSnapshot(),
      window: this.windowFromEvents(events, sequence),
    };
  }

  windowFromEvents(events, sequence) {
    let low = 0;
    let high = events.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (events[middle].seq <= sequence) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return {
      events: events.slice(low),
      generation: this.generation,
      streamAlias: this.streamAlias,
      health: this.health,
      lastSequence: events.at(-1)?.seq ?? 0,
    };
  }
}

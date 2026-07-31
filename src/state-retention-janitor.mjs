import fs from "node:fs";
import { performance } from "node:perf_hooks";

import { StateStore, UnsafeStateStorageError } from "./state-store.mjs";

const DEFAULT_MAX_ENTRIES_PER_TICK = 64;
const DEFAULT_MAX_TICK_MS = 8;
const DEFAULT_RETRY_INTERVAL_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function safeInteger(value, fallback, minimum, maximum, label) {
  const numeric = value === undefined ? fallback : Number(value);
  if (
    !Number.isSafeInteger(numeric) ||
    numeric < minimum ||
    numeric > maximum
  ) {
    throw new TypeError(`Invalid ${label}.`);
  }
  return numeric;
}

function emptyTick(status = "idle") {
  return {
    status,
    entriesVisited: 0,
    stateFilesRemoved: 0,
    temporaryFilesRemoved: 0,
    staleLocksRemoved: 0,
    activeFilesSkipped: 0,
    unsafeFilesSkipped: 0,
  };
}

function addResult(target, current) {
  for (const key of [
    "stateFilesRemoved",
    "temporaryFilesRemoved",
    "staleLocksRemoved",
    "activeFilesSkipped",
    "unsafeFilesSkipped",
  ]) {
    target[key] += current[key] ?? 0;
  }
}

function validNow(clock) {
  const value = clock();
  const numeric = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isSafeInteger(Math.trunc(numeric)) || numeric < 0) {
    throw new TypeError("Invalid state retention clock.");
  }
  return Math.trunc(numeric);
}

export class StateRetentionJanitor {
  constructor({
    store,
    root,
    retentionDays = 30,
    clock = () => Date.now(),
    monotonicClock = () => performance.now(),
    maxEntriesPerTick,
    maxTickMs,
    retryIntervalMs,
  } = {}) {
    if (store !== undefined && !(store instanceof StateStore)) {
      throw new TypeError("State retention requires a StateStore.");
    }
    if (!store && !root) {
      throw new TypeError("State retention requires a data root.");
    }
    if (typeof clock !== "function" || typeof monotonicClock !== "function") {
      throw new TypeError("State retention clocks must be functions.");
    }
    this.store = store ?? new StateStore({ root });
    this.retentionDays = safeInteger(
      retentionDays,
      30,
      1,
      3650,
      "retention days",
    );
    this.maxEntriesPerTick = safeInteger(
      maxEntriesPerTick,
      DEFAULT_MAX_ENTRIES_PER_TICK,
      1,
      DEFAULT_MAX_ENTRIES_PER_TICK,
      "state retention batch size",
    );
    this.maxTickMs = safeInteger(
      maxTickMs,
      DEFAULT_MAX_TICK_MS,
      1,
      DEFAULT_MAX_TICK_MS,
      "state retention tick budget",
    );
    this.retryIntervalMs = safeInteger(
      retryIntervalMs,
      DEFAULT_RETRY_INTERVAL_MS,
      25,
      60 * 60 * 1000,
      "state retention retry interval",
    );
    this.clock = clock;
    this.monotonicClock = monotonicClock;
    this.closed = false;
    this.running = false;
    this.retryAt = 0;
    this.sweep = null;
  }

  beginSweep(now) {
    if (!this.store.retentionMaintenanceDue(now)) return "idle";
    const maintenanceLock = this.store.acquireMaintenanceLock(now);
    if (!maintenanceLock) return "idle";
    try {
      this.store.assertMaintenanceControlSafe(maintenanceLock.storage);
      if (!this.store.retentionMaintenanceDue(now)) {
        this.store.releaseMaintenanceLock(maintenanceLock);
        return "idle";
      }
      const storage = this.store.retentionStorageIdentity();
      if (!this.store.sameOwnedMaintenanceLock(maintenanceLock)) {
        throw new UnsafeStateStorageError();
      }
      if (!storage.sessions) {
        this.store.writeMaintenanceMarker(
          this.store.nextMaintenanceAt(now),
          maintenanceLock.storage,
        );
        this.store.releaseMaintenanceLock(maintenanceLock);
        return "complete";
      }
      const directory = fs.opendirSync(this.store.sessionsDir);
      try {
        this.store.assertRetentionStorageIdentity(storage);
      } catch (error) {
        directory.closeSync();
        throw error;
      }
      this.sweep = {
        directory,
        maintenanceLock,
        storage,
        cutoff: now - this.retentionDays * DAY_MS,
        unsafeEntrySeen: false,
      };
      return "progress";
    } catch (error) {
      this.store.releaseMaintenanceLock(maintenanceLock);
      throw error;
    }
  }

  finishSweep(now) {
    const sweep = this.sweep;
    if (!sweep) return;
    sweep.directory.closeSync();
    this.store.assertRetentionStorageIdentity(sweep.storage);
    this.store.refreshMaintenanceLock(sweep.maintenanceLock, now);
    this.store.writeMaintenanceMarker(
      this.store.nextMaintenanceAt(now),
      sweep.maintenanceLock.storage,
    );
    this.store.releaseMaintenanceLock(sweep.maintenanceLock);
    this.sweep = null;
  }

  abandonSweep() {
    const sweep = this.sweep;
    this.sweep = null;
    if (!sweep) return;
    try {
      sweep.directory.closeSync();
    } catch {
      // A completed or failed directory cursor is already closed.
    }
    this.store.releaseMaintenanceLock(sweep.maintenanceLock);
  }

  tick() {
    if (this.closed) return emptyTick("closed");
    if (this.running) return emptyTick("idle");
    this.running = true;
    let now = 0;
    try {
      now = validNow(this.clock);
      if (now < this.retryAt) return emptyTick("idle");

      if (!this.sweep) {
        const started = this.beginSweep(now);
        if (started === "idle") return emptyTick("idle");
        if (started === "complete") return emptyTick("complete");
      }

      const result = emptyTick("progress");
      const startedAt = Number(this.monotonicClock());
      if (!Number.isFinite(startedAt)) {
        throw new TypeError("Invalid state retention monotonic clock.");
      }
      this.store.refreshMaintenanceLock(this.sweep.maintenanceLock, now);
      this.store.assertRetentionStorageIdentity(this.sweep.storage);

      while (result.entriesVisited < this.maxEntriesPerTick) {
        const entry = this.sweep.directory.readSync();
        if (!entry) {
          const unsafeEntrySeen = this.sweep.unsafeEntrySeen;
          this.finishSweep(now);
          result.status = unsafeEntrySeen ? "degraded" : "complete";
          return result;
        }
        result.entriesVisited += 1;
        try {
          addResult(
            result,
            this.store.purgeRetentionEntry(entry.name, {
              cutoff: this.sweep.cutoff,
              now,
              storage: this.sweep.storage,
            }),
          );
        } catch (error) {
          if (error.code !== "UNSAFE_STATE_ENTRY") throw error;
          result.unsafeFilesSkipped += 1;
          this.sweep.unsafeEntrySeen = true;
        }
        const elapsed = Number(this.monotonicClock()) - startedAt;
        if (!Number.isFinite(elapsed) || elapsed >= this.maxTickMs) break;
      }
      return result;
    } catch {
      this.abandonSweep();
      if (Number.isSafeInteger(now) && now >= 0) {
        this.retryAt = now + this.retryIntervalMs;
      }
      return emptyTick("degraded");
    } finally {
      this.running = false;
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.abandonSweep();
  }
}

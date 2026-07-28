import fs from "node:fs";

import { auditTraceText } from "./trace-schema.mjs";

const MAX_TRACE_BYTES = 64 * 1024 * 1024;
const MAX_TRACE_EVENTS = 1_000_000;
const STABLE_READ_ATTEMPTS = 3;

function snapshotFromStat(stat) {
  if (stat.size > BigInt(MAX_TRACE_BYTES)) {
    throw new Error("Dashboard trace exceeds the audited size limit.");
  }
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: Number(stat.size),
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  };
}

function fileSnapshot(filename) {
  return snapshotFromStat(fs.statSync(filename, { bigint: true }));
}

function sameIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function sameSnapshot(left, right) {
  return (
    sameIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function completeJsonlLength(buffer) {
  return buffer.lastIndexOf(0x0a) + 1;
}

function parseAuditedChunk(buffer) {
  const text = buffer.toString("utf8");
  const audit = auditTraceText(text);
  if (!audit.ok) {
    throw new Error("Dashboard rejected an unaudited trace append.");
  }
  const events = text
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  if (events.length !== audit.eventCount) {
    throw new Error("Dashboard rejected an inconsistent trace append.");
  }
  return events;
}

function readRange(filename, expectedIdentity, offset) {
  const descriptor = fs.openSync(filename, "r");
  try {
    const before = snapshotFromStat(fs.fstatSync(descriptor, { bigint: true }));
    if (!sameIdentity(before, expectedIdentity) || before.size < offset) {
      return null;
    }
    const length = before.size - offset;
    const buffer = Buffer.allocUnsafe(length);
    let bytesRead = 0;
    while (bytesRead < length) {
      const count = fs.readSync(
        descriptor,
        buffer,
        bytesRead,
        length - bytesRead,
        offset + bytesRead,
      );
      if (count === 0) {
        return null;
      }
      bytesRead += count;
    }
    const after = snapshotFromStat(fs.fstatSync(descriptor, { bigint: true }));
    if (!sameIdentity(before, after) || after.size < before.size) {
      return null;
    }
    return { buffer, snapshot: before };
  } finally {
    fs.closeSync(descriptor);
  }
}

export class DashboardTraceCursor {
  constructor(store, traceId) {
    this.store = store;
    this.traceId = traceId;
    this.filename = store.eventsPath(traceId);
    this.events = [];
    this.generation = 0;
    this.health = "healthy";
    this.identity = null;
    this.offset = 0;
    this.observedSnapshot = null;
    this.initialized = false;
  }

  readEvents() {
    try {
      this.refresh();
    } catch {
      // Keep the last audited semantic snapshot until the file changes.
      this.health = "degraded";
    }
    return this.events;
  }

  readEventsAfter(sequence) {
    return this.readWindowAfter(sequence).events;
  }

  readWindowAfter(sequence) {
    const events = this.readEvents();
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
      health: this.health,
      lastSequence: events.at(-1)?.seq ?? 0,
    };
  }

  refresh() {
    if (!this.initialized) {
      this.bootstrap();
      return;
    }

    const current = fileSnapshot(this.filename);
    if (sameSnapshot(current, this.observedSnapshot)) {
      if (current.size === this.offset) {
        this.health = "healthy";
      }
      return;
    }
    if (!sameIdentity(current, this.identity) || current.size < this.offset) {
      this.bootstrap();
      return;
    }
    if (current.size === this.offset) {
      // A same-length mutation is not an append, so it requires a fresh strict audit.
      this.bootstrap();
      return;
    }

    this.appendCompleteEvents(current);
  }

  bootstrap() {
    for (let attempt = 0; attempt < STABLE_READ_ATTEMPTS; attempt += 1) {
      const before = fileSnapshot(this.filename);
      let events;
      let readError = null;
      try {
        events = this.store.readEvents(this.traceId);
      } catch (error) {
        readError = error;
      }
      const after = fileSnapshot(this.filename);
      if (!sameSnapshot(before, after)) {
        continue;
      }
      if (readError) {
        if (after.size === 0) {
          this.commitSnapshot([], after);
          return;
        }
        this.commitRejectedSnapshot(after);
        return;
      }
      if (!Array.isArray(events) || events.length > MAX_TRACE_EVENTS) {
        this.commitRejectedSnapshot(after);
        return;
      }
      this.commitSnapshot(events, after);
      return;
    }

    // Continuous appends are retried by a later request without exposing a
    // snapshot whose byte boundary is unknown.
    throw new Error("Dashboard could not obtain a stable audited trace snapshot.");
  }

  appendCompleteEvents(current) {
    const read = readRange(this.filename, this.identity, this.offset);
    if (!read) {
      this.bootstrap();
      return;
    }
    const completeLength = completeJsonlLength(read.buffer);
    if (completeLength === 0) {
      this.observedSnapshot = read.snapshot;
      return;
    }

    let appended;
    try {
      appended = parseAuditedChunk(read.buffer.subarray(0, completeLength));
      this.validateBoundary(appended);
    } catch {
      this.health = "degraded";
      this.observedSnapshot = read.snapshot;
      return;
    }
    if (this.events.length + appended.length > MAX_TRACE_EVENTS) {
      this.health = "degraded";
      this.observedSnapshot = read.snapshot;
      return;
    }

    this.events = [...this.events, ...appended];
    this.offset += completeLength;
    this.identity = read.snapshot;
    this.observedSnapshot = read.snapshot;
    this.health = "healthy";
  }

  validateBoundary(appended) {
    const previous = this.events.at(-1);
    const first = appended[0];
    if (!previous || !first) {
      return;
    }
    if (first.seq <= previous.seq) {
      throw new Error("Dashboard rejected a non-increasing trace sequence.");
    }
    if (first.elapsedMs < previous.elapsedMs) {
      throw new Error("Dashboard rejected decreasing trace elapsed time.");
    }
  }

  commitSnapshot(events, snapshot) {
    this.generation += 1;
    this.events = [...events];
    this.health = "healthy";
    this.identity = snapshot;
    this.offset = snapshot.size;
    this.observedSnapshot = snapshot;
    this.initialized = true;
  }

  commitRejectedSnapshot(snapshot) {
    this.generation += 1;
    this.events = [];
    this.health = "degraded";
    this.identity = snapshot;
    this.offset = 0;
    this.observedSnapshot = snapshot;
    this.initialized = true;
  }
}

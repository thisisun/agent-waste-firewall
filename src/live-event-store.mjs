import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

import { projectLiveEvent } from "./live-event-projection.mjs";
import {
  auditLiveEventText,
  LIVE_EVENT_MAX_BYTES,
  LIVE_EVENT_MAX_EVENTS,
  LIVE_SPOOL_MAX_BYTES,
  serializeLiveEvent,
} from "./live-event-schema.mjs";

const CONTROL_KEYS = [
  "v",
  "generation",
  "nextSeq",
  "pendingSeq",
  "committedSeq",
  "eventCount",
  "totalBytes",
  "oldestSeq",
  "lastElapsedMs",
  "incidentCount",
  "avoidableCallCount",
];
const GENERATION_KEYS = [
  "v",
  "generation",
  "firstSeq",
  "lastElapsedMs",
];
const GENERATION_DIRECTORY = /^\d{8}$/u;
const RETIRED_GENERATION_DIRECTORY =
  /^\.retired-\d{8}-[0-9a-f]{8}$/u;
const EVENT_FILE = /^(\d{16})\.json$/u;
const LOCK_RETRY_MS = 2;
const LOCK_STALE_MS = 30_000;
const DEFAULT_LOCK_TIMEOUT_MS = 50;
const DEFAULT_MAX_EVENTS = 4096;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CONTROL_BYTES = 16 * 1024;
const STABLE_READ_ATTEMPTS = 3;
const RETIRED_CLEANUP_BATCH = 64;
const MAINTENANCE_CLEANUP_BATCH = 256;
const COVERAGE_MARKER_TEXT =
  '{"coverage":"incomplete","v":1}\n';

const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

class LiveWindowRaceError extends Error {
  constructor() {
    super("Live spool changed during an audited read.");
    this.code = "LIVE_WINDOW_RACE";
  }
}

function sleepSync(milliseconds) {
  Atomics.wait(sleepBuffer, 0, 0, milliseconds);
}

function nowMs(clock) {
  const value = clock();
  const milliseconds = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError("Live event clock must return a valid time.");
  }
  return Math.trunc(milliseconds);
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (uid !== null && stat.uid !== uid)
  ) {
    throw new Error("Unsafe live spool directory.");
  }
  if ((stat.mode & 0o077) !== 0) fs.chmodSync(directory, 0o700);
}

function assertPrivateDirectory(directory) {
  const stat = fs.lstatSync(directory);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (uid !== null && stat.uid !== uid) ||
    (stat.mode & 0o077) !== 0
  ) {
    throw new Error("Unsafe live spool directory.");
  }
  return stat;
}

function snapshotFromPrivateStat(stat, maximumBytes) {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > BigInt(maximumBytes) ||
    (uid !== null && stat.uid !== BigInt(uid)) ||
    (stat.mode & 0o077n) !== 0n
  ) {
    throw new Error("Unsafe live spool file.");
  }
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: Number(stat.size),
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  };
}

function privateFileSnapshot(filename, maximumBytes) {
  return snapshotFromPrivateStat(
    fs.lstatSync(filename, { bigint: true }),
    maximumBytes,
  );
}

function sameFileSnapshot(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function sameOptionalFile(left, right) {
  if (left.present !== right.present) return false;
  if (!left.present) return true;
  return (
    left.text === right.text &&
    sameFileSnapshot(left.snapshot, right.snapshot)
  );
}

function readPrivateText(filename, maximumBytes) {
  const current = readPrivateBuffer(filename, maximumBytes);
  let text;
  try {
    text = utf8Decoder.decode(current.buffer);
  } catch {
    throw new Error("Live spool file failed its UTF-8 audit.");
  }
  return { text, snapshot: current.snapshot };
}

function readPrivateBuffer(filename, maximumBytes) {
  const descriptor = fs.openSync(
    filename,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = snapshotFromPrivateStat(
      fs.fstatSync(descriptor, { bigint: true }),
      maximumBytes,
    );
    const buffer = fs.readFileSync(descriptor);
    const after = snapshotFromPrivateStat(
      fs.fstatSync(descriptor, { bigint: true }),
      maximumBytes,
    );
    if (
      !sameFileSnapshot(before, after) ||
      buffer.length !== after.size
    ) {
      throw new LiveWindowRaceError();
    }
    return { buffer, snapshot: after };
  } finally {
    fs.closeSync(descriptor);
  }
}

function writePrivateAtomic(filename, value) {
  ensurePrivateDirectory(path.dirname(filename));
  const temporary = `${filename}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, value, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(temporary, filename);
    fs.chmodSync(filename, 0o600);
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // The failed write may not have created a temporary file.
    }
    throw error;
  }
}

function privateKey(filename) {
  const current = readPrivateBuffer(filename, 32);
  if (current.buffer.length !== 32) {
    throw new Error("Unsafe live alias key.");
  }
  return current.buffer;
}

function generationAlias(key) {
  return `generation_${crypto
    .createHmac("sha256", key)
    .update("awf-live-v1\0generation\0")
    .digest("hex")
    .slice(0, 32)}`;
}

function safeBound(value, fallback, minimum, maximum, label) {
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

function generationName(generation) {
  return String(generation).padStart(8, "0");
}

function eventName(sequence) {
  return `${String(sequence).padStart(16, "0")}.json`;
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validControl(value) {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== CONTROL_KEYS.length ||
    Object.keys(value).some((key) => !CONTROL_KEYS.includes(key))
  ) {
    return false;
  }
  if (
    value.v !== 1 ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    !Number.isSafeInteger(value.nextSeq) ||
    value.nextSeq < 1 ||
    !(
      value.pendingSeq === null ||
      (Number.isSafeInteger(value.pendingSeq) && value.pendingSeq >= 1)
    )
  ) {
    return false;
  }
  for (const key of [
    "committedSeq",
    "eventCount",
    "totalBytes",
    "oldestSeq",
    "lastElapsedMs",
    "incidentCount",
    "avoidableCallCount",
  ]) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) return false;
  }
  return (
    value.nextSeq > value.committedSeq &&
    value.incidentCount <= value.eventCount &&
    value.avoidableCallCount <= value.incidentCount
  );
}

function validGenerationMetadata(value, generation) {
  return (
    isRecord(value) &&
    Object.keys(value).length === GENERATION_KEYS.length &&
    Object.keys(value).every((key) => GENERATION_KEYS.includes(key)) &&
    value.v === 1 &&
    value.generation === generation &&
    Number.isSafeInteger(value.firstSeq) &&
    value.firstSeq >= 1 &&
    Number.isSafeInteger(value.lastElapsedMs) &&
    value.lastElapsedMs >= 0
  );
}

function parseEventText(text) {
  const audit = auditLiveEventText(text, {
    maxBytes: LIVE_EVENT_MAX_BYTES,
    maxEvents: 1,
    allowEmpty: false,
  });
  if (!audit.ok || audit.eventCount !== 1) {
    throw new Error("Live event failed its closed-schema audit.");
  }
  const event = JSON.parse(text.trim());
  return { event, bytes: Buffer.byteLength(text, "utf8") };
}

function emptyControl(generation, nextSeq = 1, lastElapsedMs = 0) {
  return {
    v: 1,
    generation,
    nextSeq,
    pendingSeq: null,
    committedSeq: nextSeq - 1,
    eventCount: 0,
    totalBytes: 0,
    oldestSeq: nextSeq,
    lastElapsedMs,
    incidentCount: 0,
    avoidableCallCount: 0,
  };
}

function statusFromControl(control, store) {
  return {
    v: 1,
    generation: control.generation,
    nextSeq: control.nextSeq,
    eventCount: control.eventCount,
    totalBytes: control.totalBytes,
    oldestSeq: control.oldestSeq,
    committedSeq: control.committedSeq,
    lastElapsedMs: control.lastElapsedMs,
    incidentCount: control.incidentCount,
    avoidableCallCount: control.avoidableCallCount,
    maxEvents: store.maxEvents,
    maxBytes: store.maxBytes,
    maxAgeMs: store.maxAgeMs,
  };
}

export class LiveEventStore {
  constructor({
    root,
    clock = () => new Date(),
    env = process.env,
    maxEvents,
    maxBytes,
    maxAgeMs,
    lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  }) {
    this.root = path.resolve(root);
    this.clock = clock;
    this.env = env;
    this.maxEvents = safeBound(
      maxEvents,
      DEFAULT_MAX_EVENTS,
      2,
      LIVE_EVENT_MAX_EVENTS,
      "live event limit",
    );
    this.maxBytes = safeBound(
      maxBytes,
      DEFAULT_MAX_BYTES,
      4 * 1024,
      LIVE_SPOOL_MAX_BYTES,
      "live byte limit",
    );
    this.maxAgeMs = safeBound(
      maxAgeMs,
      DEFAULT_MAX_AGE_MS,
      1000,
      DEFAULT_MAX_AGE_MS,
      "live age limit",
    );
    this.lockTimeoutMs = safeBound(
      lockTimeoutMs,
      DEFAULT_LOCK_TIMEOUT_MS,
      0,
      1000,
      "live lock timeout",
    );
    this.liveDir = path.join(this.root, "live-v1");
    this.generationsDir = path.join(this.liveDir, "generations");
    this.controlPath = path.join(this.liveDir, "control.json");
    this.lockPath = path.join(this.liveDir, "publish.lock");
  }

  generationDir(generation) {
    return path.join(this.generationsDir, generationName(generation));
  }

  eventsDir(generation) {
    return path.join(this.generationDir(generation), "events");
  }

  keyPath(generation) {
    return path.join(this.generationDir(generation), "alias.key");
  }

  generationMetadataPath(generation) {
    return path.join(this.generationDir(generation), "generation.json");
  }

  coverageMarkerPath(generation) {
    return path.join(this.generationDir(generation), "coverage.json");
  }

  eventPath(generation, sequence) {
    return path.join(this.eventsDir(generation), eventName(sequence));
  }

  acquireLock() {
    ensurePrivateDirectory(this.liveDir);
    const startedAt = Date.now();
    do {
      try {
        fs.mkdirSync(this.lockPath, { mode: 0o700 });
        return true;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        try {
          if (Date.now() - fs.statSync(this.lockPath).mtimeMs > LOCK_STALE_MS) {
            fs.rmdirSync(this.lockPath);
            continue;
          }
        } catch {
          // A racing publisher may have released the lock.
        }
      }
      if (Date.now() - startedAt >= this.lockTimeoutMs) return false;
      sleepSync(LOCK_RETRY_MS);
    } while (true);
  }

  releaseLock() {
    try {
      fs.rmdirSync(this.lockPath);
    } catch {
      // A failed optional publication must never affect the hook decision.
    }
  }

  withLock(action) {
    if (!this.acquireLock()) return { locked: false, value: null };
    try {
      return { locked: true, value: action() };
    } finally {
      this.releaseLock();
    }
  }

  initializeGeneration(generation, firstSeq = 1, lastElapsedMs = 0) {
    ensurePrivateDirectory(this.root);
    ensurePrivateDirectory(this.liveDir);
    ensurePrivateDirectory(this.generationsDir);
    const directory = this.generationDir(generation);
    ensurePrivateDirectory(directory);
    ensurePrivateDirectory(this.eventsDir(generation));
    fs.writeFileSync(this.keyPath(generation), crypto.randomBytes(32), {
      mode: 0o600,
      flag: "wx",
    });
    writePrivateAtomic(
      this.generationMetadataPath(generation),
      `${JSON.stringify(
        {
          v: 1,
          generation,
          firstSeq,
          lastElapsedMs,
        },
        null,
        2,
      )}\n`,
    );
    return directory;
  }

  generationMetadata(generation) {
    const metadata = JSON.parse(
      fs.readFileSync(this.generationMetadataPath(generation), "utf8"),
    );
    if (!validGenerationMetadata(metadata, generation)) {
      throw new Error("Invalid live generation metadata.");
    }
    return metadata;
  }

  cleanTemporaryFiles(generation) {
    const directories = [
      this.liveDir,
      this.generationDir(generation),
      this.eventsDir(generation),
    ];
    for (const directory of directories) {
      if (!fs.existsSync(directory)) continue;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".tmp")) {
          fs.unlinkSync(path.join(directory, entry.name));
        }
      }
    }
  }

  eventFiles(generation) {
    const directory = this.eventsDir(generation);
    if (!fs.existsSync(directory)) return [];
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) => {
        const match = entry.isFile() ? EVENT_FILE.exec(entry.name) : null;
        if (!match) return [];
        const sequence = Number.parseInt(match[1], 10);
        return Number.isSafeInteger(sequence)
          ? [{ sequence, filename: path.join(directory, entry.name) }]
          : [];
      })
      .sort((left, right) => left.sequence - right.sequence);
  }

  stableEventFiles(generation) {
    const directory = this.eventsDir(generation);
    assertPrivateDirectory(directory);
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile() && /^\..+\.tmp$/u.test(entry.name)) continue;
      const match = entry.isFile() ? EVENT_FILE.exec(entry.name) : null;
      if (!match) {
        throw new Error("Live spool contained an unaudited event entry.");
      }
      const sequence = Number.parseInt(match[1], 10);
      if (!Number.isSafeInteger(sequence)) {
        throw new Error("Live spool contained an invalid event sequence.");
      }
      const filename = path.join(directory, entry.name);
      privateFileSnapshot(filename, LIVE_EVENT_MAX_BYTES);
      files.push({ sequence, filename });
    }
    return files.sort((left, right) => left.sequence - right.sequence);
  }

  readControlSnapshot() {
    const current = readPrivateText(this.controlPath, MAX_CONTROL_BYTES);
    let control;
    try {
      control = JSON.parse(current.text);
    } catch {
      throw new Error("Live spool control failed its closed-schema audit.");
    }
    if (!validControl(control)) {
      throw new Error("Live spool control failed its closed-schema audit.");
    }
    return { ...current, control };
  }

  readGenerationMetadata(generation) {
    const current = readPrivateText(
      this.generationMetadataPath(generation),
      MAX_CONTROL_BYTES,
    );
    let metadata;
    try {
      metadata = JSON.parse(current.text);
    } catch {
      throw new Error("Live generation failed its closed-schema audit.");
    }
    if (!validGenerationMetadata(metadata, generation)) {
      throw new Error("Live generation failed its closed-schema audit.");
    }
    return metadata;
  }

  readCoverageMarker(generation) {
    const filename = this.coverageMarkerPath(generation);
    if (!fs.existsSync(filename)) {
      return { present: false, text: null, snapshot: null };
    }
    try {
      const current = readPrivateText(filename, 1024);
      const value = JSON.parse(current.text);
      if (
        current.text !== COVERAGE_MARKER_TEXT ||
        !isRecord(value) ||
        Object.keys(value).length !== 2 ||
        value.v !== 1 ||
        value.coverage !== "incomplete"
      ) {
        throw new Error("Live coverage marker failed its audit.");
      }
      return { present: true, ...current };
    } catch (error) {
      if (error.code === "ENOENT") throw new LiveWindowRaceError();
      throw error;
    }
  }

  markCoverageIncomplete() {
    try {
      for (
        let attempt = 0;
        attempt < STABLE_READ_ATTEMPTS;
        attempt += 1
      ) {
        const before = this.readControlSnapshot();
        const generation = before.control.generation;
        assertPrivateDirectory(this.generationDir(generation));
        writePrivateAtomic(
          this.coverageMarkerPath(generation),
          COVERAGE_MARKER_TEXT,
        );
        const after = this.readControlSnapshot();
        if (
          before.text === after.text &&
          sameFileSnapshot(before.snapshot, after.snapshot)
        ) {
          return true;
        }
      }
    } catch {
      // A degraded optional publication must not affect the hook response.
    }
    return false;
  }

  emptyReadWindow(checkpoint = {}, { freshness = "current" } = {}) {
    return {
      v: 1,
      generation: 0,
      streamAlias: null,
      freshness,
      reset: checkpoint.streamAlias !== null && checkpoint.streamAlias !== undefined,
      events: [],
      status: {
        v: 1,
        generation: 0,
        nextSeq: 1,
        eventCount: 0,
        totalBytes: 0,
        oldestSeq: 1,
        committedSeq: 0,
        lastElapsedMs: 0,
        incidentCount: 0,
        avoidableCallCount: 0,
        generationFirstSeq: 1,
        gapCount: 0,
        publicationDropped: 0,
        maxEvents: this.maxEvents,
        maxBytes: this.maxBytes,
        maxAgeMs: this.maxAgeMs,
      },
    };
  }

  rebuildControl(generation, metadata = this.generationMetadata(generation)) {
    const files = this.eventFiles(generation);
    const highestObservedSequence =
      files.at(-1)?.sequence ?? metadata.firstSeq - 1;
    let totalBytes = 0;
    let incidentCount = 0;
    let avoidableCallCount = 0;
    let lastElapsedMs = 0;
    const valid = [];
    for (const current of files) {
      try {
        const parsed = parseEventText(fs.readFileSync(current.filename, "utf8"));
        if (
          parsed.event.seq !== current.sequence ||
          parsed.event.seq < metadata.firstSeq
        ) {
          throw new Error("Live event filename did not match its sequence.");
        }
        valid.push({ ...current, ...parsed });
        totalBytes += parsed.bytes;
        incidentCount += parsed.event.incidentCountDelta;
        avoidableCallCount += parsed.event.avoidableCallsDelta;
        lastElapsedMs = Math.max(lastElapsedMs, parsed.event.elapsedMs);
      } catch {
        fs.unlinkSync(current.filename);
      }
    }
    const first = valid[0]?.sequence ?? metadata.firstSeq;
    const last = valid.at(-1)?.sequence ?? metadata.firstSeq - 1;
    return {
      v: 1,
      generation,
      nextSeq: Math.max(
        metadata.firstSeq,
        highestObservedSequence + 1,
      ),
      pendingSeq: null,
      committedSeq: last,
      eventCount: valid.length,
      totalBytes,
      oldestSeq: valid.length > 0 ? first : last + 1,
      lastElapsedMs: Math.max(metadata.lastElapsedMs, lastElapsedMs),
      incidentCount,
      avoidableCallCount,
    };
  }

  retireOtherGenerations(generation) {
    if (!fs.existsSync(this.generationsDir)) return;
    for (const entry of fs.readdirSync(this.generationsDir, {
      withFileTypes: true,
    })) {
      if (
        entry.isDirectory() &&
        GENERATION_DIRECTORY.test(entry.name) &&
        entry.name !== generationName(generation)
      ) {
        fs.renameSync(
          path.join(this.generationsDir, entry.name),
          path.join(
            this.generationsDir,
            `.retired-${entry.name}-${crypto
              .randomBytes(4)
              .toString("hex")}`,
          ),
        );
      }
    }
  }

  cleanupRetiredGenerations(limit = RETIRED_CLEANUP_BATCH) {
    let remaining = limit;
    try {
      if (!fs.existsSync(this.generationsDir)) return;
      for (const entry of fs.readdirSync(this.generationsDir, {
        withFileTypes: true,
      })) {
        if (
          remaining <= 0 ||
          !entry.isDirectory() ||
          !RETIRED_GENERATION_DIRECTORY.test(entry.name)
        ) {
          continue;
        }
        const retired = path.join(this.generationsDir, entry.name);
        const events = path.join(retired, "events");
        try {
          assertPrivateDirectory(retired);
          if (fs.existsSync(events)) {
            assertPrivateDirectory(events);
            for (const event of fs.readdirSync(events, {
              withFileTypes: true,
            })) {
              if (remaining <= 0) break;
              if (!event.isFile() && !event.isSymbolicLink()) continue;
              fs.unlinkSync(path.join(events, event.name));
              remaining -= 1;
            }
            if (fs.readdirSync(events).length === 0) {
              fs.rmdirSync(events);
            }
          }
          if (!fs.existsSync(events)) {
            for (const temporary of fs.readdirSync(retired, {
              withFileTypes: true,
            })) {
              if (
                remaining <= 0 ||
                (!temporary.isFile() &&
                  !temporary.isSymbolicLink()) ||
                !temporary.name.endsWith(".tmp")
              ) {
                continue;
              }
              fs.unlinkSync(path.join(retired, temporary.name));
              remaining -= 1;
            }
            for (const filename of [
              "alias.key",
              "coverage.json",
              "generation.json",
            ]) {
              try {
                fs.unlinkSync(path.join(retired, filename));
              } catch (error) {
                if (error.code !== "ENOENT") throw error;
              }
            }
            if (fs.readdirSync(retired).length === 0) {
              fs.rmdirSync(retired);
            }
          }
        } catch {
          // Retired cleanup is best-effort and never affects hook decisions.
        }
      }
    } catch {
      // The live spool may be concurrently purged or rotated.
    }
  }

  loadControl({ allowRepair = false, maintenance = false } = {}) {
    ensurePrivateDirectory(this.root);
    ensurePrivateDirectory(this.liveDir);
    ensurePrivateDirectory(this.generationsDir);
    let control = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.controlPath, "utf8"));
      if (validControl(parsed)) control = parsed;
    } catch {
      // Missing or corrupt control is reconstructed only from audited event files.
    }

    if (!control) {
      const generations = fs
        .readdirSync(this.generationsDir, { withFileTypes: true })
        .flatMap((entry) =>
          entry.isDirectory() && GENERATION_DIRECTORY.test(entry.name)
            ? [Number.parseInt(entry.name, 10)]
            : [],
        )
        .filter(Number.isSafeInteger)
        .sort((left, right) => right - left);
      if (generations.length > 0 && !allowRepair) {
        throw new Error("Live spool control requires maintenance.");
      }
      const generation = generations[0] ?? 1;
      if (!fs.existsSync(this.generationDir(generation))) {
        this.initializeGeneration(generation);
      }
      ensurePrivateDirectory(this.generationDir(generation));
      privateKey(this.keyPath(generation));
      const metadata = this.generationMetadata(generation);
      control = this.rebuildControl(generation, metadata);
      writePrivateAtomic(
        this.controlPath,
        `${JSON.stringify(control, null, 2)}\n`,
      );
      maintenance = true;
    }

    try {
      ensurePrivateDirectory(this.generationDir(control.generation));
      privateKey(this.keyPath(control.generation));
      this.generationMetadata(control.generation);
      ensurePrivateDirectory(this.eventsDir(control.generation));
    } catch {
      const next = this.rotate(control);
      control = next.control;
    }
    const hadPending = control.pendingSeq !== null;
    control = this.recoverPending(control);
    if (maintenance || hadPending) {
      this.cleanTemporaryFiles(control.generation);
    }
    this.retireOtherGenerations(control.generation);
    return control;
  }

  recoverPending(control) {
    if (control.pendingSeq === null) return control;
    const filename = this.eventPath(control.generation, control.pendingSeq);
    const recovered = { ...control, pendingSeq: null };
    try {
      const parsed = parseEventText(fs.readFileSync(filename, "utf8"));
      if (parsed.event.seq !== control.pendingSeq) {
        throw new Error("Pending live event sequence did not match.");
      }
      recovered.committedSeq = Math.max(
        recovered.committedSeq,
        parsed.event.seq,
      );
      recovered.eventCount += 1;
      recovered.totalBytes += parsed.bytes;
      recovered.oldestSeq =
        recovered.eventCount === 1
          ? parsed.event.seq
          : Math.min(recovered.oldestSeq, parsed.event.seq);
      recovered.lastElapsedMs = Math.max(
        recovered.lastElapsedMs,
        parsed.event.elapsedMs,
      );
      recovered.incidentCount += parsed.event.incidentCountDelta;
      recovered.avoidableCallCount += parsed.event.avoidableCallsDelta;
    } catch {
      try {
        fs.unlinkSync(filename);
      } catch {
        // A reserved-but-unpublished sequence is intentionally left as a gap.
      }
    }
    writePrivateAtomic(
      this.controlPath,
      `${JSON.stringify(recovered, null, 2)}\n`,
    );
    return recovered;
  }

  generationExpired(control, currentTime) {
    const stat = fs.statSync(this.keyPath(control.generation));
    const createdAt = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.ctimeMs;
    return currentTime - createdAt >= this.maxAgeMs;
  }

  rotate(control) {
    let generation = control.generation + 1;
    while (fs.existsSync(this.generationDir(generation))) generation += 1;
    this.initializeGeneration(
      generation,
      control.nextSeq,
      control.lastElapsedMs,
    );
    const nextControl = emptyControl(
      generation,
      control.nextSeq,
      control.lastElapsedMs,
    );
    nextControl.committedSeq = control.committedSeq;
    writePrivateAtomic(
      this.controlPath,
      `${JSON.stringify(nextControl, null, 2)}\n`,
    );
    this.retireOtherGenerations(generation);
    return {
      control: nextControl,
      key: privateKey(this.keyPath(generation)),
    };
  }

  elapsedMs(control, currentTime) {
    if (control.eventCount > 0) {
      try {
        const stat = fs.statSync(
          this.eventPath(control.generation, control.committedSeq),
        );
        return Math.trunc(
          Math.max(
            control.lastElapsedMs,
            control.lastElapsedMs + Math.max(0, currentTime - stat.mtimeMs),
          ),
        );
      } catch {
        return control.lastElapsedMs;
      }
    }
    const stat = fs.statSync(this.keyPath(control.generation));
    const startedAt = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.ctimeMs;
    return Math.trunc(
      control.lastElapsedMs + Math.max(0, currentTime - startedAt),
    );
  }

  publish(payload, result, config, { decisionLatencyMs = 0 } = {}) {
    try {
      const locked = this.withLock(() => {
        let control = this.loadControl();
        let key = privateKey(this.keyPath(control.generation));
        const currentTime = nowMs(this.clock);
        const elapsedMs = this.elapsedMs(control, currentTime);
        let event = projectLiveEvent({
          payload,
          result,
          config,
          key,
          seq: control.nextSeq,
          elapsedMs,
          decisionLatencyMs,
          env: this.env,
        });
        if (!event) return { published: false, reason: "unsupported" };
        let serialized = serializeLiveEvent(event);
        const eventBytes = Buffer.byteLength(serialized, "utf8");

        if (
          control.eventCount >= this.maxEvents ||
          control.totalBytes + eventBytes > this.maxBytes ||
          this.generationExpired(control, currentTime)
        ) {
          const rotated = this.rotate(control);
          control = rotated.control;
          key = rotated.key;
          event = projectLiveEvent({
            payload,
            result,
            config,
            key,
            seq: control.nextSeq,
            elapsedMs,
            decisionLatencyMs,
            env: this.env,
          });
          serialized = serializeLiveEvent(event);
        }

        const reserved = {
          ...control,
          nextSeq: control.nextSeq + 1,
          pendingSeq: control.nextSeq,
        };
        writePrivateAtomic(
          this.controlPath,
          `${JSON.stringify(reserved, null, 2)}\n`,
        );

        const finalPath = this.eventPath(
          reserved.generation,
          reserved.pendingSeq,
        );
        const temporary = path.join(
          this.eventsDir(reserved.generation),
          `.${eventName(reserved.pendingSeq)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`,
        );
        try {
          fs.writeFileSync(temporary, serialized, {
            encoding: "utf8",
            mode: 0o600,
            flag: "wx",
          });
          parseEventText(fs.readFileSync(temporary, "utf8"));
          fs.renameSync(temporary, finalPath);
          fs.chmodSync(finalPath, 0o600);
        } catch (error) {
          try {
            fs.unlinkSync(temporary);
          } catch {
            // The temporary event may already have been atomically published.
          }
          throw error;
        }

        const committed = {
          ...reserved,
          pendingSeq: null,
          committedSeq: event.seq,
          eventCount: reserved.eventCount + 1,
          totalBytes:
            reserved.totalBytes + Buffer.byteLength(serialized, "utf8"),
          oldestSeq:
            reserved.eventCount === 0 ? event.seq : reserved.oldestSeq,
          lastElapsedMs: event.elapsedMs,
          incidentCount:
            reserved.incidentCount + event.incidentCountDelta,
          avoidableCallCount:
            reserved.avoidableCallCount + event.avoidableCallsDelta,
        };
        writePrivateAtomic(
          this.controlPath,
          `${JSON.stringify(committed, null, 2)}\n`,
        );
        return {
          published: true,
          event,
          generation: committed.generation,
        };
      });
      if (locked.locked) this.cleanupRetiredGenerations();
      if (!locked.locked) {
        this.markCoverageIncomplete();
        return { published: false, reason: "busy" };
      }
      return locked.value;
    } catch {
      this.markCoverageIncomplete();
      return { published: false, reason: "unavailable" };
    }
  }

  auditEventFiles(
    files,
    { previousSeq = 0, previousElapsedMs = 0 } = {},
  ) {
    const events = [];
    let totalBytes = 0;
    let incidentCount = 0;
    let avoidableCallCount = 0;
    let lastSeq = previousSeq;
    let lastElapsedMs = previousElapsedMs;
    for (const current of files) {
      const stable = readPrivateText(
        current.filename,
        LIVE_EVENT_MAX_BYTES,
      );
      const parsed = parseEventText(stable.text);
      if (
        parsed.event.seq !== current.sequence ||
        parsed.event.seq <= lastSeq ||
        parsed.event.elapsedMs < lastElapsedMs
      ) {
        throw new Error("Live event window failed its closed-schema audit.");
      }
      events.push(parsed.event);
      totalBytes += parsed.bytes;
      incidentCount += parsed.event.incidentCountDelta;
      avoidableCallCount += parsed.event.avoidableCallsDelta;
      lastSeq = parsed.event.seq;
      lastElapsedMs = parsed.event.elapsedMs;
    }
    return {
      events,
      totalBytes,
      incidentCount,
      avoidableCallCount,
    };
  }

  readWindow(checkpoint = {}) {
    const forceFull = checkpoint.forceFull === true;
    const requestedStreamAlias =
      typeof checkpoint.streamAlias === "string" &&
      /^generation_[0-9a-f]{32}$/u.test(checkpoint.streamAlias)
        ? checkpoint.streamAlias
        : null;
    const afterSeq =
      Number.isSafeInteger(checkpoint.afterSeq) && checkpoint.afterSeq >= 0
        ? checkpoint.afterSeq
        : 0;
    const previousElapsedMs =
      Number.isSafeInteger(checkpoint.lastElapsedMs) &&
      checkpoint.lastElapsedMs >= 0
        ? checkpoint.lastElapsedMs
        : 0;
    const seenEventCount =
      Number.isSafeInteger(checkpoint.eventCount) &&
      checkpoint.eventCount >= 0
        ? checkpoint.eventCount
        : 0;
    const seenTotalBytes =
      Number.isSafeInteger(checkpoint.totalBytes) &&
      checkpoint.totalBytes >= 0
        ? checkpoint.totalBytes
        : 0;
    const seenIncidentCount =
      Number.isSafeInteger(checkpoint.incidentCount) &&
      checkpoint.incidentCount >= 0
        ? checkpoint.incidentCount
        : 0;
    const seenAvoidableCallCount =
      Number.isSafeInteger(checkpoint.avoidableCallCount) &&
      checkpoint.avoidableCallCount >= 0
        ? checkpoint.avoidableCallCount
        : 0;
    for (let attempt = 0; attempt < STABLE_READ_ATTEMPTS; attempt += 1) {
      let before = null;
      try {
        if (!fs.existsSync(this.controlPath)) {
          if (fs.existsSync(this.lockPath)) throw new LiveWindowRaceError();
          if (fs.existsSync(this.liveDir)) {
            assertPrivateDirectory(this.liveDir);
          }
          if (fs.existsSync(this.generationsDir)) {
            assertPrivateDirectory(this.generationsDir);
          }
          const generationEntries = fs.existsSync(this.generationsDir)
            ? fs.readdirSync(this.generationsDir, {
                withFileTypes: true,
              })
            : [];
          if (
            generationEntries.some(
              (entry) =>
                !(
                  entry.isDirectory() &&
                  (GENERATION_DIRECTORY.test(entry.name) ||
                    RETIRED_GENERATION_DIRECTORY.test(entry.name))
                ),
            )
          ) {
            throw new Error("Live spool contained an unknown entry.");
          }
          const generations = generationEntries.some((entry) =>
            GENERATION_DIRECTORY.test(entry.name),
          );
          if (generations) {
            throw new Error("Live spool control is unavailable.");
          }
          return this.emptyReadWindow(checkpoint);
        }

        before = this.readControlSnapshot();
        const control = before.control;
        if (control.pendingSeq !== null) throw new LiveWindowRaceError();
        assertPrivateDirectory(this.liveDir);
        assertPrivateDirectory(this.generationsDir);
        assertPrivateDirectory(this.generationDir(control.generation));
        assertPrivateDirectory(this.eventsDir(control.generation));
        const key = privateKey(this.keyPath(control.generation));
        const streamAlias = generationAlias(key);
        const metadata = this.readGenerationMetadata(control.generation);
        const coverageBefore = this.readCoverageMarker(
          control.generation,
        );
        const gapCount =
          control.nextSeq - metadata.firstSeq - control.eventCount;
        if (
          metadata.firstSeq > control.nextSeq ||
          gapCount < 0 ||
          (control.eventCount === 0 &&
            (control.oldestSeq !== metadata.firstSeq ||
              control.committedSeq !== metadata.firstSeq - 1 ||
              control.totalBytes !== 0 ||
              control.incidentCount !== 0 ||
              control.avoidableCallCount !== 0 ||
              control.lastElapsedMs !== metadata.lastElapsedMs)) ||
          (control.eventCount > 0 &&
            (control.oldestSeq < metadata.firstSeq ||
              control.committedSeq < control.oldestSeq))
        ) {
          throw new Error("Live spool control is inconsistent.");
        }

        if (this.generationExpired(control, nowMs(this.clock))) {
          const after = this.readControlSnapshot();
          const coverageAfter = this.readCoverageMarker(
            control.generation,
          );
          if (
            before.text !== after.text ||
            !sameFileSnapshot(before.snapshot, after.snapshot) ||
            !sameOptionalFile(coverageBefore, coverageAfter)
          ) {
            throw new LiveWindowRaceError();
          }
          return this.emptyReadWindow(checkpoint, {
            freshness: "expired",
          });
        }

        const sameGeneration = requestedStreamAlias === streamAlias;
        const status = {
          ...statusFromControl(control, this),
          generationFirstSeq: metadata.firstSeq,
          gapCount,
          publicationDropped: coverageBefore.present ? 1 : 0,
        };
        const unchanged =
          !forceFull &&
          sameGeneration &&
          seenEventCount === control.eventCount &&
          seenTotalBytes === control.totalBytes &&
          seenIncidentCount === control.incidentCount &&
          seenAvoidableCallCount === control.avoidableCallCount &&
          (control.eventCount === 0 ||
            afterSeq === control.committedSeq);
        if (unchanged) {
          const after = this.readControlSnapshot();
          const coverageAfter = this.readCoverageMarker(
            control.generation,
          );
          if (
            before.text !== after.text ||
            !sameFileSnapshot(before.snapshot, after.snapshot) ||
            !sameOptionalFile(coverageBefore, coverageAfter)
          ) {
            throw new LiveWindowRaceError();
          }
          return {
            v: 1,
            generation: control.generation,
            streamAlias,
            freshness: "current",
            reset: false,
            events: [],
            status,
          };
        }

        const files = this.stableEventFiles(control.generation);
        if (
          files.length !== control.eventCount ||
          files.some((current) => current.sequence > control.committedSeq)
        ) {
          throw new Error("Live spool failed its closed-schema audit.");
        }

        const canAppend =
          !forceFull &&
          sameGeneration &&
          seenEventCount <= control.eventCount &&
          seenTotalBytes <= control.totalBytes &&
          seenIncidentCount <= control.incidentCount &&
          seenAvoidableCallCount <= control.avoidableCallCount &&
          (seenEventCount === 0 || afterSeq >= control.oldestSeq) &&
          afterSeq <= control.committedSeq;
        const reset = !canAppend;
        const selectedFiles = reset
          ? files
          : files.filter((current) => current.sequence > afterSeq);
        const audited = this.auditEventFiles(selectedFiles, {
          previousSeq: reset ? 0 : afterSeq,
          previousElapsedMs: reset
            ? metadata.lastElapsedMs
            : previousElapsedMs,
        });

        if (reset) {
          const first = audited.events[0];
          const last = audited.events.at(-1);
          if (
            audited.events.length !== control.eventCount ||
            audited.totalBytes !== control.totalBytes ||
            audited.incidentCount !== control.incidentCount ||
            audited.avoidableCallCount !== control.avoidableCallCount ||
            (first && first.seq !== control.oldestSeq) ||
            (last && last.seq !== control.committedSeq) ||
            (last && last.elapsedMs !== control.lastElapsedMs) ||
            (!first &&
              (control.totalBytes !== 0 ||
                control.incidentCount !== 0 ||
                control.avoidableCallCount !== 0))
          ) {
            throw new Error("Live spool failed its closed-schema audit.");
          }
        } else if (
          audited.events.length !== control.eventCount - seenEventCount ||
          audited.totalBytes !== control.totalBytes - seenTotalBytes ||
          audited.incidentCount !==
            control.incidentCount - seenIncidentCount ||
          audited.avoidableCallCount !==
            control.avoidableCallCount - seenAvoidableCallCount ||
          (audited.events.length > 0 &&
            audited.events.at(-1).elapsedMs !== control.lastElapsedMs)
        ) {
          throw new Error("Live spool append failed its closed-schema audit.");
        }

        const after = this.readControlSnapshot();
        const coverageAfter = this.readCoverageMarker(
          control.generation,
        );
        if (
          before.text !== after.text ||
          !sameFileSnapshot(before.snapshot, after.snapshot) ||
          !sameOptionalFile(coverageBefore, coverageAfter)
        ) {
          throw new LiveWindowRaceError();
        }
        return {
          v: 1,
          generation: control.generation,
          streamAlias,
          freshness: "current",
          reset,
          events: audited.events,
          status,
        };
      } catch (error) {
        if (error?.code === "LIVE_WINDOW_RACE") {
          if (attempt + 1 < STABLE_READ_ATTEMPTS) continue;
          throw error;
        }
        if (before) {
          let changed = false;
          try {
            const after = this.readControlSnapshot();
            changed =
              before.text !== after.text ||
              !sameFileSnapshot(before.snapshot, after.snapshot);
          } catch (afterError) {
            changed =
              afterError?.code === "LIVE_WINDOW_RACE" ||
              afterError?.code === "ENOENT";
          }
          if (changed) {
            if (attempt + 1 < STABLE_READ_ATTEMPTS) continue;
            throw new LiveWindowRaceError();
          }
        }
        throw error;
      }
    }
    throw new LiveWindowRaceError();
  }

  readEvents() {
    const locked = this.withLock(() => {
      let control = this.loadControl({
        allowRepair: true,
        maintenance: true,
      });
      if (this.generationExpired(control, nowMs(this.clock))) {
        control = this.rotate(control).control;
      }
      const text = this.eventFiles(control.generation)
        .map((current) => fs.readFileSync(current.filename, "utf8"))
        .join("");
      const audit = auditLiveEventText(text, {
        maxBytes: this.maxBytes,
        maxEvents: this.maxEvents,
        allowEmpty: true,
      });
      if (!audit.ok) {
        throw new Error("Live spool failed its closed-schema audit.");
      }
      return text
        .split(/\r?\n/u)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    });
    if (!locked.locked) throw new Error("Live spool is busy.");
    this.cleanupRetiredGenerations();
    return locked.value;
  }

  status() {
    const locked = this.withLock(() => {
      let control = this.loadControl({
        allowRepair: true,
        maintenance: true,
      });
      if (this.generationExpired(control, nowMs(this.clock))) {
        control = this.rotate(control).control;
      }
      return statusFromControl(control, this);
    });
    if (locked.locked) this.cleanupRetiredGenerations();
    return locked.locked ? locked.value : null;
  }

  maintain() {
    if (!fs.existsSync(this.controlPath)) {
      this.cleanupRetiredGenerations(MAINTENANCE_CLEANUP_BATCH);
      return { maintained: false, rotated: false };
    }
    try {
      const locked = this.withLock(() => {
        let control = this.readControlSnapshot().control;
        if (control.pendingSeq !== null) {
          return {
            maintained: false,
            rotated: false,
            generation: control.generation,
          };
        }
        assertPrivateDirectory(this.generationDir(control.generation));
        privateKey(this.keyPath(control.generation));
        this.readGenerationMetadata(control.generation);
        const previousGeneration = control.generation;
        if (this.generationExpired(control, nowMs(this.clock))) {
          control = this.rotate(control).control;
        }
        return {
          maintained: true,
          rotated: control.generation !== previousGeneration,
          generation: control.generation,
        };
      });
      this.cleanupRetiredGenerations(MAINTENANCE_CLEANUP_BATCH);
      return locked.locked
        ? locked.value
        : { maintained: false, rotated: false };
    } catch {
      return { maintained: false, rotated: false };
    }
  }

  purge() {
    const locked = this.withLock(() => {
      for (const entry of fs.existsSync(this.liveDir)
        ? fs.readdirSync(this.liveDir, { withFileTypes: true })
        : []) {
        if (entry.name === path.basename(this.lockPath)) continue;
        fs.rmSync(path.join(this.liveDir, entry.name), {
          recursive: true,
          force: true,
        });
      }
      return { liveSpoolRemoved: true };
    });
    return locked.locked
      ? locked.value
      : { liveSpoolRemoved: false };
  }
}

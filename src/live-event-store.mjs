import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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
const EVENT_FILE = /^(\d{16})\.json$/u;
const LOCK_RETRY_MS = 2;
const LOCK_STALE_MS = 30_000;
const DEFAULT_LOCK_TIMEOUT_MS = 8;
const DEFAULT_MAX_EVENTS = 4096;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

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
  const stat = fs.lstatSync(filename);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size !== 32 ||
    (uid !== null && stat.uid !== uid) ||
    (stat.mode & 0o077) !== 0
  ) {
    throw new Error("Unsafe live alias key.");
  }
  return fs.readFileSync(filename);
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
    const directories = [this.liveDir, this.eventsDir(generation)];
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

  rebuildControl(generation, metadata = this.generationMetadata(generation)) {
    const files = this.eventFiles(generation);
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
      nextSeq: Math.max(metadata.firstSeq, last + 1),
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

  removeOtherGenerations(generation) {
    if (!fs.existsSync(this.generationsDir)) return;
    for (const entry of fs.readdirSync(this.generationsDir, {
      withFileTypes: true,
    })) {
      if (
        entry.isDirectory() &&
        GENERATION_DIRECTORY.test(entry.name) &&
        entry.name !== generationName(generation)
      ) {
        fs.rmSync(path.join(this.generationsDir, entry.name), {
          recursive: true,
          force: true,
        });
      }
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
    this.removeOtherGenerations(control.generation);
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
    this.removeOtherGenerations(generation);
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
      return locked.locked
        ? locked.value
        : { published: false, reason: "busy" };
    } catch {
      return { published: false, reason: "unavailable" };
    }
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
        maxEvents: this.maxEvents,
        maxBytes: this.maxBytes,
        maxAgeMs: this.maxAgeMs,
      };
    });
    return locked.locked ? locked.value : null;
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

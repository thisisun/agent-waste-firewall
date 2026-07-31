import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { hash, sleepSync } from "./utils.mjs";

const SCHEMA_VERSION = 4;
const STALE_LOCK_MS = 10_000;
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
const MAINTENANCE_CLOCK_SKEW_MS = 60 * 1000;
const MAINTENANCE_LOCK_STALE_MS = 10 * 60 * 1000;
const MAINTENANCE_MARKER_MAX_BYTES = 128;
const STATE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const MAX_STATE_TOOL_EVENTS = 512;
const MAX_STATE_INCIDENTS = 256;
const MAX_STATE_FILE_ALIASES = 512;
const SESSION_KEY = /^[a-f0-9]{16}-[a-f0-9]{10}$/u;
const SESSION_STATE_FILE =
  /^([a-f0-9]{16}-[a-f0-9]{10})\.json$/u;
const SESSION_LOCK_DIRECTORY =
  /^([a-f0-9]{16}-[a-f0-9]{10})\.lock$/u;
const SESSION_TEMPORARY_FILE =
  /^([a-f0-9]{16}-[a-f0-9]{10})\.json\.(\d+)\.([a-f0-9]+)\.tmp$/u;
const PLATFORMS = new Set(["unknown", "codex", "claude"]);
const LOCALES = new Set(["en", "ko"]);
const PROMPT_SEVERITIES = new Set(["none", "low", "medium", "high"]);
const ISSUE_IDS = new Set([
  "broad",
  "target",
  "success",
  "verify",
  "stop",
  "conflict",
]);
const TOOL_FAMILIES = new Set([
  "wait",
  "write",
  "read",
  "search",
  "shell",
  "subagent",
  "other",
]);
const OPERATIONS = new Set([
  ...TOOL_FAMILIES,
  "sign",
  "submit",
  "deploy",
  "migrate",
  "verify",
  "release",
  "test",
  "build",
  "inspect",
  "command",
]);
const RULE_IDS = new Set([
  "prompt_contract",
  "exact_tool_repeat",
  "unchanged_reread",
  "retry_after_same_failure",
  "repeated_failure_result",
  "status_polling_loop",
  "edit_revert_oscillation",
]);
const ATTRIBUTIONS = new Set([
  "user_instruction",
  "agent",
  "environment",
  "harness",
]);
const CONFIDENCES = new Set(["low", "medium", "high"]);
const FAILURE_CATEGORIES = new Set(["agent", "environment"]);
const HEX_16 = /^[a-f0-9]{16}$/u;
const HEX_64 = /^[a-f0-9]{64}$/u;
const PATH_ALIAS = /^path_[a-f0-9]{32}$/u;
const SESSION_ALIAS = /^session_[a-f0-9]{32}$/u;
const WORKSPACE_ALIAS = /^workspace_[a-f0-9]{32}$/u;
const DEDUPE_KEY = /^incident_[a-f0-9]{32}$/u;

function iso(clock) {
  const value = clock();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function safeInteger(value, fallback = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isInteger(value) && value >= 0 && value <= maximum
    ? value
    : fallback;
}

function safeIso(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : fallback;
}

function safeEnum(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function safeFingerprint(value) {
  return typeof value === "string" && HEX_64.test(value) ? value : null;
}

function sanitizePrompt(value, fallbackTime) {
  if (!value || typeof value !== "object" || !HEX_64.test(value.promptHash ?? "")) {
    return null;
  }
  return {
    at: safeIso(value.at, fallbackTime),
    promptHash: value.promptHash,
    score: safeInteger(value.score, 0, 100),
    severity: safeEnum(value.severity, PROMPT_SEVERITIES, "none"),
    issueIds: Array.isArray(value.issueIds)
      ? [...new Set(value.issueIds.filter((item) => ISSUE_IDS.has(item)))].slice(0, 8)
      : [],
  };
}

function sanitizeToolEvent(value, fallbackTime) {
  if (
    !value ||
    typeof value !== "object" ||
    !["pre", "post"].includes(value.phase) ||
    !HEX_64.test(value.signature ?? "")
  ) {
    return null;
  }
  const event = {
    phase: value.phase,
    at: safeIso(value.at, fallbackTime),
    family: safeEnum(value.family, TOOL_FAMILIES, "other"),
    operation: safeEnum(value.operation, OPERATIONS, "other"),
    signature: value.signature,
    progressVersion: safeInteger(value.progressVersion),
  };
  if (value.phase === "post") {
    event.resultFingerprint = safeFingerprint(value.resultFingerprint);
    event.failed = value.failed === true;
    event.interrupted = value.interrupted === true;
    event.failureCategory =
      value.failureCategory === null
        ? null
        : safeEnum(value.failureCategory, FAILURE_CATEGORIES, "agent");
    event.madeProgress = value.madeProgress === true;
  }
  return event;
}

function sanitizeFailure(value, fallbackTime) {
  if (
    !value ||
    typeof value !== "object" ||
    !HEX_64.test(value.signature ?? "")
  ) {
    return null;
  }
  return {
    at: safeIso(value.at, fallbackTime),
    signature: value.signature,
    resultFingerprint: safeFingerprint(value.resultFingerprint),
    progressVersion: safeInteger(value.progressVersion),
  };
}

function sanitizeFiles(value, fallbackTime) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const files = {};
  for (const [pathAlias, entry] of Object.entries(value).slice(
    -MAX_STATE_FILE_ALIASES,
  )) {
    if (!PATH_ALIAS.test(pathAlias) || !entry || typeof entry !== "object") {
      continue;
    }
    const hashes = Array.isArray(entry.hashes)
      ? entry.hashes
          .flatMap((current) => {
            if (!current || typeof current !== "object") {
              return [];
            }
            const digest =
              safeFingerprint(current.hash) ??
              (["missing", "unavailable"].includes(current.hash)
                ? current.hash
                : null);
            if (
              !digest ||
              !["before-write", "after-write"].includes(current.source)
            ) {
              return [];
            }
            return [{
              hash: digest,
              source: current.source,
              at: safeIso(current.at, fallbackTime),
            }];
          })
          .slice(-8)
      : [];
    files[pathAlias] = { hashes };
  }
  return files;
}

function sanitizeEvidence(ruleId, value) {
  const evidence = value && typeof value === "object" ? value : {};
  switch (ruleId) {
    case "prompt_contract":
      return {
        score: safeInteger(evidence.score, 0, 100),
        issueIds: Array.isArray(evidence.issueIds)
          ? [...new Set(evidence.issueIds.filter((item) => ISSUE_IDS.has(item)))].slice(0, 8)
          : [],
      };
    case "retry_after_same_failure":
      return {
        repeatedFailedAttempts: safeInteger(evidence.repeatedFailedAttempts),
        repositoryProgressSinceFailure: evidence.repositoryProgressSinceFailure === true,
        failureCategory: safeEnum(
          evidence.failureCategory,
          FAILURE_CATEGORIES,
          "agent",
        ),
      };
    case "status_polling_loop":
      return {
        pollingCalls: safeInteger(evidence.pollingCalls),
        repositoryProgressDuringPolling: evidence.repositoryProgressDuringPolling === true,
      };
    case "unchanged_reread":
      return {
        identicalReads: safeInteger(evidence.identicalReads),
        repositoryProgressBetweenReads: evidence.repositoryProgressBetweenReads === true,
      };
    case "exact_tool_repeat":
      return {
        identicalCalls: safeInteger(evidence.identicalCalls),
        repositoryProgressBetweenCalls: evidence.repositoryProgressBetweenCalls === true,
        highCostOperation: evidence.highCostOperation === true,
      };
    case "repeated_failure_result":
      return {
        identicalFailureResults: safeInteger(evidence.identicalFailureResults),
        repositoryProgressBetweenFailures: evidence.repositoryProgressBetweenFailures === true,
        failureCategory: safeEnum(
          evidence.failureCategory,
          FAILURE_CATEGORIES,
          "agent",
        ),
      };
    case "edit_revert_oscillation":
      return {
        pathAlias: PATH_ALIAS.test(evidence.pathAlias ?? "")
          ? evidence.pathAlias
          : `path_${"0".repeat(32)}`,
        pattern: "A-B-A",
      };
    default:
      return {};
  }
}

function sanitizeIncident(value, fallbackTime) {
  if (
    !value ||
    typeof value !== "object" ||
    !HEX_16.test(value.id ?? "") ||
    !DEDUPE_KEY.test(value.dedupeKey ?? "") ||
    !RULE_IDS.has(value.ruleId)
  ) {
    return null;
  }
  return {
    id: value.id,
    dedupeKey: value.dedupeKey,
    ruleId: value.ruleId,
    category: safeEnum(value.category, ATTRIBUTIONS, "agent"),
    severity: safeEnum(value.severity, PROMPT_SEVERITIES, "medium"),
    confidence: safeEnum(value.confidence, CONFIDENCES, "medium"),
    at: safeIso(value.at, fallbackTime),
    lastSeenAt: safeIso(value.lastSeenAt, fallbackTime),
    occurrences: Math.max(1, safeInteger(value.occurrences, 1)),
    evidence: sanitizeEvidence(value.ruleId, value.evidence),
    blockable: value.blockable === true,
  };
}

function projectState(value, fallback) {
  const source = value && typeof value === "object" ? value : {};
  const createdAt = safeIso(source.createdAt, fallback.createdAt);
  const updatedAt = safeIso(source.updatedAt, fallback.updatedAt);
  return {
    schemaVersion: SCHEMA_VERSION,
    sessionAlias: fallback.sessionAlias,
    workspaceAlias: fallback.workspaceAlias,
    platform: safeEnum(source.platform, PLATFORMS, "unknown"),
    locale: safeEnum(source.locale, LOCALES, "en"),
    createdAt,
    updatedAt,
    progressVersion: safeInteger(source.progressVersion),
    prompt: sanitizePrompt(source.prompt, updatedAt),
    toolEvents: Array.isArray(source.toolEvents)
      ? source.toolEvents
          .slice(-MAX_STATE_TOOL_EVENTS)
          .map((current) => sanitizeToolEvent(current, updatedAt))
          .filter(Boolean)
      : [],
    failures: Array.isArray(source.failures)
      ? source.failures
          .map((current) => sanitizeFailure(current, updatedAt))
          .filter(Boolean)
      : [],
    files: sanitizeFiles(source.files, updatedAt),
    incidents: Array.isArray(source.incidents)
      ? source.incidents
          .slice(-MAX_STATE_INCIDENTS)
          .map((current) => sanitizeIncident(current, updatedAt))
          .filter(Boolean)
      : [],
    verification: {
      lastSuccessfulAt:
        source.verification?.lastSuccessfulAt === null
          ? null
          : safeIso(source.verification?.lastSuccessfulAt, null),
      operation: ["test", "build"].includes(source.verification?.operation)
        ? source.verification.operation
        : null,
    },
    counters: {
      stops: safeInteger(source.counters?.stops),
      interruptions: safeInteger(source.counters?.interruptions),
    },
    ...(source.lastStop && typeof source.lastStop === "object"
      ? {
          lastStop: {
            at: safeIso(source.lastStop.at, updatedAt),
            stopHookActive: source.lastStop.stopHookActive === true,
          },
        }
      : {}),
  };
}

function initialState(payload, now) {
  const cwd = path.resolve(payload.cwd ?? process.cwd());
  const sessionScope = String(payload.session_id ?? "unknown");
  return {
    schemaVersion: SCHEMA_VERSION,
    sessionAlias: `session_${hash("session", sessionScope).slice(0, 32)}`,
    workspaceAlias: `workspace_${hash(`workspace:${cwd}`, sessionScope).slice(0, 32)}`,
    platform: "unknown",
    locale: "en",
    createdAt: now,
    updatedAt: now,
    progressVersion: 0,
    prompt: null,
    toolEvents: [],
    failures: [],
    files: {},
    incidents: [],
    verification: {
      lastSuccessfulAt: null,
      operation: null,
    },
    counters: {
      stops: 0,
    },
  };
}

function prune(state, config) {
  state.toolEvents = state.toolEvents.slice(
    -Math.min(config.maxToolEvents, MAX_STATE_TOOL_EVENTS),
  );
  state.failures = state.failures.slice(-80);
  state.incidents = state.incidents.slice(
    -Math.min(config.maxIncidents, MAX_STATE_INCIDENTS),
  );
  state.files = Object.fromEntries(
    Object.entries(state.files).slice(-MAX_STATE_FILE_ALIASES),
  );
  for (const file of Object.values(state.files)) {
    file.hashes = file.hashes.slice(-8);
  }
}

function emptyPurgeResult() {
  return {
    stateFilesRemoved: 0,
    temporaryFilesRemoved: 0,
    staleLocksRemoved: 0,
    activeFilesSkipped: 0,
    unsafeFilesSkipped: 0,
  };
}

export class UnsafeStateStorageError extends Error {
  constructor() {
    super("Unsafe state storage boundary.");
    this.code = "UNSAFE_STATE_STORAGE";
  }
}

export class UnsafeStateEntryError extends Error {
  constructor() {
    super("Unsafe state entry.");
    this.code = "UNSAFE_STATE_ENTRY";
  }
}

function ownerUid() {
  return typeof process.getuid === "function" ? BigInt(process.getuid()) : null;
}

function privateDirectorySnapshot(stat) {
  const uid = ownerUid();
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (uid !== null && stat.uid !== uid) ||
    (stat.mode & 0o077n) !== 0n
  ) {
    throw new UnsafeStateStorageError();
  }
  return { dev: stat.dev, ino: stat.ino };
}

function inspectPrivateDirectory(directory) {
  return privateDirectorySnapshot(
    fs.lstatSync(directory, { bigint: true }),
  );
}

function sameDirectory(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertTrustedAncestorStat(stat, { symbolicLink = false } = {}) {
  const uid = ownerUid();
  const trustedOwner =
    uid === null || stat.uid === uid || stat.uid === 0n;
  if (!trustedOwner) throw new UnsafeStateStorageError();
  if (symbolicLink) {
    if (!stat.isSymbolicLink()) throw new UnsafeStateStorageError();
    return;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new UnsafeStateStorageError();
  }
  const writableByOthers = (stat.mode & 0o022n) !== 0n;
  const sticky = (stat.mode & 0o1000n) !== 0n;
  if (writableByOthers && !sticky) {
    throw new UnsafeStateStorageError();
  }
}

function assertTrustedAncestorPath(directory) {
  const absolute = path.resolve(directory);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  assertTrustedAncestorStat(fs.lstatSync(current, { bigint: true }));
  for (const component of absolute
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, component);
    const stat = fs.lstatSync(current, { bigint: true });
    assertTrustedAncestorStat(stat, {
      symbolicLink: stat.isSymbolicLink(),
    });
  }
}

function privateFileSnapshot(filename, maximumBytes = STATE_FILE_MAX_BYTES) {
  const stat = fs.lstatSync(filename, { bigint: true });
  const uid = ownerUid();
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > BigInt(maximumBytes) ||
    (uid !== null && stat.uid !== uid) ||
    (stat.mode & 0o077n) !== 0n
  ) {
    throw new UnsafeStateStorageError();
  }
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
    mtimeMs: Number(stat.mtimeNs / 1_000_000n),
  };
}

function retentionFileSnapshot(filename) {
  try {
    return privateFileSnapshot(filename);
  } catch (error) {
    if (error.code === "ENOENT") throw error;
    if (error.code === "UNSAFE_STATE_STORAGE") {
      throw new UnsafeStateEntryError();
    }
    throw error;
  }
}

function sameFile(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function parseRetentionEntry(filename) {
  for (const [kind, pattern] of [
    ["state", SESSION_STATE_FILE],
    ["temporary", SESSION_TEMPORARY_FILE],
    ["lock", SESSION_LOCK_DIRECTORY],
  ]) {
    const match = pattern.exec(filename);
    if (match) return { kind, key: match[1] };
  }
  return null;
}

function addPurgeResult(target, current) {
  for (const key of Object.keys(target)) {
    target[key] += current[key] ?? 0;
  }
}

export class StateStore {
  constructor({
    root,
    clock = () => new Date(),
  }) {
    this.root = path.resolve(root);
    this.clock = clock;
    this.sessionsDir = path.join(this.root, "sessions");
    this.maintenanceMarkerPath = path.join(
      this.root,
      "state-maintenance-v1.json",
    );
    this.maintenanceLockPath = path.join(
      this.root,
      "state-maintenance-v1.lock",
    );
  }

  now() {
    return iso(this.clock);
  }

  keyFor(payload) {
    const sessionScope = String(payload.session_id ?? "unknown");
    const sessionId = hash(sessionScope).slice(0, 16);
    const cwdHash = hash(
      path.resolve(payload.cwd ?? process.cwd()),
      sessionScope,
    ).slice(0, 10);
    return `${sessionId}-${cwdHash}`;
  }

  statePath(key) {
    if (!SESSION_KEY.test(key)) throw new UnsafeStateStorageError();
    return path.join(this.sessionsDir, `${key}.json`);
  }

  assertSafeRootParent({ deep = false } = {}) {
    const requestedParent = path.dirname(this.root);
    const parent = fs.realpathSync(requestedParent);
    assertTrustedAncestorStat(
      fs.lstatSync(parent, { bigint: true }),
    );
    if (deep) {
      assertTrustedAncestorPath(requestedParent);
      if (parent !== path.resolve(requestedParent)) {
        assertTrustedAncestorPath(parent);
      }
    }
  }

  ensureRootStorage({ deep = false } = {}) {
    this.assertSafeRootParent({ deep });
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    return inspectPrivateDirectory(this.root);
  }

  ensureSessionStorage() {
    const root = this.ensureRootStorage({ deep: true });
    fs.mkdirSync(this.sessionsDir, { recursive: true, mode: 0o700 });
    const sessions = inspectPrivateDirectory(this.sessionsDir);
    const verifiedRoot = inspectPrivateDirectory(this.root);
    if (!sameDirectory(root, verifiedRoot)) {
      throw new UnsafeStateStorageError();
    }
    return { root: verifiedRoot, sessions };
  }

  retentionStorageIdentity({ createSessions = false } = {}) {
    const root = this.ensureRootStorage({ deep: true });
    let sessions = null;
    try {
      sessions = inspectPrivateDirectory(this.sessionsDir);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (createSessions) {
        fs.mkdirSync(this.sessionsDir, { recursive: true, mode: 0o700 });
        sessions = inspectPrivateDirectory(this.sessionsDir);
      }
    }
    const verifiedRoot = inspectPrivateDirectory(this.root);
    if (!sameDirectory(root, verifiedRoot)) {
      throw new UnsafeStateStorageError();
    }
    return { root: verifiedRoot, sessions };
  }

  assertRetentionStorageIdentity(identity, { sessions = true } = {}) {
    const root = inspectPrivateDirectory(this.root);
    if (!sameDirectory(root, identity.root)) {
      throw new UnsafeStateStorageError();
    }
    if (sessions) {
      if (!identity.sessions) throw new UnsafeStateStorageError();
      const currentSessions = inspectPrivateDirectory(this.sessionsDir);
      if (!sameDirectory(currentSessions, identity.sessions)) {
        throw new UnsafeStateStorageError();
      }
    }
    return identity;
  }

  lockSnapshot(lockPath) {
    return inspectPrivateDirectory(lockPath);
  }

  sameOwnedLock(token) {
    try {
      this.assertRetentionStorageIdentity(token.storage);
      return sameDirectory(this.lockSnapshot(token.path), token.lock);
    } catch {
      return false;
    }
  }

  releaseOwnedLock(token) {
    if (!token || !this.sameOwnedLock(token)) return false;
    try {
      fs.rmdirSync(token.path);
      return true;
    } catch {
      return false;
    }
  }

  tryAcquireSessionLock(
    key,
    now = Date.now(),
    { reclaimStale = true } = {},
  ) {
    if (!SESSION_KEY.test(key)) throw new UnsafeStateStorageError();
    const storage = this.ensureSessionStorage();
    const lockPath = path.join(this.sessionsDir, `${key}.lock`);
    let staleLocksRemoved = 0;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        fs.mkdirSync(lockPath, { mode: 0o700 });
        const lock = this.lockSnapshot(lockPath);
        this.assertRetentionStorageIdentity(storage);
        return {
          active: false,
          staleLocksRemoved,
          token: { key, path: lockPath, lock, storage },
        };
      } catch (error) {
        if (error.code !== "EEXIST") {
          throw error;
        }
        if (!reclaimStale) {
          return { active: true, staleLocksRemoved, token: null };
        }
        try {
          const before = this.lockSnapshot(lockPath);
          const age =
            Math.trunc(Number(now)) -
            Number(fs.lstatSync(lockPath, { bigint: true }).mtimeMs);
          if (age > STALE_LOCK_MS) {
            this.assertRetentionStorageIdentity(storage);
            const after = this.lockSnapshot(lockPath);
            if (!sameDirectory(before, after)) {
              throw new UnsafeStateStorageError();
            }
            fs.rmdirSync(lockPath);
            staleLocksRemoved += 1;
            continue;
          }
        } catch (nestedError) {
          if (nestedError.code === "ENOENT") continue;
          throw nestedError;
        }
        return { active: true, staleLocksRemoved, token: null };
      }
    }

    return { active: true, staleLocksRemoved, token: null };
  }

  acquireLock(key) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const acquired = this.tryAcquireSessionLock(key);
      if (acquired.token) return acquired.token;
      sleepSync(10);
    }
    throw new Error(`Timed out waiting for state lock: ${key}`);
  }

  purgeRetentionEntry(
    filename,
    {
      all = false,
      cutoff,
      excludedKey = null,
      now = Date.now(),
      reclaimStaleLocks = false,
      storage,
    },
  ) {
    const result = emptyPurgeResult();
    const entry = parseRetentionEntry(filename);
    if (!entry || entry.key === excludedKey) return result;
    this.assertRetentionStorageIdentity(storage);
    const target = path.join(this.sessionsDir, filename);

    if (entry.kind === "lock") {
      const acquired = this.tryAcquireSessionLock(entry.key, now, {
        reclaimStale: reclaimStaleLocks,
      });
      result.staleLocksRemoved += acquired.staleLocksRemoved;
      if (acquired.token) this.releaseOwnedLock(acquired.token);
      return result;
    }

    let before;
    try {
      before = retentionFileSnapshot(target);
    } catch (error) {
      if (error.code === "ENOENT") return result;
      throw error;
    }
    if (entry.kind === "state" && !all && before.mtimeMs >= cutoff) {
      return result;
    }

    const acquired = this.tryAcquireSessionLock(entry.key, now, {
      reclaimStale: reclaimStaleLocks,
    });
    result.staleLocksRemoved += acquired.staleLocksRemoved;
    if (!acquired.token) {
      result.activeFilesSkipped += 1;
      return result;
    }
    try {
      this.assertRetentionStorageIdentity(storage);
      let after;
      try {
        after = retentionFileSnapshot(target);
      } catch (error) {
        if (error.code === "ENOENT") return result;
        throw error;
      }
      if (!sameFile(before, after)) {
        throw new UnsafeStateStorageError();
      }
      if (entry.kind === "state" && !all && after.mtimeMs >= cutoff) {
        return result;
      }
      this.assertRetentionStorageIdentity(storage);
      fs.unlinkSync(target);
      this.assertRetentionStorageIdentity(storage);
      if (entry.kind === "state") result.stateFilesRemoved += 1;
      else result.temporaryFilesRemoved += 1;
      return result;
    } finally {
      this.releaseOwnedLock(acquired.token);
    }
  }

  purge({ all = false, retentionDays = 30, excludedKey = null, now = Date.now() }) {
    const result = emptyPurgeResult();
    const cleanupNow = Math.trunc(Number(now));
    if (!Number.isSafeInteger(cleanupNow) || cleanupNow < 0) {
      throw new TypeError("Invalid state cleanup clock.");
    }
    if (
      !Number.isSafeInteger(retentionDays) ||
      retentionDays < 1 ||
      retentionDays > 3650
    ) {
      throw new TypeError("Invalid state retention period.");
    }
    let storage;
    try {
      storage = this.retentionStorageIdentity();
    } catch (error) {
      if (error.code === "ENOENT") return result;
      throw error;
    }
    if (!storage.sessions) return result;
    const cutoff =
      cleanupNow - retentionDays * 24 * 60 * 60 * 1000;
    for (const filename of fs.readdirSync(this.sessionsDir)) {
      try {
        addPurgeResult(
          result,
          this.purgeRetentionEntry(filename, {
            all,
            cutoff,
            excludedKey,
            now: cleanupNow,
            reclaimStaleLocks: false,
            storage,
          }),
        );
      } catch (error) {
        if (error.code !== "UNSAFE_STATE_ENTRY") throw error;
        result.unsafeFilesSkipped += 1;
      }
    }
    return result;
  }

  purgeExpired(retentionDays, excludedKey = null, now = Date.now()) {
    return this.purge({ retentionDays, excludedKey, now });
  }

  retentionMaintenanceDue(now) {
    try {
      const before = privateFileSnapshot(
        this.maintenanceMarkerPath,
        MAINTENANCE_MARKER_MAX_BYTES,
      );
      const source = fs.readFileSync(this.maintenanceMarkerPath, "utf8");
      const after = privateFileSnapshot(
        this.maintenanceMarkerPath,
        MAINTENANCE_MARKER_MAX_BYTES,
      );
      if (!sameFile(before, after) || Buffer.byteLength(source) !== Number(after.size)) {
        return true;
      }
      const marker = JSON.parse(source);
      const canonical =
        `{"v":1,"nextSweepAt":${marker?.nextSweepAt}}\n`;
      return !(
        source === canonical &&
        Number.isSafeInteger(marker.nextSweepAt) &&
        marker.nextSweepAt > now &&
        marker.nextSweepAt <=
          now + MAINTENANCE_INTERVAL_MS + MAINTENANCE_CLOCK_SKEW_MS
      );
    } catch {
      return true;
    }
  }

  assertMaintenanceControlSafe(storage) {
    this.assertRetentionStorageIdentity(storage, { sessions: false });
    try {
      const before = privateFileSnapshot(
        this.maintenanceMarkerPath,
        MAINTENANCE_MARKER_MAX_BYTES,
      );
      const source = fs.readFileSync(this.maintenanceMarkerPath, "utf8");
      const after = privateFileSnapshot(
        this.maintenanceMarkerPath,
        MAINTENANCE_MARKER_MAX_BYTES,
      );
      if (
        !sameFile(before, after) ||
        Buffer.byteLength(source) !== Number(after.size)
      ) {
        throw new UnsafeStateStorageError();
      }
      const marker = JSON.parse(source);
      const canonical = `{"v":1,"nextSweepAt":${marker?.nextSweepAt}}\n`;
      if (
        source !== canonical ||
        !Number.isSafeInteger(marker.nextSweepAt) ||
        marker.nextSweepAt < 0
      ) {
        throw new UnsafeStateStorageError();
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  acquireMaintenanceLock(now) {
    const storage = {
      root: this.ensureRootStorage({ deep: true }),
      sessions: null,
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        fs.mkdirSync(this.maintenanceLockPath, { mode: 0o700 });
        const lock = this.lockSnapshot(this.maintenanceLockPath);
        this.assertRetentionStorageIdentity(storage, { sessions: false });
        return {
          path: this.maintenanceLockPath,
          lock,
          storage,
        };
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        try {
          const before = this.lockSnapshot(this.maintenanceLockPath);
          const age =
            Math.trunc(Number(now)) -
            Number(
              fs.lstatSync(this.maintenanceLockPath, {
                bigint: true,
              }).mtimeMs,
            );
          if (age > MAINTENANCE_LOCK_STALE_MS) {
            this.assertRetentionStorageIdentity(storage, {
              sessions: false,
            });
            const after = this.lockSnapshot(this.maintenanceLockPath);
            if (!sameDirectory(before, after)) {
              throw new UnsafeStateStorageError();
            }
            fs.rmdirSync(this.maintenanceLockPath);
            continue;
          }
        } catch (nestedError) {
          if (nestedError.code === "ENOENT") continue;
          throw nestedError;
        }
        return null;
      }
    }
    return null;
  }

  sameOwnedMaintenanceLock(token) {
    if (!token) return false;
    try {
      this.assertRetentionStorageIdentity(token.storage, {
        sessions: false,
      });
      return sameDirectory(this.lockSnapshot(token.path), token.lock);
    } catch {
      return false;
    }
  }

  refreshMaintenanceLock(token, now) {
    if (!this.sameOwnedMaintenanceLock(token)) {
      throw new UnsafeStateStorageError();
    }
    const timestamp = new Date(Math.trunc(Number(now)));
    fs.utimesSync(token.path, timestamp, timestamp);
    if (!this.sameOwnedMaintenanceLock(token)) {
      throw new UnsafeStateStorageError();
    }
  }

  releaseMaintenanceLock(token) {
    if (!this.sameOwnedMaintenanceLock(token)) return false;
    try {
      fs.rmdirSync(token.path);
      return true;
    } catch {
      return false;
    }
  }

  writeMaintenanceMarker(nextSweepAt, storage) {
    if (!Number.isSafeInteger(nextSweepAt) || nextSweepAt < 0) {
      throw new TypeError("Invalid state maintenance marker.");
    }
    this.assertMaintenanceControlSafe(storage);
    const temporary =
      `${this.maintenanceMarkerPath}.${process.pid}.` +
      `${crypto.randomBytes(8).toString("hex")}.tmp`;
    try {
      fs.writeFileSync(
        temporary,
        `{"v":1,"nextSweepAt":${nextSweepAt}}\n`,
        {
          mode: 0o600,
          flag: "wx",
        },
      );
      this.assertMaintenanceControlSafe(storage);
      fs.renameSync(temporary, this.maintenanceMarkerPath);
      privateFileSnapshot(
        this.maintenanceMarkerPath,
        MAINTENANCE_MARKER_MAX_BYTES,
      );
      this.assertRetentionStorageIdentity(storage, { sessions: false });
    } catch (error) {
      try {
        fs.unlinkSync(temporary);
      } catch {
        // The failed write may not have created its private temporary file.
      }
      throw error;
    }
  }

  nextMaintenanceAt(now) {
    return Math.trunc(Number(now)) + MAINTENANCE_INTERVAL_MS;
  }

  purgeAll(now = Date.now()) {
    return this.purge({ all: true, now });
  }

  mutate(payload, config, mutator) {
    const key = this.keyFor(payload);
    const lock = this.acquireLock(key);
    try {
      const stateFile = this.statePath(key);
      const now = this.now();
      const fresh = initialState(payload, now);
      let state = fresh;

      if (fs.existsSync(stateFile)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
          if (parsed?.schemaVersion === SCHEMA_VERSION) {
            state = projectState(parsed, fresh);
          }
        } catch {
          // Corrupt state is replaced by a clean fail-open state.
        }
      }

      const result = mutator(state, now);
      state.updatedAt = now;
      prune(state, config);
      const persisted = projectState(state, fresh);

      const temporary =
        `${stateFile}.${process.pid}.` +
        `${crypto.randomBytes(8).toString("hex")}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(persisted, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      if (!this.sameOwnedLock(lock)) {
        try {
          fs.unlinkSync(temporary);
        } catch {
          // The state write is abandoned when ownership cannot be proven.
        }
        throw new UnsafeStateStorageError();
      }
      fs.renameSync(temporary, stateFile);
      return result;
    } finally {
      this.releaseOwnedLock(lock);
    }
  }

  listStates() {
    let storage;
    try {
      storage = this.retentionStorageIdentity();
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    if (!storage.sessions) return [];

    return fs
      .readdirSync(this.sessionsDir)
      .filter((filename) => SESSION_STATE_FILE.test(filename))
      .flatMap((filename) => {
        try {
          this.assertRetentionStorageIdentity(storage);
          privateFileSnapshot(path.join(this.sessionsDir, filename));
          const parsed = JSON.parse(
            fs.readFileSync(path.join(this.sessionsDir, filename), "utf8"),
          );
          if (
            parsed?.schemaVersion !== SCHEMA_VERSION ||
            !SESSION_ALIAS.test(parsed.sessionAlias ?? "") ||
            !WORKSPACE_ALIAS.test(parsed.workspaceAlias ?? "")
          ) {
            return [];
          }
          const fallbackTime = this.now();
          return [
            projectState(parsed, {
              sessionAlias: parsed.sessionAlias,
              workspaceAlias: parsed.workspaceAlias,
              createdAt: fallbackTime,
              updatedAt: fallbackTime,
            }),
          ];
        } catch {
          return [];
        }
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
}

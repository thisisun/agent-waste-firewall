import fs from "node:fs";
import path from "node:path";

import { hash, sleepSync } from "./utils.mjs";

const SCHEMA_VERSION = 4;
const STALE_LOCK_MS = 10_000;
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
const MAINTENANCE_CLOCK_SKEW_MS = 60 * 1000;
const MAINTENANCE_LOCK_STALE_MS = 10 * 60 * 1000;
const MAINTENANCE_MARKER_MAX_BYTES = 128;
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
  for (const [pathAlias, entry] of Object.entries(value)) {
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
  state.toolEvents = state.toolEvents.slice(-config.maxToolEvents);
  state.failures = state.failures.slice(-80);
  state.incidents = state.incidents.slice(-config.maxIncidents);
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
  };
}

export class StateStore {
  constructor({
    root,
    clock = () => new Date(),
    maintenanceClock = () => Date.now(),
  }) {
    this.root = path.resolve(root);
    this.clock = clock;
    this.maintenanceClock = maintenanceClock;
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
    return path.join(this.sessionsDir, `${key}.json`);
  }

  acquireLock(key) {
    fs.mkdirSync(this.sessionsDir, { recursive: true, mode: 0o700 });
    const lockPath = path.join(this.sessionsDir, `${key}.lock`);

    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        fs.mkdirSync(lockPath, { mode: 0o700 });
        return lockPath;
      } catch (error) {
        if (error.code !== "EEXIST") {
          throw error;
        }
        try {
          const age = Date.now() - fs.statSync(lockPath).mtimeMs;
          if (age > STALE_LOCK_MS) {
            fs.rmdirSync(lockPath);
            continue;
          }
        } catch {
          continue;
        }
        sleepSync(10);
      }
    }

    throw new Error(`Timed out waiting for state lock: ${key}`);
  }

  inspectLock(key, now) {
    const lockPath = path.join(this.sessionsDir, `${key}.lock`);
    if (!fs.existsSync(lockPath)) {
      return { active: false, staleRemoved: false };
    }
    try {
      const age = now - fs.statSync(lockPath).mtimeMs;
      if (age > STALE_LOCK_MS) {
        fs.rmdirSync(lockPath);
        return { active: false, staleRemoved: true };
      }
      return { active: true, staleRemoved: false };
    } catch {
      return {
        active: fs.existsSync(lockPath),
        staleRemoved: false,
      };
    }
  }

  purge({ all = false, retentionDays = 30, excludedKey = null, now = Date.now() }) {
    const result = emptyPurgeResult();
    if (!fs.existsSync(this.sessionsDir)) {
      return result;
    }
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    const lockStates = new Map();
    const lockFor = (key) => {
      if (!lockStates.has(key)) {
        const status = this.inspectLock(key, now);
        lockStates.set(key, status);
        if (status.staleRemoved) {
          result.staleLocksRemoved += 1;
        }
      }
      return lockStates.get(key);
    };

    for (const filename of fs.readdirSync(this.sessionsDir)) {
      if (!filename.endsWith(".json")) {
        continue;
      }
      const key = filename.slice(0, -5);
      if (key === excludedKey) {
        continue;
      }
      const stateFile = path.join(this.sessionsDir, filename);
      try {
        if (!all && fs.statSync(stateFile).mtimeMs >= cutoff) {
          continue;
        }
        if (lockFor(key).active) {
          result.activeFilesSkipped += 1;
          continue;
        }
        fs.unlinkSync(stateFile);
        result.stateFilesRemoved += 1;
      } catch {
        // Concurrent cleanup or an unreadable stale entry should not break hooks.
      }
    }

    for (const filename of fs.readdirSync(this.sessionsDir)) {
      const marker = ".json.";
      const markerIndex = filename.indexOf(marker);
      if (!filename.endsWith(".tmp") || markerIndex <= 0) {
        continue;
      }
      const key = filename.slice(0, markerIndex);
      if (key === excludedKey) {
        continue;
      }
      if (lockFor(key).active) {
        result.activeFilesSkipped += 1;
        continue;
      }
      try {
        fs.unlinkSync(path.join(this.sessionsDir, filename));
        result.temporaryFilesRemoved += 1;
      } catch {
        // Concurrent cleanup is harmless.
      }
    }

    for (const filename of fs.readdirSync(this.sessionsDir)) {
      if (!filename.endsWith(".lock")) {
        continue;
      }
      const key = filename.slice(0, -5);
      if (key !== excludedKey) {
        lockFor(key);
      }
    }
    return result;
  }

  purgeExpired(retentionDays, excludedKey = null, now = Date.now()) {
    return this.purge({ retentionDays, excludedKey, now });
  }

  retentionMaintenanceDue(now) {
    try {
      const stat = fs.lstatSync(this.maintenanceMarkerPath);
      const uid = typeof process.getuid === "function" ? process.getuid() : null;
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > MAINTENANCE_MARKER_MAX_BYTES ||
        (uid !== null && stat.uid !== uid) ||
        (stat.mode & 0o077) !== 0
      ) {
        return true;
      }
      const source = fs.readFileSync(this.maintenanceMarkerPath, "utf8");
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

  acquireMaintenanceLock(now) {
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    try {
      fs.mkdirSync(this.maintenanceLockPath, { mode: 0o700 });
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") {
        return false;
      }
      try {
        const age = now - fs.statSync(this.maintenanceLockPath).mtimeMs;
        if (age > MAINTENANCE_LOCK_STALE_MS) {
          fs.rmdirSync(this.maintenanceLockPath);
          fs.mkdirSync(this.maintenanceLockPath, { mode: 0o700 });
          return true;
        }
      } catch {
        // A racing janitor may have released or replaced the lock.
      }
      return false;
    }
  }

  writeMaintenanceMarker(nextSweepAt) {
    const temporary =
      `${this.maintenanceMarkerPath}.${process.pid}.` +
      `${Math.random().toString(16).slice(2)}.tmp`;
    try {
      fs.writeFileSync(
        temporary,
        `{"v":1,"nextSweepAt":${nextSweepAt}}\n`,
        {
          mode: 0o600,
          flag: "wx",
        },
      );
      fs.renameSync(temporary, this.maintenanceMarkerPath);
      fs.chmodSync(this.maintenanceMarkerPath, 0o600);
    } catch (error) {
      try {
        fs.unlinkSync(temporary);
      } catch {
        // The failed write may not have created its private temporary file.
      }
      throw error;
    }
  }

  maintainRetention(retentionDays, excludedKey) {
    const now = Math.trunc(Number(this.maintenanceClock()));
    if (!Number.isSafeInteger(now) || now < 0) {
      return;
    }
    if (!this.retentionMaintenanceDue(now)) {
      return;
    }
    if (!this.acquireMaintenanceLock(now)) {
      return;
    }
    try {
      if (!this.retentionMaintenanceDue(now)) {
        return;
      }
      this.purgeExpired(retentionDays, excludedKey, now);
      this.writeMaintenanceMarker(now + MAINTENANCE_INTERVAL_MS);
    } finally {
      try {
        fs.rmdirSync(this.maintenanceLockPath);
      } catch {
        // A stale-lock cleanup in another process is harmless.
      }
    }
  }

  purgeAll(now = Date.now()) {
    return this.purge({ all: true, now });
  }

  mutate(payload, config, mutator) {
    const key = this.keyFor(payload);
    try {
      this.maintainRetention(config.retentionDays, key);
    } catch {
      // Optional retention cleanup must never disable the guard decision.
    }
    const lockPath = this.acquireLock(key);
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

      const temporary = `${stateFile}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(persisted, null, 2)}\n`, {
        mode: 0o600,
      });
      fs.renameSync(temporary, stateFile);
      return result;
    } finally {
      try {
        fs.rmdirSync(lockPath);
      } catch {
        // A stale-lock cleanup in another process is harmless.
      }
    }
  }

  listStates() {
    if (!fs.existsSync(this.sessionsDir)) {
      return [];
    }

    return fs
      .readdirSync(this.sessionsDir)
      .filter((filename) => filename.endsWith(".json"))
      .flatMap((filename) => {
        try {
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

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  auditTraceText,
  serializeTraceEvent,
  validateTraceEvent,
} from "./trace-schema.mjs";
import { detectPlatform } from "./tool-event.mjs";
import { sleepSync } from "./utils.mjs";

const TRACE_ID = /^trace_[0-9a-f]{24}$/u;
const SAFE_LABEL = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u;
const LOCK_STALE_MS = 10_000;
const MAX_CAPTURE_FILE_BYTES = 10 * 1024 * 1024;

const FILE_TYPE_BY_EXTENSION = new Map([
  [".c", "source"],
  [".cc", "source"],
  [".cpp", "source"],
  [".cs", "source"],
  [".css", "source"],
  [".go", "source"],
  [".html", "source"],
  [".java", "source"],
  [".js", "source"],
  [".jsx", "source"],
  [".kt", "source"],
  [".mjs", "source"],
  [".php", "source"],
  [".py", "source"],
  [".rb", "source"],
  [".rs", "source"],
  [".scss", "source"],
  [".sh", "source"],
  [".sql", "source"],
  [".swift", "source"],
  [".ts", "source"],
  [".tsx", "source"],
  [".vue", "source"],
  [".xml", "source"],
  [".json", "data"],
  [".jsonl", "data"],
  [".csv", "data"],
  [".tsv", "data"],
  [".toml", "config"],
  [".yaml", "config"],
  [".yml", "config"],
  [".ini", "config"],
  [".conf", "config"],
  [".md", "document"],
  [".mdx", "document"],
  [".txt", "document"],
  [".pdf", "document"],
  [".gif", "image"],
  [".jpeg", "image"],
  [".jpg", "image"],
  [".png", "image"],
  [".svg", "image"],
  [".webp", "image"],
  [".aab", "binary"],
  [".apk", "binary"],
  [".app", "binary"],
  [".dmg", "binary"],
  [".ipa", "binary"],
  [".wasm", "binary"],
  [".zip", "binary"],
]);

function milliseconds(clock) {
  const value = clock();
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
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
    throw new Error("Unsafe trace data directory.");
  }
  if ((stat.mode & 0o077) !== 0) {
    fs.chmodSync(directory, 0o700);
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
      // Nothing to clean up.
    }
    throw error;
  }
}

function safeTraceId(traceId) {
  const value = String(traceId ?? "");
  if (!TRACE_ID.test(value)) {
    throw new Error("Invalid trace id.");
  }
  return value;
}

function parseJsonFile(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function workspaceAncestors(cwd) {
  const values = [];
  let current = path.resolve(cwd);
  while (true) {
    values.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      return values;
    }
    current = parent;
  }
}

export function resolveWorkspaceRoot(cwd) {
  for (const candidate of workspaceAncestors(cwd)) {
    if (fs.existsSync(path.join(candidate, ".git"))) {
      return candidate;
    }
  }
  return path.resolve(cwd);
}

export function traceAlias(key, domain, value) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new TypeError("Trace alias key must be 32 bytes.");
  }
  const safeDomain = String(domain);
  if (!/^[a-z][a-z0-9-]{1,31}$/u.test(safeDomain)) {
    throw new TypeError("Invalid trace alias domain.");
  }
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  const digest = crypto
    .createHmac("sha256", key)
    .update("awf-trace-v1\0")
    .update(safeDomain)
    .update("\0")
    .update(input)
    .digest("hex")
    .slice(0, 32);
  return `${safeDomain.replaceAll("-", "_")}_${digest}`;
}

function normalizeLabel(label) {
  const value = String(label ?? "").trim();
  if (!SAFE_LABEL.test(value)) {
    throw new Error(
      "Trace label must be 1-64 characters using only letters, numbers, dot, underscore, or hyphen.",
    );
  }
  return value;
}

function insideWorkspace(workspaceRoot, candidate) {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(candidate);
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function coarseFileType(filename) {
  const extension = path.extname(filename).toLowerCase();
  return FILE_TYPE_BY_EXTENSION.get(extension) ?? "other";
}

function captureContent(target, key) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isDirectory()) {
      return {
        contentAlias: null,
        contentState: "not_observed",
        fileType: "directory",
      };
    }
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.size > MAX_CAPTURE_FILE_BYTES
    ) {
      return {
        contentAlias: null,
        contentState: "unavailable",
        fileType: coarseFileType(target),
      };
    }
    return {
      contentAlias: traceAlias(key, "content", fs.readFileSync(target)),
      contentState: "present",
      fileType: coarseFileType(target),
    };
  } catch (error) {
    return {
      contentAlias: null,
      contentState: error.code === "ENOENT" ? "missing" : "unavailable",
      fileType: coarseFileType(target),
    };
  }
}

function targetReferences(tool, cwd, workspaceRoot, key) {
  if (!tool || !Array.isArray(tool.filePaths)) {
    return [];
  }

  return tool.filePaths.slice(0, 32).map((filePath) => {
    const absolute = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(cwd, filePath);
    const inWorkspace = insideWorkspace(workspaceRoot, absolute);
    const canonical = inWorkspace
      ? path.relative(workspaceRoot, absolute) || "."
      : absolute;
    const captured =
      tool.family === "write" && inWorkspace
        ? captureContent(absolute, key)
        : {
            contentAlias: null,
            contentState: "not_observed",
            fileType: coarseFileType(absolute),
          };
    return {
      pathAlias: traceAlias(key, "path", canonical),
      fileType: captured.fileType,
      scope: inWorkspace ? "workspace" : "external",
      contentAlias: captured.contentAlias,
      contentState: captured.contentState,
    };
  });
}

function safeIncident(incident) {
  if (!incident) {
    return null;
  }
  return {
    ruleId: String(incident.ruleId),
    attribution: String(incident.category),
    severity: String(incident.severity),
    confidence: String(incident.confidence),
    repeatCount: Math.max(1, Number(incident.occurrences ?? 1)),
    blockable: incident.blockable === true,
    notified: incident.shouldNotify !== false,
  };
}

function recordedDecision(result, mode) {
  const output = result?.output ?? {};
  if (
    output.decision === "block" ||
    output.hookSpecificOutput?.permissionDecision === "deny"
  ) {
    return "block";
  }
  if (result?.incident && mode === "observe") {
    return "observe";
  }
  if (
    result?.incident?.shouldNotify !== false &&
    (output.systemMessage || output.hookSpecificOutput?.additionalContext)
  ) {
    return "warn";
  }
  return "allow";
}

function eventKind(eventName) {
  if (eventName === "UserPromptSubmit") return "prompt";
  if (eventName === "PreToolUse") return "tool_pre";
  if (eventName === "PostToolUse" || eventName === "PostToolUseFailure") {
    return "tool_post";
  }
  if (eventName === "Stop") return "stop";
  return null;
}

function toolOutcome(tool) {
  if (tool?.interrupted) return "interrupted";
  if (tool?.failed) return "failure";
  if (tool) return "success";
  return "unknown";
}

function buildEvent({
  payload,
  result,
  config,
  key,
  workspaceRoot,
  seq,
  elapsedMs,
  env,
}) {
  const kind = eventKind(String(payload.hook_event_name ?? ""));
  if (!kind) {
    return null;
  }

  const turnId = payload.turn_id;
  const base = {
    v: 1,
    seq,
    elapsedMs,
    kind,
    platform: detectPlatform(payload, env),
    sessionAlias: traceAlias(
      key,
      "session",
      String(payload.session_id ?? "unknown"),
    ),
    decision: recordedDecision(result, config.mode),
  };
  const incident = safeIncident(result.incident);
  if (incident) {
    base.incident = incident;
  }
  if (turnId !== undefined && turnId !== null && String(turnId)) {
    base.turnAlias = traceAlias(key, "turn", String(turnId));
  }

  if (kind === "prompt") {
    const evaluation = result.evaluation;
    return {
      ...base,
      promptAlias: traceAlias(key, "prompt", String(payload.prompt ?? "")),
      locale: ["ko", "en"].includes(evaluation.locale) ? evaluation.locale : "other",
      score: evaluation.score,
      severity: evaluation.severity,
      shouldWarn: evaluation.shouldWarn === true,
      isAction: evaluation.isAction === true,
      isFollowUp: evaluation.isFollowUp === true,
      issueIds: evaluation.issues.map((current) => current.id),
      progressVersion: result.observed?.progressVersion ?? 0,
    };
  }

  if (kind === "stop") {
    return {
      ...base,
      progressVersion: result.observed?.progressVersion ?? 0,
    };
  }

  const tool = result.tool;
  const commonTool = {
    ...base,
    callAlias: traceAlias(
      key,
      "call",
      String(payload.tool_use_id ?? tool.toolUseId ?? "unknown"),
    ),
    signatureAlias: traceAlias(key, "signature", tool.signature),
    family: tool.family,
    operation: tool.operation,
    risk: tool.risk ?? "none",
    targets: targetReferences(tool, payload.cwd ?? process.cwd(), workspaceRoot, key),
    progressVersion: result.observed?.progressVersion ?? 0,
  };

  if (kind === "tool_pre") {
    return commonTool;
  }

  return {
    ...commonTool,
    resultAlias: tool.resultFingerprint
      ? traceAlias(key, "result", tool.resultFingerprint)
      : null,
    outcome: toolOutcome(tool),
    failureClass: tool.failed ? tool.failureCategory ?? "agent" : null,
    madeProgress: result.observed?.madeProgress === true,
  };
}

function readKey(filename) {
  const stat = fs.lstatSync(filename);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size !== 32 ||
    (uid !== null && stat.uid !== uid) ||
    (stat.mode & 0o077) !== 0
  ) {
    throw new Error("Unsafe trace key file.");
  }
  return fs.readFileSync(filename);
}

export class TraceStore {
  constructor({ root, clock = () => new Date(), env = process.env }) {
    this.root = path.resolve(root);
    this.clock = clock;
    this.env = env;
    this.tracesDir = path.join(this.root, "traces");
    this.keysDir = path.join(this.root, "trace-keys");
    this.activePath = path.join(this.root, "active-trace.json");
    this.globalLockPath = path.join(this.root, "trace-control.lock");
  }

  traceDir(traceId) {
    return path.join(this.tracesDir, safeTraceId(traceId));
  }

  metadataPath(traceId) {
    return path.join(this.traceDir(traceId), "metadata.json");
  }

  eventsPath(traceId) {
    return path.join(this.traceDir(traceId), "events.jsonl");
  }

  keyPath(traceId) {
    return path.join(this.keysDir, `${safeTraceId(traceId)}.key`);
  }

  acquireLock(lockPath) {
    ensurePrivateDirectory(path.dirname(lockPath));
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        fs.mkdirSync(lockPath, { mode: 0o700 });
        return lockPath;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        try {
          if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
            fs.rmdirSync(lockPath);
            continue;
          }
        } catch {
          continue;
        }
        sleepSync(10);
      }
    }
    throw new Error("Timed out waiting for trace lock.");
  }

  withLock(lockPath, action) {
    const acquired = this.acquireLock(lockPath);
    try {
      return action();
    } finally {
      try {
        fs.rmdirSync(acquired);
      } catch {
        // A stale-lock cleanup in another process is harmless.
      }
    }
  }

  readActive() {
    if (!fs.existsSync(this.activePath)) return null;
    const active = parseJsonFile(this.activePath);
    safeTraceId(active.traceId);
    if (
      active.v !== 1 ||
      typeof active.workspaceAlias !== "string" ||
      !active.workspaceAlias.startsWith("workspace_")
    ) {
      throw new Error("Invalid active trace marker.");
    }
    return active;
  }

  start({ workspace = process.cwd(), label = "recording", mode = "observe" } = {}) {
    return this.withLock(this.globalLockPath, () => {
      if (this.readActive()) {
        throw new Error("A trace recording is already active. Stop it first.");
      }
      if (!["observe", "warn", "block"].includes(mode)) {
        throw new Error("Trace mode must be observe, warn, or block.");
      }
      const safeLabel = normalizeLabel(label);

      const workspaceRoot = resolveWorkspaceRoot(workspace);
      const stat = fs.lstatSync(workspaceRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error("Recording workspace must be a real directory.");
      }
      const traceId = `trace_${crypto.randomBytes(12).toString("hex")}`;
      const key = crypto.randomBytes(32);
      const workspaceAlias = traceAlias(key, "workspace", workspaceRoot);
      const startedAtMs = milliseconds(this.clock);
      const traceDir = this.traceDir(traceId);

      ensurePrivateDirectory(this.root);
      ensurePrivateDirectory(this.tracesDir);
      ensurePrivateDirectory(this.keysDir);
      try {
        fs.mkdirSync(traceDir, { mode: 0o700 });
        fs.writeFileSync(this.keyPath(traceId), key, {
          mode: 0o600,
          flag: "wx",
        });
        fs.writeFileSync(this.eventsPath(traceId), "", {
          mode: 0o600,
          flag: "wx",
        });
        writePrivateAtomic(
          this.metadataPath(traceId),
          `${JSON.stringify({
            v: 1,
            traceId,
            label: safeLabel,
            workspaceAlias,
            mode,
            startedAtMs,
            stoppedAtMs: null,
            eventCount: 0,
            incidentCount: 0,
            avoidableCallCount: 0,
            lastElapsedMs: 0,
            status: "recording",
          }, null, 2)}\n`,
        );
        writePrivateAtomic(
          this.activePath,
          `${JSON.stringify({ v: 1, traceId, workspaceAlias })}\n`,
        );
      } catch (error) {
        try {
          fs.rmSync(traceDir, { recursive: true, force: true });
        } catch {
          // The failed transaction may not have created a trace directory.
        }
        try {
          fs.unlinkSync(this.keyPath(traceId));
        } catch {
          // The failed transaction may not have created a key.
        }
        throw error;
      }
      return this.status(traceId);
    });
  }

  activeFor(cwd) {
    const active = this.readActive();
    if (!active) return null;
    const key = readKey(this.keyPath(active.traceId));
    for (const candidate of workspaceAncestors(cwd)) {
      if (traceAlias(key, "workspace", candidate) === active.workspaceAlias) {
        return {
          ...active,
          workspaceRoot: candidate,
          key,
          metadata: parseJsonFile(this.metadataPath(active.traceId)),
        };
      }
    }
    return null;
  }

  appendHook(payload, result, config) {
    const active = this.activeFor(payload.cwd ?? process.cwd());
    if (!active) return null;
    const lockPath = path.join(this.traceDir(active.traceId), "append.lock");
    return this.withLock(lockPath, () => {
      const metadata = parseJsonFile(this.metadataPath(active.traceId));
      if (metadata.status !== "recording") return null;
      const elapsedMs = Math.max(
        metadata.lastElapsedMs,
        milliseconds(this.clock) - metadata.startedAtMs,
      );
      const event = buildEvent({
        payload,
        result,
        config,
        key: active.key,
        workspaceRoot: active.workspaceRoot,
        seq: metadata.eventCount + 1,
        elapsedMs,
        env: this.env,
      });
      if (!event) return null;
      validateTraceEvent(event);
      fs.appendFileSync(this.eventsPath(active.traceId), serializeTraceEvent(event), {
        encoding: "utf8",
        mode: 0o600,
      });
      metadata.eventCount += 1;
      metadata.lastElapsedMs = elapsedMs;
      if (event.incident?.notified) metadata.incidentCount += 1;
      if (
        event.incident?.notified &&
        ["exact_tool_repeat", "unchanged_reread", "retry_after_same_failure", "repeated_failure_result", "status_polling_loop", "edit_revert_oscillation"].includes(
          event.incident.ruleId,
        )
      ) {
        metadata.avoidableCallCount += 1;
      }
      writePrivateAtomic(
        this.metadataPath(active.traceId),
        `${JSON.stringify(metadata, null, 2)}\n`,
      );
      return event;
    });
  }

  stop() {
    return this.withLock(this.globalLockPath, () => {
      const active = this.readActive();
      if (!active) {
        throw new Error("No trace recording is active.");
      }
      const appendLock = path.join(this.traceDir(active.traceId), "append.lock");
      return this.withLock(appendLock, () => {
        const metadata = parseJsonFile(this.metadataPath(active.traceId));
        metadata.status = "stopped";
        metadata.stoppedAtMs = milliseconds(this.clock);
        writePrivateAtomic(
          this.metadataPath(active.traceId),
          `${JSON.stringify(metadata, null, 2)}\n`,
        );
        fs.unlinkSync(this.activePath);
        try {
          fs.unlinkSync(this.keyPath(active.traceId));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        return this.status(active.traceId);
      });
    });
  }

  status(traceId = null) {
    let selected = traceId;
    if (!selected) {
      const active = this.readActive();
      if (active) selected = active.traceId;
    }
    if (!selected) return null;
    const metadata = parseJsonFile(this.metadataPath(selected));
    return {
      traceId: metadata.traceId,
      label: metadata.label,
      mode: metadata.mode,
      status: metadata.status,
      eventCount: metadata.eventCount,
      incidentCount: metadata.incidentCount,
      avoidableCallCount: metadata.avoidableCallCount,
      elapsedMs:
        metadata.status === "recording"
          ? Math.max(0, milliseconds(this.clock) - metadata.startedAtMs)
          : Math.max(0, metadata.stoppedAtMs - metadata.startedAtMs),
    };
  }

  list() {
    if (!fs.existsSync(this.tracesDir)) return [];
    return fs
      .readdirSync(this.tracesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && TRACE_ID.test(entry.name))
      .flatMap((entry) => {
        try {
          return [this.status(entry.name)];
        } catch {
          return [];
        }
      })
      .filter(Boolean)
      .sort((left, right) => right.traceId.localeCompare(left.traceId));
  }

  purge({ all = false, retentionDays = 30 } = {}) {
    const result = {
      traceDirectoriesRemoved: 0,
      traceKeysRemoved: 0,
      activeTracesSkipped: 0,
    };
    const active = this.readActive();
    const cutoff = milliseconds(this.clock) - retentionDays * 24 * 60 * 60 * 1000;

    if (fs.existsSync(this.tracesDir)) {
      for (const entry of fs.readdirSync(this.tracesDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !TRACE_ID.test(entry.name)) continue;
        if (entry.name === active?.traceId) {
          result.activeTracesSkipped += 1;
          continue;
        }
        const traceDirectory = this.traceDir(entry.name);
        let referenceTime = fs.statSync(traceDirectory).mtimeMs;
        try {
          const metadata = parseJsonFile(this.metadataPath(entry.name));
          referenceTime =
            metadata.stoppedAtMs ?? metadata.startedAtMs ?? referenceTime;
        } catch {
          // Corrupt inactive traces use their directory timestamp for retention.
        }
        if (!all && referenceTime >= cutoff) continue;
        fs.rmSync(traceDirectory, { recursive: true, force: false });
        result.traceDirectoriesRemoved += 1;
        try {
          fs.unlinkSync(this.keyPath(entry.name));
          result.traceKeysRemoved += 1;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }

    if (fs.existsSync(this.keysDir)) {
      for (const entry of fs.readdirSync(this.keysDir, { withFileTypes: true })) {
        const traceId = entry.name.endsWith(".key")
          ? entry.name.slice(0, -4)
          : "";
        if (!entry.isFile() || !TRACE_ID.test(traceId)) continue;
        if (traceId === active?.traceId) {
          continue;
        }
        const keyFile = this.keyPath(traceId);
        if (
          fs.existsSync(this.traceDir(traceId)) ||
          (!all && fs.statSync(keyFile).mtimeMs >= cutoff)
        ) {
          continue;
        }
        fs.unlinkSync(keyFile);
        result.traceKeysRemoved += 1;
      }
    }
    return result;
  }

  purgeExpired(retentionDays = 30) {
    return this.purge({ retentionDays });
  }

  purgeAll() {
    return this.purge({ all: true });
  }

  readEvents(traceId) {
    const text = fs.readFileSync(this.eventsPath(traceId), "utf8");
    const audit = auditTraceText(text);
    if (!audit.ok) {
      const first = audit.findings[0];
      throw new Error(
        `Trace audit failed at line ${first.line ?? 0}, field ${first.field ?? "unknown"} (${first.code}).`,
      );
    }
    return text
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  audit(traceId) {
    const text = fs.readFileSync(this.eventsPath(traceId), "utf8");
    return auditTraceText(text);
  }

  export(traceId, destination) {
    safeTraceId(traceId);
    const output = path.resolve(destination);
    if (fs.existsSync(output)) {
      throw new Error("Export destination already exists.");
    }
    const text = fs.readFileSync(this.eventsPath(traceId), "utf8");
    const audit = auditTraceText(text);
    if (!audit.ok) {
      const first = audit.findings[0];
      throw new Error(
        `Trace export refused at line ${first.line ?? 0}, field ${first.field ?? "unknown"} (${first.code}).`,
      );
    }
    const outputDirectory = path.dirname(output);
    const outputDirectoryStat = fs.lstatSync(outputDirectory);
    if (!outputDirectoryStat.isDirectory() || outputDirectoryStat.isSymbolicLink()) {
      throw new Error("Export destination directory is unsafe.");
    }
    const temporary = `${output}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    try {
      fs.writeFileSync(temporary, text, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      const secondAudit = auditTraceText(fs.readFileSync(temporary, "utf8"));
      if (!secondAudit.ok) {
        throw new Error("Trace export verification failed.");
      }
      fs.renameSync(temporary, output);
      fs.chmodSync(output, 0o600);
    } catch (error) {
      try {
        fs.unlinkSync(temporary);
      } catch {
        // Nothing to clean up.
      }
      throw error;
    }
    return {
      traceId,
      eventCount: audit.eventCount,
      output,
    };
  }
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { configFromEnv } from "./config.mjs";
import { handleHook } from "./engine.mjs";
import { LiveEventStore } from "./live-event-store.mjs";
import { evaluatePrompt } from "./prompt-contract.mjs";
import { replaySemanticEvents } from "./semantic-replay.mjs";
import { StateStore } from "./state-store.mjs";
import { TraceStore } from "./trace-store.mjs";
import { hash } from "./utils.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = "0.1.0";

async function readStdin() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input;
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function positionalArguments(args, valuedOptions = []) {
  const values = [];
  const withValue = new Set(valuedOptions);
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (withValue.has(item)) {
      index += 1;
    } else if (!item.startsWith("--")) {
      values.push(item);
    }
  }
  return values;
}

function printPromptEvaluation(evaluation) {
  console.log(`AWF preflight: ${evaluation.score}/100`);
  if (evaluation.issues.length === 0) {
    console.log("No high-signal instruction gaps detected.");
    return;
  }
  for (const current of evaluation.issues) {
    console.log(`- [${current.severity}] ${current.message}`);
    console.log(`  ${current.recommendation}`);
  }
  console.log("\nSuggested task contract:\n");
  console.log(evaluation.suggestedPrompt);
}

function stateSummary(state) {
  const byCategory = Object.create(null);
  for (const current of state.incidents) {
    byCategory[current.category] = (byCategory[current.category] ?? 0) + 1;
  }
  return {
    sessionAlias: state.sessionAlias,
    platform: state.platform,
    workspaceAlias: state.workspaceAlias,
    updatedAt: state.updatedAt,
    progressVersion: state.progressVersion,
    promptScore: state.prompt?.score ?? null,
    incidentCount: state.incidents.length,
    incidentsByCategory: byCategory,
    recentIncidents: state.incidents.slice(-10).map((current) => ({
      at: current.at,
      ruleId: current.ruleId,
      category: current.category,
      severity: current.severity,
      evidence: current.evidence,
    })),
  };
}

function usage() {
  return `AWF — Agent Waste Firewall

Usage:
  agent-waste-firewall --version
  agent-waste-firewall check-prompt <prompt> [--json]
  agent-waste-firewall hook
  agent-waste-firewall record start --workspace <path> --label <safe-label> [--mode observe|warn|block] [--json]
  agent-waste-firewall record status [--json]
  agent-waste-firewall record stop [--json]
  agent-waste-firewall dashboard [trace-id] [--port 4319]
  agent-waste-firewall trace list [--json]
  agent-waste-firewall trace audit <trace-id> [--json]
  agent-waste-firewall trace export <trace-id> --output <trace.jsonl> [--json]
  agent-waste-firewall replay <events.jsonl> [--mode observe|warn|block] [--json]
  agent-waste-firewall report [--json]
  agent-waste-firewall purge [--all] [--json]
  agent-waste-firewall doctor [--json]

Modes:
  AGENT_WASTE_FIREWALL_MODE=observe  record only
  AGENT_WASTE_FIREWALL_MODE=warn     record and add concise context (default)
  AGENT_WASTE_FIREWALL_MODE=block    block only high-confidence repeats
`;
}

async function commandCheckPrompt(args) {
  const json = args.includes("--json");
  const prompt = args.filter((item) => item !== "--json").join(" ").trim();
  if (!prompt) {
    throw new Error("check-prompt requires prompt text.");
  }
  const evaluation = evaluatePrompt(prompt, { cwd: process.cwd() });
  if (json) {
    console.log(JSON.stringify(evaluation, null, 2));
  } else {
    printPromptEvaluation(evaluation);
  }
}

function replayMode(args, env) {
  const mode = argumentValue(args, "--mode") ?? env.AGENT_WASTE_FIREWALL_MODE ?? "warn";
  if (!["observe", "warn", "block"].includes(mode)) {
    throw new Error("Replay mode must be observe, warn, or block.");
  }
  return mode;
}

function legacyAction(output, incident, mode) {
  if (
    output?.decision === "block" ||
    output?.hookSpecificOutput?.permissionDecision === "deny"
  ) {
    return "block";
  }
  if (incident && mode === "observe") return "observe";
  if (incident?.shouldNotify !== false && Object.keys(output ?? {}).length > 0) {
    return "warn";
  }
  return "allow";
}

function safeLegacyIncident(incident) {
  if (!incident) return null;
  return {
    ruleId: incident.ruleId,
    attribution: incident.category,
    severity: incident.severity,
    confidence: incident.confidence,
    repeatCount: incident.occurrences ?? 1,
    blockable: incident.blockable === true,
    notified: incident.shouldNotify !== false,
  };
}

function replayStateSummary(state) {
  return {
    platform: state.platform,
    progressVersion: state.progressVersion,
    promptScore: state.prompt?.score ?? null,
    incidentCount: state.incidents.length,
    recentIncidents: state.incidents.slice(-10).map((incident) => ({
      ruleId: incident.ruleId,
      category: incident.category,
      severity: incident.severity,
    })),
  };
}

async function commandReplay(args, baseEnv = process.env) {
  const json = args.includes("--json");
  const filename = positionalArguments(args, ["--mode"])[0];
  if (!filename) {
    throw new Error("replay requires a JSONL fixture path.");
  }
  const mode = replayMode(args, baseEnv);
  const lines = fs
    .readFileSync(path.resolve(filename), "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"));
  const parsedEvents = lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON on replay line ${index + 1}.`);
    }
  });

  if (parsedEvents[0]?.v === 1 && typeof parsedEvents[0]?.kind === "string") {
    const result = {
      sourceKind: "semantic_trace",
      ...replaySemanticEvents(parsedEvents, {
        mode,
        promptBlockScore: configFromEnv({
          ...baseEnv,
          AGENT_WASTE_FIREWALL_MODE: mode,
        }).promptBlockScore,
      }),
    };
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Replayed ${result.eventCount} anonymized semantic events.`);
      console.log(
        `Mode ${result.mode}: warn=${result.actionCounts.warn}, block=${result.actionCounts.block}, drift=${result.driftCount}.`,
      );
      for (const decision of result.decisions) {
        console.log(
          `- event ${decision.seq}: ${decision.ruleId} (${decision.attribution}) → ${decision.simulatedDecision}`,
        );
      }
    }
    return;
  }

  const replayDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-waste-firewall-replay-"));
  const env = {
    ...baseEnv,
    AGENT_WASTE_FIREWALL_DATA_DIR: replayDir,
    AGENT_WASTE_FIREWALL_MODE: mode,
  };
  const config = configFromEnv(env);
  const store = new StateStore({ root: config.dataDir });
  try {
    const decisions = [];

    for (const [index, payload] of parsedEvents.entries()) {
      const result = handleHook(payload, { env, config, store });
      if (
        Object.keys(result.output).length > 0 ||
        (result.incident && result.incident.shouldNotify !== false)
      ) {
        decisions.push({
          line: index + 1,
          event: payload.hook_event_name,
          incident: safeLegacyIncident(result.incident),
          action: legacyAction(result.output, result.incident, mode),
        });
      }
    }

    const result = {
      sourceKind: "synthetic_hook_fixture",
      mode,
      eventCount: lines.length,
      decisionCount: decisions.length,
      decisions,
      sessions: store.listStates().map(replayStateSummary),
    };

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Replayed ${result.eventCount} events.`);
      console.log(`Detected ${result.decisionCount} warning or intervention points.`);
      for (const decision of decisions) {
        if (decision.incident) {
          console.log(
            `- line ${decision.line}: ${decision.incident.ruleId} (${decision.incident.attribution})`,
          );
        }
      }
    }
  } finally {
    fs.rmSync(replayDir, { recursive: true, force: true });
  }
}

function printResult(value, json, lines) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  for (const line of lines(value)) {
    console.log(line);
  }
}

async function commandRecord(args, env = process.env) {
  const config = configFromEnv(env);
  const store = new TraceStore({ root: config.dataDir, env });
  const json = args.includes("--json");
  const [action] = positionalArguments(args, [
    "--workspace",
    "--label",
    "--mode",
  ]);

  if (action === "start") {
    store.purgeExpired(config.retentionDays);
    const result = store.start({
      workspace: argumentValue(args, "--workspace") ?? process.cwd(),
      label: argumentValue(args, "--label") ?? "recording",
      mode: argumentValue(args, "--mode") ?? "observe",
    });
    printResult(result, json, (current) => [
      `Started ${current.traceId} (${current.label}) in ${current.mode} mode.`,
      "Only anonymized semantic events will be written.",
    ]);
    return;
  }

  if (action === "status") {
    const result = store.status();
    if (!result) {
      printResult(null, json, () => ["No trace recording is active."]);
      return;
    }
    printResult(result, json, (current) => [
      `${current.traceId}  ${current.status}  mode=${current.mode}  events=${current.eventCount}  incidents=${current.incidentCount}`,
    ]);
    return;
  }

  if (action === "stop") {
    const result = store.stop();
    printResult(result, json, (current) => [
      `Stopped ${current.traceId}.`,
      `Recorded ${current.eventCount} semantic event(s) and ${current.incidentCount} incident(s).`,
    ]);
    return;
  }

  throw new Error("record requires start, status, or stop.");
}

async function commandTrace(args, env = process.env) {
  const config = configFromEnv(env);
  const store = new TraceStore({ root: config.dataDir, env });
  const json = args.includes("--json");
  const positional = positionalArguments(args, ["--output"]);
  const [action, traceId] = positional;

  if (action === "list") {
    const result = store.list();
    printResult(result, json, (items) =>
      items.length === 0
        ? ["No local anonymized traces found."]
        : items.map(
            (current) =>
              `${current.traceId}  ${current.status}  ${current.label}  events=${current.eventCount}`,
          ),
    );
    return;
  }

  if (action === "audit") {
    if (!traceId) throw new Error("trace audit requires a trace id.");
    const result = store.audit(traceId);
    printResult(result, json, (current) => [
      current.ok
        ? `PASS  ${current.eventCount} event(s); no unsafe fields detected.`
        : `FAIL  ${current.findings.length} privacy or schema finding(s).`,
      ...current.findings.slice(0, 10).map(
        (finding) =>
          `  line=${finding.line ?? 0} field=${finding.field ?? "unknown"} category=${finding.category ?? finding.code}`,
      ),
    ]);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (action === "export") {
    if (!traceId) throw new Error("trace export requires a trace id.");
    const destination = argumentValue(args, "--output");
    if (!destination) throw new Error("trace export requires --output <file>.");
    const result = store.export(traceId, destination);
    printResult(result, json, (current) => [
      `Exported ${current.eventCount} audited semantic event(s).`,
      `Output: ${current.output}`,
    ]);
    return;
  }

  throw new Error("trace requires list, audit, or export.");
}

async function commandDashboard(args, env = process.env) {
  const { startDashboard } = await import("./dashboard-server.mjs");
  const config = configFromEnv(env);
  const traceId = positionalArguments(args, ["--port"])[0] ?? null;
  const dashboard = await startDashboard({
    root: config.dataDir,
    traceId,
    port: argumentValue(args, "--port") ?? 4319,
    env,
  });
  console.log(`AWF dashboard: ${dashboard.url}`);
  console.log("Press Ctrl-C to stop the local dashboard.");

  await new Promise((resolve) => {
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      process.removeListener("SIGINT", close);
      process.removeListener("SIGTERM", close);
      await dashboard.close();
      resolve();
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}

async function commandReport(args, env = process.env) {
  const config = configFromEnv(env);
  const store = new StateStore({ root: config.dataDir });
  const summaries = store.listStates().map(stateSummary);
  if (args.includes("--json")) {
    console.log(JSON.stringify(summaries, null, 2));
    return;
  }
  if (summaries.length === 0) {
    console.log("No local AWF sessions found.");
    return;
  }
  for (const summary of summaries) {
    console.log(
      `${summary.updatedAt}  ${summary.platform}  ${summary.workspaceAlias}  incidents=${summary.incidentCount}`,
    );
    for (const current of summary.recentIncidents.slice(-3)) {
      console.log(`  - ${current.ruleId}`);
    }
  }
}

async function commandDoctor(args, env = process.env) {
  const config = configFromEnv(env);
  const requiredFiles = [
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    "hooks/hooks.json",
    "hooks/claude-hooks.json",
    "scripts/hook.mjs",
    "src/live-event-schema.mjs",
    "src/live-event-projection.mjs",
    "src/live-event-store.mjs",
    "src/trace-schema.mjs",
    "src/trace-store.mjs",
    "src/semantic-replay.mjs",
    "src/dashboard-server.mjs",
    "src/dashboard-trace-cursor.mjs",
    "src/dashboard-assets.mjs",
  ];
  const checks = requiredFiles.map((relativePath) => ({
    check: relativePath,
    ok: fs.existsSync(path.join(PROJECT_ROOT, relativePath)),
  }));
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const probe = path.join(config.dataDir, `.doctor-${process.pid}`);
  try {
    fs.writeFileSync(probe, "ok", { mode: 0o600 });
    fs.unlinkSync(probe);
    checks.push({ check: "local data directory is writable", ok: true });
  } catch (error) {
    checks.push({
      check: "local data directory is writable",
      ok: false,
      detail: error.message,
    });
  }
  try {
    const liveStatus = new LiveEventStore({
      root: config.dataDir,
      env,
      maxEvents: config.liveMaxEvents,
      maxBytes: config.liveMaxBytes,
      maxAgeMs: config.liveMaxAgeMinutes * 60 * 1000,
    }).status();
    checks.push({
      check: "bounded live spool is ready",
      ok: liveStatus?.v === 1,
    });
  } catch {
    checks.push({
      check: "bounded live spool is ready",
      ok: false,
    });
  }
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  checks.push({ check: "Node.js >= 18", ok: major >= 18, detail: process.version });
  const result = {
    ok: checks.every((current) => current.ok),
    mode: config.mode,
    dataDir: config.dataDir,
    checks,
  };
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const current of checks) {
      console.log(`${current.ok ? "PASS" : "FAIL"}  ${current.check}${current.detail ? ` (${current.detail})` : ""}`);
    }
    console.log(`Mode: ${config.mode}`);
    console.log(`Data: ${config.dataDir}`);
  }
  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function commandPurge(args, env = process.env) {
  const config = configFromEnv(env);
  const store = new StateStore({ root: config.dataDir });
  const traceStore = new TraceStore({ root: config.dataDir, env });
  const liveStore = new LiveEventStore({
    root: config.dataDir,
    env,
    maxEvents: config.liveMaxEvents,
    maxBytes: config.liveMaxBytes,
    maxAgeMs: config.liveMaxAgeMinutes * 60 * 1000,
  });
  const all = args.includes("--all");
  const details = all
    ? store.purgeAll()
    : store.purgeExpired(config.retentionDays);
  const traceDetails = all
    ? traceStore.purgeAll()
    : traceStore.purgeExpired(config.retentionDays);
  const liveDetails = all
    ? liveStore.purge()
    : { liveSpoolRemoved: false };
  const result = {
    ...details,
    ...traceDetails,
    ...liveDetails,
    scope: all ? "all" : `older-than-${config.retentionDays}-days`,
  };
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `Removed ${result.stateFilesRemoved} state file(s) and ${result.temporaryFilesRemoved} orphan temporary file(s) (${result.scope}).`,
    );
    console.log(
      `Removed ${result.traceDirectoriesRemoved} anonymized trace(s) and ${result.traceKeysRemoved} orphan trace key(s).`,
    );
    if (all) {
      console.log(
        result.liveSpoolRemoved
          ? "Removed the bounded live event spool."
          : "The live event spool was busy and was not removed.",
      );
    }
    if (result.activeFilesSkipped > 0) {
      console.log(
        `Skipped ${result.activeFilesSkipped} active file(s); run purge again after the coding-agent session stops.`,
      );
    }
    if (result.activeTracesSkipped > 0) {
      console.log("Skipped the active trace recording; stop it before purging.");
    }
  }
}

function failOpenMarker(env, suffix = "warning") {
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  const dataKey = hash(env.AGENT_WASTE_FIREWALL_DATA_DIR ?? "default").slice(0, 12);
  const directory = path.join(os.tmpdir(), `agent-waste-firewall-${uid}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (typeof uid === "number" && stat.uid !== uid)
  ) {
    throw new Error("Unsafe fail-open warning directory.");
  }
  return path.join(directory, `${dataKey}.${suffix}`);
}

function failOpenOutput(env = process.env) {
  const interval = 5 * 60 * 1000;
  let shouldWarn = true;
  try {
    const marker = failOpenMarker(env);
    if (fs.existsSync(marker)) {
      shouldWarn = Date.now() - fs.statSync(marker).mtimeMs >= interval;
    }
    if (shouldWarn) {
      fs.writeFileSync(marker, String(Date.now()), { mode: 0o600 });
    }
  } catch {
    // If rate limiting itself fails, warning once is safer than silent disablement.
  }
  return shouldWarn
    ? {
        systemMessage:
          "AWF failed open: this event was not checked. Run `agent-waste-firewall doctor`.",
      }
    : {};
}

function recorderWarningOutput(output, env = process.env) {
  const interval = 5 * 60 * 1000;
  let shouldWarn = true;
  try {
    const marker = failOpenMarker(env, "recorder-warning");
    if (fs.existsSync(marker)) {
      shouldWarn = Date.now() - fs.statSync(marker).mtimeMs >= interval;
    }
    if (shouldWarn) {
      fs.writeFileSync(marker, String(Date.now()), { mode: 0o600 });
    }
  } catch {
    // A local recorder warning is safer than silently claiming recording succeeded.
  }
  if (!shouldWarn) return output;
  const message =
    "AWF explicit trace recording failed for this event; the guard decision still applied. Run `agent-waste-firewall doctor`.";
  return {
    ...output,
    systemMessage: output.systemMessage
      ? `${output.systemMessage}\n${message}`
      : message,
  };
}

function warnLiveSpoolFailure(env = process.env) {
  const interval = 5 * 60 * 1000;
  let shouldWarn = true;
  try {
    const marker = failOpenMarker(env, "live-spool-warning");
    if (fs.existsSync(marker)) {
      shouldWarn = Date.now() - fs.statSync(marker).mtimeMs >= interval;
    }
    if (shouldWarn) {
      fs.writeFileSync(marker, String(Date.now()), { mode: 0o600 });
    }
  } catch {
    // The live spool is optional presentation transport; the guard still runs.
  }
  if (shouldWarn) {
    process.stderr.write(
      "AWF live monitor degraded: one semantic presentation event was dropped. The guard decision still applied.\n",
    );
  }
}

export async function runHookStdio(options = {}) {
  try {
    const input = await readStdin();
    const payload = JSON.parse(input);
    const env = options.env ?? process.env;
    const baseConfig = {
      ...configFromEnv(env),
      ...(options.config ?? {}),
    };
    const traceStore =
      options.traceStore ?? new TraceStore({ root: baseConfig.dataDir, env });
    const liveStore =
      options.liveStore ??
      new LiveEventStore({
        root: baseConfig.dataDir,
        env,
        maxEvents: baseConfig.liveMaxEvents,
        maxBytes: baseConfig.liveMaxBytes,
        maxAgeMs: baseConfig.liveMaxAgeMinutes * 60 * 1000,
      });
    let config = baseConfig;
    let recorderFailed = false;
    try {
      const active = traceStore.activeFor(payload.cwd ?? process.cwd());
      if (active?.metadata?.mode) {
        config = { ...baseConfig, mode: active.metadata.mode };
      }
    } catch {
      recorderFailed = true;
    }

    const decisionStartedAt = performance.now();
    const result = handleHook(payload, {
      ...options,
      env,
      config,
    });
    const decisionLatencyMs = performance.now() - decisionStartedAt;
    try {
      const publication = liveStore.publish(payload, result, config, {
        decisionLatencyMs,
      });
      if (
        publication?.published === false &&
        publication.reason !== "unsupported"
      ) {
        warnLiveSpoolFailure(env);
      }
    } catch {
      warnLiveSpoolFailure(env);
    }
    try {
      traceStore.appendHook(payload, result, config);
    } catch {
      recorderFailed = true;
    }
    const output = recorderFailed
      ? recorderWarningOutput(result.output, env)
      : result.output;
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch (error) {
    if (process.env.AGENT_WASTE_FIREWALL_DEBUG === "1") {
      process.stderr.write(`AWF hook failed open: ${error.stack ?? error}\n`);
    }
    process.stdout.write(`${JSON.stringify(failOpenOutput(options.env))}\n`);
  }
}

export async function main(args, options = {}) {
  const [command, ...rest] = args;
  try {
    if (!command || command === "help" || command === "--help" || command === "-h") {
      console.log(usage());
    } else if (command === "--version" || command === "-V") {
      console.log(VERSION);
    } else if (command === "check-prompt") {
      await commandCheckPrompt(rest);
    } else if (command === "hook") {
      await runHookStdio(options);
    } else if (command === "record") {
      await commandRecord(rest, options.env);
    } else if (command === "dashboard" || command === "monitor") {
      await commandDashboard(rest, options.env);
    } else if (command === "trace") {
      await commandTrace(rest, options.env);
    } else if (command === "replay") {
      await commandReplay(rest, options.env);
    } else if (command === "report") {
      await commandReport(rest, options.env);
    } else if (command === "purge") {
      await commandPurge(rest, options.env);
    } else if (command === "doctor") {
      await commandDoctor(rest, options.env);
    } else {
      throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

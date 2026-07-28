#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { startDashboard } from "../src/dashboard-server.mjs";
import { serializeTraceEvent } from "../src/trace-schema.mjs";
import { TraceStore } from "../src/trace-store.mjs";

function integerArgument(name, fallback, maximum) {
  const index = process.argv.indexOf(name);
  const raw = index >= 0 ? process.argv[index + 1] : fallback;
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}.`);
  }
  return value;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function sessionAlias(index) {
  return `session_${index.toString(16).padStart(32, "0")}`;
}

function stopEvent(seq, sessionCount) {
  return {
    v: 1,
    seq,
    elapsedMs: seq,
    kind: "stop",
    platform: seq % 2 === 0 ? "claude" : "codex",
    sessionAlias: sessionAlias(seq % sessionCount),
    decision: "allow",
    progressVersion: Math.floor((seq - 1) / sessionCount),
  };
}

function updateMetadata(store, traceId, eventCount) {
  const filename = store.metadataPath(traceId);
  const metadata = JSON.parse(fs.readFileSync(filename, "utf8"));
  metadata.eventCount = eventCount;
  metadata.lastElapsedMs = eventCount;
  fs.writeFileSync(filename, `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

const eventCount = integerArgument("--events", 15_000, 250_000);
const requestCount = integerArgument("--requests", 100, 10_000);
const sessionCount = integerArgument("--sessions", 16, 1_000);
const p95LimitMs = integerArgument("--p95-ms", 100, 60_000);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "awf-dashboard-benchmark-"));
const workspace = path.join(root, "workspace");
const dataDir = path.join(root, "data");
fs.mkdirSync(workspace, { mode: 0o700 });
fs.mkdirSync(path.join(workspace, ".git"), { mode: 0o700 });

const env = {
  AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
  AGENT_WASTE_FIREWALL_MODE: "observe",
  AGENT_WASTE_FIREWALL_PLATFORM: "codex",
};
const store = new TraceStore({ root: dataDir, env });
const started = store.start({
  workspace,
  label: "dashboard-benchmark",
  mode: "observe",
});
const traceText = Array.from({ length: eventCount }, (_, index) =>
  serializeTraceEvent(stopEvent(index + 1, sessionCount)),
).join("");
fs.writeFileSync(store.eventsPath(started.traceId), traceText, {
  encoding: "utf8",
  mode: 0o600,
});
updateMetadata(store, started.traceId, eventCount);

let dashboard;
try {
  const startupStartedAt = performance.now();
  dashboard = await startDashboard({
    store,
    port: 0,
    token: "b".repeat(48),
  });
  const startupMs = performance.now() - startupStartedAt;
  const statusUrl = `http://127.0.0.1:${dashboard.port}/api/status?token=${dashboard.token}`;

  const warmup = await fetch(statusUrl);
  if (!warmup.ok) {
    throw new Error(`Dashboard warmup failed with HTTP ${warmup.status}.`);
  }
  await warmup.arrayBuffer();

  const latencies = [];
  for (let index = 0; index < requestCount; index += 1) {
    const startedAt = performance.now();
    const response = await fetch(statusUrl);
    if (!response.ok) {
      throw new Error(`Dashboard request failed with HTTP ${response.status}.`);
    }
    await response.arrayBuffer();
    latencies.push(performance.now() - startedAt);
  }

  const appendedSeq = eventCount + 1;
  fs.appendFileSync(
    store.eventsPath(started.traceId),
    serializeTraceEvent(stopEvent(appendedSeq, sessionCount)),
    "utf8",
  );
  updateMetadata(store, started.traceId, appendedSeq);
  const appendStartedAt = performance.now();
  const appendedResponse = await fetch(statusUrl);
  const appendedStatus = await appendedResponse.json();
  const appendVisibleMs = performance.now() - appendStartedAt;
  if (!appendedResponse.ok || appendedStatus.lastSequence !== appendedSeq) {
    throw new Error("The incrementally appended event was not visible.");
  }

  const p95 = percentile(latencies, 0.95);
  const p95WithinLimit = p95 < p95LimitMs;
  console.log(
    JSON.stringify(
      {
        eventCount,
        requestCount,
        sessionCount,
        p95LimitMs,
        startupMs,
        statusMs: {
          p50: percentile(latencies, 0.5),
          p95,
          p99: percentile(latencies, 0.99),
          maximum: Math.max(...latencies),
        },
        appendVisibleMs,
        lastSequence: appendedStatus.lastSequence,
        p95WithinLimit,
      },
      null,
      2,
    ),
  );
  if (!p95WithinLimit) {
    process.exitCode = 1;
  }
} finally {
  if (dashboard) {
    await dashboard.close();
  }
  fs.rmSync(root, { recursive: true, force: true });
}

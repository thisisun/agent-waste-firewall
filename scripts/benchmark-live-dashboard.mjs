#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { startDashboard } from "../src/dashboard-server.mjs";
import { LiveEventStore } from "../src/live-event-store.mjs";

function integerArgument(name, fallback, minimum, maximum) {
  const index = process.argv.indexOf(name);
  const raw = index >= 0 ? process.argv[index + 1] : fallback;
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return value;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function payload(workspace) {
  return {
    hook_event_name: "PreToolUse",
    session_id: "synthetic-live-dashboard-session",
    cwd: workspace,
    tool_name: "Bash",
  };
}

function result() {
  return {
    output: {},
    incident: null,
    tool: {
      family: "shell",
      operation: "inspect",
      failed: false,
      interrupted: false,
    },
    observed: {
      progressVersion: 0,
      madeProgress: false,
    },
  };
}

async function readUntil(reader, marker, timeoutMs = 5000) {
  const decoder = new TextDecoder();
  const startedAt = performance.now();
  let text = "";
  while (!text.includes(marker)) {
    if (performance.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for the live dashboard stream.");
    }
    const current = await reader.read();
    if (current.done) break;
    text += decoder.decode(current.value, { stream: true });
  }
  return text;
}

const eventLimit = integerArgument("--events", 4096, 2, 4096);
const requestCount = integerArgument("--requests", 100, 1, 10_000);
const publishCount = integerArgument("--publishes", 100, 1, 1000);
const p95LimitMs = integerArgument("--p95-ms", 100, 1, 60_000);
const coldLimitMs = integerArgument("--cold-ms", 1000, 1, 60_000);
const rotationLimitMs = integerArgument(
  "--rotation-ms",
  1000,
  1,
  60_000,
);
const root = fs.mkdtempSync(
  path.join(os.tmpdir(), "awf-live-dashboard-benchmark-"),
);
const workspace = path.join(root, "workspace");
const dataDir = path.join(root, "data");
fs.mkdirSync(workspace, { mode: 0o700 });
fs.mkdirSync(path.join(workspace, ".git"), { mode: 0o700 });
const store = new LiveEventStore({
  root: dataDir,
  maxEvents: eventLimit,
});
const safePayload = payload(workspace);
const safeResult = result();
let dashboard;
let streamReader;

try {
  for (let index = 0; index < eventLimit; index += 1) {
    const publication = store.publish(
      safePayload,
      safeResult,
      { mode: "observe" },
    );
    if (!publication.published) {
      throw new Error("Failed to saturate the live dashboard fixture.");
    }
  }

  const startupStartedAt = performance.now();
  dashboard = await startDashboard({
    source: "live",
    store,
    port: 0,
    token: "9".repeat(48),
  });
  const coldAuditMs = performance.now() - startupStartedAt;
  const statusUrl =
    `http://127.0.0.1:${dashboard.port}` +
    `/api/status?token=${dashboard.token}`;
  const eventUrl =
    `http://127.0.0.1:${dashboard.port}` +
    `/events?token=${dashboard.token}`;

  const statusLatencies = [];
  for (let index = 0; index < requestCount; index += 1) {
    const startedAt = performance.now();
    const response = await fetch(statusUrl);
    if (!response.ok) {
      throw new Error(`Dashboard status failed with HTTP ${response.status}.`);
    }
    await response.arrayBuffer();
    statusLatencies.push(performance.now() - startedAt);
  }

  const beforeRotation = await fetch(statusUrl).then((response) =>
    response.json(),
  );
  const stream = await fetch(eventUrl);
  streamReader = stream.body.getReader();
  await readUntil(
    streamReader,
    `${beforeRotation.streamAlias}:${eventLimit}\n`,
  );

  const rotationStartedAt = performance.now();
  const rotated = store.publish(
    safePayload,
    safeResult,
    { mode: "observe" },
  );
  const rotationMs = performance.now() - rotationStartedAt;
  if (!rotated.published) {
    throw new Error("Live dashboard rotation publication was dropped.");
  }
  const current = store.readWindow();
  const visibilityStartedAt = performance.now();
  const resetText = await readUntil(
    streamReader,
    `${current.streamAlias}:${rotated.event.seq}\n`,
  );
  const rotationVisibleMs = performance.now() - visibilityStartedAt;
  if (!resetText.includes('"reset":true')) {
    throw new Error("Live dashboard rotation did not emit a reset.");
  }

  const publishLatencies = [];
  let droppedPublications = 0;
  for (let index = 0; index < publishCount; index += 1) {
    const startedAt = performance.now();
    const publication = store.publish(
      safePayload,
      safeResult,
      { mode: "observe" },
    );
    publishLatencies.push(performance.now() - startedAt);
    if (!publication.published) droppedPublications += 1;
  }
  const finalStatus = await fetch(statusUrl).then((response) =>
    response.json(),
  );

  const statusP95 = percentile(statusLatencies, 0.95);
  const publishP95 = percentile(publishLatencies, 0.95);
  const passed =
    coldAuditMs < coldLimitMs &&
    statusP95 < p95LimitMs &&
    publishP95 < p95LimitMs &&
    rotationMs < rotationLimitMs &&
    droppedPublications === 0 &&
    finalStatus.lastSequence === rotated.event.seq + publishCount;
  console.log(
    JSON.stringify(
      {
        eventLimit,
        requestCount,
        publishCount,
        limitsMs: {
          cold: coldLimitMs,
          p95: p95LimitMs,
          rotation: rotationLimitMs,
        },
        coldAuditMs,
        warmStatusMs: {
          p50: percentile(statusLatencies, 0.5),
          p95: statusP95,
          p99: percentile(statusLatencies, 0.99),
          maximum: Math.max(...statusLatencies),
        },
        concurrentPublishMs: {
          p50: percentile(publishLatencies, 0.5),
          p95: publishP95,
          p99: percentile(publishLatencies, 0.99),
          maximum: Math.max(...publishLatencies),
        },
        rotationMs,
        rotationVisibleMs,
        droppedPublications,
        lastSequence: finalStatus.lastSequence,
        passed,
      },
      null,
      2,
    ),
  );
  if (!passed) process.exitCode = 1;
} finally {
  if (streamReader) await streamReader.cancel();
  if (dashboard) await dashboard.close();
  fs.rmSync(root, { recursive: true, force: true });
}

#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { LiveEventStore } from "../src/live-event-store.mjs";
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

const sampleCount = integerArgument("--samples", 100, 10_000);
const warmupCount = integerArgument("--warmups", 10, 1_000);
const p95LimitMs = integerArgument("--p95-ms", 100, 60_000);
const activeSemanticTrace = !process.argv.includes("--no-trace");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "awf-hook-benchmark-"));
const workspace = path.join(root, "workspace");
const dataDir = path.join(root, "data");
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const launcher = path.join(projectRoot, "scripts", "hook-launcher.sh");
fs.mkdirSync(workspace, { mode: 0o700 });
fs.mkdirSync(path.join(workspace, ".git"), { mode: 0o700 });

const env = {
  ...process.env,
  HOME: path.join(root, "isolated-home"),
  PLUGIN_ROOT: projectRoot,
  AWF_NODE_PATH: process.execPath,
  AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
  AGENT_WASTE_FIREWALL_MODE: "observe",
  AGENT_WASTE_FIREWALL_PLATFORM: "codex",
};
const traceStore = new TraceStore({ root: dataDir, env });
if (activeSemanticTrace) {
  traceStore.start({
    workspace,
    label: "hook-benchmark",
    mode: "observe",
  });
}

function invokeHook(index) {
  const payload = {
    session_id: "synthetic-benchmark-session",
    cwd: workspace,
    hook_event_name: "PreToolUse",
    turn_id: "synthetic-benchmark-turn",
    tool_name: "Bash",
    tool_use_id: `synthetic-call-${index}`,
    tool_input: { command: "git status --short" },
  };
  const startedAt = performance.now();
  const result = spawnSync("/bin/sh", ["-p", launcher, projectRoot], {
    encoding: "utf8",
    env,
    input: JSON.stringify(payload),
  });
  const elapsedMs = performance.now() - startedAt;
  if (result.status !== 0) {
    throw new Error("Hook benchmark subprocess failed.");
  }
  try {
    JSON.parse(result.stdout);
  } catch {
    throw new Error("Hook benchmark subprocess returned invalid JSON.");
  }
  return elapsedMs;
}

try {
  for (let index = 0; index < warmupCount; index += 1) {
    invokeHook(index);
  }

  const latencies = [];
  for (let index = 0; index < sampleCount; index += 1) {
    latencies.push(invokeHook(warmupCount + index));
  }

  const p95 = percentile(latencies, 0.95);
  const p95WithinLimit = p95 < p95LimitMs;
  const liveStatus = new LiveEventStore({ root: dataDir, env }).status();
  const expectedEventCount = sampleCount + warmupCount;
  if (liveStatus?.committedSeq !== expectedEventCount) {
    throw new Error("Always-on live spool did not publish every benchmark event.");
  }
  const traceStatus = traceStore.status();
  if (
    activeSemanticTrace
      ? traceStatus?.eventCount !== expectedEventCount
      : traceStatus !== null
  ) {
    throw new Error(
      activeSemanticTrace
        ? "Explicit trace did not record every benchmark event."
        : "No-trace benchmark unexpectedly created an explicit trace.",
    );
  }
  console.log(
    JSON.stringify(
      {
        sampleCount,
        warmupCount,
        executionPath: "external_node_launcher",
        nativeHelperIncluded: false,
        providerShellIncluded: false,
        innerShellShimIncluded: true,
        activeSemanticTrace,
        traceEventCount: traceStatus?.eventCount ?? 0,
        alwaysOnLiveSpool: true,
        liveCommittedSequence: liveStatus.committedSeq,
        liveRetainedEventCount: liveStatus.eventCount,
        p95LimitMs,
        latencyMs: {
          p50: percentile(latencies, 0.5),
          p95,
          p99: percentile(latencies, 0.99),
          maximum: Math.max(...latencies),
        },
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
  fs.rmSync(root, { recursive: true, force: true });
}

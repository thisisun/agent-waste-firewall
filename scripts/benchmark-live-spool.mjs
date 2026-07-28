#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

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

const eventLimit = integerArgument("--events", 4096, 2, 4096);
const p95LimitMs = integerArgument("--p95-ms", 100, 1, 60_000);
const rotationLimitMs = integerArgument(
  "--rotation-ms",
  1000,
  1,
  60_000,
);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "awf-live-benchmark-"));
const workspace = path.join(root, "workspace");
const store = new LiveEventStore({
  root: path.join(root, "data"),
  maxEvents: eventLimit,
});
fs.mkdirSync(workspace, { mode: 0o700 });
fs.mkdirSync(path.join(workspace, ".git"), { mode: 0o700 });

const payload = {
  hook_event_name: "PreToolUse",
  session_id: "synthetic-live-benchmark-session",
  cwd: workspace,
};
const result = {
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

try {
  const publishLatencies = [];
  for (let index = 0; index < eventLimit; index += 1) {
    const startedAt = performance.now();
    const publication = store.publish(payload, result, { mode: "observe" });
    publishLatencies.push(performance.now() - startedAt);
    if (!publication.published) {
      throw new Error("Live spool benchmark publication failed.");
    }
  }

  const rotationStartedAt = performance.now();
  const rotated = store.publish(payload, result, { mode: "observe" });
  const rotationMs = performance.now() - rotationStartedAt;
  if (!rotated.published || rotated.generation !== 2) {
    throw new Error("Live spool benchmark did not rotate.");
  }

  const p95 = percentile(publishLatencies, 0.95);
  const p95WithinLimit = p95 < p95LimitMs;
  const rotationWithinLimit = rotationMs < rotationLimitMs;
  console.log(
    JSON.stringify(
      {
        eventLimit,
        p95LimitMs,
        rotationLimitMs,
        publishMs: {
          p50: percentile(publishLatencies, 0.5),
          p95,
          p99: percentile(publishLatencies, 0.99),
          maximum: Math.max(...publishLatencies),
        },
        rotationMs,
        committedSequence: store.status()?.committedSeq,
        p95WithinLimit,
        rotationWithinLimit,
      },
      null,
      2,
    ),
  );
  if (!p95WithinLimit || !rotationWithinLimit) {
    process.exitCode = 1;
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

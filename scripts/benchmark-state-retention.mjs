import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { StateRetentionJanitor } from "../src/state-retention-janitor.mjs";
import { StateStore } from "../src/state-store.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 64;

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((percentileValue / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, index)];
}

function round(value) {
  return Number(value.toFixed(3));
}

function sessionKey(index) {
  const hex = index.toString(16);
  return `${hex.padStart(16, "0")}-${hex.padStart(10, "0")}`;
}

function measureHook(store, root) {
  const payload = {
    session_id: "state-retention-benchmark",
    cwd: root,
  };
  const config = {
    retentionDays: 30,
    maxToolEvents: 160,
    maxIncidents: 100,
  };
  const mutate = () => store.mutate(payload, config, () => null);
  for (let index = 0; index < 5; index += 1) mutate();
  const durations = [];
  for (let index = 0; index < 30; index += 1) {
    const startedAt = performance.now();
    mutate();
    durations.push(performance.now() - startedAt);
  }
  return {
    samples: durations.length,
    p50Ms: round(percentile(durations, 50)),
    p95Ms: round(percentile(durations, 95)),
    maxMs: round(Math.max(...durations)),
  };
}

function runCase(sessionCount) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), `awf-retention-${sessionCount}-`),
  );
  const sessions = path.join(root, "sessions");
  fs.mkdirSync(sessions, { mode: 0o700 });
  const now = Date.now();
  const expiredAt = new Date(now - 40 * DAY_MS);
  try {
    for (let index = 1; index <= sessionCount; index += 1) {
      const filename = path.join(
        sessions,
        `${sessionKey(index)}.json`,
      );
      fs.writeFileSync(filename, "{}\n", { mode: 0o600 });
      fs.utimesSync(filename, expiredAt, expiredAt);
    }

    const store = new StateStore({ root });
    const hook = measureHook(store, root);
    const janitor = new StateRetentionJanitor({
      store,
      retentionDays: 30,
      clock: () => now,
      maxEntriesPerTick: BATCH_SIZE,
      maxTickMs: 8,
    });
    const tickDurations = [];
    let removed = 0;
    let maxEntriesVisited = 0;
    let status = "progress";
    const startedAt = performance.now();
    for (
      let tickCount = 0;
      tickCount <= sessionCount + 2 && status !== "complete";
      tickCount += 1
    ) {
      const tickStartedAt = performance.now();
      const result = janitor.tick();
      tickDurations.push(performance.now() - tickStartedAt);
      status = result.status;
      removed += result.stateFilesRemoved;
      maxEntriesVisited = Math.max(
        maxEntriesVisited,
        result.entriesVisited,
      );
      assert.notEqual(status, "degraded");
      assert.ok(result.entriesVisited <= BATCH_SIZE);
    }
    janitor.close();
    assert.equal(status, "complete");
    assert.equal(removed, sessionCount);
    assert.ok(maxEntriesVisited <= BATCH_SIZE);
    return {
      sessionCount,
      hook,
      janitor: {
        batchSize: BATCH_SIZE,
        ticks: tickDurations.length,
        maxEntriesVisited,
        totalMs: round(performance.now() - startedAt),
        p50TickMs: round(percentile(tickDurations, 50)),
        p95TickMs: round(percentile(tickDurations, 95)),
        maxTickMs: round(Math.max(...tickDurations)),
        removed,
      },
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log(
  JSON.stringify(
    {
      v: 1,
      benchmark: "state_retention",
      cases: [runCase(1000), runCase(10_000)],
    },
    null,
    2,
  ),
);

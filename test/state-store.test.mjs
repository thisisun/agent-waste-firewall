import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { StateStore } from "../src/state-store.mjs";

test("removes expired state but preserves fresh and locked sessions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awf-retention-"));
  const sessions = path.join(root, "sessions");
  fs.mkdirSync(sessions);
  const old = path.join(sessions, "old.json");
  const locked = path.join(sessions, "locked.json");
  const fresh = path.join(sessions, "fresh.json");
  for (const filename of [old, locked, fresh]) {
    fs.writeFileSync(filename, "{}\n");
  }
  fs.mkdirSync(path.join(sessions, "locked.lock"));
  const staleDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  fs.utimesSync(old, staleDate, staleDate);
  fs.utimesSync(locked, staleDate, staleDate);

  const store = new StateStore({ root });
  assert.deepEqual(store.purgeExpired(30), {
    stateFilesRemoved: 1,
    temporaryFilesRemoved: 0,
    staleLocksRemoved: 0,
    activeFilesSkipped: 1,
  });
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(locked), true);
  assert.equal(fs.existsSync(fresh), true);
});

test("purgeAll removes only unlocked session state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awf-purge-"));
  const sessions = path.join(root, "sessions");
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(sessions, "one.json"), "{}\n");
  fs.writeFileSync(path.join(sessions, "two.json"), "{}\n");
  fs.mkdirSync(path.join(sessions, "two.lock"));

  const store = new StateStore({ root });
  assert.deepEqual(store.purgeAll(), {
    stateFilesRemoved: 1,
    temporaryFilesRemoved: 0,
    staleLocksRemoved: 0,
    activeFilesSkipped: 1,
  });
  assert.equal(fs.existsSync(path.join(sessions, "one.json")), false);
  assert.equal(fs.existsSync(path.join(sessions, "two.json")), true);
});

test("purgeAll removes stale locks and orphan atomic-write files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awf-stale-purge-"));
  const sessions = path.join(root, "sessions");
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(sessions, "stale.json"), "{}\n");
  fs.writeFileSync(path.join(sessions, "stale.json.123.abc.tmp"), "{}\n");
  const lock = path.join(sessions, "stale.lock");
  fs.mkdirSync(lock);
  const staleDate = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, staleDate, staleDate);

  const store = new StateStore({ root });
  assert.deepEqual(store.purgeAll(), {
    stateFilesRemoved: 1,
    temporaryFilesRemoved: 1,
    staleLocksRemoved: 1,
    activeFilesSkipped: 0,
  });
  assert.equal(fs.existsSync(lock), false);
  assert.deepEqual(fs.readdirSync(sessions), []);
});

test("scheduled retention avoids per-hook scans and preserves productive state", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-scheduled-retention-"),
  );
  const sessions = path.join(root, "sessions");
  let now = Date.now();
  let sweeps = 0;
  class CountingStateStore extends StateStore {
    purgeExpired(...arguments_) {
      sweeps += 1;
      return super.purgeExpired(...arguments_);
    }
  }
  const store = new CountingStateStore({
    root,
    maintenanceClock: () => now,
  });
  const payload = {
    session_id: "productive-session",
    cwd: root,
  };
  const config = {
    retentionDays: 30,
    maxToolEvents: 160,
    maxIncidents: 100,
  };
  const mutate = () => store.mutate(payload, config, () => ({}));

  mutate();
  assert.equal(sweeps, 1);

  const expired = path.join(sessions, "expired.json");
  const locked = path.join(sessions, "locked.json");
  fs.writeFileSync(expired, "{}\n");
  fs.writeFileSync(locked, "{}\n");
  fs.mkdirSync(path.join(sessions, "locked.lock"));
  const staleDate = new Date(now - 40 * 24 * 60 * 60 * 1000);
  fs.utimesSync(expired, staleDate, staleDate);
  fs.utimesSync(locked, staleDate, staleDate);

  now += 30 * 60 * 1000;
  mutate();
  assert.equal(sweeps, 1);
  assert.equal(fs.existsSync(expired), true);

  now += 31 * 60 * 1000;
  const activeLockDate = new Date(now);
  fs.utimesSync(
    path.join(sessions, "locked.lock"),
    activeLockDate,
    activeLockDate,
  );
  mutate();
  assert.equal(sweeps, 2);
  assert.equal(fs.existsSync(expired), false);
  assert.equal(fs.existsSync(locked), true);
  assert.equal(
    fs.readdirSync(sessions).some((name) => name.endsWith(".json")),
    true,
  );

  fs.rmSync(root, { recursive: true, force: true });
});

test("retention maintenance corruption cannot disable state mutation", (context) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-retention-fail-open-"),
  );
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "state-maintenance-v1.json"));
  const store = new StateStore({ root });
  const payload = {
    session_id: "productive-maintenance-counterexample",
    cwd: root,
  };
  const config = {
    retentionDays: 30,
    maxToolEvents: 160,
    maxIncidents: 100,
  };

  for (const expectedStops of [1, 2]) {
    const result = store.mutate(payload, config, (state) => {
      state.counters.stops += 1;
      return state.counters.stops;
    });
    assert.equal(result, expectedStops);
  }

  assert.equal(store.listStates().length, 1);
  assert.equal(store.listStates()[0].counters.stops, 2);
});

test("concurrent maintenance clock skew does not trigger a duplicate sweep", (context) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-retention-clock-skew-"),
  );
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const capturedNow = Date.now();
  const payload = {
    session_id: "maintenance-clock-skew",
    cwd: root,
  };
  const config = {
    retentionDays: 30,
    maxToolEvents: 160,
    maxIncidents: 100,
  };
  new StateStore({
    root,
    maintenanceClock: () => capturedNow + 500,
  }).mutate(payload, config, () => null);

  let duplicateSweeps = 0;
  class CountingStateStore extends StateStore {
    purgeExpired(...arguments_) {
      duplicateSweeps += 1;
      return super.purgeExpired(...arguments_);
    }
  }
  new CountingStateStore({
    root,
    maintenanceClock: () => capturedNow,
  }).mutate(payload, config, () => null);

  assert.equal(duplicateSweeps, 0);
});

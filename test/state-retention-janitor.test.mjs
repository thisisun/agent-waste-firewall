import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { StateRetentionJanitor } from "../src/state-retention-janitor.mjs";
import { StateStore } from "../src/state-store.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAINTENANCE_MARKER = "state-maintenance-v1.json";
const MAINTENANCE_LOCK = "state-maintenance-v1.lock";

function sessionKey(index) {
  const hex = index.toString(16);
  return `${hex.padStart(16, "0")}-${hex.padStart(10, "0")}`;
}

function setup(context, prefix = "awf-state-janitor-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const sessions = path.join(root, "sessions");
  fs.mkdirSync(sessions, { mode: 0o700 });
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, sessions };
}

function writePrivateFile(filename, contents = "{}\n") {
  fs.writeFileSync(filename, contents, { mode: 0o600 });
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
}

function writeState(sessions, index, modifiedAt) {
  const filename = path.join(sessions, `${sessionKey(index)}.json`);
  writePrivateFile(filename);
  fs.utimesSync(filename, modifiedAt, modifiedAt);
  return filename;
}

function writeTemporary(sessions, index, modifiedAt) {
  const filename = path.join(
    sessions,
    `${sessionKey(index)}.json.${process.pid}.deadbeef.tmp`,
  );
  writePrivateFile(filename);
  fs.utimesSync(filename, modifiedAt, modifiedAt);
  return filename;
}

function aggregate(results, field) {
  return results.reduce((sum, result) => sum + result[field], 0);
}

function runToCompletion(janitor, maximumTicks = 100) {
  const results = [];
  for (let index = 0; index < maximumTicks; index += 1) {
    const result = janitor.tick();
    results.push(result);
    if (result.status === "complete") return results;
    assert.equal(result.status, "progress");
  }
  assert.fail(`state retention did not reach EOF within ${maximumTicks} ticks`);
}

test("bounds each tick and eventually reaches EOF without deleting productive entries", (context) => {
  const { root, sessions } = setup(context);
  const now = Date.now();
  const expiredAt = new Date(now - 40 * DAY_MS);
  const freshAt = new Date(now);
  const expiredOne = writeState(sessions, 1, expiredAt);
  const expiredTwo = writeState(sessions, 2, expiredAt);
  const fresh = writeState(sessions, 3, freshAt);
  const active = writeState(sessions, 4, expiredAt);
  const temporary = writeTemporary(sessions, 5, expiredAt);
  const unknown = path.join(sessions, "unknown-control.json");
  writePrivateFile(unknown, "keep\n");
  const activeLock = path.join(sessions, `${sessionKey(4)}.lock`);
  fs.mkdirSync(activeLock, { mode: 0o700 });
  fs.utimesSync(activeLock, expiredAt, expiredAt);

  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  assert.equal(fs.statSync(sessions).mode & 0o777, 0o700);
  assert.equal(fs.statSync(activeLock).mode & 0o777, 0o700);

  const janitor = new StateRetentionJanitor({
    root,
    clock: () => now,
    monotonicClock: () => 0,
    maxEntriesPerTick: 2,
    maxTickMs: 8,
  });
  const results = runToCompletion(janitor);

  assert.ok(results.length > 1);
  assert.equal(
    results.every((result) => result.entriesVisited <= 2),
    true,
  );
  assert.equal(aggregate(results, "stateFilesRemoved"), 2);
  assert.equal(aggregate(results, "temporaryFilesRemoved"), 1);
  assert.equal(aggregate(results, "activeFilesSkipped"), 1);
  assert.equal(aggregate(results, "staleLocksRemoved"), 0);
  assert.equal(fs.existsSync(expiredOne), false);
  assert.equal(fs.existsSync(expiredTwo), false);
  assert.equal(fs.existsSync(temporary), false);
  assert.equal(fs.existsSync(fresh), true);
  assert.equal(fs.existsSync(active), true);
  assert.equal(fs.existsSync(activeLock), true);
  assert.equal(fs.readFileSync(unknown, "utf8"), "keep\n");

  const marker = path.join(root, MAINTENANCE_MARKER);
  assert.equal(
    fs.readFileSync(marker, "utf8"),
    `{"v":1,"nextSweepAt":${now + 60 * 60 * 1000}}\n`,
  );
  assert.equal(fs.statSync(marker).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(path.join(root, MAINTENANCE_LOCK)), false);
});

test("honors the monotonic tick deadline before the entry batch is exhausted", (context) => {
  const { root, sessions } = setup(context);
  const now = Date.now();
  const expiredAt = new Date(now - 40 * DAY_MS);
  for (let index = 1; index <= 4; index += 1) {
    writeState(sessions, index, expiredAt);
  }
  let monotonic = 0;
  const janitor = new StateRetentionJanitor({
    root,
    clock: () => now,
    monotonicClock: () => {
      monotonic += 2;
      return monotonic;
    },
    maxEntriesPerTick: 4,
    maxTickMs: 1,
  });

  const first = janitor.tick();
  assert.equal(first.status, "progress");
  assert.equal(first.entriesVisited, 1);
  const results = [first, ...runToCompletion(janitor)];
  assert.equal(
    results.every((result) => result.entriesVisited <= 1),
    true,
  );
  assert.equal(aggregate(results, "stateFilesRemoved"), 4);
});

test("rejects maintenance budgets above the audited per-tick ceilings", () => {
  assert.throws(
    () =>
      new StateRetentionJanitor({
        root: path.join(os.tmpdir(), "awf-unused-retention-root"),
        maxEntriesPerTick: 65,
      }),
    /Invalid state retention batch size/u,
  );
  assert.throws(
    () =>
      new StateRetentionJanitor({
        root: path.join(os.tmpdir(), "awf-unused-retention-root"),
        maxTickMs: 9,
      }),
    /Invalid state retention tick budget/u,
  );
});

test("rejects a symlinked sessions directory without touching its external victim", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awf-janitor-link-root-"));
  const external = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-janitor-link-victim-"),
  );
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  context.after(() => fs.rmSync(external, { recursive: true, force: true }));
  const now = Date.now();
  const victim = writeState(external, 1, new Date(now - 40 * DAY_MS));
  const victimContents = fs.readFileSync(victim, "utf8");
  fs.symlinkSync(external, path.join(root, "sessions"), "dir");

  const janitor = new StateRetentionJanitor({
    root,
    clock: () => now,
  });
  assert.deepEqual(janitor.tick(), {
    status: "degraded",
    entriesVisited: 0,
    stateFilesRemoved: 0,
    temporaryFilesRemoved: 0,
    staleLocksRemoved: 0,
    activeFilesSkipped: 0,
    unsafeFilesSkipped: 0,
  });
  assert.equal(fs.readFileSync(victim, "utf8"), victimContents);
  assert.equal(fs.existsSync(path.join(root, MAINTENANCE_MARKER)), false);
  assert.equal(fs.existsSync(path.join(root, MAINTENANCE_LOCK)), false);
});

test("allows only one janitor to hold the global maintenance lock", (context) => {
  const { root, sessions } = setup(context);
  const now = Date.now();
  const expiredAt = new Date(now - 40 * DAY_MS);
  for (let index = 1; index <= 3; index += 1) {
    writeState(sessions, index, expiredAt);
  }
  const first = new StateRetentionJanitor({
    root,
    clock: () => now,
    monotonicClock: () => 0,
    maxEntriesPerTick: 1,
    maxTickMs: 8,
  });
  const second = new StateRetentionJanitor({
    root,
    clock: () => now,
  });

  const firstTick = first.tick();
  assert.equal(firstTick.status, "progress");
  assert.equal(firstTick.entriesVisited, 1);
  const lock = path.join(root, MAINTENANCE_LOCK);
  assert.equal(fs.statSync(lock).mode & 0o777, 0o700);

  assert.deepEqual(second.tick(), {
    status: "idle",
    entriesVisited: 0,
    stateFilesRemoved: 0,
    temporaryFilesRemoved: 0,
    staleLocksRemoved: 0,
    activeFilesSkipped: 0,
    unsafeFilesSkipped: 0,
  });
  const remaining = runToCompletion(first);
  assert.equal(
    firstTick.stateFilesRemoved +
      aggregate(remaining, "stateFilesRemoved"),
    3,
  );
  assert.equal(fs.existsSync(lock), false);
  assert.equal(second.tick().status, "idle");
});

test("closing mid-sweep records no completion marker and releases the global lock", (context) => {
  const { root, sessions } = setup(context);
  const now = Date.now();
  const expiredAt = new Date(now - 40 * DAY_MS);
  for (let index = 1; index <= 4; index += 1) {
    writeState(sessions, index, expiredAt);
  }
  const janitor = new StateRetentionJanitor({
    root,
    clock: () => now,
    monotonicClock: () => 0,
    maxEntriesPerTick: 1,
    maxTickMs: 8,
  });

  assert.equal(janitor.tick().status, "progress");
  assert.equal(fs.existsSync(path.join(root, MAINTENANCE_LOCK)), true);
  assert.equal(fs.existsSync(path.join(root, MAINTENANCE_MARKER)), false);
  janitor.close();

  assert.equal(fs.existsSync(path.join(root, MAINTENANCE_LOCK)), false);
  assert.equal(fs.existsSync(path.join(root, MAINTENANCE_MARKER)), false);
  assert.equal(janitor.tick().status, "closed");
});

test("fails closed when the maintenance control file is corrupt", (context) => {
  const { root, sessions } = setup(context);
  const now = Date.now();
  const expired = writeState(
    sessions,
    1,
    new Date(now - 40 * DAY_MS),
  );
  const marker = path.join(root, MAINTENANCE_MARKER);
  writePrivateFile(marker, "{not-valid-json\n");
  const originalControl = fs.readFileSync(marker, "utf8");
  const janitor = new StateRetentionJanitor({
    root,
    clock: () => now,
  });

  assert.equal(janitor.tick().status, "degraded");
  assert.equal(fs.existsSync(expired), true);
  assert.equal(fs.readFileSync(marker, "utf8"), originalControl);
  assert.equal(fs.existsSync(path.join(root, MAINTENANCE_LOCK)), false);
});

test("fails closed before creating data below a writable non-sticky ancestor", (context) => {
  const parent = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-janitor-unsafe-parent-"),
  );
  context.after(() =>
    fs.rmSync(parent, { recursive: true, force: true }),
  );
  const shared = path.join(parent, "shared");
  fs.mkdirSync(shared, { mode: 0o700 });
  fs.chmodSync(shared, 0o770);
  const root = path.join(shared, "data");
  const janitor = new StateRetentionJanitor({ root });

  assert.equal(janitor.tick().status, "degraded");
  assert.equal(fs.existsSync(root), false);
});

test("an oversized unsafe entry cannot starve cleanup of a valid expired state", (context) => {
  const { root, sessions } = setup(context);
  const now = Date.now();
  const expiredAt = new Date(now - 40 * DAY_MS);
  const oversized = path.join(sessions, `${sessionKey(1)}.json`);
  writePrivateFile(oversized, Buffer.alloc(2 * 1024 * 1024 + 1));
  fs.utimesSync(oversized, expiredAt, expiredAt);
  const valid = writeState(sessions, 2, expiredAt);
  const janitor = new StateRetentionJanitor({
    root,
    clock: () => now,
    monotonicClock: () => 0,
    maxTickMs: 8,
  });

  const result = janitor.tick();
  assert.equal(result.status, "degraded");
  assert.equal(result.unsafeFilesSkipped, 1);
  assert.equal(result.stateFilesRemoved, 1);
  assert.equal(fs.existsSync(oversized), true);
  assert.equal(fs.existsSync(valid), false);
  assert.equal(fs.existsSync(path.join(root, MAINTENANCE_MARKER)), true);
  assert.equal(fs.existsSync(path.join(root, MAINTENANCE_LOCK)), false);
});

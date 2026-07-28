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

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { StateStore } from "../src/state-store.mjs";

const KEYS = {
  old: "0000000000000001-0000000001",
  locked: "0000000000000002-0000000002",
  fresh: "0000000000000003-0000000003",
  one: "0000000000000004-0000000004",
  two: "0000000000000005-0000000005",
  stale: "0000000000000006-0000000006",
};

function stateFile(sessions, key) {
  return path.join(sessions, `${key}.json`);
}

function writePrivate(filename, contents = "{}\n") {
  fs.writeFileSync(filename, contents, { mode: 0o600 });
}

test("removes expired state but preserves fresh and locked sessions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awf-retention-"));
  const sessions = path.join(root, "sessions");
  fs.mkdirSync(sessions, { mode: 0o700 });
  const old = stateFile(sessions, KEYS.old);
  const locked = stateFile(sessions, KEYS.locked);
  const fresh = stateFile(sessions, KEYS.fresh);
  for (const filename of [old, locked, fresh]) {
    writePrivate(filename);
  }
  fs.mkdirSync(path.join(sessions, `${KEYS.locked}.lock`), {
    mode: 0o700,
  });
  const staleDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  fs.utimesSync(old, staleDate, staleDate);
  fs.utimesSync(locked, staleDate, staleDate);

  const store = new StateStore({ root });
  assert.deepEqual(store.purgeExpired(30), {
    stateFilesRemoved: 1,
    temporaryFilesRemoved: 0,
    staleLocksRemoved: 0,
    activeFilesSkipped: 1,
    unsafeFilesSkipped: 0,
  });
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(locked), true);
  assert.equal(fs.existsSync(fresh), true);
});

test("purgeAll removes only unlocked session state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awf-purge-"));
  const sessions = path.join(root, "sessions");
  fs.mkdirSync(sessions, { mode: 0o700 });
  writePrivate(stateFile(sessions, KEYS.one));
  writePrivate(stateFile(sessions, KEYS.two));
  fs.mkdirSync(path.join(sessions, `${KEYS.two}.lock`), {
    mode: 0o700,
  });

  const store = new StateStore({ root });
  assert.deepEqual(store.purgeAll(), {
    stateFilesRemoved: 1,
    temporaryFilesRemoved: 0,
    staleLocksRemoved: 0,
    activeFilesSkipped: 1,
    unsafeFilesSkipped: 0,
  });
  assert.equal(fs.existsSync(stateFile(sessions, KEYS.one)), false);
  assert.equal(fs.existsSync(stateFile(sessions, KEYS.two)), true);
});

test("purgeAll preserves every held lock and removes only unlocked temporary files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awf-stale-purge-"));
  const sessions = path.join(root, "sessions");
  fs.mkdirSync(sessions, { mode: 0o700 });
  writePrivate(stateFile(sessions, KEYS.stale));
  writePrivate(
    path.join(sessions, `${KEYS.stale}.json.123.abc.tmp`),
  );
  const orphanKey = "0000000000000007-0000000007";
  const orphan = path.join(
    sessions,
    `${orphanKey}.json.123.def.tmp`,
  );
  writePrivate(orphan);
  const lock = path.join(sessions, `${KEYS.stale}.lock`);
  fs.mkdirSync(lock, { mode: 0o700 });
  const staleDate = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, staleDate, staleDate);

  const store = new StateStore({ root });
  assert.deepEqual(store.purgeAll(), {
    stateFilesRemoved: 0,
    temporaryFilesRemoved: 1,
    staleLocksRemoved: 0,
    activeFilesSkipped: 2,
    unsafeFilesSkipped: 0,
  });
  assert.equal(fs.existsSync(lock), true);
  assert.equal(fs.existsSync(stateFile(sessions, KEYS.stale)), true);
  assert.equal(
    fs.existsSync(
      path.join(sessions, `${KEYS.stale}.json.123.abc.tmp`),
    ),
    true,
  );
  assert.equal(fs.existsSync(orphan), false);
});

test("hook mutation performs no retention sweep and preserves productive state", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-scheduled-retention-"),
  );
  const sessions = path.join(root, "sessions");
  let sweeps = 0;
  class CountingStateStore extends StateStore {
    purge(...arguments_) {
      sweeps += 1;
      return super.purge(...arguments_);
    }
  }
  const store = new CountingStateStore({ root });
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
  mutate();
  assert.equal(sweeps, 0);
  assert.equal(
    fs.readdirSync(sessions).some((name) => name.endsWith(".json")),
    true,
  );
  assert.equal(store.listStates()[0].updatedAt.length > 0, true);

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

test("purge refuses a sessions symlink and preserves the external victim", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awf-retention-root-"));
  const victim = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-retention-victim-"),
  );
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(victim, { recursive: true, force: true });
  });
  const externalState = stateFile(victim, KEYS.old);
  writePrivate(externalState);
  const staleDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  fs.utimesSync(externalState, staleDate, staleDate);
  fs.symlinkSync(victim, path.join(root, "sessions"));

  const store = new StateStore({ root });
  assert.throws(
    () => store.purgeExpired(30),
    { code: "UNSAFE_STATE_STORAGE" },
  );
  assert.equal(fs.existsSync(externalState), true);
});

test("invalid retention input cannot turn into an unbounded deletion cutoff", (context) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-retention-invalid-"),
  );
  context.after(() =>
    fs.rmSync(root, { recursive: true, force: true }),
  );
  const sessions = path.join(root, "sessions");
  fs.mkdirSync(sessions, { mode: 0o700 });
  const current = stateFile(sessions, KEYS.fresh);
  writePrivate(current);
  const store = new StateStore({ root });

  assert.throws(
    () => store.purgeExpired(Number.NaN),
    /Invalid state retention period/u,
  );
  assert.equal(fs.existsSync(current), true);
});

test("state persistence bounds file aliases below the audited file ceiling", (context) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-state-file-bound-"),
  );
  context.after(() =>
    fs.rmSync(root, { recursive: true, force: true }),
  );
  const store = new StateStore({ root });
  const payload = {
    session_id: "bounded-file-aliases",
    cwd: root,
  };
  store.mutate(
    payload,
    {
      retentionDays: 30,
      maxToolEvents: 512,
      maxIncidents: 256,
    },
    (state) => {
      for (let index = 0; index < 16_000; index += 1) {
        const suffix = index.toString(16).padStart(32, "0");
        state.files[`path_${suffix}`] = {
          hashes: [{
            hash: "a".repeat(64),
            source: "after-write",
            at: state.updatedAt,
          }],
        };
      }
      return null;
    },
  );

  const filename = store.statePath(store.keyFor(payload));
  assert.equal(fs.statSync(filename).size < 2 * 1024 * 1024, true);
  assert.equal(
    Object.keys(JSON.parse(fs.readFileSync(filename, "utf8")).files).length,
    512,
  );
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DashboardLiveCursor } from "../src/dashboard-live-cursor.mjs";
import { projectLiveDashboardStatus } from "../src/dashboard-projection.mjs";
import { LiveEventStore } from "../src/live-event-store.mjs";

function setup(context, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awf-live-cursor-"));
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-live-cursor-workspace-"),
  );
  fs.mkdirSync(path.join(workspace, ".git"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  context.after(() =>
    fs.rmSync(workspace, { recursive: true, force: true }),
  );
  return {
    root,
    workspace,
    store: new LiveEventStore({ root, ...options }),
  };
}

function publish(store, workspace, index, overrides = {}) {
  return store.publish(
    {
      hook_event_name: overrides.eventName ?? "PreToolUse",
      session_id: overrides.sessionId ?? "cursor-session",
      cwd: workspace,
      tool_name: "Bash",
      tool_input: {
        command: `SECRET-CURSOR-COMMAND-${index}`,
      },
    },
    {
      output: {},
      incident: overrides.incident ?? null,
      tool:
        overrides.eventName === "UserPromptSubmit"
          ? undefined
          : {
              family: "shell",
              operation: "inspect",
              failed: false,
              interrupted: false,
            },
      observed: {
        progressVersion: overrides.progressVersion ?? 0,
        madeProgress: overrides.madeProgress ?? false,
      },
      evaluation: overrides.issueIds
        ? {
            issues: overrides.issueIds.map((id) => ({ id })),
          }
        : undefined,
    },
    { mode: overrides.mode ?? "observe" },
  );
}

test("reads an empty spool and incremental appends without taking the publish lock", (context) => {
  const { workspace, store } = setup(context);
  const cursor = new DashboardLiveCursor(store);
  const empty = cursor.readSnapshot();

  assert.equal(empty.initialized, true);
  assert.equal(empty.generation, 0);
  assert.equal(empty.streamAlias, null);
  assert.deepEqual(empty.events, []);
  assert.equal(empty.health, "healthy");

  const first = publish(store, workspace, 1);
  assert.equal(first.published, true);
  fs.mkdirSync(store.lockPath, { mode: 0o700 });
  const active = cursor.readSnapshot();
  fs.rmdirSync(store.lockPath);

  assert.equal(active.health, "healthy");
  assert.equal(active.events.length, 1);
  assert.equal(active.events[0].seq, 1);
  assert.match(active.streamAlias, /^generation_[0-9a-f]{32}$/u);
  assert.equal(
    JSON.stringify(active).includes("SECRET-CURSOR-COMMAND"),
    false,
  );

  publish(store, workspace, 2);
  const appended = cursor.readSnapshot();
  assert.deepEqual(
    appended.events.map((event) => event.seq),
    [1, 2],
  );
});

test("resets atomically when the bounded generation rotates", (context) => {
  const { workspace, store } = setup(context, { maxEvents: 2 });
  const cursor = new DashboardLiveCursor(store);
  publish(store, workspace, 1);
  publish(store, workspace, 2);
  const before = cursor.readSnapshot();

  publish(store, workspace, 3);
  const after = cursor.readSnapshot();

  assert.notEqual(after.streamAlias, before.streamAlias);
  assert.deepEqual(after.events.map((event) => event.seq), [3]);
  assert.equal(after.status.eventCount, 1);
});

test("reports reserved sequence gaps as incomplete coverage", (context) => {
  const { workspace, store } = setup(context);
  publish(store, workspace, 1);
  const control = JSON.parse(fs.readFileSync(store.controlPath, "utf8"));
  fs.writeFileSync(
    store.controlPath,
    `${JSON.stringify({
      ...control,
      nextSeq: 3,
      pendingSeq: 2,
    })}\n`,
    { mode: 0o600 },
  );
  store.status();
  const third = publish(store, workspace, 3);
  assert.equal(third.event.seq, 3);

  const cursor = new DashboardLiveCursor(store);
  const status = projectLiveDashboardStatus(cursor.readSnapshot());
  assert.equal(status.coverage, "incomplete");
  assert.equal(cursor.status.gapCount, 1);
  assert.deepEqual(cursor.events.map((event) => event.seq), [1, 3]);
});

test("preserves the last audited snapshot across races and corrupt appends", (context) => {
  const { workspace, store } = setup(context);
  publish(store, workspace, 1);
  const cursor = new DashboardLiveCursor(store);
  const first = cursor.readSnapshot();
  assert.equal(first.events.length, 1);

  const control = JSON.parse(fs.readFileSync(store.controlPath, "utf8"));
  fs.writeFileSync(
    store.controlPath,
    `${JSON.stringify({
      ...control,
      nextSeq: 3,
      pendingSeq: 2,
    })}\n`,
    { mode: 0o600 },
  );
  const racing = cursor.readSnapshot();
  assert.equal(racing.health, "stale");
  assert.deepEqual(racing.events, first.events);
  fs.writeFileSync(store.controlPath, `${JSON.stringify(control)}\n`, {
    mode: 0o600,
  });

  const second = publish(store, workspace, 2);
  const eventPath = store.eventPath(second.generation, second.event.seq);
  const valid = fs.readFileSync(eventPath, "utf8");
  const canary = "SECRET-CORRUPT-LIVE-EVENT";
  fs.writeFileSync(eventPath, `${JSON.stringify({ raw: canary })}\n`, {
    mode: 0o600,
  });

  const degraded = cursor.readSnapshot();
  assert.equal(degraded.health, "degraded");
  assert.deepEqual(degraded.events, first.events);
  assert.equal(JSON.stringify(degraded).includes(canary), false);

  fs.writeFileSync(eventPath, valid, { mode: 0o600 });
  const recovered = cursor.readSnapshot();
  assert.equal(recovered.health, "healthy");
  assert.deepEqual(recovered.events.map((event) => event.seq), [1, 2]);
});

test("periodic full audit rejects mutation of an already committed event", (context) => {
  let now = Date.now();
  const { workspace, store } = setup(context);
  const publication = publish(store, workspace, 1);
  const cursor = new DashboardLiveCursor(store, {
    clock: () => now,
    fullAuditIntervalMs: 1000,
  });
  const first = cursor.readSnapshot();
  const eventPath = store.eventPath(
    publication.generation,
    publication.event.seq,
  );
  const original = fs.readFileSync(eventPath, "utf8");
  const changed = original.replace(
    '"operation":"inspect"',
    '"operation":"release"',
  );
  assert.equal(Buffer.byteLength(changed), Buffer.byteLength(original));
  fs.writeFileSync(eventPath, changed, { mode: 0o600 });
  now += 2000;

  const degraded = cursor.readSnapshot();
  assert.equal(degraded.health, "degraded");
  assert.deepEqual(degraded.events, first.events);

  fs.writeFileSync(eventPath, original, { mode: 0o600 });
  const recovered = cursor.readSnapshot();
  assert.equal(recovered.health, "healthy");
});

test("classifies invalid UTF-8 as corruption rather than a writer race", (context) => {
  const { workspace, store } = setup(context);
  const publication = publish(store, workspace, 1);
  const cursor = new DashboardLiveCursor(store, {
    fullAuditIntervalMs: 0,
  });
  const first = cursor.readSnapshot();
  fs.writeFileSync(
    store.eventPath(publication.generation, publication.event.seq),
    Buffer.from([0xff, 0x0a]),
    { mode: 0o600 },
  );

  const degraded = cursor.readSnapshot();
  assert.equal(degraded.health, "degraded");
  assert.deepEqual(degraded.events, first.events);
});

test("rejects valid-looking control and metadata invariant violations", (context) => {
  const { workspace, store } = setup(context);
  publish(store, workspace, 1);
  const metadata = JSON.parse(
    fs.readFileSync(store.generationMetadataPath(1), "utf8"),
  );
  const control = JSON.parse(fs.readFileSync(store.controlPath, "utf8"));
  fs.writeFileSync(
    store.generationMetadataPath(1),
    `${JSON.stringify({
      ...metadata,
      firstSeq: 10,
    })}\n`,
    { mode: 0o600 },
  );
  fs.writeFileSync(
    store.controlPath,
    `${JSON.stringify({
      ...control,
      nextSeq: 11,
    })}\n`,
    { mode: 0o600 },
  );

  const cursor = new DashboardLiveCursor(store);
  const snapshot = cursor.readSnapshot();
  assert.equal(snapshot.health, "degraded");
  assert.deepEqual(snapshot.events, []);
});

test("expired data is hidden but never represented as healthy coverage", (context) => {
  let now = Date.now();
  const { workspace, store } = setup(context, {
    maxAgeMs: 1000,
    clock: () => new Date(now),
  });
  publish(store, workspace, 1);
  const cursor = new DashboardLiveCursor(store, {
    clock: () => now,
  });
  assert.equal(cursor.readSnapshot().events.length, 1);

  now += 5000;
  const expired = cursor.readSnapshot();
  const status = projectLiveDashboardStatus(expired);
  assert.deepEqual(expired.events, []);
  assert.equal(expired.health, "stale");
  assert.equal(status.sourceState, "empty");
  assert.equal(status.coverage, "unknown");
});

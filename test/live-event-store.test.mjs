import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { LiveEventStore } from "../src/live-event-store.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const publisherFixture = path.join(
  projectRoot,
  "test-support",
  "live-publisher.mjs",
);

function setup(context, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awf-live-store-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "awf-live-workspace-"));
  fs.mkdirSync(path.join(workspace, ".git"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  context.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const store = new LiveEventStore({ root, ...options });
  return { root, workspace, store };
}

function payload(workspace, index = 1, overrides = {}) {
  return {
    hook_event_name: "PreToolUse",
    session_id: `session-${index}`,
    cwd: workspace,
    tool_name: "Bash",
    tool_input: {
      command: `SECRET-COMMAND-${index} --token SECRET-TOKEN-${index}`,
    },
    ...overrides,
  };
}

function result(index = 1, overrides = {}) {
  return {
    output: {},
    incident: null,
    tool: {
      family: "shell",
      operation: "test",
      failed: false,
      interrupted: false,
      rawOutput: `SECRET-OUTPUT-${index}`,
    },
    observed: {
      progressVersion: index,
      madeProgress: false,
    },
    ...overrides,
  };
}

function publish(store, workspace, index = 1, overrides = {}) {
  return store.publish(
    payload(workspace, index, overrides.payload),
    result(index, overrides.result),
    { mode: overrides.mode ?? "observe" },
    { decisionLatencyMs: index },
  );
}

function allFileBytes(directory) {
  if (!fs.existsSync(directory)) return Buffer.alloc(0);
  const buffers = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) buffers.push(fs.readFileSync(target));
    }
  };
  visit(directory);
  return Buffer.concat(buffers);
}

function runPublisher(root, workspace, index) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [publisherFixture, root, workspace, String(index)],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Publisher failed: ${stderr}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

test("publishes only audited semantic bytes with private permissions", (context) => {
  const { root, workspace, store } = setup(context);
  const rawPrompt = "SECRET-PROMPT /Users/customer/private";
  const rawWarning = "SECRET-WARNING-PROSE";
  const published = store.publish(
    payload(workspace, 1, {
      hook_event_name: "UserPromptSubmit",
      prompt: rawPrompt,
    }),
    result(1, {
      incident: {
        ruleId: "prompt_contract",
        category: "user_instruction",
        severity: "high",
        occurrences: 1,
        shouldNotify: true,
        message: rawWarning,
        recommendation: "SECRET-RECOMMENDATION",
      },
      evaluation: {
        issues: [{ id: "broad" }, { id: "verify" }],
      },
      tool: undefined,
    }),
    { mode: "warn" },
    { decisionLatencyMs: 7 },
  );

  assert.equal(published.published, true);
  assert.equal(store.readEvents().length, 1);
  const bytes = allFileBytes(path.join(root, "live-v1")).toString("utf8");
  for (const canary of [
    rawPrompt,
    rawWarning,
    "SECRET-RECOMMENDATION",
    "SECRET-COMMAND",
    "SECRET-OUTPUT",
    workspace,
  ]) {
    assert.equal(bytes.includes(canary), false);
  }
  assert.equal(fs.statSync(path.join(root, "live-v1")).mode & 0o077, 0);
  assert.equal(
    fs.statSync(store.controlPath).mode & 0o077,
    0,
  );
  assert.equal(
    fs.statSync(store.keyPath(published.generation)).mode & 0o077,
    0,
  );
  assert.equal(
    fs.statSync(
      store.generationMetadataPath(published.generation),
    ).mode & 0o077,
    0,
  );
  assert.equal(
    fs.statSync(store.eventPath(published.generation, 1)).mode & 0o077,
    0,
  );
});

test("rotates atomically at the event bound and keeps global sequence monotonic", (context) => {
  const { workspace, store } = setup(context, { maxEvents: 2 });
  const first = publish(store, workspace, 1);
  const second = publish(store, workspace, 2);
  const third = publish(store, workspace, 3);
  const status = store.status();
  const events = store.readEvents();

  assert.equal(first.generation, second.generation);
  assert.equal(third.generation, first.generation + 1);
  assert.notEqual(first.event.sessionAlias, third.event.sessionAlias);
  assert.deepEqual(events.map((event) => event.seq), [3]);
  assert.equal(status.nextSeq, 4);
  assert.equal(status.eventCount, 1);
  assert.ok(status.totalBytes <= status.maxBytes);
  assert.deepEqual(
    fs
      .readdirSync(store.generationsDir)
      .filter((name) => /^\d{8}$/u.test(name)),
    ["00000002"],
  );
});

test("rotates when the byte or age bound is reached", (context) => {
  let now = Date.now();
  const { workspace, store } = setup(context, {
    maxEvents: 100,
    maxBytes: 4096,
    maxAgeMs: 1000,
    clock: () => new Date(now),
  });
  let generation = 1;
  for (let index = 1; index <= 20; index += 1) {
    const current = publish(store, workspace, index);
    assert.equal(current.published, true);
    generation = current.generation;
    assert.ok(store.status().totalBytes <= 4096);
  }
  assert.ok(generation > 1, "byte-bound rotation did not occur");

  const beforeAgeRotation = store.status().generation;
  now += 5000;
  const aged = publish(store, workspace, 21);
  assert.equal(aged.generation, beforeAgeRotation + 1);
  assert.equal(aged.event.seq, 21);
});

test("hides and removes expired events on the next read", (context) => {
  let now = Date.now();
  const { workspace, store } = setup(context, {
    maxAgeMs: 1000,
    clock: () => new Date(now),
  });
  const first = publish(store, workspace, 1);
  assert.equal(first.published, true);

  now += 5000;
  assert.deepEqual(store.readEvents(), []);
  now = Date.now();
  assert.equal(store.status().generation, first.generation + 1);
  assert.equal(store.status().nextSeq, 2);
});

test("does not reuse a sequence when control is lost after an empty rotation", (context) => {
  let now = Date.now();
  const { workspace, store } = setup(context, {
    maxAgeMs: 1000,
    clock: () => new Date(now),
  });
  const first = publish(store, workspace, 1);
  assert.equal(first.event.seq, 1);

  now += 5000;
  assert.deepEqual(store.readEvents(), []);
  now = Date.now();
  fs.writeFileSync(store.controlPath, '{"corrupt":true}\n', {
    mode: 0o600,
  });

  assert.deepEqual(publish(store, workspace, 2), {
    published: false,
    reason: "unavailable",
  });
  assert.equal(store.status().nextSeq, 2);
  const recovered = publish(store, workspace, 2);
  assert.equal(recovered.published, true);
  assert.equal(recovered.event.seq, 2);
});

test("maintenance recovers corrupt control and a partial temporary file", (context) => {
  const { workspace, store } = setup(context);
  assert.equal(publish(store, workspace, 1).published, true);
  const status = store.status();
  fs.writeFileSync(
    path.join(store.eventsDir(status.generation), ".partial.tmp"),
    "SECRET-PARTIAL-RAW",
    { mode: 0o600 },
  );
  fs.writeFileSync(
    store.controlPath,
    '{"raw":"SECRET-CORRUPT-CONTROL"}\n',
    { mode: 0o600 },
  );

  const skipped = publish(store, workspace, 2);
  assert.deepEqual(skipped, {
    published: false,
    reason: "unavailable",
  });
  assert.equal(store.status().eventCount, 1);
  const recovered = publish(store, workspace, 2);
  assert.equal(recovered.published, true);
  assert.deepEqual(store.readEvents().map((event) => event.seq), [1, 2]);
  assert.equal(
    allFileBytes(store.liveDir)
      .toString("utf8")
      .includes("SECRET-CORRUPT-CONTROL"),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(store.eventsDir(status.generation), ".partial.tmp")),
    false,
  );
});

test("rejects a corrupt event without copying its contents into an error", (context) => {
  const { workspace, store } = setup(context);
  const first = publish(store, workspace, 1);
  const canary = "SECRET-UNSAFE-EVENT /Users/private/repository";
  fs.writeFileSync(
    store.eventPath(first.generation, 2),
    `${JSON.stringify({ raw: canary })}\n`,
    { mode: 0o600 },
  );

  assert.throws(
    () => store.readEvents(),
    (error) => {
      assert.equal(error.message.includes(canary), false);
      return /closed-schema audit/u.test(error.message);
    },
  );
});

test("fails open when the spool is busy or unavailable", (context) => {
  const { root, workspace, store } = setup(context, { lockTimeoutMs: 0 });
  store.status();
  fs.mkdirSync(store.lockPath, { mode: 0o700 });
  const busy = publish(store, workspace, 1);
  fs.rmdirSync(store.lockPath);
  assert.deepEqual(busy, { published: false, reason: "busy" });
  assert.equal(store.readEvents().length, 0);

  const unavailableRoot = path.join(root, "not-a-directory");
  fs.writeFileSync(unavailableRoot, "x", { mode: 0o600 });
  const unavailable = new LiveEventStore({ root: unavailableRoot }).publish(
    payload(workspace, 2),
    result(2),
    { mode: "observe" },
  );
  assert.deepEqual(unavailable, {
    published: false,
    reason: "unavailable",
  });
});

test("refuses a symlinked generation without writing through it", (context) => {
  const { root, workspace, store } = setup(context);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "awf-live-external-"));
  context.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.mkdirSync(store.generationsDir, {
    recursive: true,
    mode: 0o700,
  });
  fs.symlinkSync(external, store.generationDir(1), "dir");

  assert.deepEqual(publish(store, workspace, 1), {
    published: false,
    reason: "unavailable",
  });
  assert.deepEqual(fs.readdirSync(external), []);
  assert.equal(fs.existsSync(path.join(root, "live-v1", "control.json")), false);
});

test("serializes concurrent hook publishers without duplicate sequences", async (context) => {
  const { root, workspace, store } = setup(context);
  const published = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      runPublisher(root, workspace, index + 1),
    ),
  );
  const events = store.readEvents();
  const sequences = events.map((event) => event.seq);

  assert.equal(published.every((current) => current.published), true);
  assert.equal(events.length, 10);
  assert.equal(new Set(sequences).size, 10);
  assert.deepEqual(sequences, [...sequences].sort((left, right) => left - right));
});

test("purges the bounded live spool without touching its parent", (context) => {
  const { root, workspace, store } = setup(context);
  publish(store, workspace, 1);
  const sibling = path.join(root, "keep.txt");
  fs.writeFileSync(sibling, "keep", { mode: 0o600 });

  assert.deepEqual(store.purge(), { liveSpoolRemoved: true });
  assert.equal(fs.existsSync(store.controlPath), false);
  assert.equal(fs.readFileSync(sibling, "utf8"), "keep");
});

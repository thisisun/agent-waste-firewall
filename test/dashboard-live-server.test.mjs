import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { startDashboard } from "../src/dashboard-server.mjs";
import { LiveEventStore } from "../src/live-event-store.mjs";
import { TraceStore } from "../src/trace-store.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const hook = path.join(projectRoot, "scripts", "hook.mjs");

function setup(context) {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-live-dashboard-"),
  );
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-live-dashboard-workspace-"),
  );
  fs.mkdirSync(path.join(workspace, ".git"));
  context.after(() =>
    fs.rmSync(dataDir, { recursive: true, force: true }),
  );
  context.after(() =>
    fs.rmSync(workspace, { recursive: true, force: true }),
  );
  const env = {
    ...process.env,
    AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
    AGENT_WASTE_FIREWALL_PLATFORM: "codex",
    AGENT_WASTE_FIREWALL_MODE: "warn",
  };
  return { dataDir, workspace, env };
}

function runHook(env, payload) {
  return spawnSync(process.execPath, [hook], {
    encoding: "utf8",
    env,
    input: JSON.stringify(payload),
  });
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function readStreamUntil(reader, marker) {
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes(marker)) {
    const current = await withTimeout(
      reader.read(),
      3000,
      `Timed out waiting for live SSE marker: ${marker}`,
    );
    if (current.done) break;
    text += decoder.decode(current.value, { stream: true });
  }
  return text;
}

function publish(store, workspace, index) {
  return store.publish(
    {
      hook_event_name: "PreToolUse",
      session_id: "SECRET-ROTATION-SESSION",
      cwd: workspace,
      tool_name: "Bash",
      tool_input: {
        command: `SECRET-ROTATION-COMMAND-${index}`,
      },
    },
    {
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
    },
    { mode: "observe" },
  );
}

test("default dashboard starts empty and consumes the real always-on hook spool", async (context) => {
  const { dataDir, workspace, env } = setup(context);
  const token = "e".repeat(48);
  const dashboard = await startDashboard({
    root: dataDir,
    port: 0,
    token,
    env,
  });
  context.after(() => dashboard.close());
  assert.equal(dashboard.source, "live");
  assert.equal(dashboard.traceId, null);
  assert.equal(new TraceStore({ root: dataDir, env }).status(), null);
  const origin = `http://127.0.0.1:${dashboard.port}`;

  const empty = await fetch(`${origin}/api/status?token=${token}`).then(
    (response) => response.json(),
  );
  assert.equal(empty.source, "live");
  assert.equal(empty.sourceState, "empty");
  assert.equal(empty.streamHealth, "healthy");
  assert.equal(empty.coverage, "complete");
  assert.equal(empty.metrics.events, 0);
  assert.equal(empty.lastSequence, 0);

  const rawPrompt =
    "SECRET-DASHBOARD-PROMPT 전체 저장소를 알아서 개선하고 멈추지 마";
  const rawSession = "SECRET-DASHBOARD-LIVE-SESSION";
  const result = runHook(env, {
    session_id: rawSession,
    cwd: workspace,
    hook_event_name: "UserPromptSubmit",
    turn_id: "SECRET-DASHBOARD-TURN",
    prompt: rawPrompt,
  });
  assert.equal(result.status, 0, result.stderr);

  const active = await fetch(`${origin}/api/status?token=${token}`).then(
    (response) => response.json(),
  );
  assert.equal(active.sourceState, "active");
  assert.equal(active.metrics.events, 1);
  assert.equal(active.currentWarning.ruleId, "prompt_contract");
  assert.match(active.streamAlias, /^generation_[0-9a-f]{32}$/u);
  for (const canary of [rawPrompt, rawSession, workspace]) {
    assert.equal(JSON.stringify(active).includes(canary), false);
  }

  const streamResponse = await fetch(`${origin}/events?token=${token}`);
  const reader = streamResponse.body.getReader();
  const streamText = await readStreamUntil(
    reader,
    `${active.streamAlias}:1\n`,
  );
  assert.match(streamText, /event: status/u);
  assert.match(streamText, /"kind":"incident"/u);
  for (const canary of [rawPrompt, rawSession, workspace]) {
    assert.equal(streamText.includes(canary), false);
  }
  await reader.cancel();

  const corrected = runHook(env, {
    session_id: rawSession,
    cwd: workspace,
    hook_event_name: "UserPromptSubmit",
    turn_id: "SECRET-DASHBOARD-TURN-2",
    prompt: "Fix src/auth.ts and verify with npm test.",
  });
  assert.equal(corrected.status, 0, corrected.stderr);
  const cleared = await fetch(`${origin}/api/status?token=${token}`).then(
    (response) => response.json(),
  );
  assert.equal(cleared.currentWarning, null);
  assert.deepEqual(cleared.promptCoach.issueIds, []);
});

test("rotation and reconnect emit one generation-aware reset", async (context) => {
  const { dataDir, workspace, env } = setup(context);
  const store = new LiveEventStore({
    root: dataDir,
    env,
    maxEvents: 2,
  });
  publish(store, workspace, 1);
  publish(store, workspace, 2);
  const token = "f".repeat(48);
  const dashboard = await startDashboard({
    source: "live",
    store,
    port: 0,
    token,
  });
  context.after(() => dashboard.close());
  const origin = `http://127.0.0.1:${dashboard.port}`;
  const before = await fetch(`${origin}/api/status?token=${token}`).then(
    (response) => response.json(),
  );

  const streamResponse = await fetch(`${origin}/events?token=${token}`);
  const reader = streamResponse.body.getReader();
  await readStreamUntil(reader, `${before.streamAlias}:2\n`);

  const third = publish(store, workspace, 3);
  assert.equal(third.generation, 2);
  const current = store.readWindow();
  const rotatedText = await readStreamUntil(
    reader,
    `${current.streamAlias}:3\n`,
  );
  assert.match(rotatedText, /event: snapshot/u);
  assert.match(rotatedText, /"reset":true/u);
  assert.equal(rotatedText.includes(before.streamAlias + ":3"), false);
  assert.equal(
    rotatedText.includes("SECRET-ROTATION-COMMAND"),
    false,
  );
  await reader.cancel();

  const reconnect = await fetch(`${origin}/events?token=${token}`, {
    headers: {
      "last-event-id": `${before.streamAlias}:2`,
    },
  });
  const reconnectReader = reconnect.body.getReader();
  const reconnectText = await readStreamUntil(
    reconnectReader,
    `${current.streamAlias}:3\n`,
  );
  assert.match(reconnectText, /event: snapshot/u);
  assert.equal(
    reconnectText.match(/event: snapshot/gu)?.length,
    1,
  );
  await reconnectReader.cancel();
});

test("streams incomplete coverage after a busy drop without a later event", async (context) => {
  const { dataDir, workspace, env } = setup(context);
  const store = new LiveEventStore({
    root: dataDir,
    env,
    lockTimeoutMs: 0,
  });
  store.status();
  const token = "8".repeat(48);
  const dashboard = await startDashboard({
    source: "live",
    store,
    port: 0,
    token,
  });
  context.after(() => dashboard.close());
  const origin = `http://127.0.0.1:${dashboard.port}`;
  const stream = await fetch(`${origin}/events?token=${token}`);
  const reader = stream.body.getReader();
  await readStreamUntil(reader, '"coverage":"complete"');

  fs.mkdirSync(store.lockPath, { mode: 0o700 });
  const dropped = publish(store, workspace, 1);
  fs.rmdirSync(store.lockPath);
  assert.deepEqual(dropped, {
    published: false,
    reason: "busy",
  });
  const coverageText = await readStreamUntil(
    reader,
    '"coverage":"incomplete"',
  );
  assert.match(coverageText, /event: status/u);
  assert.equal(coverageText.includes("SECRET-ROTATION-COMMAND"), false);
  await reader.cancel();
});

test("dashboard maintenance physically removes expired events and alias keys", async (context) => {
  let now = Date.now();
  const { dataDir, workspace, env } = setup(context);
  const store = new LiveEventStore({
    root: dataDir,
    env,
    maxAgeMs: 1000,
    clock: () => new Date(now),
  });
  const first = publish(store, workspace, 1);
  const eventPath = store.eventPath(first.generation, first.event.seq);
  const keyPath = store.keyPath(first.generation);
  const dashboard = await startDashboard({
    source: "live",
    store,
    port: 0,
    token: "7".repeat(48),
    maintenanceIntervalMs: 25,
  });
  context.after(() => dashboard.close());
  now += 5000;

  await withTimeout(
    new Promise((resolve) => {
      const interval = setInterval(() => {
        if (!fs.existsSync(eventPath) && !fs.existsSync(keyPath)) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    }),
    2000,
    "Expired live generation was not physically removed.",
  );
  now = Date.now();
  assert.ok(store.status().generation > first.generation);
});

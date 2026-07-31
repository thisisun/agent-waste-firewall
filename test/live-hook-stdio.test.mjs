import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { runHookPayload } from "../src/hook-stdio.mjs";
import { PORTABLE_WORKER_ARGUMENTS } from "../src/helper-worker-handshake.mjs";
import { LiveEventStore } from "../src/live-event-store.mjs";
import { StateStore } from "../src/state-store.mjs";
import { TraceStore } from "../src/trace-store.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hook = path.join(root, "scripts", "hook.mjs");

function setup(context) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "awf-live-hook-data-"));
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-live-hook-workspace-"),
  );
  fs.mkdirSync(path.join(workspace, ".git"));
  context.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  context.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const env = {
    ...process.env,
    AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
    AGENT_WASTE_FIREWALL_PLATFORM: "codex",
    AGENT_WASTE_FIREWALL_MODE: "observe",
  };
  return { dataDir, workspace, env };
}

function run(env, payload) {
  return spawnSync(
    process.execPath,
    [hook, ...PORTABLE_WORKER_ARGUMENTS],
    {
      encoding: "utf8",
      env,
      input: JSON.stringify(payload),
    },
  );
}

test("publishes LiveEventV1 without an explicit trace recording", (context) => {
  const { dataDir, workspace, env } = setup(context);
  const rawPrompt =
    "SECRET-LIVE-HOOK-PROMPT 전체 저장소를 알아서 개선하고 멈추지 마";
  const result = run(env, {
    session_id: "SECRET-LIVE-HOOK-SESSION",
    cwd: workspace,
    hook_event_name: "UserPromptSubmit",
    turn_id: "SECRET-LIVE-HOOK-TURN",
    prompt: rawPrompt,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {});
  assert.equal(new TraceStore({ root: dataDir, env }).status(), null);
  const liveStore = new LiveEventStore({ root: dataDir, env });
  const events = liveStore.readEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "incident");
  assert.equal(events[0].ruleId, "prompt_contract");
  const persisted = fs
    .readFileSync(
      liveStore.eventPath(liveStore.status().generation, events[0].seq),
      "utf8",
    );
  for (const canary of [
    rawPrompt,
    "SECRET-LIVE-HOOK-SESSION",
    "SECRET-LIVE-HOOK-TURN",
    workspace,
  ]) {
    assert.equal(persisted.includes(canary), false);
  }
});

test("publishes a raw-free Claude failure event through the real hook", (context) => {
  const { dataDir, workspace, env } = setup(context);
  const command = "SECRET-CLAUDE-COMMAND --token SECRET-CLAUDE-TOKEN";
  const output = "SECRET-CLAUDE-OUTPUT: process exited with code 1";
  const result = run(
    {
      ...env,
      AGENT_WASTE_FIREWALL_PLATFORM: "claude",
    },
    {
      session_id: "SECRET-CLAUDE-SESSION",
      cwd: workspace,
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_input: { command },
      tool_response: output,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {});
  const store = new LiveEventStore({ root: dataDir, env });
  const events = store.readEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].platform, "claude");
  assert.equal(events[0].outcome, "failed");
  const persisted = fs.readFileSync(
    store.eventPath(store.status().generation, events[0].seq),
    "utf8",
  );
  for (const canary of [
    command,
    output,
    "SECRET-CLAUDE-SESSION",
    workspace,
  ]) {
    assert.equal(persisted.includes(canary), false);
  }
});

test("reuses one active trace lookup for decision mode and append", async (context) => {
  const { dataDir, workspace, env } = setup(context);
  const traceStore = new TraceStore({ root: dataDir, env });
  traceStore.start({
    workspace,
    label: "single-lookup",
    mode: "observe",
  });
  const activeFor = traceStore.activeFor.bind(traceStore);
  let activeLookups = 0;
  traceStore.activeFor = (...arguments_) => {
    activeLookups += 1;
    return activeFor(...arguments_);
  };

  const output = await runHookPayload(
    {
      session_id: "private-single-lookup-session",
      cwd: workspace,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git status --short" },
    },
    {
      env,
      traceStore,
      store: new StateStore({ root: dataDir }),
    },
  );

  assert.deepEqual(output, {});
  assert.equal(activeLookups, 1);
  assert.equal(traceStore.status().eventCount, 1);
});

test("fails open without persisting an oversized raw hook envelope", (context) => {
  const { dataDir, workspace, env } = setup(context);
  const canary = "SECRET-OVERSIZED-HOOK-CANARY";
  const result = run(env, {
    session_id: "oversized-session",
    cwd: workspace,
    hook_event_name: "UserPromptSubmit",
    prompt: canary + "x".repeat(1024 * 1024),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(typeof JSON.parse(result.stdout), "object");
  assert.deepEqual(fs.readdirSync(dataDir), []);
  assert.equal(result.stdout.includes(canary), false);
  assert.equal(result.stderr.includes(canary), false);
});

test("an unavailable live spool never changes the hook response", (context) => {
  const { dataDir, workspace, env } = setup(context);
  fs.writeFileSync(path.join(dataDir, "live-v1"), "not-a-directory", {
    mode: 0o600,
  });
  const payload = {
    session_id: "safe-session",
    cwd: workspace,
    hook_event_name: "Stop",
    stop_hook_active: true,
  };

  const first = run(env, payload);
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(JSON.parse(first.stdout), {});
  assert.match(first.stderr, /live monitor degraded/u);
  assert.equal(first.stderr.includes(workspace), false);

  const second = run(env, payload);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(JSON.parse(second.stdout), {});
  assert.equal(second.stderr, "");
});

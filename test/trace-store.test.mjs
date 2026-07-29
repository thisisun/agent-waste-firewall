import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { configFromEnv } from "../src/config.mjs";
import { handleHook } from "../src/engine.mjs";
import { StateStore } from "../src/state-store.mjs";
import { TraceStore } from "../src/trace-store.mjs";

function fixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "awf-trace-workspace-"));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "awf-trace-data-"));
  fs.mkdirSync(path.join(workspace, ".git"));
  fs.mkdirSync(path.join(workspace, "src"));
  const env = {
    AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
    AGENT_WASTE_FIREWALL_MODE: "observe",
    AGENT_WASTE_FIREWALL_PLATFORM: "codex",
  };
  const config = configFromEnv(env);
  const stateStore = new StateStore({ root: dataDir });
  const traceStore = new TraceStore({ root: dataDir, env });
  return { workspace, dataDir, env, config, stateStore, traceStore };
}

function processHook(context, payload) {
  const result = handleHook(payload, {
    env: context.env,
    config: context.config,
    store: context.stateStore,
  });
  const event = context.traceStore.appendHook(payload, result, context.config);
  return { result, event };
}

test("records a strict semantic trace without raw hook data", () => {
  const context = fixture();
  const secretFile = path.join(context.workspace, "src", "고객-secret-name.ts");
  fs.writeFileSync(secretFile, "export const API_TOKEN = 'SECRET-SOURCE';\n");
  const started = context.traceStore.start({
    workspace: context.workspace,
    label: "release-candidate-1",
    mode: "observe",
  });

  const common = {
    session_id: "SECRET-SESSION",
    cwd: context.workspace,
    model: "SECRET-MODEL",
    turn_id: "SECRET-TURN",
  };
  processHook(context, {
    ...common,
    hook_event_name: "UserPromptSubmit",
    prompt:
      "전체 저장소를 알아서 개선하고 SECRET-PROMPT 작업이 끝날 때까지 멈추지 마",
  });
  const tool = {
    ...common,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_use_id: "SECRET-CALL",
    tool_input: {
      command: "API_TOKEN=SECRET-COMMAND pnpm test",
      file_path: secretFile,
    },
  };
  processHook(context, tool);
  processHook(context, {
    ...tool,
    hook_event_name: "PostToolUse",
    tool_response: {
      exit_code: 1,
      stderr: "SECRET-OUTPUT https://private.example.invalid",
    },
  });
  processHook(context, {
    ...common,
    hook_event_name: "Stop",
    last_assistant_message: "SECRET-ASSISTANT-MESSAGE",
  });
  const stopped = context.traceStore.stop();

  assert.equal(stopped.eventCount, 4);
  assert.equal(stopped.status, "stopped");
  assert.equal(fs.existsSync(path.join(context.dataDir, "active-trace.json")), false);
  assert.equal(
    fs.existsSync(path.join(context.dataDir, "trace-keys", `${started.traceId}.key`)),
    false,
  );

  const eventsPath = path.join(
    context.dataDir,
    "traces",
    started.traceId,
    "events.jsonl",
  );
  const stored = fs.readFileSync(eventsPath, "utf8");
  for (const raw of [
    "SECRET-SESSION",
    "SECRET-TURN",
    "SECRET-CALL",
    "SECRET-PROMPT",
    "SECRET-COMMAND",
    "SECRET-OUTPUT",
    "SECRET-SOURCE",
    "고객-secret-name.ts",
    context.workspace,
    "private.example.invalid",
  ]) {
    assert.equal(stored.includes(raw), false, raw);
  }
  assert.deepEqual(context.traceStore.audit(started.traceId), {
    ok: true,
    eventCount: 4,
    findings: [],
  });
});

test("matches an active recording from a workspace subdirectory", () => {
  const context = fixture();
  const nested = path.join(context.workspace, "src", "nested");
  fs.mkdirSync(nested, { recursive: true });
  const started = context.traceStore.start({
    workspace: context.workspace,
    label: "nested-test",
  });

  const active = context.traceStore.activeFor(nested);
  assert.equal(active.traceId, started.traceId);
  assert.equal(active.workspaceRoot, context.workspace);
});

test("reuses one active trace context without crossing a stop or switch", () => {
  const context = fixture();
  const first = context.traceStore.start({
    workspace: context.workspace,
    label: "first-context",
  });
  const active = context.traceStore.activeFor(context.workspace);
  const payload = {
    session_id: "private-context-session",
    cwd: context.workspace,
    hook_event_name: "UserPromptSubmit",
    prompt: "Fix src/example.ts and verify with npm test.",
  };
  const result = handleHook(payload, {
    env: context.env,
    config: context.config,
    store: context.stateStore,
  });

  const event = context.traceStore.appendHook(
    payload,
    result,
    context.config,
    active,
  );
  assert.equal(event.seq, 1);
  assert.equal(context.traceStore.status(first.traceId).eventCount, 1);

  context.traceStore.stop();
  const second = context.traceStore.start({
    workspace: context.workspace,
    label: "second-context",
  });
  assert.equal(
    context.traceStore.appendHook(
      payload,
      result,
      context.config,
      active,
    ),
    null,
  );
  assert.equal(context.traceStore.status(first.traceId).eventCount, 1);
  assert.equal(context.traceStore.status(second.traceId).eventCount, 0);
});

test("uses unlinkable aliases for separate traces", () => {
  const context = fixture();
  const rawPrompt = "Fix src/example.ts and verify with pnpm test.";

  const aliases = [];
  for (const label of ["first", "second"]) {
    const started = context.traceStore.start({
      workspace: context.workspace,
      label,
      mode: "observe",
    });
    const { event } = processHook(context, {
      session_id: "same-session",
      cwd: context.workspace,
      hook_event_name: "UserPromptSubmit",
      turn_id: "same-turn",
      prompt: rawPrompt,
    });
    aliases.push(event.promptAlias);
    context.traceStore.stop();
    assert.equal(context.traceStore.audit(started.traceId).ok, true);
  }

  assert.notEqual(aliases[0], aliases[1]);
});

test("records and exports multiple pseudonymous sessions in one workspace trace", () => {
  const context = fixture();
  const started = context.traceStore.start({
    workspace: context.workspace,
    label: "two-sessions",
    mode: "observe",
  });

  for (const sessionId of ["private-session-a", "private-session-b"]) {
    processHook(context, {
      session_id: sessionId,
      cwd: context.workspace,
      hook_event_name: "UserPromptSubmit",
      prompt: "Fix src/example.ts and verify with npm test.",
    });
  }
  context.traceStore.stop();

  const events = context.traceStore.readEvents(started.traceId);
  assert.equal(events.length, 2);
  assert.notEqual(events[0].sessionAlias, events[1].sessionAlias);
  assert.deepEqual(context.traceStore.audit(started.traceId), {
    ok: true,
    eventCount: 2,
    findings: [],
  });

  const output = path.join(context.dataDir, "two-sessions.jsonl");
  assert.equal(context.traceStore.export(started.traceId, output).eventCount, 2);
  const exported = fs.readFileSync(output, "utf8");
  assert.equal(exported.includes("private-session-a"), false);
  assert.equal(exported.includes("private-session-b"), false);
});

test("exports only audited events and never exports the local key or label", () => {
  const context = fixture();
  const started = context.traceStore.start({
    workspace: context.workspace,
    label: "private-local-label",
  });
  processHook(context, {
    session_id: "private-session",
    cwd: context.workspace,
    hook_event_name: "UserPromptSubmit",
    prompt: "Fix src/example.ts and verify with pnpm test.",
  });
  context.traceStore.stop();

  const output = path.join(context.dataDir, "public-trace.jsonl");
  const result = context.traceStore.export(started.traceId, output);
  const exported = fs.readFileSync(output, "utf8");
  assert.equal(result.eventCount, 1);
  assert.equal(exported.includes("private-local-label"), false);
  assert.equal(exported.includes("private-session"), false);
  assert.equal(exported.includes("trace-keys"), false);
  assert.equal(fs.statSync(output).mode & 0o077, 0);
  assert.throws(
    () => context.traceStore.export(started.traceId, output),
    /already exists/u,
  );
});

test("trace read and export errors report the closed audit code", () => {
  const context = fixture();
  const started = context.traceStore.start({
    workspace: context.workspace,
    label: "invalid-trace",
  });
  fs.writeFileSync(context.traceStore.eventsPath(started.traceId), "{}\n", {
    mode: 0o600,
  });

  assert.throws(
    () => context.traceStore.readEvents(started.traceId),
    /missing_field/u,
  );
  assert.throws(
    () =>
      context.traceStore.export(
        started.traceId,
        path.join(context.dataDir, "invalid-export.jsonl"),
      ),
    /missing_field/u,
  );
});

test("does not record a different workspace", () => {
  const context = fixture();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "awf-trace-other-"));
  fs.mkdirSync(path.join(other, ".git"));
  const started = context.traceStore.start({
    workspace: context.workspace,
    label: "scoped",
  });

  const payload = {
    session_id: "other-session",
    cwd: other,
    hook_event_name: "UserPromptSubmit",
    prompt: "Fix src/example.ts and verify with pnpm test.",
  };
  const result = handleHook(payload, {
    env: context.env,
    config: context.config,
    store: context.stateStore,
  });
  assert.equal(context.traceStore.appendHook(payload, result, context.config), null);
  assert.equal(context.traceStore.status(started.traceId).eventCount, 0);
});

test("purges expired stopped traces while preserving the active recording", () => {
  const context = fixture();
  const baseTime = Date.parse("2026-01-01T00:00:00.000Z");
  const oldStore = new TraceStore({
    root: context.dataDir,
    env: context.env,
    clock: () => new Date(baseTime),
  });
  const old = oldStore.start({
    workspace: context.workspace,
    label: "old",
  });
  oldStore.stop();
  const active = oldStore.start({
    workspace: context.workspace,
    label: "active",
  });

  const futureStore = new TraceStore({
    root: context.dataDir,
    env: context.env,
    clock: () => new Date(baseTime + 31 * 24 * 60 * 60 * 1000),
  });
  const purged = futureStore.purgeExpired(30);
  assert.equal(purged.traceDirectoriesRemoved, 1);
  assert.equal(purged.activeTracesSkipped, 1);
  assert.equal(fs.existsSync(futureStore.traceDir(old.traceId)), false);
  assert.equal(fs.existsSync(futureStore.traceDir(active.traceId)), true);
});

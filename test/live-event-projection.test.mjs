import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { projectLiveEvent } from "../src/live-event-projection.mjs";

function workspace(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "awf-live-project-"));
  fs.mkdirSync(path.join(directory, ".git"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("projects a prompt incident without raw prompt or warning prose", (context) => {
  const cwd = workspace(context);
  const rawPrompt = "SECRET-LIVE-PROMPT improve /Users/customer/private";
  const rawMessage = "SECRET-LIVE-WARNING";
  const event = projectLiveEvent({
    payload: {
      hook_event_name: "UserPromptSubmit",
      session_id: "SECRET-LIVE-SESSION",
      cwd,
      prompt: rawPrompt,
    },
    result: {
      output: { systemMessage: rawMessage },
      incident: {
        ruleId: "prompt_contract",
        category: "user_instruction",
        severity: "high",
        occurrences: 1,
        shouldNotify: true,
        message: rawMessage,
      },
      evaluation: {
        issues: [{ id: "broad" }, { id: "verify" }],
      },
      observed: { progressVersion: 0, madeProgress: false },
    },
    config: { mode: "warn" },
    key: crypto.randomBytes(32),
    seq: 1,
    elapsedMs: 10,
    decisionLatencyMs: 4.2,
    env: { AGENT_WASTE_FIREWALL_PLATFORM: "codex" },
  });
  const bytes = JSON.stringify(event);

  assert.equal(event.kind, "incident");
  assert.equal(event.family, "prompt");
  assert.equal(event.outcome, "warned");
  assert.deepEqual(event.issueIds, ["broad", "verify"]);
  assert.match(event.sessionAlias, /^session_[0-9a-f]{32}$/u);
  for (const canary of [rawPrompt, rawMessage, "SECRET-LIVE-SESSION", cwd]) {
    assert.equal(bytes.includes(canary), false);
  }
});

test("projects productive post-tool work as progress, not waste", (context) => {
  const cwd = workspace(context);
  const event = projectLiveEvent({
    payload: {
      hook_event_name: "PostToolUse",
      session_id: "session",
      cwd,
    },
    result: {
      output: {},
      incident: null,
      tool: {
        family: "write",
        operation: "write",
        failed: false,
        interrupted: false,
      },
      observed: { progressVersion: 7, madeProgress: true },
    },
    config: { mode: "warn" },
    key: Buffer.alloc(32, 1),
    seq: 2,
    elapsedMs: 20,
    env: { AGENT_WASTE_FIREWALL_PLATFORM: "codex" },
  });

  assert.equal(event.kind, "progress");
  assert.equal(event.operation, "progress");
  assert.equal(event.ruleId, null);
  assert.equal(event.incidentCountDelta, 0);
  assert.equal(event.avoidableCallsDelta, 0);
});

test("session aliases are stable only for the same live key and scope", (context) => {
  const firstWorkspace = workspace(context);
  const secondWorkspace = workspace(context);
  const key = Buffer.alloc(32, 7);
  const base = {
    result: {
      output: {},
      incident: null,
      evaluation: { issues: [] },
      observed: { progressVersion: 0, madeProgress: false },
    },
    config: { mode: "observe" },
    seq: 1,
    elapsedMs: 0,
    env: { AGENT_WASTE_FIREWALL_PLATFORM: "claude" },
  };
  const project = (cwd, currentKey = key) =>
    projectLiveEvent({
      ...base,
      payload: {
        hook_event_name: "UserPromptSubmit",
        session_id: "same-session",
        cwd,
      },
      key: currentKey,
    }).sessionAlias;

  assert.equal(project(firstWorkspace), project(firstWorkspace));
  assert.notEqual(project(firstWorkspace), project(secondWorkspace));
  assert.notEqual(project(firstWorkspace), project(firstWorkspace, Buffer.alloc(32, 8)));
});

test("ignores unsupported provider events", () => {
  assert.equal(
    projectLiveEvent({
      payload: { hook_event_name: "Notification" },
      result: {},
      config: { mode: "warn" },
      key: Buffer.alloc(32),
      seq: 1,
      elapsedMs: 0,
    }),
    null,
  );
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hook = path.join(root, "scripts/hook.mjs");

function invoke(payload, extraEnv = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "awf-hook-"));
  return spawnSync(process.execPath, [hook], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
      ...extraEnv,
    },
  });
}

test("accepts a Codex UserPromptSubmit fixture", () => {
  const result = invoke({
    session_id: "codex-1",
    transcript_path: null,
    cwd: root,
    hook_event_name: "UserPromptSubmit",
    model: "test-model",
    permission_mode: "default",
    turn_id: "turn-1",
    prompt: "Fix the TypeError in src/auth.ts and verify with npm test.",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {});
});

test("accepts a Claude UserPromptSubmit fixture and keeps unknown fields", () => {
  const result = invoke({
    session_id: "claude-1",
    transcript_path: "/tmp/claude.jsonl",
    cwd: root,
    hook_event_name: "UserPromptSubmit",
    permission_mode: "default",
    prompt_id: "prompt-1",
    prompt: "Build everything and keep going until complete",
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(
    output.hookSpecificOutput.hookEventName,
    "UserPromptSubmit",
  );
});

test("handles Claude PostToolUseFailure through the real stdio hook", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "awf-claude-failure-"));
  const extraEnv = {
    AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
    AGENT_WASTE_FIREWALL_MODE: "block",
  };
  let result;
  for (let index = 1; index <= 2; index += 1) {
    invoke(
      {
        session_id: "claude-failure-1",
        cwd: root,
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_use_id: `tool-${index}`,
        tool_input: { command: "npm test" },
      },
      extraEnv,
    );
    invoke(
      {
        session_id: "claude-failure-1",
        cwd: root,
        hook_event_name: "PostToolUseFailure",
        tool_name: "Bash",
        tool_use_id: `tool-${index}`,
        tool_input: { command: "npm test" },
        error: "Command exited with non-zero status code 1",
        is_interrupt: false,
      },
      extraEnv,
    );
  }
  result = invoke(
    {
      session_id: "claude-failure-1",
      cwd: root,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_use_id: "tool-3",
      tool_input: { command: "npm test" },
    },
    extraEnv,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(result.stdout).hookSpecificOutput.permissionDecision,
    "deny",
  );
});

test("fails open with a visible, non-sensitive warning when stdin is invalid", () => {
  const result = invoke("{not-json", {
    AGENT_WASTE_FIREWALL_DEBUG: "0",
  });
  assert.equal(result.status, 0);
  assert.match(
    JSON.parse(result.stdout).systemMessage,
    /failed open: this event was not checked/u,
  );
  assert.equal(result.stdout.includes("not-json"), false);
});

test("rate-limits repeated fail-open warnings", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "awf-fail-open-"));
  const extraEnv = { AGENT_WASTE_FIREWALL_DATA_DIR: dataDir };
  const first = invoke("{bad-json", extraEnv);
  const second = invoke("{bad-json", extraEnv);
  assert.match(
    JSON.parse(first.stdout).systemMessage,
    /failed open/u,
  );
  assert.deepEqual(JSON.parse(second.stdout), {});
});

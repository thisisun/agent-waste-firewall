import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  canonicalHelperWorkerHandshake,
  helperWorkerHandshake,
  nativeWorkerCompatible,
  NATIVE_WORKER_ARGUMENTS,
  PORTABLE_WORKER_ARGUMENTS,
  workerInvocationCompatible,
} from "../src/helper-worker-handshake.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hook = path.join(root, "scripts/hook.mjs");

function invoke(payload, extraEnv = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "awf-hook-"));
  return spawnSync(
    process.execPath,
    [hook, ...PORTABLE_WORKER_ARGUMENTS],
    {
      input: typeof payload === "string" ? payload : JSON.stringify(payload),
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
        ...extraEnv,
      },
    },
  );
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
  }, {
    AGENT_WASTE_FIREWALL_PLATFORM: "codex",
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
  }, {
    AGENT_WASTE_FIREWALL_PLATFORM: "claude",
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
    AGENT_WASTE_FIREWALL_PLATFORM: "claude",
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
    AGENT_WASTE_FIREWALL_PLATFORM: "claude",
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
  extraEnv.AGENT_WASTE_FIREWALL_PLATFORM = "claude";
  const first = invoke("{bad-json", extraEnv);
  const second = invoke("{bad-json", extraEnv);
  assert.match(
    JSON.parse(first.stdout).systemMessage,
    /failed open/u,
  );
  assert.deepEqual(JSON.parse(second.stdout), {});
});

test("debug fail-open diagnostics never echo malformed raw input", (context) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "awf-debug-fail-open-"));
  context.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const canary = "RAW-CLAUDE-PROMPT-CANARY-66f0de62";
  const result = invoke(`${canary}{`, {
    AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
    AGENT_WASTE_FIREWALL_DEBUG: "1",
    AGENT_WASTE_FIREWALL_PLATFORM: "claude",
  });

  assert.equal(result.status, 0);
  assert.match(result.stderr, /processing failed; this event was not checked/u);
  assert.equal(result.stdout.includes(canary), false);
  assert.equal(result.stderr.includes(canary), false);
  assert.deepEqual(fs.readdirSync(dataDir), []);
});

test("rootless portable worker invocation fails open without monitoring", (context) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "awf-provider-boundary-"));
  context.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const canary = "RAW-ROOTLESS-WORKER-CANARY-a9e06f4d";
  const result = spawnSync(
    process.execPath,
    [hook, ...PORTABLE_WORKER_ARGUMENTS],
    {
      input: `${canary}\n`,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
        AGENT_WASTE_FIREWALL_PLATFORM: "",
      },
    },
  );

  assert.equal(result.status, 0);
  assert.match(result.stderr, /compatibility check failed open/u);
  assert.equal(result.stdout.includes(canary), false);
  assert.equal(result.stderr.includes(canary), false);
  assert.deepEqual(fs.readdirSync(dataDir), []);
});

test("native worker compatibility is exact and tied to the pinned runtime", () => {
  const marker = fs.readFileSync(
    path.join(root, "protocol", "helper-worker-handshake-v1.json"),
    "utf8",
  );
  assert.equal(
    marker,
    canonicalHelperWorkerHandshake(
      helperWorkerHandshake("24.18.0"),
    ),
  );
  assert.equal(marker, canonicalHelperWorkerHandshake());
  assert.equal(
    nativeWorkerCompatible({
      arguments: [...NATIVE_WORKER_ARGUMENTS],
      nodeVersion: "24.18.0",
    }),
    true,
  );
  assert.equal(
    nativeWorkerCompatible({
      arguments: [...NATIVE_WORKER_ARGUMENTS],
      nodeVersion: "22.22.0",
    }),
    false,
  );
  assert.equal(
    nativeWorkerCompatible({
      arguments: [
        "--awf-worker-protocol",
        "2",
        "--awf-runtime-major",
        "24",
      ],
      nodeVersion: "24.18.0",
    }),
    false,
  );
  assert.equal(
    workerInvocationCompatible({
      arguments: [...PORTABLE_WORKER_ARGUMENTS],
      nodeVersion: "18.20.8",
    }),
    true,
  );
  assert.equal(
    workerInvocationCompatible({
      arguments: [],
      nodeVersion: "24.18.0",
    }),
    false,
  );
});

test("incompatible native arguments fail open without reading or monitoring", () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-worker-handshake-"),
  );
  const canary = "RAW-HANDSHAKE-INPUT-CANARY-0f409d6a";
  const result = spawnSync(
    process.execPath,
    [
      hook,
      "--awf-worker-protocol",
      "2",
      "--awf-runtime-major",
      "24",
      "--unknown-raw-key",
      canary,
    ],
    {
      input: `${canary}\n`,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
      },
    },
  );

  assert.equal(result.status, 0);
  assert.match(
    JSON.parse(result.stdout).systemMessage,
    /failed open: this event was not checked/u,
  );
  assert.match(result.stderr, /compatibility check failed open/u);
  assert.equal(result.stdout.includes(canary), false);
  assert.equal(result.stderr.includes(canary), false);
  assert.deepEqual(fs.readdirSync(dataDir), []);
});

test("a zero-argument legacy invocation fails open without monitoring", () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-worker-zero-arguments-"),
  );
  const canary = "RAW-ZERO-ARGUMENT-CANARY-23d85eb1";
  const result = spawnSync(process.execPath, [hook], {
    input: `${canary}\n`,
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
    },
  });

  assert.equal(result.status, 0);
  assert.match(
    JSON.parse(result.stdout).systemMessage,
    /failed open: this event was not checked/u,
  );
  assert.match(result.stderr, /compatibility check failed open/u);
  assert.equal(result.stdout.includes(canary), false);
  assert.equal(result.stderr.includes(canary), false);
  assert.deepEqual(fs.readdirSync(dataDir), []);
});

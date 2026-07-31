import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { configFromEnv } from "../src/config.mjs";
import { handleHook } from "../src/engine.mjs";
import { StateStore } from "../src/state-store.mjs";
import { normalizeToolEvent } from "../src/tool-event.mjs";

function harness(mode = "warn", cwd = fs.mkdtempSync(path.join(os.tmpdir(), "awf-repo-"))) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "awf-state-"));
  const env = {
    AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
    AGENT_WASTE_FIREWALL_MODE: mode,
  };
  const config = configFromEnv(env);
  const store = new StateStore({ root: dataDir });
  return { cwd, dataDir, env, config, store };
}

function payload(context, event, extra = {}) {
  return {
    session_id: "session-1",
    cwd: context.cwd,
    hook_event_name: event,
    model: "test-model",
    turn_id: "turn-1",
    permission_mode: "default",
    ...extra,
  };
}

function run(context, event, extra = {}) {
  return handleHook(payload(context, event, extra), context);
}

function storedBytes(root) {
  const chunks = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(target);
      } else if (entry.isFile()) {
        chunks.push(fs.readFileSync(target));
      }
    }
  };
  visit(root);
  return Buffer.concat(chunks).toString("utf8");
}

test("warns on an underspecified prompt but stores no raw prompt", () => {
  const context = harness("warn");
  const secretPrompt =
    "전체 저장소를 알아서 개선하고 끝날 때까지 멈추지 마 SECRET-RAW-PROMPT";
  const result = run(context, "UserPromptSubmit", { prompt: secretPrompt });
  assert.equal(
    result.output.hookSpecificOutput.hookEventName,
    "UserPromptSubmit",
  );
  const stateFile = fs
    .readdirSync(path.join(context.dataDir, "sessions"))
    .find((name) => name.endsWith(".json"));
  const stored = fs.readFileSync(
    path.join(context.dataDir, "sessions", stateFile),
    "utf8",
  );
  assert.equal(stored.includes("SECRET-RAW-PROMPT"), false);
});

test("blocks only high-severity prompts in explicit block mode", () => {
  const context = harness("block");
  const result = run(context, "UserPromptSubmit", {
    prompt: "전체 저장소를 알아서 개선하고 끝날 때까지 멈추지 마",
  });
  assert.equal(result.output.decision, "block");
  assert.match(result.output.reason, /AWF/u);
});

test("a repeated severe prompt remains blocked even when its warning is deduplicated", () => {
  const context = harness("block");
  const prompt = "전체 저장소를 알아서 개선하고 끝날 때까지 멈추지 마";
  run(context, "UserPromptSubmit", { prompt });
  const repeated = run(context, "UserPromptSubmit", { prompt });
  assert.equal(repeated.incident.shouldNotify, false);
  assert.equal(repeated.output.decision, "block");
});

test("blocks the fourth identical tool call with no progress", () => {
  const context = harness("block");
  let result;
  for (let index = 1; index <= 4; index += 1) {
    result = run(context, "PreToolUse", {
      tool_name: "Bash",
      tool_use_id: `tool-${index}`,
      tool_input: { command: "git status --short" },
    });
  }
  assert.equal(
    result.output.hookSpecificOutput.permissionDecision,
    "deny",
  );
  assert.equal(result.incident.ruleId, "exact_tool_repeat");
  assert.equal(result.incident.category, "agent");
});

test("repeated denials explicitly tell the agent to stop retrying", () => {
  const context = harness("block");
  let result;
  for (let index = 1; index <= 5; index += 1) {
    result = run(context, "PreToolUse", {
      tool_name: "Bash",
      tool_use_id: `denial-${index}`,
      tool_input: { command: "git status --short" },
    });
  }
  assert.equal(result.output.hookSpecificOutput.permissionDecision, "deny");
  assert.match(
    result.output.hookSpecificOutput.permissionDecisionReason,
    /Do not retry it again/u,
  );
});

test("blocks a third attempt after two identical failures", () => {
  const context = harness("block");
  for (let index = 1; index <= 2; index += 1) {
    run(context, "PreToolUse", {
      tool_name: "Bash",
      tool_use_id: `tool-${index}`,
      tool_input: { command: "npm test" },
    });
    run(context, "PostToolUse", {
      tool_name: "Bash",
      tool_use_id: `tool-${index}`,
      tool_input: { command: "npm test" },
      tool_response: { exit_code: 1, stderr: "TypeError: same failure" },
    });
  }
  const result = run(context, "PreToolUse", {
    tool_name: "Bash",
    tool_use_id: "tool-3",
    tool_input: { command: "npm test" },
  });
  assert.equal(result.incident.ruleId, "retry_after_same_failure");
  assert.equal(
    result.output.hookSpecificOutput.permissionDecision,
    "deny",
  );
});

test("recognizes Codex model-facing non-zero exit text as a failure", () => {
  const context = harness("block");
  for (let index = 1; index <= 2; index += 1) {
    run(context, "PreToolUse", {
      tool_name: "Bash",
      tool_use_id: `codex-${index}`,
      tool_input: { command: "npm test" },
    });
    run(context, "PostToolUse", {
      tool_name: "Bash",
      tool_use_id: `codex-${index}`,
      tool_input: { command: "npm test" },
      tool_response: "Process exited with code 1\nFAIL auth",
    });
  }
  const result = run(context, "PreToolUse", {
    tool_name: "Bash",
    tool_use_id: "codex-3",
    tool_input: { command: "npm test" },
  });
  assert.equal(result.incident.ruleId, "retry_after_same_failure");
  assert.equal(result.output.hookSpecificOutput.permissionDecision, "deny");
});

test("normalizes volatile Codex wrapper metadata in failure fingerprints", () => {
  const common = {
    session_id: "codex-wrapper",
    turn_id: "turn-1",
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
  };
  const first = normalizeToolEvent(
    {
      ...common,
      tool_response: {
        chunk_id: "abc123",
        wall_time_seconds: 0.41,
        exit_code: 1,
        output: "TypeError: same failure",
      },
    },
    { platform: "codex" },
  );
  const second = normalizeToolEvent(
    {
      ...common,
      tool_response: {
        chunk_id: "xyz789",
        wall_time_seconds: 1.92,
        exit_code: 1,
        output: "TypeError: same failure",
      },
    },
    { platform: "codex" },
  );
  assert.equal(first.resultFingerprint, second.resultFingerprint);
  assert.equal(first.failed, true);
  assert.equal(second.failed, true);
});

test("normalizes volatile Codex wrapper labels in string output", () => {
  const common = {
    session_id: "codex-wrapper-text",
    turn_id: "turn-1",
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
  };
  const first = normalizeToolEvent({
    ...common,
    tool_response:
      "Chunk ID: aa11\nWall time: 0.4 seconds\nProcess exited with code 1\nTypeError",
  });
  const second = normalizeToolEvent({
    ...common,
    tool_response:
      "Chunk ID: zz99\nWall time: 1.8 seconds\nProcess exited with code 1\nTypeError",
  });
  assert.equal(first.resultFingerprint, second.resultFingerprint);
});

test("does not infer failure from successful Codex application output", () => {
  const response = normalizeToolEvent(
    {
      session_id: "codex-success",
      turn_id: "turn-1",
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      tool_response:
        'Process exited with code 0\nExpected: "User not found" Received: "Unauthorized"',
    },
    { platform: "codex" },
  );
  assert.equal(response.failed, false);
});

test("treats Claude PostToolUse as success even when output contains error words", () => {
  const response = normalizeToolEvent(
    {
      session_id: "claude-success",
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "grep error: app.log" },
      tool_response: { stdout: "exception: user not found" },
    },
    { platform: "claude" },
  );
  assert.equal(response.failed, false);
});

test("attributes repeated infrastructure failures to the environment", () => {
  const context = harness("warn");
  let result;
  for (let index = 1; index <= 3; index += 1) {
    run(context, "PreToolUse", {
      tool_name: "Bash",
      tool_use_id: `network-${index}`,
      tool_input: { command: "npm test" },
    });
    result = run(context, "PostToolUse", {
      tool_name: "Bash",
      tool_use_id: `network-${index}`,
      tool_input: { command: "npm test" },
      tool_response: {
        exit_code: 1,
        stderr: "ECONNREFUSED: network unavailable",
      },
    });
  }
  assert.equal(result.incident.ruleId, "repeated_failure_result");
  assert.equal(result.incident.category, "environment");
});

test("does not mistake application assertion text for an environment failure", () => {
  const context = harness("warn");
  let result;
  for (let index = 1; index <= 3; index += 1) {
    run(context, "PreToolUse", {
      tool_name: "Bash",
      tool_use_id: `assertion-${index}`,
      tool_input: { command: "npm test" },
    });
    result = run(context, "PostToolUse", {
      tool_name: "Bash",
      tool_use_id: `assertion-${index}`,
      tool_input: { command: "npm test" },
      tool_response: {
        exit_code: 1,
        stderr: 'Expected: "User not found" Received: "Unauthorized"',
      },
    });
  }
  assert.equal(result.incident.ruleId, "repeated_failure_result");
  assert.equal(result.incident.category, "agent");
});

test("different failure results do not become an identical-failure block", () => {
  const context = harness("block");
  for (const [index, stderr] of ["first error", "second error"].entries()) {
    run(context, "PreToolUse", {
      tool_name: "Bash",
      tool_use_id: `different-${index}`,
      tool_input: { command: "npm test" },
    });
    run(context, "PostToolUse", {
      tool_name: "Bash",
      tool_use_id: `different-${index}`,
      tool_input: { command: "npm test" },
      tool_response: { exit_code: 1, stderr },
    });
  }
  const result = run(context, "PreToolUse", {
    tool_name: "Bash",
    tool_use_id: "different-3",
    tool_input: { command: "npm test" },
  });
  assert.notEqual(
    result.output.hookSpecificOutput?.permissionDecision,
    "deny",
  );
});

test("a recovered command resets its earlier failure streak", () => {
  const context = harness("block");
  run(context, "PreToolUse", {
    tool_name: "Bash",
    tool_use_id: "recover-1",
    tool_input: { command: "custom-health-check" },
  });
  run(context, "PostToolUse", {
    tool_name: "Bash",
    tool_use_id: "recover-1",
    tool_input: { command: "custom-health-check" },
    tool_response: { exit_code: 1, stderr: "service unavailable" },
  });
  run(context, "PreToolUse", {
    tool_name: "Bash",
    tool_use_id: "recover-2",
    tool_input: { command: "custom-health-check" },
  });
  run(context, "PostToolUse", {
    tool_name: "Bash",
    tool_use_id: "recover-2",
    tool_input: { command: "custom-health-check" },
    tool_response: { exit_code: 0, stdout: "healthy" },
  });
  const result = run(context, "PreToolUse", {
    tool_name: "Bash",
    tool_use_id: "recover-3",
    tool_input: { command: "custom-health-check" },
  });
  assert.equal(result.incident, null);
  assert.deepEqual(result.output, {});
});

test("a user interruption resets repeat accounting and is not blamed on the agent", () => {
  const context = harness("block");
  for (let index = 1; index <= 2; index += 1) {
    run(context, "PreToolUse", {
      tool_name: "Bash",
      tool_use_id: `interrupt-${index}`,
      tool_input: { command: "npm test" },
    });
    run(context, "PostToolUseFailure", {
      tool_name: "Bash",
      tool_use_id: `interrupt-${index}`,
      tool_input: { command: "npm test" },
      error: "Interrupted by user",
      is_interrupt: true,
    });
  }
  const result = run(context, "PreToolUse", {
    tool_name: "Bash",
    tool_use_id: "interrupt-3",
    tool_input: { command: "npm test" },
  });
  assert.equal(result.incident, null);
  assert.deepEqual(result.output, {});
});

test("changing status responses count as progress", () => {
  const context = harness("block");
  for (const [index, progress] of [25, 50, 75].entries()) {
    run(context, "PreToolUse", {
      tool_name: "mcp__jobs__status",
      tool_use_id: `status-${index}`,
      tool_input: { job_id: "job-1" },
    });
    run(context, "PostToolUse", {
      tool_name: "mcp__jobs__status",
      tool_use_id: `status-${index}`,
      tool_input: { job_id: "job-1" },
      tool_response: { progress },
    });
  }
  const result = run(context, "PreToolUse", {
    tool_name: "mcp__jobs__status",
    tool_use_id: "status-4",
    tool_input: { job_id: "job-1" },
  });
  assert.equal(result.incident, null);
  assert.deepEqual(result.output, {});
});

test("the same shell command in different workdirs has different signatures", () => {
  const context = harness("block");
  let result;
  for (let index = 0; index < 4; index += 1) {
    result = run(context, "PreToolUse", {
      tool_name: "Bash",
      tool_use_id: `monorepo-${index}`,
      tool_input: {
        command: "npm test",
        workdir: index % 2 ? "packages/a" : "packages/b",
      },
    });
  }
  assert.notEqual(
    result.output.hookSpecificOutput?.permissionDecision,
    "deny",
  );
});

test("classifies costly release stages and external-change risks without storing commands", () => {
  const cases = [
    ["pnpm release:1.0.5:candidate:check", "verify", "none"],
    ["pnpm native:android:bundle", "sign", "signing"],
    ["supabase db push --linked", "migrate", "production_change"],
    ["vercel deploy --prod", "deploy", "production_change"],
    ["fastlane pilot", "submit", "submission"],
    ["git push origin main", "command", "external_change"],
  ];
  for (const [command, operation, risk] of cases) {
    const normalized = normalizeToolEvent({
      session_id: "release-risk",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command },
    });
    assert.equal(normalized.operation, operation, command);
    assert.equal(normalized.risk, risk, command);
  }
});

test("does not collapse meaningful whitespace inside shell commands", () => {
  const common = {
    session_id: "shell-spacing",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
  };
  const first = normalizeToolEvent({
    ...common,
    tool_input: { command: 'printf "a  b"' },
  });
  const second = normalizeToolEvent({
    ...common,
    tool_input: { command: 'printf "a b"' },
  });
  assert.notEqual(first.signature, second.signature);
});

test("identical successful test results eventually trigger the circuit breaker", () => {
  const context = harness("block");
  let result;
  for (let index = 1; index <= 5; index += 1) {
    result = run(context, "PreToolUse", {
      tool_name: "Bash",
      tool_use_id: `passing-${index}`,
      tool_input: { command: "npm test" },
    });
    if (result.output.hookSpecificOutput?.permissionDecision === "deny") {
      break;
    }
    run(context, "PostToolUse", {
      tool_name: "Bash",
      tool_use_id: `passing-${index}`,
      tool_input: { command: "npm test" },
      tool_response: { exit_code: 0, stdout: "10 tests passed in 50 ms" },
    });
  }
  assert.equal(result.output.hookSpecificOutput.permissionDecision, "deny");
});

test("warns on the second identical high-cost verification with no progress", () => {
  const context = harness("warn");
  run(context, "PreToolUse", {
    tool_name: "Bash",
    tool_use_id: "candidate-1",
    tool_input: { command: "pnpm release:1.0.5:candidate:check" },
  });
  run(context, "PostToolUse", {
    tool_name: "Bash",
    tool_use_id: "candidate-1",
    tool_input: { command: "pnpm release:1.0.5:candidate:check" },
    tool_response: { exit_code: 0, stdout: "candidate passed" },
  });
  const repeated = run(context, "PreToolUse", {
    tool_name: "Bash",
    tool_use_id: "candidate-2",
    tool_input: { command: "pnpm release:1.0.5:candidate:check" },
  });
  assert.equal(repeated.incident.ruleId, "exact_tool_repeat");
  assert.equal(repeated.incident.evidence.highCostOperation, true);
  assert.equal(
    repeated.output.hookSpecificOutput.hookEventName,
    "PreToolUse",
  );
});

test("a real file change resets no-progress repeat accounting", () => {
  const context = harness("block");
  const target = path.join(context.cwd, "example.js");
  fs.writeFileSync(target, "export const value = 1;\n");
  for (let index = 1; index <= 3; index += 1) {
    run(context, "PreToolUse", {
      tool_name: "Bash",
      tool_use_id: `inspect-${index}`,
      tool_input: { command: "git status --short" },
    });
  }
  run(context, "PreToolUse", {
    tool_name: "apply_patch",
    tool_use_id: "edit-1",
    tool_input: {
      command: "*** Begin Patch\n*** Update File: example.js\n*** End Patch",
    },
  });
  fs.writeFileSync(target, "export const value = 2;\n");
  run(context, "PostToolUse", {
    tool_name: "apply_patch",
    tool_use_id: "edit-1",
    tool_input: {
      command: "*** Begin Patch\n*** Update File: example.js\n*** End Patch",
    },
    tool_response: { success: true },
  });
  const result = run(context, "PreToolUse", {
    tool_name: "Bash",
    tool_use_id: "inspect-4",
    tool_input: { command: "git status --short" },
  });
  assert.equal(result.incident, null);
  assert.deepEqual(result.output, {});
});

test("attributes repeated polling of one target to the harness", () => {
  const context = harness("warn");
  let result;
  for (let index = 1; index <= 3; index += 1) {
    result = run(context, "PreToolUse", {
      tool_name: "wait_agent",
      tool_use_id: `wait-${index}`,
      tool_input: { target: "agent-1", timeout_ms: 30_000 },
    });
  }
  assert.equal(result.incident.ruleId, "status_polling_loop");
  assert.equal(result.incident.category, "harness");
});

test("waits for different targets are not combined into one polling loop", () => {
  const context = harness("block");
  let result;
  for (let index = 1; index <= 5; index += 1) {
    result = run(context, "PreToolUse", {
      tool_name: "wait_agent",
      tool_use_id: `target-${index}`,
      tool_input: { target: `agent-${index}`, timeout_ms: 30_000 },
    });
  }
  assert.equal(result.incident, null);
  assert.deepEqual(result.output, {});
});

test("block mode still emits non-blocking warnings", () => {
  const context = harness("block");
  let result;
  for (let index = 1; index <= 3; index += 1) {
    result = run(context, "PreToolUse", {
      tool_name: "Read",
      tool_use_id: `read-${index}`,
      tool_input: { file_path: "src/auth.js" },
    });
  }
  assert.equal(result.incident.ruleId, "unchanged_reread");
  assert.equal(
    result.output.hookSpecificOutput.hookEventName,
    "PreToolUse",
  );
});

test("deduplicates repeated warning context until progress changes", () => {
  const context = harness("warn");
  let third;
  let fourth;
  for (let index = 1; index <= 4; index += 1) {
    const result = run(context, "PreToolUse", {
      tool_name: "Read",
      tool_use_id: `dedupe-${index}`,
      tool_input: { file_path: "src/auth.js" },
    });
    if (index === 3) third = result;
    if (index === 4) fourth = result;
  }
  assert.equal(
    third.output.hookSpecificOutput.hookEventName,
    "PreToolUse",
  );
  assert.deepEqual(fourth.output, {});
  assert.equal(fourth.incident.shouldNotify, false);
});

test("detects edit-revert oscillation from file content", () => {
  const context = harness("warn");
  const target = path.join(context.cwd, "oscillate.js");
  fs.writeFileSync(target, "A\n");

  run(context, "PreToolUse", {
    tool_name: "Edit",
    tool_use_id: "edit-a",
    tool_input: { file_path: target, old_string: "A", new_string: "B" },
  });
  fs.writeFileSync(target, "B\n");
  run(context, "PostToolUse", {
    tool_name: "Edit",
    tool_use_id: "edit-a",
    tool_input: { file_path: target, old_string: "A", new_string: "B" },
    tool_response: { success: true },
  });

  run(context, "PreToolUse", {
    tool_name: "Edit",
    tool_use_id: "edit-b",
    tool_input: { file_path: target, old_string: "B", new_string: "A" },
  });
  fs.writeFileSync(target, "A\n");
  const result = run(context, "PostToolUse", {
    tool_name: "Edit",
    tool_use_id: "edit-b",
    tool_input: { file_path: target, old_string: "B", new_string: "A" },
    tool_response: { success: true },
  });
  assert.equal(result.incident.ruleId, "edit_revert_oscillation");
  assert.equal(result.incident.category, "agent");
  const state = context.store.listStates()[0];
  assert.equal(state.progressVersion, 1);
});

test("does not report a productive A-B-C edit sequence as oscillation", () => {
  const context = harness("warn");
  const target = path.join(context.cwd, "productive.js");
  fs.writeFileSync(target, "A\n");

  run(context, "PreToolUse", {
    tool_name: "Edit",
    tool_use_id: "productive-a",
    tool_input: { file_path: target, old_string: "A", new_string: "B" },
  });
  fs.writeFileSync(target, "B\n");
  const first = run(context, "PostToolUse", {
    tool_name: "Edit",
    tool_use_id: "productive-a",
    tool_input: { file_path: target, old_string: "A", new_string: "B" },
    tool_response: { success: true },
  });

  run(context, "PreToolUse", {
    tool_name: "Edit",
    tool_use_id: "productive-b",
    tool_input: { file_path: target, old_string: "B", new_string: "C" },
  });
  fs.writeFileSync(target, "C\n");
  const second = run(context, "PostToolUse", {
    tool_name: "Edit",
    tool_use_id: "productive-b",
    tool_input: { file_path: target, old_string: "B", new_string: "C" },
    tool_response: { success: true },
  });

  assert.equal(first.incident, null);
  assert.equal(second.incident, null);
});

test("persists only closed aliases and excludes raw hook canaries", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "SECRET-WORKSPACE-CANARY-"));
  const context = harness("warn", cwd);
  const target = path.join(cwd, "src", "SECRET-FILENAME-CANARY.js");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "SECRET-SOURCE-CONTENT-A\n");

  run(context, "UserPromptSubmit", {
    prompt: "Refactor everything forever SECRET-PROMPT-CANARY",
  });

  let repeatedRead;
  for (let index = 0; index < 3; index += 1) {
    repeatedRead = run(context, "PreToolUse", {
      tool_name: "private__read_file_SECRET-TOOL-NAME",
      tool_use_id: `privacy-read-${index}`,
      tool_input: {
        file_path: target,
        query: "SECRET-TOOL-INPUT-CANARY",
      },
    });
  }
  assert.equal(repeatedRead.incident.ruleId, "unchanged_reread");

  run(context, "PreToolUse", {
    tool_name: "private__edit_SECRET-WRITE-TOOL",
    tool_use_id: "privacy-write",
    tool_input: {
      file_path: target,
      old_string: "SECRET-SOURCE-CONTENT-A",
      new_string: "SECRET-SOURCE-CONTENT-B",
    },
  });
  fs.writeFileSync(target, "SECRET-SOURCE-CONTENT-B\n");
  run(context, "PostToolUse", {
    tool_name: "private__edit_SECRET-WRITE-TOOL",
    tool_use_id: "privacy-write",
    tool_input: {
      file_path: target,
      old_string: "SECRET-SOURCE-CONTENT-A",
      new_string: "SECRET-SOURCE-CONTENT-B",
    },
    tool_response: {
      success: true,
      stdout: "SECRET-TOOL-OUTPUT-CANARY",
    },
  });

  run(context, "PreToolUse", {
    tool_name: "Bash",
    tool_use_id: "privacy-shell",
    tool_input: { command: "echo SECRET-COMMAND-CANARY" },
  });
  run(context, "PostToolUse", {
    tool_name: "Bash",
    tool_use_id: "privacy-shell",
    tool_input: { command: "echo SECRET-COMMAND-CANARY" },
    tool_response: { exit_code: 0, stdout: "SECRET-SHELL-OUTPUT-CANARY" },
  });

  const sessionsDir = path.join(context.dataDir, "sessions");
  const stateFile = fs
    .readdirSync(sessionsDir)
    .find((name) => name.endsWith(".json"));
  const statePath = path.join(sessionsDir, stateFile);
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const stored = storedBytes(context.dataDir);

  assert.equal(state.schemaVersion, 4);
  assert.match(state.sessionAlias, /^session_[a-f0-9]{32}$/u);
  assert.match(state.workspaceAlias, /^workspace_[a-f0-9]{32}$/u);
  assert.ok(Object.keys(state.files).every((item) => /^path_[a-f0-9]{32}$/u.test(item)));
  assert.ok(state.incidents.some((item) => item.ruleId === "unchanged_reread"));
  for (const forbiddenKey of [
    '"workspaceLabel"',
    '"workspacePathHash"',
    '"toolName"',
    '"message"',
    '"recommendation"',
    '"project"',
  ]) {
    assert.equal(stored.includes(forbiddenKey), false);
  }
  for (const secret of [
    path.basename(cwd),
    target,
    path.basename(target),
    "SECRET-TOOL-NAME",
    "SECRET-WRITE-TOOL",
    "SECRET-PROMPT-CANARY",
    "SECRET-TOOL-INPUT-CANARY",
    "SECRET-TOOL-OUTPUT-CANARY",
    "SECRET-COMMAND-CANARY",
    "SECRET-SHELL-OUTPUT-CANARY",
    "SECRET-SOURCE-CONTENT-A",
    "SECRET-SOURCE-CONTENT-B",
  ]) {
    assert.equal(stored.includes(secret), false, secret);
  }
  assert.equal(fs.statSync(sessionsDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
});

test("drops unknown fields from current-version detector state", () => {
  const context = harness("warn");
  run(context, "UserPromptSubmit", {
    prompt: "Refactor everything forever",
  });
  for (let index = 0; index < 3; index += 1) {
    run(context, "PreToolUse", {
      tool_name: "Read",
      tool_use_id: `unknown-${index}`,
      tool_input: { file_path: "src/example.js" },
    });
  }

  const sessionsDir = path.join(context.dataDir, "sessions");
  const filename = fs
    .readdirSync(sessionsDir)
    .find((name) => name.endsWith(".json"));
  const statePath = path.join(sessionsDir, filename);
  const injected = JSON.parse(fs.readFileSync(statePath, "utf8"));
  injected.rawPrompt = "SECRET-INJECTED-TOP-LEVEL";
  injected.workspaceLabel = "SECRET-INJECTED-WORKSPACE";
  injected.prompt.project = { rawPath: "SECRET-INJECTED-PROMPT-PATH" };
  injected.toolEvents[0].rawToolInput = "SECRET-INJECTED-TOOL-INPUT";
  injected.incidents[0].message = "SECRET-INJECTED-INCIDENT-MESSAGE";
  fs.writeFileSync(statePath, `${JSON.stringify(injected)}\n`);

  run(context, "PreToolUse", {
    tool_name: "Read",
    tool_use_id: "unknown-cleanup",
    tool_input: { file_path: "src/example.js" },
  });

  const cleaned = fs.readFileSync(statePath, "utf8");
  for (const secret of [
    "SECRET-INJECTED-TOP-LEVEL",
    "SECRET-INJECTED-WORKSPACE",
    "SECRET-INJECTED-PROMPT-PATH",
    "SECRET-INJECTED-TOOL-INPUT",
    "SECRET-INJECTED-INCIDENT-MESSAGE",
  ]) {
    assert.equal(cleaned.includes(secret), false);
  }
});

test("replaces a legacy detector state when that session becomes active", () => {
  const context = harness("warn");
  const currentPayload = payload(context, "UserPromptSubmit", {
    prompt: "Refactor everything forever",
  });
  const sessionsDir = path.join(context.dataDir, "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });
  const statePath = context.store.statePath(context.store.keyFor(currentPayload));
  fs.writeFileSync(
    statePath,
    `${JSON.stringify({
      schemaVersion: 3,
      workspaceLabel: "SECRET-LEGACY-WORKSPACE",
      files: { "SECRET-LEGACY-PATH.js": {} },
      rawPrompt: "SECRET-LEGACY-PROMPT",
    })}\n`,
    { mode: 0o600 },
  );

  handleHook(currentPayload, context);

  const replaced = fs.readFileSync(statePath, "utf8");
  assert.equal(JSON.parse(replaced).schemaVersion, 4);
  for (const secret of [
    "SECRET-LEGACY-WORKSPACE",
    "SECRET-LEGACY-PATH",
    "SECRET-LEGACY-PROMPT",
  ]) {
    assert.equal(replaced.includes(secret), false);
  }
});

test("stores hashes instead of raw session, command, output, or absolute workspace path", () => {
  const context = harness("warn");
  const secretSession = "SECRET-SESSION-ID";
  const secretCommand = "echo SECRET-COMMAND";
  const base = {
    session_id: secretSession,
    cwd: context.cwd,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_use_id: "privacy-1",
    tool_input: { command: secretCommand },
  };
  handleHook(base, context);
  handleHook(
    {
      ...base,
      hook_event_name: "PostToolUse",
      tool_response: { exit_code: 0, stdout: "SECRET-OUTPUT" },
    },
    context,
  );
  const stateFile = fs
    .readdirSync(path.join(context.dataDir, "sessions"))
    .find((name) => name.endsWith(".json"));
  const stored = fs.readFileSync(
    path.join(context.dataDir, "sessions", stateFile),
    "utf8",
  );
  for (const secret of [
    secretSession,
    secretCommand,
    "SECRET-OUTPUT",
    context.cwd,
  ]) {
    assert.equal(stored.includes(secret), false);
  }
});

test("scopes tool and result fingerprints to the session", () => {
  const common = {
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
    tool_response: { exit_code: 0, stdout: "all passed" },
  };
  const first = normalizeToolEvent({ ...common, session_id: "scope-a" });
  const second = normalizeToolEvent({ ...common, session_id: "scope-b" });
  assert.notEqual(first.signature, second.signature);
  assert.notEqual(first.resultFingerprint, second.resultFingerprint);
});

test("scopes persisted file-content hashes to the session", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "awf-file-scope-"));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "awf-file-state-"));
  const target = path.join(cwd, "shared.js");
  fs.writeFileSync(target, "export const shared = true;\n");
  const env = {
    AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
    AGENT_WASTE_FIREWALL_MODE: "warn",
  };
  const config = configFromEnv(env);
  const store = new StateStore({ root: dataDir });

  for (const sessionId of ["scope-a", "scope-b"]) {
    handleHook(
      {
        session_id: sessionId,
        cwd,
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        tool_input: {
          file_path: target,
          old_string: "true",
          new_string: "false",
        },
      },
      { env, config, store },
    );
  }

  const states = store.listStates();
  const pathAliases = states.map((state) => Object.keys(state.files)[0]);
  const hashes = states.map(
    (state) => Object.values(state.files)[0].hashes[0].hash,
  );
  assert.equal(hashes.length, 2);
  assert.ok(pathAliases.every((alias) => /^path_[a-f0-9]{32}$/u.test(alias)));
  assert.notEqual(pathAliases[0], pathAliases[1]);
  assert.notEqual(hashes[0], hashes[1]);
});

test("Stop always allows termination and cannot create a guard loop", () => {
  const context = harness("block");
  const first = run(context, "Stop", {
    stop_hook_active: false,
    last_assistant_message: "Done",
  });
  const repeated = run(context, "Stop", {
    stop_hook_active: true,
    last_assistant_message: "Done again",
  });
  assert.deepEqual(first.output, {});
  assert.deepEqual(repeated.output, {});
});

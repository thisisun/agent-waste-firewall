import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { evaluatePrompt } from "../src/prompt-contract.mjs";

test("passes short conversational follow-ups", () => {
  const result = evaluatePrompt("응 좋아. 시작해");
  assert.equal(result.score, 100);
  assert.equal(result.shouldWarn, false);
  assert.equal(result.isFollowUp, true);
});

test("scopes persisted prompt fingerprints to the session", () => {
  const prompt = "Fix the TypeError in src/auth.ts and verify with npm test.";
  const first = evaluatePrompt(prompt, { hashScope: "session-a" });
  const second = evaluatePrompt(prompt, { hashScope: "session-b" });
  assert.notEqual(first.promptHash, second.promptHash);
});

test("does not hide a broad action behind a follow-up word", () => {
  const result = evaluatePrompt("continue and refactor everything");
  assert.equal(result.isFollowUp, false);
  assert.equal(result.shouldWarn, true);
  assert.ok(result.issues.some((current) => current.id === "broad"));
});

test("recognizes ensure-everything prompts as broad action requests", () => {
  const result = evaluatePrompt("Please ensure everything works");
  assert.equal(result.isAction, true);
  assert.equal(result.shouldWarn, true);
  assert.ok(result.issues.some((current) => current.id === "broad"));
});

test("does not treat all passing tests as an unbounded Korean scope", () => {
  const result = evaluatePrompt(
    "테스트가 모두 통과하도록 src/auth.ts를 수정하고 npm test로 검증해줘",
  );
  assert.equal(result.shouldWarn, false);
  assert.equal(result.score, 100);
});

test("flags broad autonomous work without verification or a stop condition", () => {
  const result = evaluatePrompt(
    "전체 저장소를 알아서 개선하고 끝날 때까지 멈추지 마",
  );
  const ids = result.issues.map((current) => current.id);
  assert.equal(result.severity, "high");
  assert.ok(ids.includes("broad"));
  assert.ok(ids.includes("success"));
  assert.ok(ids.includes("verify"));
  assert.ok(ids.includes("stop"));
});

test("passes a scoped fix with a verification command", () => {
  const result = evaluatePrompt(
    "Fix the TypeError in src/auth/login.ts and verify with npm test.",
  );
  assert.equal(result.shouldWarn, false);
  assert.equal(result.score, 100);
});

test("discovers project verification scripts without reading prompt history", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "awf-project-"));
  fs.writeFileSync(
    path.join(cwd, "package.json"),
    JSON.stringify({ scripts: { test: "node --test", lint: "eslint ." } }),
  );
  const result = evaluatePrompt("Build an authentication system across the app", {
    cwd,
  });
  assert.deepEqual(result.project.verificationCommands, [
    "npm run test",
    "npm run lint",
  ]);
  assert.match(result.suggestedPrompt, /npm run test/u);
});

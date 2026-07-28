import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("prints the package version", () => {
  const packageManifest = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const result = spawnSync(
    process.execPath,
    [path.join(root, "bin/agent-waste-firewall.mjs"), "--version"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), packageManifest.version);
});

test("doctor verifies the incremental dashboard runtime", (context) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "awf-doctor-data-"));
  context.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [path.join(root, "bin/agent-waste-firewall.mjs"), "doctor", "--json"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.ok(
    report.checks.some(
      (check) =>
        check.check === "src/dashboard-trace-cursor.mjs" && check.ok === true,
    ),
  );
});

test("replays a JSONL incident fixture", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, "bin/agent-waste-firewall.mjs"),
      "replay",
      path.join(root, "fixtures/repeated-test-loop.jsonl"),
      "--json",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.eventCount, 8);
  assert.ok(
    parsed.decisions.some(
      (decision) => decision.incident?.ruleId === "repeated_failure_result",
    ),
  );
  assert.ok(
    parsed.sessions[0].recentIncidents.some(
      (incident) => incident.category === "user_instruction",
    ),
  );
});

test("records, audits, exports, and replays an anonymized live hook trace", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "awf-cli-data-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "awf-cli-workspace-"));
  fs.mkdirSync(path.join(workspace, ".git"));
  const cli = path.join(root, "bin/agent-waste-firewall.mjs");
  const hook = path.join(root, "scripts/hook.mjs");
  const env = {
    ...process.env,
    AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
    AGENT_WASTE_FIREWALL_PLATFORM: "codex",
  };
  const run = (args, options = {}) =>
    spawnSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      env,
      ...options,
    });

  const started = run([
    "record",
    "start",
    "--workspace",
    workspace,
    "--label",
    "release-candidate-1",
    "--mode",
    "observe",
    "--json",
  ]);
  assert.equal(started.status, 0, started.stderr);
  const traceId = JSON.parse(started.stdout).traceId;

  const rawPrompt =
    "전체 저장소를 알아서 개선하고 SECRET-CLI-PROMPT 끝날 때까지 멈추지 마";
  const hooked = spawnSync(process.execPath, [hook], {
    encoding: "utf8",
    env,
    input: JSON.stringify({
      session_id: "SECRET-CLI-SESSION",
      cwd: workspace,
      hook_event_name: "UserPromptSubmit",
      turn_id: "turn-1",
      prompt: rawPrompt,
    }),
  });
  assert.equal(hooked.status, 0, hooked.stderr);
  assert.deepEqual(JSON.parse(hooked.stdout), {});

  const status = run(["record", "status", "--json"]);
  assert.equal(JSON.parse(status.stdout).eventCount, 1);

  const audited = run(["trace", "audit", traceId, "--json"]);
  assert.equal(audited.status, 0, audited.stderr);
  assert.equal(JSON.parse(audited.stdout).ok, true);

  const stopped = run(["record", "stop", "--json"]);
  assert.equal(JSON.parse(stopped.stdout).status, "stopped");

  const exportedPath = path.join(dataDir, "public.jsonl");
  const exported = run([
    "trace",
    "export",
    traceId,
    "--output",
    exportedPath,
    "--json",
  ]);
  assert.equal(exported.status, 0, exported.stderr);
  const publicTrace = fs.readFileSync(exportedPath, "utf8");
  assert.equal(publicTrace.includes(rawPrompt), false);
  assert.equal(publicTrace.includes("SECRET-CLI-SESSION"), false);
  assert.equal(publicTrace.includes(workspace), false);

  const replayed = run([
    "replay",
    exportedPath,
    "--mode",
    "block",
    "--json",
  ]);
  assert.equal(replayed.status, 0, replayed.stderr);
  const replay = JSON.parse(replayed.stdout);
  assert.equal(replay.sourceKind, "semantic_trace");
  assert.equal(replay.actionCounts.block, 1);
  assert.equal(replay.eventCount, 1);
  assert.equal(replayed.stdout.includes(exportedPath), false);
});

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  integrationStatus,
  integrationStatusAsync,
  summarizeProviderMonitoring,
} from "../src/cli.mjs";
import { PORTABLE_WORKER_ARGUMENTS } from "../src/helper-worker-handshake.mjs";

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

test("CLI hook entry supplies the portable worker protocol", (context) => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-cli-hook-protocol-"),
  );
  context.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [path.join(root, "bin/agent-waste-firewall.mjs"), "hook", "codex"],
    {
      encoding: "utf8",
      input: JSON.stringify({
        session_id: "cli-hook-protocol-session",
        cwd: root,
        hook_event_name: "UserPromptSubmit",
        turn_id: "cli-hook-protocol-turn",
        prompt: "Fix src/auth.ts and verify the change with npm test.",
      }),
      env: {
        ...process.env,
        AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {});
});

test("CLI hook requires explicit attribution before reading stdin", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "bin/agent-waste-firewall.mjs"), "hook"],
    {
      encoding: "utf8",
      input: "RAW-UNATTRIBUTED-CLI-CANARY-55dbda13",
      env: {
        ...process.env,
        AGENT_WASTE_FIREWALL_PLATFORM: "claude",
      },
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires exactly one provider/u);
  assert.equal(result.stderr.includes("RAW-UNATTRIBUTED"), false);
  assert.equal(result.stdout, "");
});

test("CLI hook keeps Stop observation-only with explicit attribution", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "bin/agent-waste-firewall.mjs"), "hook", "claude"],
    {
      encoding: "utf8",
      input: JSON.stringify({
        session_id: "cli-stop-session",
        cwd: root,
        hook_event_name: "Stop",
        stop_hook_active: false,
      }),
      env: {
        ...process.env,
        AGENT_WASTE_FIREWALL_PLATFORM: "codex",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {});
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
  assert.equal(report.engineReady, true);
  assert.equal(typeof report.providerInstalled, "boolean");
  assert.equal(typeof report.monitoringActive, "boolean");
  assert.equal(report.monitoringActive, report.monitoring === "active");
  assert.match(report.monitoring, /^(?:active|attention|inactive|unknown)$/u);
  assert.deepEqual(
    report.providerIntegration.providers.map((provider) => provider.provider),
    ["codex", "claude"],
  );
  assert.ok(
    report.checks.some(
      (check) =>
        check.check === "src/dashboard-trace-cursor.mjs" && check.ok === true,
    ),
  );
  assert.ok(
    report.checks.some(
      (check) => check.check === "src/hook-stdio.mjs" && check.ok === true,
    ),
  );
  for (const requiredHandshakeFile of [
    "src/helper-worker-handshake.mjs",
    "protocol/helper-worker-handshake-v1.json",
    "protocol/helper-worker-handshake-v1.schema.json",
  ]) {
    assert.ok(
      report.checks.some(
        (check) => check.check === requiredHandshakeFile && check.ok === true,
      ),
    );
  }
  assert.ok(
    report.checks.some(
      (check) =>
        check.check === "bounded live spool is ready" && check.ok === true,
    ),
  );
});

test("provider monitoring summary separates installation from observed activity", () => {
  const installed = summarizeProviderMonitoring({
    providers: [
      { state: "installed_unverified" },
      { state: "not_detected" },
    ],
  });
  assert.deepEqual(installed, {
    providerInstalled: true,
    monitoringActive: false,
    monitoring: "attention",
  });

  const active = summarizeProviderMonitoring({
    providers: [
      { state: "active" },
      { state: "not_detected" },
    ],
  });
  assert.deepEqual(active, {
    providerInstalled: true,
    monitoringActive: true,
    monitoring: "active",
  });
});

test("integration status threads only the caller environment into provider probes", () => {
  const metadataValues = [];
  const status = integrationStatus(
    {
      PATH: "/isolated/bin",
      HOME: "/isolated/home",
      CODEX_HOME: "/isolated/codex",
      UNRELATED_SECRET: "MUST_NOT_REACH_PROVIDER",
    },
    (_command, _args, metadata) => {
      metadataValues.push(metadata);
      return { outcome: "not_found" };
    },
  );

  assert.deepEqual(
    status.providers.map((provider) => provider.state),
    ["not_detected", "not_detected"],
  );
  assert.equal(metadataValues.length, 2);
  for (const metadata of metadataValues) {
    assert.deepEqual(metadata.env, {
      PATH: "/isolated/bin",
      HOME: "/isolated/home",
      CODEX_HOME: "/isolated/codex",
    });
  }
});

test("CLI integration status uses concurrent bounded provider probes", async () => {
  let inFlight = 0;
  let maximumInFlight = 0;
  const startedAt = Date.now();
  const status = await integrationStatusAsync(
    { PATH: "/isolated/bin" },
    async () => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return new Promise(() => {});
    },
    { probeTimeoutMs: 30 },
  );

  assert.equal(maximumInFlight, 2);
  assert.ok(Date.now() - startedAt < 250);
  assert.deepEqual(
    status.providers.map((provider) => provider.state),
    ["unknown", "unknown"],
  );
});

test("integration status emits only the closed provider contract", (context) => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-integration-status-"),
  );
  context.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, "bin/agent-waste-firewall.mjs"),
      "integration",
      "status",
      "--json",
    ],
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
  assert.deepEqual(Object.keys(report), ["v", "kind", "providers"]);
  assert.equal(report.kind, "provider_integration_status");
  assert.deepEqual(
    report.providers.map((provider) => provider.provider),
    ["codex", "claude"],
  );
  assert.equal(result.stdout.includes(os.homedir()), false);
  assert.equal(result.stdout.includes(root), false);
});

test("integration verify JSON readiness observes a real hook event without changing provider config", async (context) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-integration-verify-"),
  );
  const dataDir = path.join(tempRoot, "data");
  const providerHome = path.join(tempRoot, "provider-home");
  const codexHome = path.join(providerHome, ".codex");
  const claudeConfig = path.join(providerHome, ".claude");
  const workspace = path.join(tempRoot, "workspace");
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(claudeConfig, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  const codexSentinel = path.join(codexHome, "config.toml");
  const claudeSentinel = path.join(claudeConfig, "settings.json");
  fs.writeFileSync(codexSentinel, "SENTINEL_CODEX_CONFIG\n");
  fs.writeFileSync(claudeSentinel, '{"sentinel":"claude-config"}\n');
  context.after(() =>
    fs.rmSync(tempRoot, { recursive: true, force: true })
  );

  const env = {
    ...process.env,
    HOME: providerHome,
    CODEX_HOME: codexHome,
    CLAUDE_CONFIG_DIR: claudeConfig,
    AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
    AGENT_WASTE_FIREWALL_PLATFORM: "codex",
  };
  const child = spawn(
    process.execPath,
    [
      path.join(root, "bin/agent-waste-firewall.mjs"),
      "integration",
      "verify",
      "codex",
      "--timeout",
      "5",
      "--json",
    ],
    {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  context.after(() => {
    if (!child.killed) child.kill("SIGKILL");
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  let hookStarted = false;
  let hookResult = null;
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    if (
      !hookStarted &&
      stderr.includes("AWF_READY provider=codex timeoutSeconds=5")
    ) {
      hookStarted = true;
      hookResult = spawnSync(
        process.execPath,
        [
          path.join(root, "scripts/hook.mjs"),
          ...PORTABLE_WORKER_ARGUMENTS,
        ],
        {
          encoding: "utf8",
          env,
          input: JSON.stringify({
            session_id: "SECRET-VERIFY-SESSION",
            cwd: workspace,
            hook_event_name: "UserPromptSubmit",
            turn_id: "SECRET-VERIFY-TURN",
            prompt: "SECRET-VERIFY-PROMPT",
          }),
        },
      );
    }
  });

  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Integration verification timed out."));
    }, 8_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

  assert.equal(hookStarted, true, stdout);
  assert.equal(hookResult?.status, 0, hookResult?.stderr);
  assert.equal(exitCode, 0, `${stdout}\n${stderr}`);
  const verification = JSON.parse(stdout);
  assert.deepEqual(Object.keys(verification), [
    "v",
    "kind",
    "provider",
    "result",
    "reason",
    "waitedMs",
    "event",
  ]);
  assert.equal(verification.provider, "codex");
  assert.equal(verification.result, "observed");
  assert.equal(verification.reason, "fresh_prompt_event");
  assert.equal(
    stderr,
    "AWF_READY provider=codex timeoutSeconds=5\n",
  );
  for (const canary of [
    "SECRET-VERIFY-SESSION",
    "SECRET-VERIFY-TURN",
    "SECRET-VERIFY-PROMPT",
  ]) {
    assert.equal(stdout.includes(canary), false);
    assert.equal(stderr.includes(canary), false);
  }
  assert.equal(
    fs.readFileSync(codexSentinel, "utf8"),
    "SENTINEL_CODEX_CONFIG\n",
  );
  assert.equal(
    fs.readFileSync(claudeSentinel, "utf8"),
    '{"sentinel":"claude-config"}\n',
  );
});

test("integration verify rejects unsafe or ambiguous options", () => {
  const cli = path.join(root, "bin/agent-waste-firewall.mjs");
  for (const [args, expected] of [
    [
      ["integration", "verify", "codex", "--timeout"],
      /timeout must be 1–300 seconds/u,
    ],
    [
      ["integration", "verify", "codex", "--timeout", "301"],
      /timeout must be 1–300 seconds/u,
    ],
    [
      ["integration", "verify", "other"],
      /requires codex or claude/u,
    ],
    [
      ["integration", "verify", "claude", "--unknown"],
      /Unknown integration verify option/u,
    ],
    [
      ["integration", "status", "--timeout", "1"],
      /integration status accepts only --json/u,
    ],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
  }
});

test("integration preflight is model-free, closed, and fails safely without Codex", (context) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-cli-preflight-"),
  );
  const workspace = path.join(tempRoot, "private workspace");
  fs.mkdirSync(workspace);
  context.after(() =>
    fs.rmSync(tempRoot, { recursive: true, force: true })
  );
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, "bin/agent-waste-firewall.mjs"),
      "integration",
      "preflight",
      "codex",
      "--workspace",
      workspace,
      "--timeout",
      "1",
      "--json",
    ],
    {
      encoding: "utf8",
      env: {
        PATH: "",
        HOME: tempRoot,
        AWF_PREFLIGHT_SECRET: "MUST_NOT_APPEAR",
      },
    },
  );

  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(report), [
    "v",
    "kind",
    "provider",
    "result",
    "reason",
    "checkedMs",
    "expectedHookCount",
    "discoveredHookCount",
    "unexpectedHookCount",
    "readyHookCount",
    "errorCount",
    "warningCount",
    "events",
  ]);
  assert.equal(report.kind, "codex_hook_preflight");
  assert.equal(report.result, "unavailable");
  assert.equal(report.reason, "provider_not_found");
  assert.equal(result.stdout.includes(workspace), false);
  assert.equal(result.stdout.includes("MUST_NOT_APPEAR"), false);
  assert.equal(result.stderr, "");
});

test("integration preflight rejects unsupported providers and ambiguous values", () => {
  const cli = path.join(root, "bin/agent-waste-firewall.mjs");
  for (const [args, expected] of [
    [
      ["integration", "preflight", "claude"],
      /currently requires codex/u,
    ],
    [
      ["integration", "preflight", "codex", "--timeout", "11"],
      /timeout must be 1–10 seconds/u,
    ],
    [
      ["integration", "preflight", "codex", "--workspace", "--json"],
      /workspace is required/u,
    ],
    [
      ["integration", "preflight", "codex", "--unknown"],
      /Unknown integration preflight option/u,
    ],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
  }
});

test("integration verify emits a closed JSON cancellation result", async (context) => {
  const parent = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-integration-cancel-"),
  );
  const dataDir = path.join(parent, "must-stay-missing");
  context.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const child = spawn(
    process.execPath,
    [
      path.join(root, "bin/agent-waste-firewall.mjs"),
      "integration",
      "verify",
      "claude",
      "--timeout",
      "5",
      "--json",
    ],
    {
      env: {
        ...process.env,
        AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  context.after(() => {
    if (!child.killed) child.kill("SIGKILL");
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  let interrupted = false;
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    if (
      !interrupted &&
      stderr.includes("AWF_READY provider=claude timeoutSeconds=5")
    ) {
      interrupted = true;
      child.kill("SIGINT");
    }
  });

  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Integration cancellation timed out."));
    }, 5_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

  assert.equal(interrupted, true);
  assert.equal(exitCode, 130, `${stdout}\n${stderr}`);
  const verification = JSON.parse(stdout);
  assert.ok(
    verification.waitedMs >= 0 && verification.waitedMs < 1_000,
  );
  assert.deepEqual({ ...verification, waitedMs: 0 }, {
    v: 1,
    kind: "provider_delivery_verification",
    provider: "claude",
    result: "cancelled",
    reason: "interrupted",
    waitedMs: 0,
    event: null,
  });
  assert.equal(
    stderr,
    "AWF_READY provider=claude timeoutSeconds=5\n",
  );
  assert.equal(fs.existsSync(dataDir), false);
});

test("dashboard without a parent lifeline survives closed stdin", async (context) => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-dashboard-ready-"),
  );
  context.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const child = spawn(
    process.execPath,
    [
      path.join(root, "bin/agent-waste-firewall.mjs"),
      "dashboard",
      "--port",
      "0",
      "--json",
    ],
    {
      env: {
        ...process.env,
        AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  context.after(() => {
    if (!child.killed) child.kill("SIGTERM");
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const firstLine = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Dashboard readiness timed out.")),
      5000,
    );
    const inspect = () => {
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timeout);
      resolve(stdout.slice(0, newline));
    };
    child.stdout.on("data", inspect);
    inspect();
    child.once("error", reject);
    child.once("close", (code) => {
      if (!stdout.includes("\n")) {
        clearTimeout(timeout);
        reject(
          new Error(
            `Dashboard exited before readiness (${code}): ${stderr}`,
          ),
        );
      }
    });
  });
  const ready = JSON.parse(firstLine);
  assert.deepEqual(Object.keys(ready), [
    "v",
    "kind",
    "host",
    "port",
    "token",
    "source",
  ]);
  assert.deepEqual(
    {
      ...ready,
      port: 4319,
      token: "0".repeat(48),
    },
    {
      v: 1,
      kind: "dashboard_ready",
      host: "127.0.0.1",
      port: 4319,
      token: "0".repeat(48),
      source: "live",
    },
  );
  const status = await fetch(
    `http://127.0.0.1:${ready.port}/api/status?token=${ready.token}`,
  );
  assert.equal(status.status, 200);
  assert.equal((await status.json()).source, "live");

  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("close", resolve));
  assert.equal(stdout.trim(), firstLine);
  assert.equal(stderr, "");
});

test("dashboard parent lifeline closes the loopback server on stdin EOF", async (context) => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-dashboard-lifeline-"),
  );
  context.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const child = spawn(
    process.execPath,
    [
      path.join(root, "bin/agent-waste-firewall.mjs"),
      "dashboard",
      "--port",
      "0",
      "--json",
    ],
    {
      env: {
        ...process.env,
        AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
        AGENT_WASTE_FIREWALL_PARENT_LIFELINE: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  context.after(() => {
    if (!child.killed) child.kill("SIGKILL");
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const firstLine = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Dashboard readiness timed out.")),
      5000,
    );
    const inspect = () => {
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timeout);
      resolve(stdout.slice(0, newline));
    };
    child.stdout.on("data", inspect);
    inspect();
    child.once("error", reject);
    child.once("close", (code) => {
      if (!stdout.includes("\n")) {
        clearTimeout(timeout);
        reject(
          new Error(
            `Dashboard exited before readiness (${code}): ${stderr}`,
          ),
        );
      }
    });
  });
  const ready = JSON.parse(firstLine);
  const endpoint =
    `http://127.0.0.1:${ready.port}/api/status?token=${ready.token}`;
  const response = await fetch(endpoint);
  assert.equal(response.status, 200);

  child.stdin.end();
  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Dashboard ignored parent lifeline EOF."));
    }, 5000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

  assert.equal(exitCode, 0, stderr);
  assert.equal(stdout.trim(), firstLine);
  assert.equal(stderr, "");
  await assert.rejects(fetch(endpoint));
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

test("records, audits, exports, replays, and purges local semantic data", (context) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "awf-cli-data-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "awf-cli-workspace-"));
  context.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  context.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
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
  const hooked = spawnSync(
    process.execPath,
    [hook, ...PORTABLE_WORKER_ARGUMENTS],
    {
      encoding: "utf8",
      env,
      input: JSON.stringify({
        session_id: "SECRET-CLI-SESSION",
        cwd: workspace,
        hook_event_name: "UserPromptSubmit",
        turn_id: "turn-1",
        prompt: rawPrompt,
      }),
    },
  );
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

  const purged = run(["purge", "--all", "--json"]);
  assert.equal(purged.status, 0, purged.stderr);
  assert.equal(JSON.parse(purged.stdout).liveSpoolRemoved, true);
  assert.equal(
    fs.existsSync(path.join(dataDir, "live-v1", "control.json")),
    false,
  );
});

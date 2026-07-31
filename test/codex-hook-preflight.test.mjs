import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CODEX_EXPECTED_HOOK_COMMAND,
  CODEX_EXPECTED_HOOKS,
  projectCodexHookDiscovery,
  runCodexHookPreflight,
  validateCodexHookPreflight,
} from "../src/codex-hook-preflight.mjs";

const RAW_WORKSPACE = "/Users/example/private/project";
const TEST_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const RAW_PLUGIN_ROOT =
  "/Users/example/private/AWF Plugin 한글's";
const RAW_SOURCE_PATH = path.join(
  RAW_PLUGIN_ROOT,
  "hooks",
  "hooks.json",
);
const EXPANDED_HOOK_COMMAND =
  `/bin/sh -p "${RAW_PLUGIN_ROOT}/scripts/hook-launcher.sh" "${RAW_PLUGIN_ROOT}" codex`;
const RAW_ERROR = "SECRET RAW PROVIDER ERROR";
const RAW_STATUS = "SECRET RAW STATUS";

function expandedCommand(pluginRoot) {
  return `/bin/sh -p "${pluginRoot}/scripts/hook-launcher.sh" "${pluginRoot}" codex`;
}

function hookMetadata(expected, overrides = {}) {
  return {
    currentHash: "a".repeat(64),
    displayOrder: 0,
    enabled: true,
    eventName: expected.event,
    handlerType: "command",
    isManaged: false,
    key: `plugin:${expected.event}`,
    source: "plugin",
    sourcePath: RAW_SOURCE_PATH,
    timeoutSec: expected.timeoutSec,
    trustStatus: "trusted",
    additionalContextLimit: expected.additionalContextLimit,
    command: EXPANDED_HOOK_COMMAND,
    matcher: null,
    pluginId: "agent-waste-firewall@agent-waste-firewall",
    statusMessage: RAW_STATUS,
    ...overrides,
  };
}

function discovery({
  hooks = CODEX_EXPECTED_HOOKS.map((expected) =>
    hookMetadata(expected)
  ),
  errors = [],
  warnings = [],
} = {}) {
  return {
    data: [
      {
        cwd: RAW_WORKSPACE,
        hooks,
        errors,
        warnings,
      },
    ],
  };
}

test("projects an exact discovered Codex hook set into a closed ready result", () => {
  const result = projectCodexHookDiscovery(discovery(), {
    checkedMs: 12,
    expectedCwd: RAW_WORKSPACE,
  });

  assert.deepEqual(result, {
    v: 1,
    kind: "codex_hook_preflight",
    provider: "codex",
    result: "ready",
    reason: "exact_hooks_ready",
    checkedMs: 12,
    expectedHookCount: 4,
    discoveredHookCount: 4,
    unexpectedHookCount: 0,
    readyHookCount: 4,
    errorCount: 0,
    warningCount: 0,
    events: CODEX_EXPECTED_HOOKS.map((expected) => ({
      event: expected.event,
      state: "ready",
    })),
  });
  assert.equal(validateCodexHookPreflight(result), result);
  const serialized = JSON.stringify(result);
  for (const raw of [
    RAW_WORKSPACE,
    RAW_PLUGIN_ROOT,
    RAW_SOURCE_PATH,
    RAW_STATUS,
    RAW_ERROR,
    CODEX_EXPECTED_HOOK_COMMAND,
    EXPANDED_HOOK_COMMAND,
  ]) {
    assert.equal(serialized.includes(raw), false);
  }
});

test("fails closed for modified hooks while ignoring a productive unrelated hook", () => {
  const hooks = CODEX_EXPECTED_HOOKS.map((expected) =>
    hookMetadata(expected)
  );
  hooks[0] = hookMetadata(CODEX_EXPECTED_HOOKS[0], {
    trustStatus: "modified",
  });
  hooks.push({
    ...hookMetadata(
      {
        event: "preCompact",
        timeoutSec: 3,
        additionalContextLimit: null,
      },
      {
        pluginId: "productive-unrelated-plugin@local",
        command: "/bin/sh productive-helper",
      },
    ),
  });

  const result = projectCodexHookDiscovery(discovery({ hooks }), {
    checkedMs: 8,
    expectedCwd: RAW_WORKSPACE,
  });

  assert.equal(result.result, "not_ready");
  assert.equal(result.reason, "modified_hooks");
  assert.equal(result.discoveredHookCount, 4);
  assert.equal(result.readyHookCount, 3);
  assert.equal(result.events[0].state, "modified");
  assert.equal(
    JSON.stringify(result).includes("productive-helper"),
    false,
  );
});

test("does not accept a same-named plugin from another marketplace", () => {
  const result = projectCodexHookDiscovery(
    discovery({
      hooks: CODEX_EXPECTED_HOOKS.map((expected) =>
        hookMetadata(expected, {
          pluginId: "agent-waste-firewall@unrelated-marketplace",
        })
      ),
    }),
    { checkedMs: 6, expectedCwd: RAW_WORKSPACE },
  );

  assert.equal(result.result, "not_ready");
  assert.equal(result.reason, "provider_plugin_not_found");
  assert.equal(result.discoveredHookCount, 0);
  assert.equal(result.readyHookCount, 0);
});

test("reduces provider errors and manifest mismatches to allowlisted evidence", () => {
  const mismatch = projectCodexHookDiscovery(
    discovery({
      hooks: CODEX_EXPECTED_HOOKS.map((expected, index) =>
        hookMetadata(expected, index === 2
          ? { command: CODEX_EXPECTED_HOOK_COMMAND }
          : {})
      ),
    }),
    { checkedMs: 5, expectedCwd: RAW_WORKSPACE },
  );
  assert.equal(mismatch.reason, "manifest_mismatch");
  assert.equal(mismatch.events[2].state, "mismatch");

  const providerError = projectCodexHookDiscovery(
    discovery({
      errors: [{ message: RAW_ERROR, path: RAW_WORKSPACE }],
    }),
    { checkedMs: 7, expectedCwd: RAW_WORKSPACE },
  );
  assert.equal(providerError.reason, "discovery_errors");
  assert.equal(providerError.errorCount, 1);
  const serialized = JSON.stringify([mismatch, providerError]);
  for (const raw of [
    RAW_WORKSPACE,
    RAW_PLUGIN_ROOT,
    RAW_ERROR,
    CODEX_EXPECTED_HOOK_COMMAND,
  ]) {
    assert.equal(serialized.includes(raw), false);
  }
});

test("binds discovery to the requested workspace and rejects managed plugin metadata", () => {
  const wrongWorkspace = projectCodexHookDiscovery(discovery(), {
    checkedMs: 4,
    expectedCwd: "/Users/example/private/another-project",
  });
  assert.equal(wrongWorkspace.result, "unavailable");
  assert.equal(wrongWorkspace.reason, "protocol_error");
  assert.equal(
    JSON.stringify(wrongWorkspace).includes(RAW_WORKSPACE),
    false,
  );

  const managed = projectCodexHookDiscovery(
    discovery({
      hooks: CODEX_EXPECTED_HOOKS.map((expected) =>
        hookMetadata(expected, {
          isManaged: true,
          trustStatus: "managed",
        })
      ),
    }),
    { checkedMs: 4, expectedCwd: RAW_WORKSPACE },
  );
  assert.equal(managed.result, "not_ready");
  assert.equal(managed.reason, "manifest_mismatch");
  assert.equal(managed.readyHookCount, 0);
  assert.ok(
    managed.events.every((event) => event.state === "mismatch"),
  );

  const managedTrust = projectCodexHookDiscovery(
    discovery({
      hooks: CODEX_EXPECTED_HOOKS.map((expected) =>
        hookMetadata(expected, {
          isManaged: false,
          trustStatus: "managed",
        })
      ),
    }),
    { checkedMs: 4, expectedCwd: RAW_WORKSPACE },
  );
  assert.equal(managedTrust.result, "not_ready");
  assert.equal(managedTrust.reason, "untrusted_hooks");
  assert.ok(
    managedTrust.events.every((event) => event.state === "untrusted"),
  );
});

test("rejects unsafe, noncanonical, and split provider source roots", () => {
  const unsafeSources = [
    "relative/hooks/hooks.json",
    "/Users/example/AWF/branch/../hooks/hooks.json",
    "/Users/example/AWF/hooks/not-hooks.json",
    "/Users/example/AWF$HOME/hooks/hooks.json",
    "/Users/example/AWF\"quoted/hooks/hooks.json",
    "/Users/example/AWF`subshell/hooks/hooks.json",
    "/Users/example/AWF\\escaped/hooks/hooks.json",
  ];
  for (const sourcePath of unsafeSources) {
    const pluginRoot = path.dirname(path.dirname(sourcePath));
    const result = projectCodexHookDiscovery(
      discovery({
        hooks: CODEX_EXPECTED_HOOKS.map((expected) =>
          hookMetadata(expected, {
            sourcePath,
            command: expandedCommand(pluginRoot),
          })
        ),
      }),
      { checkedMs: 3, expectedCwd: RAW_WORKSPACE },
    );
    assert.equal(result.reason, "manifest_mismatch", sourcePath);
    assert.equal(result.readyHookCount, 0, sourcePath);
  }

  const nullCommand = projectCodexHookDiscovery(
    discovery({
      hooks: CODEX_EXPECTED_HOOKS.map((expected) =>
        hookMetadata(expected, {
          sourcePath: unsafeSources[3],
          command: null,
        })
      ),
    }),
    { checkedMs: 3, expectedCwd: RAW_WORKSPACE },
  );
  assert.equal(nullCommand.reason, "manifest_mismatch");
  assert.equal(nullCommand.readyHookCount, 0);

  const otherRoot = "/Users/example/private/second-plugin";
  const split = projectCodexHookDiscovery(
    discovery({
      hooks: CODEX_EXPECTED_HOOKS.map((expected, index) => {
        const pluginRoot = index < 2 ? RAW_PLUGIN_ROOT : otherRoot;
        return hookMetadata(expected, {
          sourcePath: path.join(pluginRoot, "hooks", "hooks.json"),
          command: expandedCommand(pluginRoot),
        });
      }),
    }),
    { checkedMs: 3, expectedCwd: RAW_WORKSPACE },
  );
  assert.equal(split.reason, "manifest_mismatch");
  assert.equal(split.readyHookCount, 0);
  assert.ok(
    split.events.every((event) => event.state === "mismatch"),
  );

  const wrongInstalledRoot = projectCodexHookDiscovery(discovery(), {
    checkedMs: 3,
    expectedCwd: RAW_WORKSPACE,
    expectedPluginRoot: otherRoot,
  });
  assert.equal(wrongInstalledRoot.reason, "manifest_mismatch");
  assert.equal(wrongInstalledRoot.readyHookCount, 0);
});

test("classifies exact disabled, modified, and untrusted hooks without accepting them", () => {
  for (const [overrides, expectedState, expectedReason] of [
    [{ enabled: false }, "disabled", "disabled_hooks"],
    [{ trustStatus: "modified" }, "modified", "modified_hooks"],
    [{ trustStatus: "untrusted" }, "untrusted", "untrusted_hooks"],
  ]) {
    const result = projectCodexHookDiscovery(
      discovery({
        hooks: CODEX_EXPECTED_HOOKS.map((expected) =>
          hookMetadata(expected, overrides)
        ),
      }),
      { checkedMs: 2, expectedCwd: RAW_WORKSPACE },
    );
    assert.equal(result.result, "not_ready");
    assert.equal(result.reason, expectedReason);
    assert.ok(
      result.events.every((event) => event.state === expectedState),
    );
  }
});

test("preflight constants stay locked to the public Codex hook manifest", () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(
        TEST_ROOT,
        "hooks",
        "hooks.json",
      ),
      "utf8",
    ),
  );
  const manifestEvents = [
    ["UserPromptSubmit", "userPromptSubmit", 2_500],
    ["PreToolUse", "preToolUse", 2_500],
    ["PostToolUse", "postToolUse", 2_500],
    ["Stop", "stop", null],
  ].map(([manifestEvent, event, additionalContextLimit]) => {
    const hook = manifest.hooks[manifestEvent][0].hooks[0];
    assert.equal(hook.type, "command");
    assert.equal(hook.command, CODEX_EXPECTED_HOOK_COMMAND);
    assert.equal(hook.timeout, 3);
    assert.equal(
      hook.additionalContextLimit ?? null,
      additionalContextLimit,
    );
    return {
      event,
      timeoutSec: hook.timeout,
      additionalContextLimit,
    };
  });
  assert.deepEqual(manifestEvents, CODEX_EXPECTED_HOOKS);
});

test("uses only initialize and hooks/list over a bounded sanitized stdio session", async (context) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-codex-preflight-"),
  );
  context.after(() =>
    fs.rmSync(tempRoot, { recursive: true, force: true })
  );
  const fakeServer = path.join(tempRoot, "fake-app-server.mjs");
  const auditFile = path.join(tempRoot, "methods.txt");
  const fakeSource = `
import fs from "node:fs";
import readline from "node:readline";
const auditFile = process.argv[2];
const pluginRoot = process.argv[3];
const sourcePath = pluginRoot + "/hooks/hooks.json";
const command = "/bin/sh -p \\"" + pluginRoot +
  "/scripts/hook-launcher.sh\\" \\"" + pluginRoot + "\\" codex";
const expected = ${JSON.stringify(CODEX_EXPECTED_HOOKS)};
const hooks = expected.map((item, index) => ({
  currentHash: "b".repeat(64),
  displayOrder: index,
  enabled: true,
  eventName: item.event,
  handlerType: "command",
  isManaged: false,
  key: "awf:" + item.event,
  source: "plugin",
  sourcePath,
  timeoutSec: item.timeoutSec,
  trustStatus: "trusted",
  additionalContextLimit: item.additionalContextLimit,
  command,
  matcher: null,
  pluginId: "agent-waste-firewall@agent-waste-firewall",
  statusMessage: ${JSON.stringify(RAW_STATUS)}
}));
const reader = readline.createInterface({ input: process.stdin });
reader.on("line", (line) => {
  const message = JSON.parse(line);
  fs.appendFileSync(auditFile, message.method + "\\n");
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({
      id: message.id,
      result: {
        codexHome: ${JSON.stringify(RAW_WORKSPACE)},
        platformFamily: "unix",
        platformOs: "macos",
        userAgent: "secret-user-agent"
      }
    }) + "\\n");
  } else if (message.method === "hooks/list") {
    process.stdout.write(JSON.stringify({
      id: message.id,
      result: {
        data: [{
          cwd: process.cwd(),
          errors: [],
          warnings: process.env.AWF_PREFLIGHT_SECRET ? ["secret leaked"] : [],
          hooks
        }]
      }
    }) + "\\n");
  } else if (message.method !== "initialized") {
    process.exitCode = 91;
  }
});
`;
  fs.writeFileSync(fakeServer, fakeSource, { mode: 0o600 });
  const fakePluginRootCandidate = path.join(
    tempRoot,
    "AWF Plugin 한글's",
  );
  fs.mkdirSync(fakePluginRootCandidate, { mode: 0o700 });
  const fakePluginRoot = fs.realpathSync.native(
    fakePluginRootCandidate,
  );

  let now = 100;
  const result = await runCodexHookPreflight({
    cwd: tempRoot,
    env: {
      PATH: process.env.PATH,
      HOME: tempRoot,
      AWF_PREFLIGHT_SECRET: "MUST_NOT_REACH_PROVIDER",
    },
    timeoutMs: 1_000,
    expectedPluginRoot: fakePluginRoot,
    queryOptions: {
      command: process.execPath,
      commandArgs: [fakeServer, auditFile, fakePluginRoot],
    },
    clock: () => {
      now += 5;
      return now;
    },
  });

  assert.equal(result.result, "ready");
  assert.deepEqual(
    fs.readFileSync(auditFile, "utf8").trim().split("\n"),
    ["initialize", "initialized", "hooks/list"],
  );
  const serialized = JSON.stringify(result);
  for (const raw of [
    RAW_WORKSPACE,
    fakePluginRoot,
    RAW_STATUS,
    "secret-user-agent",
    "MUST_NOT_REACH_PROVIDER",
  ]) {
    assert.equal(serialized.includes(raw), false);
  }
});

test("rejects scalar frames and duplicate initialize responses before readiness", async (context) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-codex-preflight-protocol-"),
  );
  context.after(() =>
    fs.rmSync(tempRoot, { recursive: true, force: true })
  );
  const fakeServer = path.join(tempRoot, "bad-app-server.mjs");
  fs.writeFileSync(
    fakeServer,
    `
import fs from "node:fs";
import readline from "node:readline";
const mode = process.argv[2];
const auditFile = process.argv[3];
const reader = readline.createInterface({ input: process.stdin });
reader.on("line", (line) => {
  const message = JSON.parse(line);
  fs.appendFileSync(auditFile, message.method + "\\n");
  if (message.method === "initialize") {
    const initialized = JSON.stringify({ id: 1, result: {} }) + "\\n";
    process.stdout.write(
      mode === "scalar"
        ? "42\\n" + initialized
        : initialized + initialized
    );
  } else if (message.method === "hooks/list") {
    process.stdout.write(JSON.stringify({
      id: 2,
      result: {
        data: [{
          cwd: process.cwd(),
          hooks: [],
          errors: [],
          warnings: []
        }]
      }
    }) + "\\n");
  }
});
setInterval(() => {}, 1_000);
`,
    { mode: 0o600 },
  );

  for (const mode of ["scalar", "duplicate"]) {
    const auditFile = path.join(tempRoot, `${mode}.txt`);
    const result = await runCodexHookPreflight({
      cwd: tempRoot,
      timeoutMs: 1_000,
      queryOptions: {
        command: process.execPath,
        commandArgs: [fakeServer, mode, auditFile],
      },
    });
    assert.equal(result.result, "unavailable", mode);
    assert.equal(result.reason, "protocol_error", mode);
    const methods = fs.existsSync(auditFile)
      ? fs.readFileSync(auditFile, "utf8").trim().split("\n")
      : [];
    assert.equal(
      methods.filter((method) => method === "hooks/list").length <= 1,
      true,
      mode,
    );
  }
});

test("timeout terminates the provider process group including descendants", async (context) => {
  if (process.platform === "win32") return;
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-codex-preflight-process-"),
  );
  const fakeServer = path.join(tempRoot, "hanging-app-server.mjs");
  const pidFile = path.join(tempRoot, "pids.json");
  let processIds = [];
  context.after(() => {
    if (processIds[0]) {
      try {
        process.kill(-processIds[0], "SIGKILL");
      } catch {
        // The isolated process group should already be gone.
      }
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  fs.writeFileSync(
    fakeServer,
    `
import { spawn } from "node:child_process";
import fs from "node:fs";
const grandchild = spawn(
  process.execPath,
  [
    "-e",
    "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"
  ],
  { stdio: "ignore" }
);
fs.writeFileSync(
  process.argv[2],
  JSON.stringify([process.pid, grandchild.pid])
);
process.on("SIGTERM", () => {});
setInterval(() => {}, 1_000);
`,
    { mode: 0o600 },
  );

  const result = await runCodexHookPreflight({
    cwd: tempRoot,
    timeoutMs: 200,
    queryOptions: {
      command: process.execPath,
      commandArgs: [fakeServer, pidFile],
    },
  });
  assert.equal(result.result, "unavailable");
  assert.equal(result.reason, "timed_out");
  processIds = JSON.parse(fs.readFileSync(pidFile, "utf8"));
  assert.equal(processIds.length, 2);

  const pidExists = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error?.code !== "ESRCH";
    }
  };
  const deadline = Date.now() + 2_000;
  while (
    processIds.some(pidExists) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.deepEqual(processIds.map(pidExists), [false, false]);
});

test("the packaged probe binds real app-server discovery to the installed plugin root", (context) => {
  if (process.platform === "win32") return;
  const tempRoot = fs.realpathSync.native(
    fs.mkdtempSync(
      path.join(os.tmpdir(), "awf-codex-preflight-probe-"),
    ),
  );
  context.after(() =>
    fs.rmSync(tempRoot, { recursive: true, force: true })
  );
  const workspace = path.join(tempRoot, "workspace");
  const pluginRoot = path.join(tempRoot, "Installed AWF 한글");
  const otherRoot = path.join(tempRoot, "Other AWF");
  for (const directory of [workspace, pluginRoot, otherRoot]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const fakeCodex = path.join(tempRoot, "fake-codex");
  const sourcePath = path.join(pluginRoot, "hooks", "hooks.json");
  const command = expandedCommand(pluginRoot);
  fs.writeFileSync(
    fakeCodex,
    `#!/usr/bin/env node
const expected = ${JSON.stringify(CODEX_EXPECTED_HOOKS)};
const hooks = expected.map((item, index) => ({
  currentHash: "c".repeat(64),
  displayOrder: index,
  enabled: true,
  eventName: item.event,
  handlerType: "command",
  isManaged: false,
  key: "probe:" + item.event,
  source: "plugin",
  sourcePath: ${JSON.stringify(sourcePath)},
  timeoutSec: item.timeoutSec,
  trustStatus: "trusted",
  additionalContextLimit: item.additionalContextLimit,
  command: ${JSON.stringify(command)},
  matcher: null,
  pluginId: "agent-waste-firewall@agent-waste-firewall",
  statusMessage: null
}));
let buffered = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffered += chunk;
  while (buffered.includes("\\n")) {
    const index = buffered.indexOf("\\n");
    const line = buffered.slice(0, index);
    buffered = buffered.slice(index + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      process.stdout.write(JSON.stringify({ id: 1, result: {} }) + "\\n");
    } else if (message.method === "hooks/list") {
      process.stdout.write(JSON.stringify({
        id: 2,
        result: {
          data: [{
            cwd: process.cwd(),
            hooks,
            errors: [],
            warnings: []
          }]
        }
      }) + "\\n");
    }
  }
});
`,
    { mode: 0o700 },
  );
  const probe = path.join(
    TEST_ROOT,
    "scripts",
    "codex-hook-preflight-probe.mjs",
  );
  const runProbe = (expectedRoot) =>
    spawnSync(
      process.execPath,
      [probe, workspace, fakeCodex, expectedRoot],
      {
        cwd: tempRoot,
        env: {
          PATH: process.env.PATH,
          HOME: tempRoot,
          TMPDIR: tempRoot,
        },
        encoding: "utf8",
        shell: false,
        timeout: 3_000,
      },
    );

  const accepted = runProbe(pluginRoot);
  assert.equal(accepted.status, 0, accepted.stderr);
  const ready = JSON.parse(accepted.stdout);
  assert.equal(ready.result, "ready");
  assert.equal(ready.readyHookCount, 4);

  const rejected = runProbe(otherRoot);
  assert.equal(rejected.status, 0, rejected.stderr);
  const mismatch = JSON.parse(rejected.stdout);
  assert.equal(mismatch.result, "not_ready");
  assert.equal(mismatch.reason, "manifest_mismatch");
  assert.equal(mismatch.readyHookCount, 0);
});

test("returns fixed unavailable states for missing, timed-out, and malformed providers", async () => {
  for (const [outcome, reason] of [
    ["not_found", "provider_not_found"],
    ["timed_out", "timed_out"],
    ["protocol_error", "protocol_error"],
  ]) {
    const result = await runCodexHookPreflight({
      cwd: process.cwd(),
      query: async () => ({ outcome }),
      clock: () => 10,
    });
    assert.equal(result.result, "unavailable");
    assert.equal(result.reason, reason);
    assert.deepEqual(result.events, []);
  }
});

test("does not let query options override the validated workspace, environment, or timeout", async (context) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-codex-preflight-options-"),
  );
  context.after(() =>
    fs.rmSync(tempRoot, { recursive: true, force: true })
  );
  const expectedEnvironment = { PATH: process.env.PATH };
  let received;
  const result = await runCodexHookPreflight({
    cwd: tempRoot,
    env: expectedEnvironment,
    timeoutMs: 321,
    queryOptions: {
      cwd: RAW_WORKSPACE,
      env: { AWF_PREFLIGHT_SECRET: "OVERRIDE" },
      timeoutMs: 9_999,
      command: "custom-codex",
    },
    query: async (options) => {
      received = options;
      return { outcome: "not_found" };
    },
  });

  assert.equal(result.reason, "provider_not_found");
  assert.equal(received.cwd, fs.realpathSync.native(tempRoot));
  assert.equal(received.env, expectedEnvironment);
  assert.equal(received.timeoutMs, 321);
  assert.equal(received.command, "custom-codex");
});

test("rejects a missing workspace before spawning Codex without echoing its path", async () => {
  const missing = path.join(
    os.tmpdir(),
    `awf-missing-workspace-${process.pid}`,
  );
  let queried = false;
  await assert.rejects(
    runCodexHookPreflight({
      cwd: missing,
      query: async () => {
        queried = true;
        return { outcome: "not_found" };
      },
    }),
    (error) => {
      assert.equal(
        error.message,
        "Invalid Codex hook preflight workspace.",
      );
      assert.equal(error.message.includes(missing), false);
      return true;
    },
  );
  assert.equal(queried, false);
});

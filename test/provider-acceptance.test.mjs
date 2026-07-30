import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  runProviderAcceptanceCommand,
  runProviderAcceptance,
  validateProviderAcceptanceReport,
} from "../scripts/provider-acceptance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const secretOutput = "SECRET-PROVIDER-ACCEPTANCE-OUTPUT";
const requiredEvents = [
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
];
const preflightEvents = [
  "userPromptSubmit",
  "preToolUse",
  "postToolUse",
  "stop",
];

function preflightFixture(state = "untrusted") {
  const readyHookCount = state === "ready" ? 4 : 0;
  return {
    v: 1,
    kind: "codex_hook_preflight",
    provider: "codex",
    result: state === "ready" ? "ready" : "not_ready",
    reason:
      state === "ready" ? "exact_hooks_ready" : "untrusted_hooks",
    checkedMs: 14,
    expectedHookCount: 4,
    discoveredHookCount: 4,
    unexpectedHookCount: 0,
    readyHookCount,
    errorCount: 0,
    warningCount: 0,
    events: preflightEvents.map((event) => ({ event, state })),
  };
}

function missingPreflightFixture() {
  return {
    v: 1,
    kind: "codex_hook_preflight",
    provider: "codex",
    result: "not_ready",
    reason: "provider_plugin_not_found",
    checkedMs: 11,
    expectedHookCount: 4,
    discoveredHookCount: 0,
    unexpectedHookCount: 0,
    readyHookCount: 0,
    errorCount: 0,
    warningCount: 0,
    events: preflightEvents.map((event) => ({
      event,
      state: "missing",
    })),
  };
}

function tempParentTracker(context) {
  const parent = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-provider-acceptance-test-"),
  );
  context.after(() =>
    fs.rmSync(parent, { recursive: true, force: true }),
  );
  return {
    parent,
    assertClean() {
      assert.equal(fs.existsSync(parent), true);
      assert.deepEqual(fs.readdirSync(parent), []);
    },
  };
}

function successfulRunner({ command, args, env, input, cwd, timeoutMs, maxOutputBytes }) {
  if (command === "codex") {
    if (args[0] === "plugin" && args[1] === "--help") {
      return { outcome: "ok", stdout: secretOutput };
    }
    if (args[0] === "plugin" && args[1] === "marketplace") {
      return { outcome: "ok", stdout: `{"raw":"${secretOutput}"}` };
    }
    if (args[0] === "plugin" && args[1] === "add") {
      return { outcome: "ok", stdout: `{"raw":"${secretOutput}"}` };
    }
    if (args[0] === "plugin" && args[1] === "list") {
      return {
        outcome: "ok",
        stdout: JSON.stringify({
          installed: [
            {
              name: "agent-waste-firewall",
              installed: true,
              enabled: true,
            },
          ],
        }),
      };
    }
  }
  if (
    command === process.execPath &&
    path.basename(args[0]) === "codex-hook-preflight-probe.mjs"
  ) {
    const wrapperRoot = path.join(
      env.CODEX_HOME,
      "tmp",
      "arg0",
      "codex-arg0Synthetic",
    );
    fs.mkdirSync(wrapperRoot, { recursive: true, mode: 0o700 });
    fs.symlinkSync(
      process.execPath,
      path.join(wrapperRoot, "codex-execve-wrapper"),
    );
    return {
      outcome: "ok",
      stdout: JSON.stringify(preflightFixture()),
    };
  }
  if (command === "/bin/sh") {
    const result = spawnSync(command, args, {
      env: { ...env },
      input,
      cwd,
      encoding: "utf8",
      shell: false,
      timeout: timeoutMs,
      maxBuffer: maxOutputBytes,
      stdio: ["pipe", "pipe", "ignore"],
    });
    return result.status === 0
      ? { outcome: "ok", stdout: result.stdout }
      : { outcome: "failed", stdout: "" };
  }
  return { outcome: "not_found", stdout: "" };
}

function isolatedSuccessfulRunner(records = [], options = {}) {
  return (specification) => {
    records.push(specification);
    if (
      specification.command === "codex" &&
      specification.args[0] === "plugin" &&
      specification.args[1] === "add"
    ) {
      const installedRoot = path.join(
        specification.env.CODEX_HOME,
        "plugins",
        "cache",
        "agent-waste-firewall",
        "agent-waste-firewall",
        "0.1.0",
      );
      fs.mkdirSync(path.dirname(installedRoot), {
        recursive: true,
        mode: 0o700,
      });
      fs.cpSync(
        path.join(specification.cwd, "marketplace", "plugin"),
        installedRoot,
        { recursive: true, errorOnExist: true },
      );
      options.mutateInstalledPlugin?.(installedRoot);
    }
    return successfulRunner(specification);
  };
}

function editInstalledJson(installedRoot, relativePath, mutate) {
  const target = path.join(installedRoot, relativePath);
  const value = JSON.parse(fs.readFileSync(target, "utf8"));
  mutate(value);
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
}

function firstPayloadCanary(input) {
  const match = /AWF[0-9a-f]{12}/u.exec(input);
  assert.ok(match, "synthetic payload must contain a unique canary");
  return match[0];
}

test("the default acceptance runner hard-kills a child that ignores termination", (context) => {
  if (process.platform === "win32") return;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-acceptance-timeout-"),
  );
  context.after(() =>
    fs.rmSync(directory, { recursive: true, force: true })
  );
  const command = path.join(directory, "ignore-term");
  fs.writeFileSync(
    command,
    "#!/bin/sh\ntrap '' TERM\n/bin/sleep 1\n",
    { mode: 0o700 },
  );

  const startedAt = Date.now();
  const result = runProviderAcceptanceCommand({
    command,
    args: [],
    cwd: directory,
    env: { PATH: "/usr/bin:/bin" },
    timeoutMs: 50,
    maxOutputBytes: 1024,
  });
  const elapsedMs = Date.now() - startedAt;

  assert.ok(elapsedMs < 500, `acceptance child exceeded its hard bound: ${elapsedMs}ms`);
  assert.deepEqual(result, { outcome: "failed", stdout: "" });
});

test("skips cleanly when Codex is unavailable and removes its isolated home", (context) => {
  const tracker = tempParentTracker(context);
  const report = runProviderAcceptance({
    codexCommand: "codex",
    tempParent: tracker.parent,
    runner: () => ({ outcome: "not_found", stdout: secretOutput }),
  });

  assert.deepEqual(report, {
    v: 1,
    kind: "codex_provider_acceptance",
    result: "skipped",
    failure: "codex_unavailable",
    codex: "unavailable",
    checks: {
      codexDetected: false,
      packageStaged: false,
      marketplaceAdded: false,
      pluginInstalled: false,
      pluginListed: false,
      installedHookFound: false,
      providerHooksDiscovered: false,
      hookExecuted: false,
      eventProduced: false,
      privacyPreserved: false,
      cleanupSucceeded: true,
    },
    durationsMs: {
      total: report.durationsMs.total,
      probe: report.durationsMs.probe,
      packageStage: 0,
      marketplaceAdd: 0,
      pluginInstall: 0,
      pluginList: 0,
      hookDiscovery: 0,
      hook: 0,
      audit: 0,
      cleanup: report.durationsMs.cleanup,
    },
  });
  assert.equal(JSON.stringify(report).includes(secretOutput), false);
  tracker.assertClean();
  validateProviderAcceptanceReport(report);
});

test("does not forward unrelated environment secrets to provider commands", (context) => {
  const tracker = tempParentTracker(context);
  let exposed = false;
  const report = runProviderAcceptance({
    codexCommand: "codex",
    env: {
      PATH: process.env.PATH,
      AWF_ACCEPTANCE_SECRET: "MUST_NOT_REACH_PROVIDER",
    },
    tempParent: tracker.parent,
    runner: ({ env }) => {
      exposed ||= Object.prototype.hasOwnProperty.call(
        env,
        "AWF_ACCEPTANCE_SECRET",
      );
      return { outcome: "not_found", stdout: "" };
    },
  });

  assert.equal(report.result, "skipped");
  assert.equal(exposed, false);
  tracker.assertClean();
});

test("passes the isolated install, installed-hook, closed-event, and privacy gates", (context) => {
  const tracker = tempParentTracker(context);
  const records = [];
  const report = runProviderAcceptance({
    codexCommand: "codex",
    tempParent: tracker.parent,
    env: {
      PATH: process.env.PATH,
      LANG: "en_US.UTF-8",
      AWF_ACCEPTANCE_SECRET: "MUST_NOT_REACH_ANY_CHILD",
    },
    runner: isolatedSuccessfulRunner(records),
  });

  assert.equal(report.result, "passed");
  assert.equal(report.failure, "none");
  assert.equal(report.codex, "available");
  assert.deepEqual(
    Object.values(report.checks),
    Array(Object.keys(report.checks).length).fill(true),
  );
  assert.equal(JSON.stringify(report).includes(secretOutput), false);
  assert.equal(JSON.stringify(report).includes(root), false);
  assert.ok(records.length >= 5);
  const resolvedTempParent = fs.realpathSync(tracker.parent);
  for (const specification of records) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        specification.env,
        "AWF_ACCEPTANCE_SECRET",
      ),
      false,
    );
    assert.equal(
      path.relative(resolvedTempParent, specification.cwd).startsWith(".."),
      false,
    );
  }
  const providerRecords = records.filter(
    (specification) => specification.command === "codex",
  );
  const acceptanceRoot = providerRecords[0].cwd;
  for (const specification of providerRecords) {
    assert.deepEqual(
      Object.keys(specification.env).sort(),
      [
        "CODEX_HOME",
        "HOME",
        "LANG",
        "PATH",
        "TMPDIR",
        "XDG_CONFIG_HOME",
      ],
    );
    assert.equal(specification.env.HOME, path.join(acceptanceRoot, "home"));
    assert.equal(
      specification.env.CODEX_HOME,
      path.join(acceptanceRoot, "codex-home"),
    );
    assert.equal(
      specification.env.XDG_CONFIG_HOME,
      path.join(acceptanceRoot, "home", ".config"),
    );
    assert.equal(
      specification.env.TMPDIR,
      path.join(acceptanceRoot, "tmp"),
    );
  }
  const hookRecords = records.filter(
    (specification) => specification.command === "/bin/sh",
  );
  assert.equal(hookRecords.length, 4);
  const preflightRecords = records.filter(
    (specification) =>
      specification.command === process.execPath &&
      path.basename(specification.args[0]) ===
        "codex-hook-preflight-probe.mjs",
  );
  assert.equal(preflightRecords.length, 1);
  assert.equal(preflightRecords[0].args[1], acceptanceRoot);
  assert.equal(preflightRecords[0].args[2], "codex");
  assert.equal(
    preflightRecords[0].args[3],
    hookRecords[0].args[2],
  );
  assert.equal(preflightRecords[0].killSignal, "SIGTERM");
  assert.deepEqual(
    Object.keys(preflightRecords[0].env).sort(),
    [
      "CODEX_HOME",
      "HOME",
      "LANG",
      "PATH",
      "TMPDIR",
      "XDG_CONFIG_HOME",
    ],
  );
  assert.deepEqual(
    hookRecords.map(({ input }) => JSON.parse(input).hook_event_name),
    requiredEvents,
  );
  for (const hookRecord of hookRecords) {
    assert.deepEqual(
      Object.keys(hookRecord.env).sort(),
      [
        "AGENT_WASTE_FIREWALL_DATA_DIR",
        "AGENT_WASTE_FIREWALL_MODE",
        "AWF_NODE_PATH",
        "CLAUDE_PLUGIN_ROOT",
        "CODEX_HOME",
        "HOME",
        "LANG",
        "PATH",
        "PLUGIN_ROOT",
        "TMPDIR",
        "XDG_CONFIG_HOME",
      ],
    );
    assert.equal(hookRecord.env.HOME, path.join(acceptanceRoot, "home"));
    assert.equal(
      hookRecord.env.CODEX_HOME,
      path.join(acceptanceRoot, "codex-home"),
    );
    assert.equal(
      hookRecord.env.XDG_CONFIG_HOME,
      path.join(acceptanceRoot, "home", ".config"),
    );
    assert.equal(hookRecord.env.TMPDIR, path.join(acceptanceRoot, "tmp"));
    assert.equal(
      hookRecord.env.AGENT_WASTE_FIREWALL_DATA_DIR,
      path.join(acceptanceRoot, "awf-data"),
    );
    assert.equal(hookRecord.env.AGENT_WASTE_FIREWALL_MODE, "observe");
    assert.equal(hookRecord.env.AWF_NODE_PATH, process.execPath);
    assert.equal(hookRecord.env.PLUGIN_ROOT, hookRecord.args[2]);
    assert.equal(
      hookRecord.env.CLAUDE_PLUGIN_ROOT,
      hookRecord.args[2],
    );
  }
  const hookRecord = hookRecords[0];
  assert.equal(hookRecord.args[0], "-p");
  const installedCacheRoot = path.join(
    hookRecord.env.CODEX_HOME,
    "plugins",
    "cache",
    "agent-waste-firewall",
  );
  assert.equal(
    path.relative(installedCacheRoot, hookRecord.args[1]).startsWith(".."),
    false,
  );
  assert.equal(
    path.relative(installedCacheRoot, hookRecord.args[2]).startsWith(".."),
    false,
  );
  assert.equal(hookRecord.args[1].startsWith(root), false);
  assert.equal(hookRecord.args[3], "codex");
  tracker.assertClean();
  validateProviderAcceptanceReport(report);
});

test("fails when installed files exist but Codex does not discover the hooks", (context) => {
  const tracker = tempParentTracker(context);
  const records = [];
  const successful = isolatedSuccessfulRunner(records);
  const undiscoveredRunner = (specification) => {
    if (
      specification.command === process.execPath &&
      path.basename(specification.args[0]) ===
        "codex-hook-preflight-probe.mjs"
    ) {
      records.push(specification);
      return {
        outcome: "ok",
        stdout: JSON.stringify(missingPreflightFixture()),
      };
    }
    return successful(specification);
  };

  const report = runProviderAcceptance({
    codexCommand: "codex",
    tempParent: tracker.parent,
    runner: undiscoveredRunner,
  });

  assert.equal(report.result, "failed");
  assert.equal(report.failure, "provider_hook_discovery_failed");
  assert.equal(report.checks.pluginListed, true);
  assert.equal(report.checks.installedHookFound, true);
  assert.equal(report.checks.providerHooksDiscovered, false);
  assert.equal(report.checks.hookExecuted, false);
  assert.equal(
    records.some(({ command }) => command === "/bin/sh"),
    false,
  );
  assert.equal(report.checks.cleanupSucceeded, true);
  tracker.assertClean();
  validateProviderAcceptanceReport(report);
});

test("fails closed when provider discovery scratch is replaced by a symlink", (context) => {
  const tracker = tempParentTracker(context);
  const successful = isolatedSuccessfulRunner();
  const replacedScratchRunner = (specification) => {
    const result = successful(specification);
    if (
      specification.command === process.execPath &&
      path.basename(specification.args[0]) ===
        "codex-hook-preflight-probe.mjs"
    ) {
      const providerTemp = path.join(
        specification.env.CODEX_HOME,
        "tmp",
      );
      fs.rmSync(providerTemp, { recursive: true, force: true });
      fs.symlinkSync(specification.env.HOME, providerTemp);
    }
    return result;
  };

  const report = runProviderAcceptance({
    codexCommand: "codex",
    tempParent: tracker.parent,
    runner: replacedScratchRunner,
  });

  assert.equal(report.result, "failed");
  assert.equal(report.failure, "provider_scratch_cleanup_failed");
  assert.equal(report.checks.installedHookFound, true);
  assert.equal(report.checks.providerHooksDiscovered, false);
  assert.equal(report.checks.hookExecuted, false);
  assert.equal(report.checks.cleanupSucceeded, true);
  tracker.assertClean();
  validateProviderAcceptanceReport(report);
});

for (const [label, mutateInstalledPlugin] of [
  [
    "a missing required event",
    (installedRoot) =>
      editInstalledJson(
        installedRoot,
        "hooks/hooks.json",
        (manifest) => {
          delete manifest.hooks.Stop;
        },
      ),
  ],
  [
    "a different command",
    (installedRoot) =>
      editInstalledJson(
        installedRoot,
        "hooks/hooks.json",
        (manifest) => {
          manifest.hooks.PreToolUse[0].hooks[0].command =
            "/usr/bin/true";
        },
      ),
  ],
  [
    "a noncanonical args-equivalent command string",
    (installedRoot) =>
      editInstalledJson(
        installedRoot,
        "hooks/hooks.json",
        (manifest) => {
          manifest.hooks.PostToolUse[0].hooks[0].command =
            '/bin/sh  -p "${PLUGIN_ROOT}/scripts/hook-launcher.sh" "${PLUGIN_ROOT}" codex';
        },
      ),
  ],
  [
    "a different timeout",
    (installedRoot) =>
      editInstalledJson(
        installedRoot,
        "hooks/hooks.json",
        (manifest) => {
          manifest.hooks.UserPromptSubmit[0].hooks[0].timeout = 4;
        },
      ),
  ],
  [
    "a missing context limit",
    (installedRoot) =>
      editInstalledJson(
        installedRoot,
        "hooks/hooks.json",
        (manifest) => {
          delete manifest.hooks.PreToolUse[0].hooks[0]
            .additionalContextLimit;
        },
      ),
  ],
  [
    "a Stop context limit",
    (installedRoot) =>
      editInstalledJson(
        installedRoot,
        "hooks/hooks.json",
        (manifest) => {
          manifest.hooks.Stop[0].hooks[0].additionalContextLimit =
            2500;
        },
      ),
  ],
]) {
  test(`rejects installed Codex hook wiring with ${label}`, (context) => {
    const tracker = tempParentTracker(context);
    const records = [];
    const report = runProviderAcceptance({
      codexCommand: "codex",
      tempParent: tracker.parent,
      runner: isolatedSuccessfulRunner(records, {
        mutateInstalledPlugin,
      }),
    });

    assert.equal(report.result, "failed");
    assert.equal(report.failure, "installed_hook_missing");
    assert.equal(report.checks.pluginListed, true);
    assert.equal(report.checks.installedHookFound, false);
    assert.equal(report.checks.providerHooksDiscovered, false);
    assert.equal(report.checks.hookExecuted, false);
    assert.equal(
      records.some(({ command }) => command === "/bin/sh"),
      false,
    );
    assert.equal(report.checks.cleanupSucceeded, true);
    tracker.assertClean();
    validateProviderAcceptanceReport(report);
  });
}

test("rejects a non-empty installed-launcher Stop response in observe mode", (context) => {
  const tracker = tempParentTracker(context);
  const successful = isolatedSuccessfulRunner();
  const nonObservingStopRunner = (specification) => {
    const result = successful(specification);
    if (
      specification.command === "/bin/sh" &&
      result.outcome === "ok" &&
      JSON.parse(specification.input).hook_event_name === "Stop"
    ) {
      return {
        outcome: "ok",
        stdout: JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "Stop",
            decision: "block",
          },
        }),
      };
    }
    return result;
  };

  const report = runProviderAcceptance({
    codexCommand: "codex",
    tempParent: tracker.parent,
    runner: nonObservingStopRunner,
  });

  assert.equal(report.result, "failed");
  assert.equal(report.failure, "hook_failed");
  assert.equal(report.checks.installedHookFound, true);
  assert.equal(report.checks.providerHooksDiscovered, true);
  assert.equal(report.checks.hookExecuted, false);
  assert.equal(report.checks.eventProduced, false);
  assert.equal(report.checks.privacyPreserved, false);
  assert.equal(report.checks.cleanupSucceeded, true);
  tracker.assertClean();
  validateProviderAcceptanceReport(report);
});

test("fails closed when only initial raw prompt or tool fragments persist", (context) => {
  const tracker = tempParentTracker(context);
  const successful = isolatedSuccessfulRunner();
  const leakingRunner = (specification) => {
    const result = successful(specification);
    if (
      specification.command === "/bin/sh" &&
      result.outcome === "ok"
    ) {
      const payload = JSON.parse(specification.input);
      const fragments = [];
      if (payload.hook_event_name === "UserPromptSubmit") {
        fragments.push(payload.prompt.slice(0, 20));
      }
      if (payload.hook_event_name === "PreToolUse") {
        fragments.push(payload.tool_input.command.slice(0, 20));
      }
      if (payload.hook_event_name === "PostToolUse") {
        fragments.push(payload.tool_response.stdout.slice(0, 20));
      }
      if (payload.hook_event_name === "Stop") {
        fragments.push(payload.last_assistant_message.slice(0, 20));
      }
      fs.appendFileSync(
        path.join(
          specification.env.AGENT_WASTE_FIREWALL_DATA_DIR,
          "raw-leak.txt",
        ),
        `${fragments.filter(Boolean).join("\n")}\n`,
        { mode: 0o600 },
      );
    }
    return result;
  };
  const report = runProviderAcceptance({
    codexCommand: "codex",
    tempParent: tracker.parent,
    runner: leakingRunner,
  });

  assert.equal(report.result, "failed");
  assert.equal(report.failure, "privacy_violation");
  assert.equal(report.checks.eventProduced, true);
  assert.equal(report.checks.privacyPreserved, false);
  assert.equal(report.checks.cleanupSucceeded, true);
  assert.equal(JSON.stringify(report).includes("AWF-ACCEPTANCE-PROMPT"), false);
  tracker.assertClean();
  validateProviderAcceptanceReport(report);
});

test("fails closed when only interior raw field sentinels persist", (context) => {
  const tracker = tempParentTracker(context);
  const successful = isolatedSuccessfulRunner();
  const leakingRunner = (specification) => {
    const result = successful(specification);
    if (
      specification.command === "/bin/sh" &&
      result.outcome === "ok"
    ) {
      const payload = JSON.parse(specification.input);
      const rawValue =
        payload.prompt ??
        payload.tool_response?.stdout ??
        payload.tool_input?.command ??
        payload.last_assistant_message ??
        "";
      const markers = rawValue.match(/AWF[0-9a-f]{12}/gu) ?? [];
      assert.ok(markers.length >= 3);
      fs.appendFileSync(
        path.join(
          specification.env.AGENT_WASTE_FIREWALL_DATA_DIR,
          "interior-raw-leak.txt",
        ),
        `${markers[1]}\n`,
        { mode: 0o600 },
      );
    }
    return result;
  };

  const report = runProviderAcceptance({
    codexCommand: "codex",
    tempParent: tracker.parent,
    runner: leakingRunner,
  });

  assert.equal(report.result, "failed");
  assert.equal(report.failure, "privacy_violation");
  assert.equal(report.checks.eventProduced, true);
  assert.equal(report.checks.privacyPreserved, false);
  assert.equal(report.checks.cleanupSucceeded, true);
  tracker.assertClean();
  validateProviderAcceptanceReport(report);
});

for (const entryKind of ["file", "directory"]) {
  test(`fails closed if a raw canary is persisted in a ${entryKind} name`, (context) => {
    const tracker = tempParentTracker(context);
    const successful = isolatedSuccessfulRunner();
    let leaked = false;
    const leakingRunner = (specification) => {
      const result = successful(specification);
      if (
        !leaked &&
        specification.command === "/bin/sh" &&
        result.outcome === "ok"
      ) {
        const canary = firstPayloadCanary(specification.input);
        const dataDir =
          specification.env.AGENT_WASTE_FIREWALL_DATA_DIR;
        if (entryKind === "file") {
          fs.writeFileSync(
            path.join(dataDir, `persisted-${canary}.txt`),
            "synthetic fixture metadata\n",
            { mode: 0o600 },
          );
        } else {
          fs.mkdirSync(path.join(dataDir, `persisted-${canary}`), {
            mode: 0o700,
          });
        }
        leaked = true;
      }
      return result;
    };

    const report = runProviderAcceptance({
      codexCommand: "codex",
      tempParent: tracker.parent,
      runner: leakingRunner,
    });

    assert.equal(report.result, "failed");
    assert.equal(report.failure, "privacy_violation");
    assert.equal(report.checks.eventProduced, true);
    assert.equal(report.checks.privacyPreserved, false);
    assert.equal(report.checks.cleanupSucceeded, true);
    tracker.assertClean();
    validateProviderAcceptanceReport(report);
  });
}

test("allows benign acceptance prose without the unique nonce marker", (context) => {
  const tracker = tempParentTracker(context);
  const successful = isolatedSuccessfulRunner();
  let wroteCounterexample = false;
  const productiveRunner = (specification) => {
    const result = successful(specification);
    if (
      !wroteCounterexample &&
      specification.command === "/bin/sh" &&
      result.outcome === "ok"
    ) {
      const notes = path.join(
        specification.env.AGENT_WASTE_FIREWALL_DATA_DIR,
        "AWF-acceptance-fixture-notes",
      );
      fs.mkdirSync(notes, { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        path.join(
          notes,
          "productive-note.txt",
        ),
        "AWF-ACCEPTANCE-PROMPT documents the fixture family only.\n",
        { mode: 0o600 },
      );
      wroteCounterexample = true;
    }
    return result;
  };

  const report = runProviderAcceptance({
    codexCommand: "codex",
    tempParent: tracker.parent,
    runner: productiveRunner,
  });

  assert.equal(report.result, "passed");
  assert.equal(report.checks.privacyPreserved, true);
  tracker.assertClean();
});

test("rejects an explicitly disabled installed plugin", (context) => {
  const tracker = tempParentTracker(context);
  const successful = isolatedSuccessfulRunner();
  const disabledRunner = (specification) => {
    const result = successful(specification);
    if (
      specification.command === "codex" &&
      specification.args[0] === "plugin" &&
      specification.args[1] === "list"
    ) {
      return {
        outcome: "ok",
        stdout: JSON.stringify({
          installed: [
            {
              name: "agent-waste-firewall",
              installed: true,
              enabled: false,
            },
          ],
        }),
      };
    }
    return result;
  };

  const report = runProviderAcceptance({
    codexCommand: "codex",
    tempParent: tracker.parent,
    runner: disabledRunner,
  });

  assert.equal(report.result, "failed");
  assert.equal(report.failure, "plugin_list_failed");
  assert.equal(report.checks.pluginInstalled, true);
  assert.equal(report.checks.pluginListed, false);
  assert.equal(report.checks.cleanupSucceeded, true);
  tracker.assertClean();
});

test("removes only its fresh child and preserves the caller-owned temp parent", (context) => {
  const tracker = tempParentTracker(context);
  const sentinel = path.join(tracker.parent, "caller-owned.txt");
  fs.writeFileSync(sentinel, "preserve\n", { mode: 0o600 });
  const before = fs.lstatSync(tracker.parent).mode & 0o777;

  const report = runProviderAcceptance({
    codexCommand: "codex",
    tempParent: tracker.parent,
    runner: () => ({ outcome: "not_found", stdout: "" }),
  });

  assert.equal(report.result, "skipped");
  assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve\n");
  assert.equal(fs.lstatSync(tracker.parent).mode & 0o777, before);
  assert.deepEqual(fs.readdirSync(tracker.parent), ["caller-owned.txt"]);
});

test("rejects a temp parent outside the system temp tree without modifying it", () => {
  const before = fs.lstatSync(root).mode & 0o777;
  const report = runProviderAcceptance({
    codexCommand: "codex",
    tempParent: root,
    runner: () => ({ outcome: "not_found", stdout: "" }),
  });

  assert.equal(report.result, "failed");
  assert.equal(report.failure, "internal_failure");
  assert.equal(report.checks.cleanupSucceeded, true);
  assert.equal(fs.lstatSync(root).mode & 0o777, before);
  assert.equal(fs.existsSync(root), true);
});

test("cleanup refuses to delete a replaced acceptance root", (context) => {
  const tracker = tempParentTracker(context);
  let replacementRoot = null;
  const report = runProviderAcceptance({
    codexCommand: "codex",
    tempParent: tracker.parent,
    runner({ cwd }) {
      const originalRoot = `${cwd}-original`;
      fs.renameSync(cwd, originalRoot);
      fs.mkdirSync(cwd, { mode: 0o700 });
      fs.writeFileSync(path.join(cwd, "caller-owned.txt"), "preserve\n", {
        mode: 0o600,
      });
      replacementRoot = cwd;
      return { outcome: "not_found", stdout: "" };
    },
  });

  assert.equal(report.result, "failed");
  assert.equal(report.failure, "cleanup_failed");
  assert.equal(report.checks.cleanupSucceeded, false);
  assert.equal(
    fs.readFileSync(path.join(replacementRoot, "caller-owned.txt"), "utf8"),
    "preserve\n",
  );
});

test("cleanup fails if a child renames the owned root away", (context) => {
  const tracker = tempParentTracker(context);
  let movedRoot = null;
  const report = runProviderAcceptance({
    codexCommand: "codex",
    tempParent: tracker.parent,
    runner({ cwd }) {
      movedRoot = `${cwd}-moved`;
      fs.renameSync(cwd, movedRoot);
      return { outcome: "not_found", stdout: "" };
    },
  });

  assert.equal(report.result, "failed");
  assert.equal(report.failure, "cleanup_failed");
  assert.equal(report.checks.cleanupSucceeded, false);
  assert.equal(fs.existsSync(movedRoot), true);
});

test("rejects additional raw fields in the public acceptance contract", () => {
  const report = runProviderAcceptance({
    codexCommand: "codex",
    runner: () => ({ outcome: "not_found", stdout: "" }),
  });
  assert.throws(
    () =>
      validateProviderAcceptanceReport({
        ...report,
        rawOutput: secretOutput,
      }),
    /Invalid CodexProviderAcceptanceV1/u,
  );
  assert.throws(
    () =>
      validateProviderAcceptanceReport({
        ...report,
        codex: "unavailable",
        checks: {
          ...report.checks,
          codexDetected: true,
        },
      }),
    /Invalid CodexProviderAcceptanceV1/u,
  );
  assert.throws(
    () =>
      validateProviderAcceptanceReport({
        ...report,
        checks: {
          ...report.checks,
          pluginInstalled: false,
          pluginListed: true,
        },
      }),
    /Invalid CodexProviderAcceptanceV1/u,
  );
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  runClaudeProviderAcceptance,
  validateClaudeProviderAcceptanceReport,
} from "../scripts/claude-provider-acceptance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginId =
  "agent-waste-firewall@agent-waste-firewall";
const secretOutput = "SECRET-CLAUDE-ACCEPTANCE-OUTPUT";
const requiredEvents = [
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
];

function tempParentTracker(context) {
  const parent = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-claude-acceptance-test-"),
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

function runNodeWorker(specification) {
  const result = spawnSync(
    specification.command,
    specification.args,
    {
      env: specification.env,
      input: specification.input,
      cwd: specification.cwd,
      encoding: "utf8",
      shell: false,
      timeout: specification.timeoutMs,
      maxBuffer: specification.maxOutputBytes,
      stdio: ["pipe", "pipe", "ignore"],
    },
  );
  return result.status === 0
    ? { outcome: "ok", stdout: result.stdout }
    : { outcome: "failed", stdout: "" };
}

function successfulClaudeRunner(records = [], options = {}) {
  let marketplaceRoot = null;
  let installedRoot = null;

  return (specification) => {
    records.push(specification);
    if (specification.command === "claude") {
      const { args } = specification;
      if (args[0] === "plugin" && args[1] === "--help") {
        return { outcome: "ok", stdout: secretOutput };
      }
      if (
        args[0] === "plugin" &&
        args[1] === "marketplace" &&
        args[2] === "add"
      ) {
        marketplaceRoot = args[3];
        return { outcome: "ok", stdout: secretOutput };
      }
      if (args[0] === "plugin" && args[1] === "install") {
        installedRoot = path.join(
          specification.env.CLAUDE_CONFIG_DIR,
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
          path.join(marketplaceRoot, "plugin"),
          installedRoot,
          { recursive: true, errorOnExist: true },
        );
        options.mutateInstalledPlugin?.(installedRoot);
        return { outcome: "ok", stdout: secretOutput };
      }
      if (args[0] === "plugin" && args[1] === "list") {
        return {
          outcome: "ok",
          stdout: JSON.stringify([
            {
              id: pluginId,
              version: "0.1.0",
              scope: "local",
              enabled: true,
              installPath: installedRoot,
              projectPath: fs.realpathSync(specification.cwd),
            },
          ]),
        };
      }
      if (args[0] === "plugin" && args[1] === "details") {
        return {
          outcome: "ok",
          stdout:
            `${pluginId}\nHooks (5)\n` +
            requiredEvents.join("\n") +
            `\n${secretOutput}\n`,
        };
      }
    }
    if (specification.command === "/bin/sh") {
      return runNodeWorker(specification);
    }
    return { outcome: "not_found", stdout: "" };
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

function partialSensitiveFragments(payload) {
  const values = [
    payload.session_id,
    payload.transcript_path,
    payload.turn_id,
    payload.prompt,
    payload.tool_use_id,
    payload.tool_input?.command,
    payload.tool_response?.stdout,
    payload.error,
    payload.last_assistant_message,
  ];
  return values.flatMap((value) => {
    if (typeof value !== "string") return [];
    const marker = /AWF[0-9a-f]{12}/u.exec(value);
    if (!marker) return [];
    const start = value.indexOf(marker[0]);
    return [value.slice(start, start + 20)];
  });
}

test("skips cleanly when Claude is unavailable and removes its isolated state", (context) => {
  const tracker = tempParentTracker(context);
  const report = runClaudeProviderAcceptance({
    claudeCommand: "claude",
    tempParent: tracker.parent,
    runner: () => ({ outcome: "not_found", stdout: secretOutput }),
  });

  assert.deepEqual(report, {
    v: 1,
    kind: "claude_provider_acceptance",
    scope: "isolated_install_and_direct_launcher",
    providerDelivery: "not_tested",
    result: "skipped",
    failure: "claude_unavailable",
    claude: "unavailable",
    checks: {
      claudeDetected: false,
      packageStaged: false,
      marketplaceAdded: false,
      pluginInstalled: false,
      pluginListed: false,
      pluginDetailed: false,
      installedLauncherWired: false,
      launcherExecuted: false,
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
      pluginDetails: 0,
      hook: 0,
      audit: 0,
      cleanup: report.durationsMs.cleanup,
    },
  });
  assert.equal(JSON.stringify(report).includes(secretOutput), false);
  tracker.assertClean();
  validateClaudeProviderAcceptanceReport(report);
});

test("does not forward unrelated environment secrets to Claude", (context) => {
  const tracker = tempParentTracker(context);
  let exposed = false;
  const report = runClaudeProviderAcceptance({
    claudeCommand: "claude",
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

test("fails closed if marketplace trust or policy prevents noninteractive add", (context) => {
  const tracker = tempParentTracker(context);
  const records = [];
  const report = runClaudeProviderAcceptance({
    claudeCommand: "claude",
    tempParent: tracker.parent,
    runner(specification) {
      records.push(specification);
      if (specification.args[1] === "--help") {
        return { outcome: "ok", stdout: "" };
      }
      return { outcome: "failed", stdout: secretOutput };
    },
  });

  assert.equal(report.result, "failed");
  assert.equal(report.failure, "marketplace_add_failed");
  assert.equal(report.checks.marketplaceAdded, false);
  assert.equal(report.checks.cleanupSucceeded, true);
  assert.equal(records.length, 2);
  assert.deepEqual(records[1].args.slice(-2), ["--scope", "local"]);
  assert.equal(records[1].timeoutMs, 30_000);
  assert.equal(
    records.some(({ args }) => args.includes("--plugin-dir")),
    false,
  );
  assert.equal(JSON.stringify(report).includes(secretOutput), false);
  tracker.assertClean();
});

test("passes isolated local install, inventory, five launcher events, semantic events, and privacy", (context) => {
  const tracker = tempParentTracker(context);
  const records = [];
  const report = runClaudeProviderAcceptance({
    claudeCommand: "claude",
    tempParent: tracker.parent,
    env: {
      PATH: process.env.PATH,
      LANG: "en_US.UTF-8",
      AWF_ACCEPTANCE_SECRET: "MUST_NOT_REACH_ANY_CHILD",
    },
    runner: successfulClaudeRunner(records),
  });

  assert.equal(report.result, "passed");
  assert.equal(report.failure, "none");
  assert.equal(report.claude, "available");
  assert.equal(report.scope, "isolated_install_and_direct_launcher");
  assert.equal(report.providerDelivery, "not_tested");
  assert.deepEqual(
    Object.values(report.checks),
    Array(Object.keys(report.checks).length).fill(true),
  );
  assert.equal(JSON.stringify(report).includes(secretOutput), false);
  assert.equal(JSON.stringify(report).includes(root), false);

  const providerRecords = records.filter(
    (specification) => specification.command === "claude",
  );
  assert.equal(providerRecords.length, 5);
  const acceptanceRoot = path.dirname(providerRecords[0].cwd);
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
  for (const specification of providerRecords) {
    assert.deepEqual(
      Object.keys(specification.env).sort(),
      [
        "CLAUDE_CONFIG_DIR",
        "HOME",
        "LANG",
        "PATH",
        "TMPDIR",
        "XDG_CONFIG_HOME",
      ],
    );
    assert.equal(
      specification.env.HOME,
      path.join(acceptanceRoot, "home"),
    );
    assert.equal(
      specification.env.CLAUDE_CONFIG_DIR,
      path.join(acceptanceRoot, "claude-config"),
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

  const add = providerRecords.find(
    ({ args }) => args[1] === "marketplace",
  );
  assert.deepEqual(add.args.slice(0, 3), [
    "plugin",
    "marketplace",
    "add",
  ]);
  assert.deepEqual(add.args.slice(-2), ["--scope", "local"]);
  assert.equal(add.timeoutMs, 30_000);
  const install = providerRecords.find(
    ({ args }) => args[1] === "install",
  );
  assert.deepEqual(install.args, [
    "plugin",
    "install",
    pluginId,
    "--scope",
    "local",
  ]);
  assert.equal(install.timeoutMs, 30_000);
  assert.ok(
    providerRecords.some(
      ({ args }) =>
        args[1] === "list" && args.includes("--json"),
    ),
  );
  assert.ok(
    providerRecords.some(
      ({ args }) =>
        args[1] === "details" && args[2] === pluginId,
    ),
  );

  const hookRecords = records.filter(
    (specification) => specification.command === "/bin/sh",
  );
  assert.equal(hookRecords.length, 5);
  assert.deepEqual(
    hookRecords.map(({ input }) => JSON.parse(input).hook_event_name),
    requiredEvents,
  );
  for (const hookRecord of hookRecords) {
    assert.equal(hookRecord.args[0], "-p");
    assert.deepEqual(
      Object.keys(hookRecord.env).sort(),
      [
        "AGENT_WASTE_FIREWALL_DATA_DIR",
        "AGENT_WASTE_FIREWALL_MODE",
        "AGENT_WASTE_FIREWALL_PLATFORM",
        "AWF_NODE_PATH",
        "CLAUDE_CONFIG_DIR",
        "CLAUDE_PLUGIN_ROOT",
        "HOME",
        "LANG",
        "PATH",
        "TMPDIR",
        "XDG_CONFIG_HOME",
      ],
    );
    assert.equal(
      hookRecord.env.AGENT_WASTE_FIREWALL_PLATFORM,
      "claude",
    );
    assert.equal(
      hookRecord.env.AGENT_WASTE_FIREWALL_MODE,
      "observe",
    );
    assert.equal(hookRecord.env.AWF_NODE_PATH, process.execPath);
    assert.equal(
      path.relative(
        path.join(
          hookRecord.env.CLAUDE_CONFIG_DIR,
          "plugins",
          "cache",
          "agent-waste-firewall",
        ),
        hookRecord.args[1],
      ).startsWith(".."),
      false,
    );
    assert.equal(
      path.relative(
        path.join(
          hookRecord.env.CLAUDE_CONFIG_DIR,
          "plugins",
          "cache",
          "agent-waste-firewall",
        ),
        hookRecord.args[2],
      ).startsWith(".."),
      false,
    );
    assert.equal(hookRecord.args[1].startsWith(root), false);
  }
  tracker.assertClean();
  validateClaudeProviderAcceptanceReport(report);
});

for (const [label, mutateInstalledPlugin] of [
  [
    "a missing required event",
    (installedRoot) =>
      editInstalledJson(
        installedRoot,
        "hooks/claude-hooks.json",
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
        "hooks/claude-hooks.json",
        (manifest) => {
          manifest.hooks.PreToolUse[0].hooks[0].command =
            "/usr/bin/true";
        },
      ),
  ],
  [
    "different launcher arguments",
    (installedRoot) =>
      editInstalledJson(
        installedRoot,
        "hooks/claude-hooks.json",
        (manifest) => {
          manifest.hooks.PostToolUse[0].hooks[0].args = [
            "${CLAUDE_PLUGIN_ROOT}/scripts/hook-launcher.sh",
            "${CLAUDE_PLUGIN_ROOT}",
          ];
        },
      ),
  ],
  [
    "a different timeout",
    (installedRoot) =>
      editInstalledJson(
        installedRoot,
        "hooks/claude-hooks.json",
        (manifest) => {
          manifest.hooks.PostToolUseFailure[0].hooks[0].timeout = 4;
        },
      ),
  ],
  [
    "a detached plugin hook manifest",
    (installedRoot) =>
      editInstalledJson(
        installedRoot,
        ".claude-plugin/plugin.json",
        (manifest) => {
          manifest.hooks = "./hooks/other.json";
        },
      ),
  ],
]) {
  test(`rejects installed launcher wiring with ${label}`, (context) => {
    const tracker = tempParentTracker(context);
    const records = [];
    const report = runClaudeProviderAcceptance({
      claudeCommand: "claude",
      tempParent: tracker.parent,
      runner: successfulClaudeRunner(records, {
        mutateInstalledPlugin,
      }),
    });

    assert.equal(report.result, "failed");
    assert.equal(report.failure, "installed_launcher_invalid");
    assert.equal(report.checks.pluginDetailed, true);
    assert.equal(report.checks.installedLauncherWired, false);
    assert.equal(report.checks.launcherExecuted, false);
    assert.equal(
      records.some(({ command }) => command === "/bin/sh"),
      false,
    );
    assert.equal(report.checks.cleanupSucceeded, true);
    tracker.assertClean();
    validateClaudeProviderAcceptanceReport(report);
  });
}

test("rejects a non-empty Stop response in observe mode", (context) => {
  const tracker = tempParentTracker(context);
  const successful = successfulClaudeRunner();
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

  const report = runClaudeProviderAcceptance({
    claudeCommand: "claude",
    tempParent: tracker.parent,
    runner: nonObservingStopRunner,
  });

  assert.equal(report.result, "failed");
  assert.equal(report.failure, "launcher_failed");
  assert.equal(report.checks.installedLauncherWired, true);
  assert.equal(report.checks.launcherExecuted, false);
  assert.equal(report.checks.eventProduced, false);
  assert.equal(report.checks.privacyPreserved, false);
  assert.equal(report.checks.cleanupSucceeded, true);
  tracker.assertClean();
  validateClaudeProviderAcceptanceReport(report);
});

test("fails closed if an installed launcher persists partial raw field fragments", (context) => {
  const tracker = tempParentTracker(context);
  const successful = successfulClaudeRunner();
  const leakingRunner = (specification) => {
    const result = successful(specification);
    if (
      specification.command === "/bin/sh" &&
      result.outcome === "ok"
    ) {
      const payload = JSON.parse(specification.input);
      const fragments = partialSensitiveFragments(payload);
      fs.appendFileSync(
        path.join(
          specification.env.AGENT_WASTE_FIREWALL_DATA_DIR,
          "raw-leak.txt",
        ),
        `${fragments.join("\n")}\n`,
        { mode: 0o600 },
      );
    }
    return result;
  };

  const report = runClaudeProviderAcceptance({
    claudeCommand: "claude",
    tempParent: tracker.parent,
    runner: leakingRunner,
  });

  assert.equal(report.result, "failed");
  assert.equal(report.failure, "privacy_violation");
  assert.equal(report.checks.eventProduced, true);
  assert.equal(report.checks.privacyPreserved, false);
  assert.equal(report.checks.cleanupSucceeded, true);
  tracker.assertClean();
  validateClaudeProviderAcceptanceReport(report);
});

for (const entryKind of ["file", "directory"]) {
  test(`fails closed if a raw canary is persisted in a ${entryKind} name`, (context) => {
    const tracker = tempParentTracker(context);
    const successful = successfulClaudeRunner();
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

    const report = runClaudeProviderAcceptance({
      claudeCommand: "claude",
      tempParent: tracker.parent,
      runner: leakingRunner,
    });

    assert.equal(report.result, "failed");
    assert.equal(report.failure, "privacy_violation");
    assert.equal(report.checks.eventProduced, true);
    assert.equal(report.checks.privacyPreserved, false);
    assert.equal(report.checks.cleanupSucceeded, true);
    tracker.assertClean();
    validateClaudeProviderAcceptanceReport(report);
  });
}

test("allows benign fixture-family prose without a unique nonce canary", (context) => {
  const tracker = tempParentTracker(context);
  const successful = successfulClaudeRunner();
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
        "Claude acceptance payload is synthetic fixture documentation.\n",
        { mode: 0o600 },
      );
      wroteCounterexample = true;
    }
    return result;
  };

  const report = runClaudeProviderAcceptance({
    claudeCommand: "claude",
    tempParent: tracker.parent,
    runner: productiveRunner,
  });

  assert.equal(report.result, "passed");
  assert.equal(report.checks.privacyPreserved, true);
  tracker.assertClean();
});

test("rejects a disabled local plugin before details or launcher execution", (context) => {
  const tracker = tempParentTracker(context);
  const successful = successfulClaudeRunner();
  const records = [];
  const disabledRunner = (specification) => {
    records.push(specification);
    const result = successful(specification);
    if (
      specification.command === "claude" &&
      specification.args[0] === "plugin" &&
      specification.args[1] === "list"
    ) {
      const parsed = JSON.parse(result.stdout);
      parsed[0].enabled = false;
      return { outcome: "ok", stdout: JSON.stringify(parsed) };
    }
    return result;
  };

  const report = runClaudeProviderAcceptance({
    claudeCommand: "claude",
    tempParent: tracker.parent,
    runner: disabledRunner,
  });

  assert.equal(report.result, "failed");
  assert.equal(report.failure, "plugin_list_failed");
  assert.equal(report.checks.pluginInstalled, true);
  assert.equal(report.checks.pluginListed, false);
  assert.equal(report.checks.pluginDetailed, false);
  assert.equal(
    records.some(
      ({ command, args }) =>
        command === "/bin/sh" || args[1] === "details",
    ),
    false,
  );
  assert.equal(report.checks.cleanupSucceeded, true);
  tracker.assertClean();
});

test("removes only its fresh child and preserves the caller-owned temp parent", (context) => {
  const tracker = tempParentTracker(context);
  const sentinel = path.join(tracker.parent, "caller-owned.txt");
  fs.writeFileSync(sentinel, "preserve\n", { mode: 0o600 });
  const before = fs.lstatSync(tracker.parent).mode & 0o777;

  const report = runClaudeProviderAcceptance({
    claudeCommand: "claude",
    tempParent: tracker.parent,
    runner: () => ({ outcome: "not_found", stdout: "" }),
  });

  assert.equal(report.result, "skipped");
  assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve\n");
  assert.equal(fs.lstatSync(tracker.parent).mode & 0o777, before);
  assert.deepEqual(fs.readdirSync(tracker.parent), ["caller-owned.txt"]);
});

test("rejects a temp parent outside system temp without modifying it", () => {
  const before = fs.lstatSync(root).mode & 0o777;
  const report = runClaudeProviderAcceptance({
    claudeCommand: "claude",
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
  const report = runClaudeProviderAcceptance({
    claudeCommand: "claude",
    tempParent: tracker.parent,
    runner({ cwd }) {
      const originalRoot = `${path.dirname(cwd)}-original`;
      fs.renameSync(path.dirname(cwd), originalRoot);
      fs.mkdirSync(path.dirname(cwd), { mode: 0o700 });
      fs.mkdirSync(cwd, { mode: 0o700 });
      fs.writeFileSync(
        path.join(path.dirname(cwd), "caller-owned.txt"),
        "preserve\n",
        { mode: 0o600 },
      );
      replacementRoot = path.dirname(cwd);
      return { outcome: "not_found", stdout: "" };
    },
  });

  assert.equal(report.result, "failed");
  assert.equal(report.failure, "cleanup_failed");
  assert.equal(report.checks.cleanupSucceeded, false);
  assert.equal(
    fs.readFileSync(
      path.join(replacementRoot, "caller-owned.txt"),
      "utf8",
    ),
    "preserve\n",
  );
});

test("the public report is closed and cannot claim provider delivery", () => {
  const report = runClaudeProviderAcceptance({
    claudeCommand: "claude",
    runner: () => ({ outcome: "not_found", stdout: "" }),
  });
  assert.throws(
    () =>
      validateClaudeProviderAcceptanceReport({
        ...report,
        rawOutput: secretOutput,
      }),
    /Invalid ClaudeProviderAcceptanceV1/u,
  );
  assert.throws(
    () =>
      validateClaudeProviderAcceptanceReport({
        ...report,
        providerDelivery: "passed",
      }),
    /Invalid ClaudeProviderAcceptanceV1/u,
  );
  assert.throws(
    () =>
      validateClaudeProviderAcceptanceReport({
        ...report,
        checks: {
          ...report.checks,
          pluginInstalled: false,
          pluginListed: true,
        },
      }),
    /Invalid ClaudeProviderAcceptanceV1/u,
  );
});

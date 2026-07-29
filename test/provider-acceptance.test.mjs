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
  if (command === process.execPath) {
    const result = spawnSync(command, args, {
      env,
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

function isolatedSuccessfulRunner(records = []) {
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
    }
    return successfulRunner(specification);
  };
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
    (specification) => specification.command === process.execPath,
  );
  assert.equal(hookRecords.length, 3);
  for (const hookRecord of hookRecords) {
    assert.deepEqual(
      Object.keys(hookRecord.env).sort(),
      [
        "AGENT_WASTE_FIREWALL_DATA_DIR",
        "AGENT_WASTE_FIREWALL_MODE",
        "AGENT_WASTE_FIREWALL_PLATFORM",
        "CODEX_HOME",
        "HOME",
        "LANG",
        "PATH",
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
    assert.equal(hookRecord.env.AGENT_WASTE_FIREWALL_PLATFORM, "codex");
    assert.equal(hookRecord.env.AGENT_WASTE_FIREWALL_MODE, "observe");
  }
  const hookRecord = hookRecords[0];
  const installedCacheRoot = path.join(
    hookRecord.env.CODEX_HOME,
    "plugins",
    "cache",
    "agent-waste-firewall",
  );
  assert.equal(
    path.relative(installedCacheRoot, hookRecord.args[0]).startsWith(".."),
    false,
  );
  assert.equal(hookRecord.args[0].startsWith(root), false);
  tracker.assertClean();
  validateProviderAcceptanceReport(report);
});

test("fails closed when only initial raw prompt or tool fragments persist", (context) => {
  const tracker = tempParentTracker(context);
  const successful = isolatedSuccessfulRunner();
  const leakingRunner = (specification) => {
    const result = successful(specification);
    if (
      specification.command === process.execPath &&
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

test("allows benign acceptance prose without the unique nonce marker", (context) => {
  const tracker = tempParentTracker(context);
  const successful = isolatedSuccessfulRunner();
  let wroteCounterexample = false;
  const productiveRunner = (specification) => {
    const result = successful(specification);
    if (
      !wroteCounterexample &&
      specification.command === process.execPath &&
      result.outcome === "ok"
    ) {
      fs.writeFileSync(
        path.join(
          specification.env.AGENT_WASTE_FIREWALL_DATA_DIR,
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

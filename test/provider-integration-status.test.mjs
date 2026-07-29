import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  providerIntegrationStatus,
  providerIntegrationStatusAsync,
  validateProviderIntegrationStatus,
} from "../src/provider-integration-status.mjs";

const RAW_PATH = "/Users/example/private-project";
const RAW_COMMAND = "rm -rf private-project";
const RAW_OUTPUT = "SECRET-PROVIDER-OUTPUT";
const PROVIDER_ENVIRONMENT = Object.freeze({
  PATH: "/usr/local/bin:/usr/bin:/bin",
  HOME: "/Users/example",
  CODEX_HOME: "/Users/example/.codex-test",
  CLAUDE_CONFIG_DIR: "/Users/example/.claude-test",
  XDG_CONFIG_HOME: "/Users/example/.config-test",
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  TERM: "xterm-256color",
  TMPDIR: "/private/tmp/provider-test",
  TEMP: "C:\\Temp\\provider-test",
  SystemRoot: "C:\\Windows",
  ComSpec: "C:\\Windows\\System32\\cmd.exe",
  PATHEXT: ".COM;.EXE;.BAT;.CMD",
  USERPROFILE: "C:\\Users\\example",
  APPDATA: "C:\\Users\\example\\AppData\\Roaming",
  LOCALAPPDATA: "C:\\Users\\example\\AppData\\Local",
  OPENAI_API_KEY: "SECRET-OPENAI-KEY",
  ANTHROPIC_API_KEY: "SECRET-ANTHROPIC-KEY",
  GITHUB_TOKEN: "SECRET-GITHUB-TOKEN",
  AWS_SECRET_ACCESS_KEY: "SECRET-AWS-KEY",
  UNRELATED_SECRET: "SECRET-UNRELATED",
});
const EXPECTED_PROVIDER_ENVIRONMENT = Object.freeze({
  PATH: PROVIDER_ENVIRONMENT.PATH,
  HOME: PROVIDER_ENVIRONMENT.HOME,
  CODEX_HOME: PROVIDER_ENVIRONMENT.CODEX_HOME,
  CLAUDE_CONFIG_DIR: PROVIDER_ENVIRONMENT.CLAUDE_CONFIG_DIR,
  XDG_CONFIG_HOME: PROVIDER_ENVIRONMENT.XDG_CONFIG_HOME,
  LANG: PROVIDER_ENVIRONMENT.LANG,
  LC_ALL: PROVIDER_ENVIRONMENT.LC_ALL,
  TERM: PROVIDER_ENVIRONMENT.TERM,
  TMPDIR: PROVIDER_ENVIRONMENT.TMPDIR,
  TEMP: PROVIDER_ENVIRONMENT.TEMP,
  SystemRoot: PROVIDER_ENVIRONMENT.SystemRoot,
  ComSpec: PROVIDER_ENVIRONMENT.ComSpec,
  PATHEXT: PROVIDER_ENVIRONMENT.PATHEXT,
  USERPROFILE: PROVIDER_ENVIRONMENT.USERPROFILE,
  APPDATA: PROVIDER_ENVIRONMENT.APPDATA,
  LOCALAPPDATA: PROVIDER_ENVIRONMENT.LOCALAPPDATA,
});
const SECRET_ENVIRONMENT_KEYS = Object.freeze([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GITHUB_TOKEN",
  "AWS_SECRET_ACCESS_KEY",
  "UNRELATED_SECRET",
]);

function runnerFrom(responses, calls = []) {
  return (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    calls.push(key);
    const response = responses[key];
    if (response instanceof Error) throw response;
    return response ?? { outcome: "failed" };
  };
}

function version(value) {
  return { outcome: "ok", output: value };
}

function plugins(entries, root = "installed") {
  return {
    outcome: "ok",
    output: JSON.stringify({
      [root]: entries,
      ignoredRawPath: RAW_PATH,
      ignoredRawCommand: RAW_COMMAND,
    }),
  };
}

function successfulProbe(command, args) {
  if (args[0] === "--version") {
    return version(command === "codex" ? "0.146.0" : "2.3.4");
  }
  return plugins([]);
}

function assertSanitizedMetadata(metadataValues) {
  assert.equal(metadataValues.length, 4);
  const firstEnvironment = metadataValues[0].env;
  for (const metadata of metadataValues) {
    assert.deepEqual(Object.keys(metadata), ["env"]);
    assert.equal(metadata.env, firstEnvironment);
    assert.deepEqual(metadata.env, EXPECTED_PROVIDER_ENVIRONMENT);
    assert.equal(Object.isFrozen(metadata), true);
    assert.equal(Object.isFrozen(metadata.env), true);
    for (const key of SECRET_ENVIRONMENT_KEYS) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(metadata.env, key),
        false,
      );
    }
  }
}

test("reports providers in fixed order and marks observed enabled Codex active", () => {
  const calls = [];
  const result = providerIntegrationStatus({
    activityByProvider: {
      codex: "observed",
      claude: "not_observed",
    },
    runner: runnerFrom(
      {
        "codex --version": version("codex-cli 0.146.0-alpha.3.1"),
        "codex plugin list --json": plugins([
          {
            pluginId: "agent-waste-firewall@local",
            installed: true,
            enabled: true,
            path: RAW_PATH,
            output: RAW_OUTPUT,
          },
        ]),
        "claude --version": { outcome: "not_found" },
      },
      calls,
    ),
  });

  assert.deepEqual(result, {
    v: 1,
    kind: "provider_integration_status",
    providers: [
      {
        provider: "codex",
        state: "active",
        version: { major: 0, minor: 146, patch: 0 },
        activity: "observed",
      },
      {
        provider: "claude",
        state: "not_detected",
        version: null,
        activity: "not_observed",
      },
    ],
  });
  assert.deepEqual(calls, [
    "codex --version",
    "codex plugin list --json",
    "claude --version",
  ]);
  const serialized = JSON.stringify(result);
  for (const canary of [RAW_PATH, RAW_COMMAND, RAW_OUTPUT, "plugin list"]) {
    assert.equal(serialized.includes(canary), false);
  }
});

test("enabled but quiet providers remain unverified instead of claiming activity", () => {
  const result = providerIntegrationStatus({
    activityByProvider: {
      codex: "not_observed",
      claude: "not_observed",
    },
    runner: runnerFrom({
      "codex --version": version("0.146.0"),
      "codex plugin list --json": plugins([
        {
          name: "agent-waste-firewall",
          installed: true,
          enabled: true,
        },
      ]),
      "claude --version": version("2.1.4 (Claude Code)"),
      "claude plugin list --json": plugins([], "plugins"),
    }),
  });

  assert.equal(result.providers[0].state, "installed_unverified");
  assert.equal(result.providers[0].activity, "not_observed");
  assert.equal(result.providers[1].state, "needs_install");
});

test("sync probes preserve config discovery environment and exclude secrets", () => {
  const metadataValues = [];
  const result = providerIntegrationStatus({
    env: PROVIDER_ENVIRONMENT,
    activityByProvider: {
      codex: "not_observed",
      claude: "not_observed",
    },
    runner(command, args, metadata) {
      metadataValues.push(metadata);
      return successfulProbe(command, args);
    },
  });

  assert.deepEqual(
    result.providers.map(({ provider, state }) => ({ provider, state })),
    [
      { provider: "codex", state: "needs_install" },
      { provider: "claude", state: "needs_install" },
    ],
  );
  assertSanitizedMetadata(metadataValues);
});

test("sync probes hard-kill a provider that ignores termination", (context) => {
  if (process.platform === "win32") return;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-provider-timeout-"),
  );
  context.after(() =>
    fs.rmSync(directory, { recursive: true, force: true })
  );
  const command = path.join(directory, "codex");
  fs.writeFileSync(
    command,
    "#!/bin/sh\ntrap '' TERM\n/bin/sleep 1\n",
    { mode: 0o700 },
  );

  const startedAt = Date.now();
  const result = providerIntegrationStatus({
    env: { PATH: directory },
    probeTimeoutMs: 50,
  });
  const elapsedMs = Date.now() - startedAt;

  assert.ok(elapsedMs < 500, `sync probe exceeded its hard bound: ${elapsedMs}ms`);
  assert.equal(result.providers[0].state, "unknown");
  assert.equal(result.providers[1].state, "not_detected");
});

test("sync version and plugin-list probes share one provider deadline", () => {
  const startedAt = performance.now();
  const runOptions = [];
  const result = providerIntegrationStatus({
    probeTimeoutMs: 100,
    runner(command, args, _metadata, options) {
      runOptions.push({ command, args: [...args], timeoutMs: options.timeoutMs });
      if (args[0] === "--version") {
        const until = performance.now() + 70;
        while (performance.now() < until) {
          // Simulate synchronous provider startup within the supplied budget.
        }
        return version(command === "codex" ? "0.146.0" : "2.3.4");
      }
      return { outcome: "failed" };
    },
  });
  const elapsedMs = performance.now() - startedAt;

  assert.ok(elapsedMs < 250, `sync probes exceeded shared deadlines: ${elapsedMs}ms`);
  assert.deepEqual(
    result.providers.map((provider) => provider.state),
    ["unknown", "unknown"],
  );
  assert.equal(runOptions.length, 4);
  assert.ok(runOptions[1].timeoutMs <= 40);
  assert.ok(runOptions[3].timeoutMs <= 40);
});

test("async probes preserve config discovery environment and exclude secrets", async () => {
  const metadataValues = [];
  const result = await providerIntegrationStatusAsync({
    env: PROVIDER_ENVIRONMENT,
    activityByProvider: {
      codex: "not_observed",
      claude: "not_observed",
    },
    async runner(command, args, metadata) {
      metadataValues.push(metadata);
      await Promise.resolve();
      return successfulProbe(command, args);
    },
  });

  assert.deepEqual(
    result.providers.map(({ provider, state }) => ({ provider, state })),
    [
      { provider: "codex", state: "needs_install" },
      { provider: "claude", state: "needs_install" },
    ],
  );
  assertSanitizedMetadata(metadataValues);
});

test("distinguishes disabled installation from enabled unverified installation", () => {
  const result = providerIntegrationStatus({
    activityByProvider: {
      codex: "unknown",
      claude: "unknown",
    },
    runner: runnerFrom({
      "codex --version": version("codex-cli 1.2.3"),
      "codex plugin list --json": plugins([
        {
          name: "agent-waste-firewall",
          installed: true,
          enabled: false,
        },
      ]),
      "claude --version": version("claude 2.3.4"),
      "claude plugin list --json": plugins([
        {
          id: "agent-waste-firewall",
          status: "installed",
        },
      ]),
    }),
  });

  assert.equal(result.providers[0].state, "needs_enable");
  assert.equal(result.providers[1].state, "installed_unverified");
});

test("maps malformed or failed probe output to unknown without leaking it", () => {
  const result = providerIntegrationStatus({
    activityByProvider: {
      codex: "not_observed",
      claude: "not_observed",
    },
    runner: runnerFrom({
      "codex --version": version(
        `codex-cli unknown ${RAW_PATH} ${RAW_OUTPUT}`,
      ),
      "claude --version": version("2.3.4 (Claude Code)"),
      "claude plugin list --json": {
        outcome: "ok",
        output: `{malformed:${RAW_COMMAND}:${RAW_OUTPUT}`,
      },
    }),
  });

  assert.deepEqual(
    result.providers.map(({ state, version: currentVersion }) => ({
      state,
      version: currentVersion,
    })),
    [
      { state: "unknown", version: null },
      { state: "unknown", version: { major: 2, minor: 3, patch: 4 } },
    ],
  );
  const serialized = JSON.stringify(result);
  for (const canary of [RAW_PATH, RAW_COMMAND, RAW_OUTPUT]) {
    assert.equal(serialized.includes(canary), false);
  }
});

test("maps failed and throwing probes to closed unknown states", () => {
  const failure = new Error(
    `${RAW_PATH} ${RAW_COMMAND} ${RAW_OUTPUT}`,
  );
  const result = providerIntegrationStatus({
    activityByProvider: {
      codex: "unknown",
      claude: "unknown",
    },
    runner: runnerFrom({
      "codex --version": { outcome: "failed", output: RAW_OUTPUT },
      "claude --version": failure,
    }),
  });

  assert.deepEqual(
    result.providers.map(({ state, version: currentVersion }) => ({
      state,
      version: currentVersion,
    })),
    [
      { state: "unknown", version: null },
      { state: "unknown", version: null },
    ],
  );
  const serialized = JSON.stringify(result);
  for (const canary of [RAW_PATH, RAW_COMMAND, RAW_OUTPUT]) {
    assert.equal(serialized.includes(canary), false);
  }
});

test("conflicting observed activity degrades missing or disabled integration to unknown", () => {
  const result = providerIntegrationStatus({
    activityByProvider: {
      codex: "observed",
      claude: "observed",
    },
    runner: runnerFrom({
      "codex --version": version("0.146.0"),
      "codex plugin list --json": plugins([]),
      "claude --version": version("2.3.4"),
      "claude plugin list --json": plugins([
        {
          name: "agent-waste-firewall",
          installed: true,
          enabled: false,
        },
      ]),
    }),
  });

  assert.deepEqual(
    result.providers.map(({ state, activity }) => ({ state, activity })),
    [
      { state: "unknown", activity: "observed" },
      { state: "unknown", activity: "observed" },
    ],
  );
});

test("validator rejects raw fields, provider reordering, and inconsistent active state", () => {
  const valid = providerIntegrationStatus({
    runner: () => ({ outcome: "not_found" }),
  });
  assert.equal(validateProviderIntegrationStatus(valid), valid);

  assert.throws(
    () =>
      validateProviderIntegrationStatus({
        ...valid,
        providers: [
          { ...valid.providers[0], rawOutput: RAW_OUTPUT },
          valid.providers[1],
        ],
      }),
    /Invalid ProviderIntegrationStatusV1/u,
  );
  assert.throws(
    () =>
      validateProviderIntegrationStatus({
        ...valid,
        providers: [...valid.providers].reverse(),
      }),
    /Invalid ProviderIntegrationStatusV1/u,
  );
  assert.throws(
    () =>
      validateProviderIntegrationStatus({
        ...valid,
        providers: [
          {
            provider: "codex",
            state: "active",
            version: { major: 1, minor: 0, patch: 0 },
            activity: "not_observed",
          },
          valid.providers[1],
        ],
      }),
    /Invalid ProviderIntegrationStatusV1/u,
  );
});

test("async provider probes run concurrently and preserve fixed output order", async () => {
  let inFlight = 0;
  let maximumInFlight = 0;
  const runner = async (command, args) => {
    inFlight += 1;
    maximumInFlight = Math.max(maximumInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 15));
    inFlight -= 1;
    if (args[0] === "--version") {
      return version(command === "codex" ? "0.146.0" : "2.3.4");
    }
    return plugins([
      {
        name: "agent-waste-firewall",
        installed: true,
        enabled: true,
      },
    ]);
  };

  const result = await providerIntegrationStatusAsync({
    activityByProvider: {
      codex: "not_observed",
      claude: "not_observed",
    },
    runner,
  });

  assert.equal(maximumInFlight, 2);
  assert.deepEqual(
    result.providers.map(({ provider, state }) => ({ provider, state })),
    [
      { provider: "codex", state: "installed_unverified" },
      { provider: "claude", state: "installed_unverified" },
    ],
  );
});

test("async timeout failures map to unknown without exposing error detail", async () => {
  const runner = async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const error = new Error(`${RAW_PATH} ${RAW_COMMAND} ${RAW_OUTPUT}`);
    error.code = "ETIMEDOUT";
    throw error;
  };

  const result = await providerIntegrationStatusAsync({
    activityByProvider: {
      codex: "unknown",
      claude: "unknown",
    },
    runner,
  });

  assert.deepEqual(
    result.providers.map(({ state, version: currentVersion }) => ({
      state,
      version: currentVersion,
    })),
    [
      { state: "unknown", version: null },
      { state: "unknown", version: null },
    ],
  );
  const serialized = JSON.stringify(result);
  for (const canary of [RAW_PATH, RAW_COMMAND, RAW_OUTPUT]) {
    assert.equal(serialized.includes(canary), false);
  }
});

test("async probes remain bounded when a runner never settles", async () => {
  const startedAt = Date.now();
  const result = await providerIntegrationStatusAsync({
    probeTimeoutMs: 5,
    runner: () => new Promise(() => {}),
  });

  assert.ok(Date.now() - startedAt < 500);
  assert.deepEqual(
    result.providers.map((provider) => provider.state),
    ["unknown", "unknown"],
  );
  await assert.rejects(
    providerIntegrationStatusAsync({
      probeTimeoutMs: 0,
      runner: () => ({ outcome: "not_found" }),
    }),
    /Invalid provider probe timeout/u,
  );
});

test("version and plugin-list probes share one provider deadline", async () => {
  const startedAt = Date.now();
  const result = await providerIntegrationStatusAsync({
    probeTimeoutMs: 200,
    runner: async (command, args) => {
      if (args[0] === "--version") {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return version(command === "codex" ? "0.146.0" : "2.3.4");
      }
      return new Promise(() => {});
    },
  });
  const elapsedMs = Date.now() - startedAt;

  assert.ok(elapsedMs < 280, `provider probe exceeded one deadline: ${elapsedMs}ms`);
  assert.deepEqual(
    result.providers.map((provider) => provider.state),
    ["unknown", "unknown"],
  );
});

test("the default async runner kills plugin-list at the shared deadline", async (context) => {
  if (process.platform === "win32") return;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-provider-async-timeout-"),
  );
  context.after(() =>
    fs.rmSync(directory, { recursive: true, force: true })
  );
  const marker = path.join(directory, "survived.txt");
  const command = path.join(directory, "codex");
  fs.writeFileSync(
    command,
    `#!${process.execPath}\n` +
      `const fs = require("node:fs");\n` +
      `if (process.argv.includes("--version")) {\n` +
      `  setTimeout(() => console.log("0.146.0"), 65);\n` +
      `} else {\n` +
      `  setTimeout(() => {\n` +
      `    fs.writeFileSync(${JSON.stringify(marker)}, "survived");\n` +
      `    console.log('{"installed":[]}');\n` +
      `  }, 60);\n` +
      `}\n`,
    { mode: 0o700 },
  );

  const result = await providerIntegrationStatusAsync({
    env: { PATH: directory },
    probeTimeoutMs: 100,
  });
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(result.providers[0].state, "unknown");
  assert.equal(fs.existsSync(marker), false);
});

test("aborting a default async probe kills its in-flight provider child", async (context) => {
  if (process.platform === "win32") return;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-provider-async-abort-"),
  );
  context.after(() =>
    fs.rmSync(directory, { recursive: true, force: true })
  );
  const pidFile = path.join(directory, "codex.pid");
  const marker = path.join(directory, "survived.txt");
  const command = path.join(directory, "codex");
  fs.writeFileSync(
    command,
    `#!${process.execPath}\n` +
      `const fs = require("node:fs");\n` +
      `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n` +
      `process.on("SIGTERM", () => {});\n` +
      `setTimeout(() => {\n` +
      `  fs.writeFileSync(${JSON.stringify(marker)}, "survived");\n` +
      `  console.log("0.146.0");\n` +
      `}, 1000);\n`,
    { mode: 0o700 },
  );

  const controller = new AbortController();
  const pending = providerIntegrationStatusAsync({
    env: { PATH: directory },
    signal: controller.signal,
  });
  const startedAt = Date.now();
  while (!fs.existsSync(pidFile) && Date.now() - startedAt < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(fs.existsSync(pidFile), true);
  const pid = Number.parseInt(fs.readFileSync(pidFile, "utf8"), 10);
  controller.abort();
  const result = await pending;

  const stoppedAt = Date.now();
  let alive = true;
  while (alive && Date.now() - stoppedAt < 2000) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 5));
    } catch {
      alive = false;
    }
  }
  assert.equal(alive, false);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(result.providers[0].state, "unknown");
  assert.equal(result.providers[1].state, "not_detected");
});

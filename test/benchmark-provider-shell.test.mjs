import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function makeFixture(context) {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf provider shell 한글 "),
  );
  fs.mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, "hooks"), { recursive: true });
  fs.cpSync(path.join(root, "src"), path.join(fixtureRoot, "src"), {
    recursive: true,
  });
  for (const filename of [
    "benchmark-provider-shell.mjs",
    "hook-launcher.sh",
    "hook.mjs",
  ]) {
    fs.copyFileSync(
      path.join(root, "scripts", filename),
      path.join(fixtureRoot, "scripts", filename),
    );
  }
  for (const filename of ["hooks.json", "claude-hooks.json"]) {
    fs.copyFileSync(
      path.join(root, "hooks", filename),
      path.join(fixtureRoot, "hooks", filename),
    );
  }
  context.after(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });
  return fixtureRoot;
}

function runBenchmark(fixtureRoot, args, secret) {
  return spawnSync(
    process.execPath,
    [
      path.join(fixtureRoot, "scripts", "benchmark-provider-shell.mjs"),
      ...args,
    ],
    {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        AWF_PROVIDER_SHELL_TEST_SECRET: secret,
        SHELL: "/bin/sh",
      },
      timeout: 20_000,
    },
  );
}

function assertClosedSuccess(result, secret) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes(secret), false);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(parsed), [
    "benchmark",
    "provider",
    "sampleCount",
    "warmupCount",
    "executionPath",
    "manifestCommandVerified",
    "providerCreatedProcessIncluded",
    "providerDispatchIncluded",
    "innerShellShimIncluded",
    "outerShellSemanticsIncluded",
    "codexDualRootEnvironmentIncluded",
    "workspacePathVariant",
    "activeSemanticTrace",
    "traceEventCount",
    "semanticEventCount",
    "semanticIncidentCount",
    "p95LimitMs",
    "latencyMs",
    "p95WithinLimit",
  ]);
  assert.deepEqual(Object.keys(parsed.latencyMs), [
    "p50",
    "p95",
    "p99",
    "maximum",
  ]);
  for (const value of Object.values(parsed.latencyMs)) {
    assert.equal(Number.isFinite(value), true);
    assert.equal(value >= 0, true);
  }
  assert.equal(parsed.benchmark, "provider_shell");
  assert.equal(parsed.manifestCommandVerified, true);
  assert.equal(parsed.providerCreatedProcessIncluded, false);
  assert.equal(parsed.providerDispatchIncluded, false);
  assert.equal(parsed.innerShellShimIncluded, true);
  assert.equal(parsed.workspacePathVariant, "spaces_and_unicode");
  assert.equal(parsed.semanticIncidentCount, 0);
  assert.equal(parsed.p95WithinLimit, true);
  return parsed;
}

test("benchmarks both exact production manifest shell forms", (context) => {
  const fixtureRoot = makeFixture(context);
  const secret = "SECRET-PROVIDER-SHELL-POSITIVE";
  const codex = assertClosedSuccess(
    runBenchmark(
      fixtureRoot,
      [
        "--provider",
        "codex",
        "--shell",
        "/bin/sh",
        "--samples",
        "2",
        "--warmups",
        "1",
        "--p95-ms",
        "5000",
      ],
      secret,
    ),
    secret,
  );
  assert.equal(codex.provider, "codex");
  assert.equal(
    codex.executionPath,
    "codex_manifest_via_user_login_shell",
  );
  assert.equal(codex.outerShellSemanticsIncluded, true);
  assert.equal(codex.codexDualRootEnvironmentIncluded, true);
  assert.equal(codex.activeSemanticTrace, true);
  assert.equal(codex.traceEventCount, 3);
  assert.equal(codex.semanticEventCount, 3);

  const claude = assertClosedSuccess(
    runBenchmark(
      fixtureRoot,
      [
        "--provider",
        "claude",
        "--samples",
        "2",
        "--warmups",
        "1",
        "--p95-ms",
        "5000",
        "--no-trace",
      ],
      secret,
    ),
    secret,
  );
  assert.equal(claude.provider, "claude");
  assert.equal(claude.executionPath, "claude_manifest_exec_form");
  assert.equal(claude.outerShellSemanticsIncluded, false);
  assert.equal(claude.codexDualRootEnvironmentIncluded, false);
  assert.equal(claude.activeSemanticTrace, false);
  assert.equal(claude.traceEventCount, 0);
  assert.equal(claude.semanticEventCount, 3);
});

test("distinct safe calls are a productive repeat-detector counterexample", (context) => {
  const fixtureRoot = makeFixture(context);
  const secret = "SECRET-PROVIDER-SHELL-PRODUCTIVE";
  const result = assertClosedSuccess(
    runBenchmark(
      fixtureRoot,
      [
        "--provider",
        "claude",
        "--samples",
        "4",
        "--warmups",
        "1",
        "--p95-ms",
        "5000",
      ],
      secret,
    ),
    secret,
  );

  assert.equal(result.semanticEventCount, 5);
  assert.equal(result.traceEventCount, 5);
  assert.equal(result.semanticIncidentCount, 0);
});

test("strict arguments and exact-manifest validation fail closed", (context) => {
  const fixtureRoot = makeFixture(context);
  const secret = "SECRET-PROVIDER-SHELL-NEGATIVE";
  const unknown = runBenchmark(
    fixtureRoot,
    ["--provider", "claude", "--unexpected"],
    secret,
  );
  assert.notEqual(unknown.status, 0);
  assert.equal(unknown.stdout, "");
  assert.equal(unknown.stderr.includes(secret), false);
  assert.match(unknown.stderr, /Unknown benchmark argument/u);

  const manifestFile = path.join(fixtureRoot, "hooks", "hooks.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  manifest.hooks.PreToolUse[0].hooks[0].command += " ";
  fs.writeFileSync(
    manifestFile,
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  );
  const tampered = runBenchmark(
    fixtureRoot,
    [
      "--provider",
      "codex",
      "--shell",
      "/bin/sh",
      "--samples",
      "1",
      "--warmups",
      "1",
    ],
    secret,
  );
  assert.notEqual(tampered.status, 0);
  assert.equal(tampered.stdout, "");
  assert.equal(tampered.stderr.includes(secret), false);
  assert.match(
    tampered.stderr,
    /production hook command does not match the audited form/u,
  );

  fs.copyFileSync(
    path.join(root, "hooks", "hooks.json"),
    manifestFile,
  );
  const timeoutTamper = JSON.parse(
    fs.readFileSync(manifestFile, "utf8"),
  );
  timeoutTamper.hooks.PreToolUse[0].hooks[0].timeout = 4;
  fs.writeFileSync(
    manifestFile,
    `${JSON.stringify(timeoutTamper, null, 2)}\n`,
    { mode: 0o600 },
  );
  const wrongTimeout = runBenchmark(
    fixtureRoot,
    [
      "--provider",
      "codex",
      "--shell",
      "/bin/sh",
      "--samples",
      "1",
      "--warmups",
      "1",
    ],
    secret,
  );
  assert.notEqual(wrongTimeout.status, 0);
  assert.equal(wrongTimeout.stdout, "");
  assert.match(
    wrongTimeout.stderr,
    /production hook command does not match the audited form/u,
  );
});

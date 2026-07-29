import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const launcher = path.join(root, "scripts", "hook-launcher.sh");

function makeTemporaryPlugin(
  context,
  prefix = "awf-hook-launcher-",
) {
  const pluginRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), prefix),
  );
  fs.mkdirSync(path.join(pluginRoot, "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(pluginRoot, "scripts", "hook.mjs"),
    "export {};\n",
    { mode: 0o600 },
  );
  context.after(() => {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  });
  return pluginRoot;
}

function makeExecutable(file, source) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source, { mode: 0o700 });
}

function invoke(pluginRoot, { input = "", env = {} } = {}) {
  return spawnSync("/bin/sh", ["-p", launcher, pluginRoot], {
    encoding: "utf8",
    input,
    env,
  });
}

function readFilesRecursively(directory) {
  const contents = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      contents.push(...readFilesRecursively(candidate));
    } else if (entry.isFile()) {
      contents.push(fs.readFileSync(candidate, "utf8"));
    }
  }
  return contents;
}

test("streams stdin with a spaced plugin root and explicit runtime", (context) => {
  const pluginRoot = makeTemporaryPlugin(context, "awf hook root ");
  const explicitNode = path.join(pluginRoot, "explicit-node");
  const inheritedNode = path.join(pluginRoot, "inherited", "node");
  const inheritedMarker = path.join(pluginRoot, "path-used");
  makeExecutable(
    explicitNode,
    [
      "#!/bin/sh",
      'test "$1" = "$AWF_EXPECTED_WORKER" || exit 70',
      "exec /bin/cat",
      "",
    ].join("\n"),
  );
  makeExecutable(
    inheritedNode,
    `#!/bin/sh\n/usr/bin/touch "${inheritedMarker}"\nexit 72\n`,
  );
  const input = '{"secret":"streams-directly"}\n';

  const result = invoke(pluginRoot, {
    input,
    env: {
      AWF_EXPECTED_WORKER: path.join(
        pluginRoot,
        "scripts",
        "hook.mjs",
      ),
      AWF_NODE_PATH: explicitNode,
      PATH: path.dirname(inheritedNode),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, input);
  assert.equal(fs.existsSync(inheritedMarker), false);
});

test("scrubs Node code-injection environment before execution", (context) => {
  const pluginRoot = makeTemporaryPlugin(context);
  fs.writeFileSync(
    path.join(pluginRoot, "scripts", "hook.mjs"),
    'process.stdout.write("{}\\n");\n',
    { mode: 0o600 },
  );
  const injectedModule = path.join(pluginRoot, "inject.cjs");
  const injectionMarker = path.join(pluginRoot, "injection-ran");
  fs.writeFileSync(
    injectedModule,
    [
      'const fs = require("node:fs");',
      'fs.writeFileSync(process.env.AWF_INJECTION_MARKER, "bad");',
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  const result = invoke(pluginRoot, {
    input: '{"event":"scrub-environment"}\n',
    env: {
      AWF_INJECTION_MARKER: injectionMarker,
      AWF_NODE_PATH: process.execPath,
      NODE_OPTIONS: `--require=${injectedModule}`,
      NODE_PATH: pluginRoot,
      OPENSSL_CONF: path.join(pluginRoot, "untrusted-openssl.cnf"),
      DYLD_INSERT_LIBRARIES: path.join(pluginRoot, "untrusted.dylib"),
      LD_PRELOAD: path.join(pluginRoot, "untrusted.so"),
      PATH: path.join(pluginRoot, "untrusted"),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {});
  assert.equal(fs.existsSync(injectionMarker), false);
});

test("direct privileged launcher rejects startup and xtrace injection", (context) => {
  const pluginRoot = makeTemporaryPlugin(context);
  const explicitNode = path.join(pluginRoot, "explicit-node");
  const startupFile = path.join(pluginRoot, "startup.sh");
  const startupMarker = path.join(pluginRoot, "startup-ran");
  const traceMarker = path.join(pluginRoot, "trace-ran");
  makeExecutable(explicitNode, "#!/bin/sh\nexec /bin/cat\n");
  fs.writeFileSync(
    startupFile,
    `#!/bin/sh\n/usr/bin/touch "${startupMarker}"\n`,
    { mode: 0o600 },
  );
  const input = '{"event":"privileged-shell"}\n';

  const result = invoke(pluginRoot, {
    input,
    env: {
      AWF_NODE_PATH: explicitNode,
      BASH_ENV: startupFile,
      ENV: startupFile,
      SHELLOPTS: "braceexpand:hashall:interactive-comments:xtrace",
      PS4: `$(/usr/bin/touch "${traceMarker}")`,
      PATH: path.join(pluginRoot, "untrusted"),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, input);
  assert.equal(fs.existsSync(startupMarker), false);
  assert.equal(fs.existsSync(traceMarker), false);
});

test("uses an explicit absolute developer runtime without PATH lookup", (context) => {
  const pluginRoot = makeTemporaryPlugin(context);
  const explicitNode = path.join(pluginRoot, "explicit-node");
  const inheritedNode = path.join(pluginRoot, "inherited", "node");
  const inheritedMarker = path.join(pluginRoot, "path-used");
  makeExecutable(explicitNode, "#!/bin/sh\nexec /bin/cat\n");
  makeExecutable(
    inheritedNode,
    `#!/bin/sh\n/usr/bin/touch "${inheritedMarker}"\nexit 72\n`,
  );
  const input = '{"event":"bounded-fallback"}\n';

  const result = invoke(pluginRoot, {
    input,
    env: {
      AWF_NODE_PATH: explicitNode,
      PATH: path.dirname(inheritedNode),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, input);
  assert.equal(fs.existsSync(inheritedMarker), false);
});

test("accepts only a bounded active NVM runtime beneath HOME", (context) => {
  const pluginRoot = makeTemporaryPlugin(context);
  const home = path.join(pluginRoot, "home");
  const nvmBin = path.join(
    home,
    ".nvm",
    "versions",
    "node",
    "v22.22.3",
    "bin",
  );
  const nvmNode = path.join(nvmBin, "node");
  makeExecutable(nvmNode, "#!/bin/sh\nexec /bin/cat\n");
  const input = '{"event":"nvm-fallback"}\n';

  const result = invoke(pluginRoot, {
    input,
    env: {
      HOME: home,
      NVM_BIN: nvmBin,
      PATH: path.join(pluginRoot, "untrusted"),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, input);
});

test("finds the newest strict NVM runtime without shell environment", (context) => {
  const pluginRoot = makeTemporaryPlugin(context);
  const home = path.join(pluginRoot, "finder-home");
  const versions = path.join(home, ".nvm", "versions", "node");
  const oldNode = path.join(versions, "v20.12.2", "bin", "node");
  const newestNode = path.join(versions, "v22.10.0", "bin", "node");
  const misleadingNode = path.join(
    versions,
    "v023.0.0",
    "bin",
    "node",
  );
  const oldMarker = path.join(pluginRoot, "old-used");
  const misleadingMarker = path.join(pluginRoot, "misleading-used");
  makeExecutable(
    oldNode,
    `#!/bin/sh\n/usr/bin/touch "${oldMarker}"\nexit 71\n`,
  );
  makeExecutable(newestNode, "#!/bin/sh\nexec /bin/cat\n");
  makeExecutable(
    misleadingNode,
    `#!/bin/sh\n/usr/bin/touch "${misleadingMarker}"\nexit 72\n`,
  );
  const input = '{"event":"finder-nvm"}\n';

  const result = invoke(pluginRoot, {
    input,
    env: {
      HOME: home,
      PATH: path.join(pluginRoot, "untrusted"),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, input);
  assert.equal(fs.existsSync(oldMarker), false);
  assert.equal(fs.existsSync(misleadingMarker), false);
});

test("ignores NVM and PATH candidates outside the bounded user location", (context) => {
  const pluginRoot = makeTemporaryPlugin(context);
  fs.writeFileSync(
    path.join(pluginRoot, "scripts", "hook.mjs"),
    "this is not JavaScript\n",
    { mode: 0o600 },
  );
  const marker = path.join(pluginRoot, "untrusted-used");
  const untrustedBin = path.join(pluginRoot, "untrusted", "bin");
  const untrustedNode = path.join(untrustedBin, "node");
  makeExecutable(
    untrustedNode,
    `#!/bin/sh\n/usr/bin/touch "${marker}"\nexit 75\n`,
  );

  const result = invoke(pluginRoot, {
    input: '{"secret":"ignore-untrusted-runtime"}\n',
    env: {
      HOME: path.join(pluginRoot, "home"),
      NVM_BIN: untrustedBin,
      PATH: untrustedBin,
    },
  });

  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {});
  assert.equal(fs.existsSync(marker), false);
  assert.equal(result.stdout.includes("ignore-untrusted-runtime"), false);
  assert.equal(result.stderr.includes("ignore-untrusted-runtime"), false);
});

test("fails open without echoing stdin or filesystem paths", (context) => {
  const pluginRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-hook-launcher-missing-"),
  );
  context.after(() => {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  });
  const input = '{"secret":"NEVER-ECHO-RAW-HOOK-INPUT"}\n';

  const result = invoke(pluginRoot, {
    input,
    env: { PATH: path.join(pluginRoot, "untrusted") },
  });

  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {});
  assert.match(result.stderr, /failed open/u);
  assert.equal(result.stderr.includes(pluginRoot), false);
  assert.equal(result.stderr.includes("NEVER-ECHO-RAW-HOOK-INPUT"), false);
  assert.equal(result.stdout.includes("NEVER-ECHO-RAW-HOOK-INPUT"), false);
});

test("rejects symlink workers and runtime candidates", (context) => {
  const pluginRoot = makeTemporaryPlugin(context);
  const realWorker = path.join(pluginRoot, "real-worker.mjs");
  const worker = path.join(pluginRoot, "scripts", "hook.mjs");
  fs.writeFileSync(realWorker, 'process.stdout.write("{}\\n");\n', {
    mode: 0o600,
  });
  fs.rmSync(worker);
  fs.symlinkSync(realWorker, worker);

  const realRuntime = path.join(pluginRoot, "real-runtime");
  const linkedRuntime = path.join(pluginRoot, "linked-runtime");
  const runtimeMarker = path.join(pluginRoot, "runtime-used");
  makeExecutable(
    realRuntime,
    `#!/bin/sh\n/usr/bin/touch "${runtimeMarker}"\nexit 70\n`,
  );
  fs.symlinkSync(realRuntime, linkedRuntime);

  const workerResult = invoke(pluginRoot, {
    input: '{"secret":"symlink-escape"}\n',
    env: {
      AWF_NODE_PATH: linkedRuntime,
      PATH: path.join(pluginRoot, "untrusted"),
    },
  });

  assert.equal(workerResult.status, 0);
  assert.deepEqual(JSON.parse(workerResult.stdout), {});
  assert.equal(fs.existsSync(runtimeMarker), false);
  assert.equal(workerResult.stdout.includes("symlink-escape"), false);
  assert.equal(workerResult.stderr.includes("symlink-escape"), false);

  fs.rmSync(worker);
  fs.copyFileSync(realWorker, worker);
  const runtimeResult = invoke(pluginRoot, {
    input: '{"secret":"runtime-symlink-escape"}\n',
    env: {
      AWF_NODE_PATH: linkedRuntime,
      PATH: path.join(pluginRoot, "untrusted"),
    },
  });
  assert.equal(runtimeResult.status, 0);
  assert.equal(fs.existsSync(runtimeMarker), false);
  assert.equal(
    runtimeResult.stdout.includes("runtime-symlink-escape"),
    false,
  );
  assert.equal(
    runtimeResult.stderr.includes("runtime-symlink-escape"),
    false,
  );
});

test("rejects writable worker and runtime files on macOS", (context) => {
  if (process.platform !== "darwin") return;
  const pluginRoot = makeTemporaryPlugin(context);
  const worker = path.join(pluginRoot, "scripts", "hook.mjs");
  const runtime = path.join(pluginRoot, "runtime");
  const runtimeMarker = path.join(pluginRoot, "runtime-used");
  makeExecutable(
    runtime,
    `#!/bin/sh\n/usr/bin/touch "${runtimeMarker}"\nexit 70\n`,
  );

  fs.chmodSync(worker, 0o620);
  const workerResult = invoke(pluginRoot, {
    input: '{"secret":"writable-worker"}\n',
    env: { AWF_NODE_PATH: runtime, PATH: "" },
  });
  assert.equal(workerResult.status, 0);
  assert.deepEqual(JSON.parse(workerResult.stdout), {});
  assert.equal(fs.existsSync(runtimeMarker), false);

  fs.chmodSync(worker, 0o600);
  fs.chmodSync(runtime, 0o720);
  const runtimeResult = invoke(pluginRoot, {
    input: '{"secret":"writable-runtime"}\n',
    env: { AWF_NODE_PATH: runtime, PATH: "" },
  });
  assert.equal(runtimeResult.status, 0);
  assert.equal(fs.existsSync(runtimeMarker), false);
  assert.equal(runtimeResult.stdout.includes("writable-runtime"), false);
  assert.equal(runtimeResult.stderr.includes("writable-runtime"), false);
});

test("fails open when the selected worker runtime exits unsuccessfully", (context) => {
  const pluginRoot = makeTemporaryPlugin(context);
  const selectedNode = path.join(pluginRoot, "selected-node");
  const home = path.join(pluginRoot, "home");
  const fallbackNode = path.join(home, ".nvm", "current", "bin", "node");
  const fallbackMarker = path.join(pluginRoot, "fallback-used");
  makeExecutable(selectedNode, "#!/bin/sh\nexit 73\n");
  makeExecutable(
    fallbackNode,
    `#!/bin/sh\n/usr/bin/touch "${fallbackMarker}"\nexit 74\n`,
  );

  const result = invoke(pluginRoot, {
    input: '{"secret":"worker-failure"}\n',
    env: {
      AWF_NODE_PATH: selectedNode,
      HOME: home,
      PATH: "",
    },
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /failed open/u);
  assert.equal(result.stdout.includes("worker-failure"), false);
  assert.equal(result.stderr.includes("worker-failure"), false);
  assert.equal(fs.existsSync(fallbackMarker), false);
});

test("does not append a second response after a worker failure", (context) => {
  const pluginRoot = makeTemporaryPlugin(context);
  const selectedNode = path.join(pluginRoot, "selected-node");
  makeExecutable(
    selectedNode,
    [
      "#!/bin/sh",
      "/usr/bin/printf '%s\\n' '{\"systemMessage\":\"fixed\"}'",
      "exit 73",
      "",
    ].join("\n"),
  );

  const result = invoke(pluginRoot, {
    input: '{"secret":"worker-failure"}\n',
    env: { AWF_NODE_PATH: selectedNode, PATH: "" },
  });

  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    systemMessage: "fixed",
  });
  assert.equal(result.stdout.trim().split("\n").length, 1);
  assert.match(result.stderr, /failed open/u);
});

test("runs the real hook worker through an absolute runtime override", (context) => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-hook-launcher-data-"),
  );
  context.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const prompt = "SECRET-LAUNCHER-PROMPT fix src/auth.ts and run npm test";

  const result = invoke(root, {
    input: JSON.stringify({
      session_id: "SECRET-LAUNCHER-SESSION",
      cwd: root,
      hook_event_name: "UserPromptSubmit",
      turn_id: "SECRET-LAUNCHER-TURN",
      prompt,
    }),
    env: {
      ...process.env,
      AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
      AGENT_WASTE_FIREWALL_PLATFORM: "codex",
      AWF_NODE_PATH: process.execPath,
      PATH: path.join(dataDir, "untrusted"),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {});
  const persisted = readFilesRecursively(dataDir).join("\n");
  for (const canary of [
    prompt,
    "SECRET-LAUNCHER-SESSION",
    "SECRET-LAUNCHER-TURN",
    root,
  ]) {
    assert.equal(persisted.includes(canary), false);
  }
});

test("both provider manifests route through the rooted launcher", () => {
  const codex = JSON.parse(
    fs.readFileSync(path.join(root, "hooks", "hooks.json"), "utf8"),
  );
  const claude = JSON.parse(
    fs.readFileSync(
      path.join(root, "hooks", "claude-hooks.json"),
      "utf8",
    ),
  );

  for (const groups of Object.values(codex.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        assert.equal(hook.command.startsWith("/bin/sh -p "), true);
        assert.match(hook.command, /scripts\/hook-launcher\.sh/u);
        assert.match(hook.command, /\$\{PLUGIN_ROOT\}/u);
        assert.doesNotMatch(hook.command, /(^|\s)node(\s|$)/u);
        assert.equal(hook.commandWindows, undefined);
      }
    }
  }
  for (const groups of Object.values(claude.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        assert.equal(hook.command, "/bin/sh");
        assert.deepEqual(hook.args, [
          "-p",
          "${CLAUDE_PLUGIN_ROOT}/scripts/hook-launcher.sh",
          "${CLAUDE_PLUGIN_ROOT}",
        ]);
      }
    }
  }
});

test("launcher source contains no inherited PATH lookup or input reader", () => {
  const source = fs.readFileSync(launcher, "utf8");
  assert.equal(source.includes("$PATH"), false);
  assert.equal(source.includes("${PATH"), false);
  assert.doesNotMatch(source, /\bcommand\s+-v\b/u);
  assert.doesNotMatch(source, /\bread\b/u);
  assert.doesNotMatch(source, /\btee\b/u);
});

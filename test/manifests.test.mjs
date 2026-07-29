import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

test("Codex and Claude load platform-specific hook event sets", () => {
  const packageManifest = readJson("package.json");
  const codexManifest = readJson(".codex-plugin/plugin.json");
  assert.equal(codexManifest.hooks, undefined);
  const claudeManifest = readJson(".claude-plugin/plugin.json");
  assert.equal(claudeManifest.hooks, "./hooks/claude-hooks.json");
  assert.equal(codexManifest.name, packageManifest.name);
  assert.equal(claudeManifest.name, packageManifest.name);
  assert.equal(codexManifest.version, packageManifest.version);
  assert.equal(claudeManifest.version, packageManifest.version);
  assert.equal(codexManifest.license, packageManifest.license);
  assert.equal(claudeManifest.license, packageManifest.license);

  const codexHooks = readJson("hooks/hooks.json").hooks;
  const claudeHooks = readJson("hooks/claude-hooks.json").hooks;
  for (const event of [
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Stop",
  ]) {
    assert.ok(codexHooks[event], `Codex is missing ${event}`);
    assert.ok(claudeHooks[event], `Claude is missing ${event}`);
  }
  assert.equal(codexHooks.PostToolUseFailure, undefined);
  assert.ok(claudeHooks.PostToolUseFailure);
  for (const event of [
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
  ]) {
    for (const group of codexHooks[event]) {
      for (const hook of group.hooks) {
        assert.equal(hook.additionalContextLimit, 2500);
      }
    }
  }
  for (const group of codexHooks.Stop) {
    for (const hook of group.hooks) {
      assert.equal(hook.additionalContextLimit, undefined);
    }
  }
});

test("all hook commands resolve the bundled script from the plugin root", () => {
  for (const [relativePath, rootVariable] of [
    ["hooks/hooks.json", "PLUGIN_ROOT"],
    ["hooks/claude-hooks.json", "CLAUDE_PLUGIN_ROOT"],
  ]) {
    const config = readJson(relativePath);
    for (const groups of Object.values(config.hooks)) {
      for (const group of groups) {
        for (const hook of group.hooks) {
          const command = [hook.command, ...(hook.args ?? [])].join(" ");
          assert.match(command, new RegExp(`\\$\\{${rootVariable}\\}`, "u"));
          assert.equal(hook.type, "command");
          assert.ok(hook.timeout <= 3);
        }
      }
    }
  }
});

test("repo marketplace exposes the root plugin without external paths", () => {
  const packageManifest = readJson("package.json");
  const marketplace = readJson(".agents/plugins/marketplace.json");
  assert.ok(
    packageManifest.files.includes(".agents/"),
    "the published package must retain the Codex repo marketplace",
  );
  assert.deepEqual(Object.keys(marketplace).sort(), [
    "interface",
    "name",
    "plugins",
  ]);
  assert.equal(marketplace.name, "agent-waste-firewall");
  assert.equal(marketplace.plugins.length, 1);
  assert.deepEqual(marketplace.plugins[0], {
    name: "agent-waste-firewall",
    source: {
      source: "local",
      path: "./",
    },
    policy: {
      installation: "AVAILABLE",
      authentication: "ON_INSTALL",
    },
    category: "Productivity",
  });
});

test("Claude marketplace exposes the root plugin with source provenance", () => {
  const packageManifest = readJson("package.json");
  const marketplace = readJson(".claude-plugin/marketplace.json");
  const claudeManifest = readJson(".claude-plugin/plugin.json");
  assert.ok(
    packageManifest.files.includes(".claude-plugin/"),
    "the published package must retain the Claude marketplace",
  );
  assert.equal(marketplace.name, "agent-waste-firewall");
  assert.equal(marketplace.plugins.length, 1);
  assert.deepEqual(marketplace.plugins[0], {
    name: "agent-waste-firewall",
    source: "./",
  });
  assert.equal(
    marketplace.owner.url,
    "https://github.com/thisisun/agent-waste-firewall",
  );
  assert.equal(claudeManifest.repository, marketplace.owner.url);
  assert.equal(claudeManifest.author.url, marketplace.owner.url);
});

test("npm package allowlists only declarative runtime release inputs", () => {
  const packageManifest = readJson("package.json");
  assert.deepEqual(
    packageManifest.files.filter((entry) => entry.startsWith("runtime/")),
    [
      "runtime/node-runtime-v1.json",
      "runtime/node-runtime.entitlements",
    ],
  );
  assert.equal(packageManifest.files.includes("runtime/"), false);
  assert.equal(packageManifest.files.includes("macos/"), false);
});

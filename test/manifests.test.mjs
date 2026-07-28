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
});

test("all hook commands resolve the bundled script from the plugin root", () => {
  for (const relativePath of ["hooks/hooks.json", "hooks/claude-hooks.json"]) {
    const config = readJson(relativePath);
    for (const groups of Object.values(config.hooks)) {
      for (const group of groups) {
        for (const hook of group.hooks) {
          const command = [hook.command, ...(hook.args ?? [])].join(" ");
          assert.match(command, /CLAUDE_PLUGIN_ROOT/u);
          assert.equal(hook.type, "command");
          assert.ok(hook.timeout <= 3);
        }
      }
    }
  }
});

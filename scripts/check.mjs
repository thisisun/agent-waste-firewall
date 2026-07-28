import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directories = ["bin", "scripts", "src", "test"];
const files = [];

function collect(directory) {
  if (!fs.existsSync(directory)) {
    return;
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collect(target);
    } else if (target.endsWith(".mjs")) {
      files.push(target);
    }
  }
}

for (const directory of directories) {
  collect(path.join(root, directory));
}

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}

for (const jsonFile of [
  "package.json",
  ".codex-plugin/plugin.json",
  ".claude-plugin/plugin.json",
  "hooks/hooks.json",
  "hooks/claude-hooks.json",
]) {
  JSON.parse(fs.readFileSync(path.join(root, jsonFile), "utf8"));
}

console.log(`Checked ${files.length} JavaScript files and 5 JSON manifests.`);

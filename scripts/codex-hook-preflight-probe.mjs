#!/usr/bin/env node

import {
  runCodexHookPreflight,
} from "../src/codex-hook-preflight.mjs";

const [workspace, codexCommand, pluginRoot, ...extra] =
  process.argv.slice(2);
const controller = new AbortController();
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  controller.abort();
};
process.once("SIGTERM", interrupt);
process.once("SIGINT", interrupt);

if (
  typeof workspace !== "string" ||
  workspace.length === 0 ||
  typeof codexCommand !== "string" ||
  codexCommand.length === 0 ||
  typeof pluginRoot !== "string" ||
  pluginRoot.length === 0 ||
  extra.length > 0
) {
  process.exitCode = 64;
} else {
  try {
    const result = await runCodexHookPreflight({
      cwd: workspace,
      env: process.env,
      timeoutMs: 3_000,
      expectedPluginRoot: pluginRoot,
      signal: controller.signal,
      queryOptions: {
        command: codexCommand,
      },
    });
    if (interrupted) {
      process.exitCode = 1;
    } else {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }
  } catch {
    process.exitCode = 1;
  }
}

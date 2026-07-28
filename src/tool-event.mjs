import path from "node:path";

import {
  hash,
  normalizeWhitespace,
  stableStringify,
  unique,
} from "./utils.mjs";

const VOLATILE_INPUT_KEYS = new Set([
  "description",
  "justification",
  "max_output_tokens",
  "timeout",
  "timeout_ms",
  "yield_time_ms",
]);

const VOLATILE_RESULT_KEYS = new Set([
  "chunk_id",
  "duration_ms",
  "wall_time_seconds",
]);

function removeVolatile(value) {
  if (Array.isArray(value)) {
    return value.map(removeVolatile);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !VOLATILE_INPUT_KEYS.has(key))
        .map(([key, child]) => [key, removeVolatile(child)]),
    );
  }

  return typeof value === "string" ? value.replace(/\r\n/g, "\n") : value;
}

function removeVolatileResult(value, depth = 0) {
  if (Array.isArray(value)) {
    return value.map((child) => removeVolatileResult(child, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            depth > 0 || !VOLATILE_RESULT_KEYS.has(key.toLowerCase()),
        )
        .map(([key, child]) => [key, removeVolatileResult(child, depth + 1)]),
    );
  }
  return value;
}

function shellOperation(command) {
  if (
    /\b(?:native:[^\s]*?(?:bundle|archive)|xcodebuild\b[^\n]*\barchive\b|gradle(?:w)?\b[^\n]*\b(?:bundle|assemble)release\b|codesign\b)\b/iu.test(
      command,
    )
  ) {
    return "sign";
  }
  if (
    /\b(?:fastlane\s+(?:deliver|pilot|supply|upload_to_app_store)|xcrun\s+(?:altool|notarytool)|app-store-connect|play-console|store\s+submit)\b/iu.test(
      command,
    )
  ) {
    return "submit";
  }
  if (
    /\b(?:vercel\s+(?:deploy|--prod)|firebase\s+deploy|netlify\s+deploy|fly\s+deploy|railway\s+up|kubectl\s+(?:apply|delete)|terraform\s+apply|pulumi\s+up)\b/iu.test(
      command,
    )
  ) {
    return "deploy";
  }
  if (
    /\b(?:supabase\s+db\s+push|prisma\s+migrate\s+deploy|sequelize(?:-cli)?\s+db:migrate|knex\s+migrate:latest)\b/iu.test(
      command,
    )
  ) {
    return "migrate";
  }
  if (
    /\b(?:release(?::[a-z0-9._-]+)*:(?:check|candidate(?::check)?)|manifest:check|verify(?:[:\s]|$)|check(?:[:\s]|$))\b/iu.test(
      command,
    )
  ) {
    return "verify";
  }
  if (/\b(?:release(?::[a-z0-9._-]+)*:manifest|create-release-manifest)\b/iu.test(command)) {
    return "release";
  }
  if (
    /\b(npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\b(pytest|cargo test|go test|rspec|jest|vitest|mocha)\b/iu.test(
      command,
    )
  ) {
    return "test";
  }
  if (
    /\b(npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|typecheck|lint)\b|\b(cargo build|go build|tsc)\b/iu.test(
      command,
    )
  ) {
    return "build";
  }
  if (/\bgit\s+(?:diff|status|log|show)\b/iu.test(command)) {
    return "inspect";
  }
  if (/\b(?:sleep|tail\s+-f|watch)\b/iu.test(command)) {
    return "wait";
  }
  return "command";
}

function shellRisk(command, operation) {
  if (
    /\b(?:security\s+find-(?:generic-password|internet-password|identity)|aws\s+secretsmanager\s+get-secret-value|gcloud\s+secrets\s+versions\s+access|op\s+(?:read|item\s+get)|vault\s+kv\s+get|pass\s+show)\b/iu.test(
      command,
    )
  ) {
    return "credential_access";
  }
  if (operation === "sign") {
    return "signing";
  }
  if (operation === "submit") {
    return "submission";
  }
  if (operation === "deploy" || operation === "migrate") {
    return "production_change";
  }
  if (
    /\b(?:git\s+push|gh\s+(?:pr|release)\s+create|npm\s+publish|pnpm\s+publish|yarn\s+npm\s+publish)\b/iu.test(
      command,
    )
  ) {
    return "external_change";
  }
  return "none";
}

function toolFamily(toolName) {
  const name = toolName.toLowerCase();

  if (
    ["wait_agent", "list_agents", "write_stdin", "wait"].includes(name) ||
    /(?:^|__)(?:wait|status|poll)(?:_|$)|status_poll/iu.test(name)
  ) {
    return "wait";
  }
  if (/(?:^|__)(?:apply_patch|edit|write|create|delete_file)(?:$|_)/iu.test(name)) {
    return "write";
  }
  if (/(?:^|__)(?:read|read_file|view_file)(?:$|_)/iu.test(name)) {
    return "read";
  }
  if (/(?:^|__)(?:grep|glob|search|find)(?:$|_)/iu.test(name)) {
    return "search";
  }
  if (
    ["bash", "shell", "exec", "exec_command", "run_command"].includes(name) ||
    name.endsWith("__bash")
  ) {
    return "shell";
  }
  if (/(?:spawn_agent|subagent|task|agent)$/iu.test(name)) {
    return "subagent";
  }
  return "other";
}

function safeToolDisplay(family, operation) {
  if (family === "shell") {
    return operation === "command" ? "shell command" : `${operation} command`;
  }
  if (family === "wait") {
    return "wait or status operation";
  }
  return `${family} operation`;
}

function collectPaths(value, paths = []) {
  if (Array.isArray(value)) {
    for (const child of value) {
      collectPaths(child, paths);
    }
    return paths;
  }

  if (!value || typeof value !== "object") {
    return paths;
  }

  for (const [key, child] of Object.entries(value)) {
    if (
      ["file", "file_path", "filepath", "filename", "path", "target_path"].includes(
        key.toLowerCase(),
      ) &&
      typeof child === "string"
    ) {
      paths.push(child);
    } else {
      collectPaths(child, paths);
    }
  }
  return paths;
}

function patchPaths(command) {
  const matches = [];
  const pattern = /^\*{3} (?:Add|Delete|Update) File: (.+)$/gmu;
  for (const match of String(command ?? "").matchAll(pattern)) {
    matches.push(match[1].trim());
  }
  return matches;
}

function responseText(response) {
  if (typeof response === "string") {
    return response;
  }
  try {
    return stableStringify(removeVolatileResult(response));
  } catch {
    return String(response ?? "");
  }
}

function normalizedResult(response) {
  return normalizeWhitespace(responseText(response))
    .replace(
      /\b(Chunk|Cell) ID:\s*[A-Za-z0-9._-]+\b/giu,
      "$1 ID: <id>",
    )
    .replace(
      /\b\d{4}-\d{2}-\d{2}[T ][0-9:.+-]+Z?\b/giu,
      "<timestamp>",
    )
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
      "<uuid>",
    )
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|seconds?|secs?|minutes?)\b/giu, "<duration>")
    .slice(0, 12_000);
}

function explicitOutcome(response) {
  if (!response || typeof response !== "object") {
    return null;
  }

  const exitCode = response.exit_code ?? response.exitCode;
  if (
    response.success === false ||
    response.is_error === true ||
    response.isError === true ||
    (Number.isInteger(exitCode) && exitCode !== 0)
  ) {
    return true;
  }
  if (
    response.success === true ||
    (Number.isInteger(exitCode) && exitCode === 0)
  ) {
    return false;
  }
  return null;
}

function textFailure(result, operation) {
  if (
    /\b(?:process|command)?\s*exit(?:ed)?\s+with\s+(?:code|status)\s+0\b|\bexit(?:ed)?[_ ]code["':=\s]+0\b/iu.test(
      result,
    )
  ) {
    return false;
  }
  if (
    /\b(?:process|command)?\s*exit(?:ed)?\s+with\s+(?:code|status)\s+[1-9]\d*\b|\bexit(?:ed)?[_ ]code["':=\s]+[1-9]\d*\b|\bnon[- ]zero (?:exit|status)\b/iu.test(
      result,
    )
  ) {
    return true;
  }

  return (
    (operation === "test" || operation === "build") &&
    /(?:^|\s)(?:FAIL(?:ED)?|not ok)(?:\s|$)/u.test(result)
  );
}

function failureCategory(result) {
  return /\b(?:ENOENT|EACCES|EPERM|ECONNREFUSED|ENETUNREACH|EAI_AGAIN|ETIMEDOUT|ENOSPC|EMFILE)\b|(?:^|\n)(?:bash|zsh|sh|cmd|powershell)(?::|\s).*?\b(?:command not found|permission denied)\b|\b(?:no space left on device|could not resolve host|temporary failure in name resolution|certificate verify failed|unable to get local issuer certificate|rate limit exceeded|HTTP 429)\b/iu.test(
    result,
  )
    ? "environment"
    : "agent";
}

export function detectPlatform(payload, env = process.env) {
  const override = String(env.AGENT_WASTE_FIREWALL_PLATFORM ?? "").toLowerCase();
  if (override === "codex" || override === "claude") {
    return override;
  }
  return payload?.turn_id || env.PLUGIN_ROOT ? "codex" : "claude";
}

export function normalizeToolEvent(payload, options = {}) {
  const hashScope = String(payload.session_id ?? "unknown");
  const toolName = String(payload.tool_name ?? "unknown");
  const toolInput = payload.tool_input ?? {};
  const family = toolFamily(toolName);
  const sanitizedInput = removeVolatile(toolInput);
  const command =
    typeof toolInput.command === "string"
      ? toolInput.command.replace(/\r\n/g, "\n").trim()
      : "";
  const filePaths = unique([
    ...collectPaths(toolInput),
    ...patchPaths(command),
  ]).map((filePath) => filePath.replaceAll("\\", path.sep));
  const operation = family === "shell" ? shellOperation(command) : family;
  const risk = family === "shell" ? shellRisk(command, operation) : "none";
  const signaturePayload =
    family === "shell"
      ? {
          toolName: toolName.toLowerCase(),
          command,
          workdir: sanitizedInput.workdir ?? sanitizedInput.cwd ?? null,
          env: sanitizedInput.env ?? null,
        }
      : { toolName: toolName.toLowerCase(), input: sanitizedInput };
  const result = normalizedResult(payload.tool_response ?? payload.error ?? "");
  const interrupted =
    payload.is_interrupt === true ||
    payload.tool_response?.interrupted === true ||
    payload.tool_response?.is_interrupt === true;
  const platform =
    options.platform ?? detectPlatform(payload, options.env ?? process.env);
  const explicit = explicitOutcome(payload.tool_response);
  let failed = false;
  if (!interrupted && payload.hook_event_name === "PostToolUseFailure") {
    failed = true;
  } else if (
    !interrupted &&
    payload.hook_event_name === "PostToolUse" &&
    platform === "codex"
  ) {
    failed =
      explicit ??
      (family === "shell" ? textFailure(result, operation) : false);
  }
  return {
    toolUseId: String(
      payload.tool_use_id ?? hash(signaturePayload, hashScope).slice(0, 16),
    ),
    toolName,
    family,
    operation,
    risk,
    signature: hash(signaturePayload, hashScope),
    filePaths,
    display: safeToolDisplay(family, operation),
    failed,
    interrupted,
    failureCategory: failed ? failureCategory(result) : null,
    resultFingerprint: result ? hash(result, hashScope) : null,
  };
}

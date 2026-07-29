import os from "node:os";
import path from "node:path";

export const MODES = new Set(["observe", "warn", "block"]);

function integer(
  value,
  fallback,
  minimum = 1,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) &&
    parsed >= minimum &&
    parsed <= maximum
    ? parsed
    : fallback;
}

export function configFromEnv(env = process.env) {
  const requestedMode = String(env.AGENT_WASTE_FIREWALL_MODE ?? "warn").toLowerCase();

  return {
    mode: MODES.has(requestedMode) ? requestedMode : "warn",
    dataDir:
      env.AGENT_WASTE_FIREWALL_DATA_DIR ??
      path.join(os.homedir(), ".agent-waste-firewall"),
    promptBlockScore: integer(env.AGENT_WASTE_FIREWALL_PROMPT_BLOCK_SCORE, 35),
    repeatWarnAt: integer(env.AGENT_WASTE_FIREWALL_REPEAT_WARN_AT, 3),
    highCostRepeatWarnAt: integer(
      env.AGENT_WASTE_FIREWALL_HIGH_COST_REPEAT_WARN_AT,
      2,
    ),
    repeatBlockAt: integer(env.AGENT_WASTE_FIREWALL_REPEAT_BLOCK_AT, 4),
    readWarnAt: integer(env.AGENT_WASTE_FIREWALL_READ_WARN_AT, 3),
    waitWarnAt: integer(env.AGENT_WASTE_FIREWALL_WAIT_WARN_AT, 3),
    waitBlockAt: integer(env.AGENT_WASTE_FIREWALL_WAIT_BLOCK_AT, 5),
    failedAttemptsBeforeBlock: integer(
      env.AGENT_WASTE_FIREWALL_FAILED_ATTEMPTS_BEFORE_BLOCK,
      2,
    ),
    maxToolEvents: integer(
      env.AGENT_WASTE_FIREWALL_MAX_TOOL_EVENTS,
      160,
      20,
      512,
    ),
    maxIncidents: integer(
      env.AGENT_WASTE_FIREWALL_MAX_INCIDENTS,
      100,
      10,
      256,
    ),
    liveMaxEvents: integer(
      env.AGENT_WASTE_FIREWALL_LIVE_MAX_EVENTS,
      4096,
      100,
      4096,
    ),
    liveMaxBytes: integer(
      env.AGENT_WASTE_FIREWALL_LIVE_MAX_BYTES,
      8 * 1024 * 1024,
      64 * 1024,
      8 * 1024 * 1024,
    ),
    liveMaxAgeMinutes: integer(
      env.AGENT_WASTE_FIREWALL_LIVE_MAX_AGE_MINUTES,
      24 * 60,
      1,
      24 * 60,
    ),
    retentionDays: integer(
      env.AGENT_WASTE_FIREWALL_RETENTION_DAYS,
      30,
      1,
      3650,
    ),
  };
}

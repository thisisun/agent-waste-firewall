import assert from "node:assert/strict";
import test from "node:test";

import { configFromEnv } from "../src/config.mjs";

test("accepts bounded live spool limits", () => {
  const config = configFromEnv({
    AGENT_WASTE_FIREWALL_LIVE_MAX_EVENTS: "2500",
    AGENT_WASTE_FIREWALL_LIVE_MAX_BYTES: String(2 * 1024 * 1024),
    AGENT_WASTE_FIREWALL_LIVE_MAX_AGE_MINUTES: "120",
  });

  assert.equal(config.liveMaxEvents, 2500);
  assert.equal(config.liveMaxBytes, 2 * 1024 * 1024);
  assert.equal(config.liveMaxAgeMinutes, 120);
});

test("rejects live spool limits that could disable bounded retention", () => {
  const config = configFromEnv({
    AGENT_WASTE_FIREWALL_LIVE_MAX_EVENTS: String(4097),
    AGENT_WASTE_FIREWALL_LIVE_MAX_BYTES: String(8 * 1024 * 1024 + 1),
    AGENT_WASTE_FIREWALL_LIVE_MAX_AGE_MINUTES: String(24 * 60 + 1),
  });

  assert.equal(config.liveMaxEvents, 4096);
  assert.equal(config.liveMaxBytes, 8 * 1024 * 1024);
  assert.equal(config.liveMaxAgeMinutes, 24 * 60);
});

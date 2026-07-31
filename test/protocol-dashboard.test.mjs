import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { validateDashboardReady } from "../src/dashboard-ready-schema.mjs";
import { validateDashboardStatus } from "../src/dashboard-status-schema.mjs";
import {
  validateProviderIntegrationStatus,
} from "../src/provider-integration-status.mjs";
import {
  validateProviderDeliveryVerification,
} from "../src/provider-delivery-verification.mjs";
import {
  validateCodexHookPreflight,
} from "../src/codex-hook-preflight.mjs";
import {
  validateHelperWorkerHandshake,
} from "../src/helper-worker-handshake.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const protocolRoot = path.join(root, "protocol");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function jsonFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

for (const contract of [
  {
    name: "dashboard ready",
    registryKey: "dashboardReady",
    schema: "dashboard-ready-v1.schema.json",
    fixtures: "dashboard-ready-v1",
    validate: validateDashboardReady,
  },
  {
    name: "dashboard status",
    registryKey: "dashboardStatus",
    schema: "dashboard-status-v1.schema.json",
    fixtures: "dashboard-status-v1",
    validate: validateDashboardStatus,
  },
  {
    name: "provider integration status",
    registryKey: "providerIntegrationStatus",
    schema: "provider-integration-status-v1.schema.json",
    fixtures: "provider-integration-status-v1",
    validate: validateProviderIntegrationStatus,
  },
  {
    name: "provider delivery verification",
    registryKey: "providerDeliveryVerification",
    schema: "provider-delivery-verification-v1.schema.json",
    fixtures: "provider-delivery-verification-v1",
    validate: validateProviderDeliveryVerification,
  },
  {
    name: "Codex hook preflight",
    registryKey: "codexHookPreflight",
    schema: "codex-hook-preflight-v1.schema.json",
    fixtures: "codex-hook-preflight-v1",
    validate: validateCodexHookPreflight,
  },
  {
    name: "helper worker handshake",
    registryKey: "helperWorkerHandshake",
    schema: "helper-worker-handshake-v1.schema.json",
    fixtures: "helper-worker-handshake-v1",
    validate: validateHelperWorkerHandshake,
  },
]) {
  test(`${contract.name} public schema matches its runtime version`, () => {
    const schema = readJson(path.join(protocolRoot, contract.schema));
    const versions = readJson(path.join(protocolRoot, "versions.json"));
    const registered = versions.protocols[contract.registryKey];

    assert.equal(
      schema.$schema,
      "https://json-schema.org/draft/2020-12/schema",
    );
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.v.const, registered.current);
    assert.deepEqual(registered.supported, [registered.current]);
    assert.equal(registered.schema, contract.schema);
    assert.deepEqual(
      [...schema.required].sort(),
      Object.keys(schema.properties).sort(),
    );
  });

  test(`${contract.name} valid fixtures pass the runtime validator`, () => {
    const files = jsonFiles(
      path.join(protocolRoot, "fixtures", contract.fixtures, "valid"),
    );
    assert.ok(files.length > 0);
    for (const file of files) {
      const value = readJson(file);
      assert.equal(contract.validate(value), value, path.basename(file));
    }
  });

  test(`${contract.name} invalid fixtures are rejected`, () => {
    const files = jsonFiles(
      path.join(protocolRoot, "fixtures", contract.fixtures, "invalid"),
    );
    assert.ok(files.length > 0);
    for (const file of files) {
      assert.throws(
        () => contract.validate(readJson(file)),
        undefined,
        path.basename(file),
      );
    }
  });
}

test("dashboard status rejects aliases from the wrong source domain", () => {
  const invalidDirectory = path.join(
    protocolRoot,
    "fixtures",
    "dashboard-status-v1",
    "invalid",
  );
  for (const fixture of [
    "live-trace-alias.json",
    "trace-session-alias.json",
  ]) {
    assert.throws(
      () =>
        validateDashboardStatus(
          readJson(path.join(invalidDirectory, fixture)),
        ),
      /Invalid DashboardStatusV1/u,
      fixture,
    );
  }
});

test("Codex hook preflight schema mirrors runtime reason precedence", () => {
  const schema = readJson(
    path.join(protocolRoot, "codex-hook-preflight-v1.schema.json"),
  );
  const reasonRules = new Map(
    schema.allOf
      .filter((rule) => rule.if?.properties?.reason?.const)
      .map((rule) => [rule.if.properties.reason.const, rule.then.properties]),
  );
  const reasons = [
    "provider_plugin_not_found",
    "discovery_errors",
    "discovery_warnings",
    "unexpected_hooks",
    "duplicate_hooks",
    "missing_hooks",
    "manifest_mismatch",
    "disabled_hooks",
    "modified_hooks",
    "untrusted_hooks",
  ];

  assert.deepEqual([...reasonRules.keys()], reasons);
  assert.match(
    schema.description,
    /unexpectedHookCount <= discoveredHookCount remains runtime-only/u,
  );
  for (const reason of reasons) {
    assert.equal(reasonRules.get(reason).result.const, "not_ready", reason);
  }

  const providerMissing = reasonRules.get("provider_plugin_not_found");
  for (const count of [
    "discoveredHookCount",
    "unexpectedHookCount",
    "readyHookCount",
    "errorCount",
    "warningCount",
  ]) {
    assert.equal(providerMissing[count].const, 0, count);
  }
  assert.equal(
    providerMissing.events.contains.properties.state.const,
    "missing",
  );
  assert.equal(providerMissing.events.minContains, 4);
  assert.equal(providerMissing.events.maxContains, 4);

  assert.equal(reasonRules.get("discovery_errors").errorCount.minimum, 1);
  assert.equal(reasonRules.get("discovery_warnings").errorCount.const, 0);
  assert.equal(
    reasonRules.get("discovery_warnings").warningCount.minimum,
    1,
  );

  const unexpected = reasonRules.get("unexpected_hooks");
  assert.equal(unexpected.errorCount.const, 0);
  assert.equal(unexpected.warningCount.const, 0);
  assert.equal(unexpected.discoveredHookCount.minimum, 1);
  assert.equal(unexpected.unexpectedHookCount.minimum, 1);

  function eventStateSets(reason) {
    const clauses = reasonRules.get(reason).events.allOf;
    const included = [];
    const excluded = [];
    for (const clause of clauses) {
      const state = clause.contains.properties.state;
      const states = state.enum ?? [state.const];
      if (clause.maxContains === 0) excluded.push(...states);
      else if (clause.minContains >= 1) included.push(...states);
    }
    return {
      included: [...new Set(included)],
      excluded: [...new Set(excluded)],
    };
  }

  const eventPrecedence = [
    ["duplicate_hooks", "duplicate", []],
    ["missing_hooks", "missing", ["duplicate"]],
    [
      "manifest_mismatch",
      "mismatch",
      ["duplicate", "missing"],
    ],
    [
      "disabled_hooks",
      "disabled",
      ["duplicate", "missing", "mismatch"],
    ],
    [
      "modified_hooks",
      "modified",
      ["duplicate", "missing", "mismatch", "disabled"],
    ],
    [
      "untrusted_hooks",
      "untrusted",
      ["duplicate", "missing", "mismatch", "disabled", "modified"],
    ],
  ];
  for (const [reason, requiredState, higherPrecedenceStates] of eventPrecedence) {
    const properties = reasonRules.get(reason);
    assert.equal(properties.errorCount.const, 0, reason);
    assert.equal(properties.warningCount.const, 0, reason);
    assert.equal(properties.unexpectedHookCount.const, 0, reason);
    assert.equal(properties.discoveredHookCount.minimum, 1, reason);
    assert.deepEqual(
      eventStateSets(reason),
      {
        included: [requiredState],
        excluded: higherPrecedenceStates,
      },
      reason,
    );
  }
});

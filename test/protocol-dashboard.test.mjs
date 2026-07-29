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

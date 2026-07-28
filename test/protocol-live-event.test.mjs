import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { validateLiveEvent } from "../src/live-event-schema.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const protocolRoot = path.join(root, "protocol");
const fixtureRoot = path.join(
  protocolRoot,
  "fixtures",
  "live-event-v1",
);

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

test("public protocol JSON parses and identifies the runtime version", () => {
  const schema = readJson(path.join(protocolRoot, "live-event-v1.schema.json"));
  const versions = readJson(path.join(protocolRoot, "versions.json"));
  const liveEvent = versions.protocols.liveEvent;

  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.v.const, liveEvent.current);
  assert.deepEqual(liveEvent.supported, [liveEvent.current]);
  assert.equal(
    path.resolve(protocolRoot, liveEvent.schema),
    path.join(protocolRoot, "live-event-v1.schema.json"),
  );
  assert.deepEqual(
    [...schema.required].sort(),
    Object.keys(schema.properties).sort(),
  );
});

test("all valid public fixtures pass the dependency-free runtime validator", () => {
  const files = jsonFiles(path.join(fixtureRoot, "valid"));
  assert.ok(files.length > 0);

  for (const file of files) {
    const event = readJson(file);
    assert.equal(validateLiveEvent(event), event, path.basename(file));
  }
});

test("all invalid public fixtures are rejected by the runtime validator", () => {
  const files = jsonFiles(path.join(fixtureRoot, "invalid"));
  assert.ok(files.length > 0);

  for (const file of files) {
    const event = readJson(file);
    assert.throws(
      () => validateLiveEvent(event),
      undefined,
      path.basename(file),
    );
  }
});

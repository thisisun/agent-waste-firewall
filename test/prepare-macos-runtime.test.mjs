import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import test from "node:test";

import {
  loadRuntimeManifest,
  prepareMacOSRuntime,
  validateRuntimeManifest,
} from "../scripts/prepare-macos-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function temporaryDirectory(context) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-runtime-prepare-"),
  );
  context.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function writeTarString(header, offset, length, value) {
  const content = Buffer.from(value, "utf8");
  assert.ok(content.length <= length, `${value} does not fit in tar field`);
  content.copy(header, offset);
}

function writeTarOctal(header, offset, length, value) {
  const octal = value.toString(8).padStart(length - 1, "0");
  assert.equal(octal.length, length - 1);
  header.write(octal, offset, length - 1, "ascii");
  header[offset + length - 1] = 0;
}

function tarHeader(name, size, type = "0") {
  const header = Buffer.alloc(512);
  writeTarString(header, 0, 100, name);
  writeTarOctal(header, 100, 8, type === "5" ? 0o755 : 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, size);
  writeTarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  writeTarString(header, 257, 6, "ustar");
  writeTarString(header, 263, 2, "00");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  const checksumOctal = checksum.toString(8).padStart(6, "0");
  header.write(checksumOctal, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function tarGz(entries) {
  const blocks = [];
  for (const { name, content, type = "0" } of entries) {
    const body = Buffer.from(content);
    blocks.push(tarHeader(name, body.length, type), body);
    const padding = (512 - (body.length % 512)) % 512;
    if (padding > 0) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks), { level: 1 });
}

function thinMachO(architecture) {
  const binary = Buffer.alloc(64);
  binary.writeUInt32LE(0xfeedfacf, 0);
  binary.writeUInt32LE(
    architecture === "arm64" ? 0x0100000c : 0x01000007,
    4,
  );
  binary.write("AWF fixture Node.js payload", 8, "utf8");
  return binary;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixtureManifest(baseManifest, archive, node, license) {
  const manifest = clone(baseManifest);
  manifest.artifacts.arm64.archiveSha256 = sha256(archive);
  manifest.artifacts.arm64.nodeSha256 = sha256(node);
  manifest.license.sha256 = sha256(license);
  return manifest;
}

test(
  "prepares only the verified thin runtime, full license, and metadata",
  async (context) => {
    const directory = temporaryDirectory(context);
    const baseManifest = await loadRuntimeManifest(
      path.join(root, "runtime", "node-runtime-v1.json"),
    );
    const artifact = baseManifest.artifacts.arm64;
    const node = thinMachO("arm64");
    const license = Buffer.from(
      "Complete fake Node.js LICENSE fixture.\nThird-party notices remain.\n",
      "utf8",
    );
    const archive = tarGz([
      { name: artifact.licensePath, content: license },
      { name: artifact.nodePath, content: node },
      {
        name: `${artifact.archiveRoot}/README.md`,
        content: Buffer.from("not selected\n"),
      },
    ]);
    const manifest = fixtureManifest(
      baseManifest,
      archive,
      node,
      license,
    );
    const archivePath = path.join(directory, "fixture.tar.gz");
    const outputDirectory = path.join(directory, "payload");
    fs.writeFileSync(archivePath, archive);

    const metadata = await prepareMacOSRuntime({
      architecture: "arm64",
      archivePath,
      outputDirectory,
      manifest,
    });

    assert.deepEqual(
      fs.readdirSync(outputDirectory).sort(),
      ["LICENSE", "awf-node", "payload.json"],
    );
    assert.deepEqual(
      fs.readFileSync(path.join(outputDirectory, "awf-node")),
      node,
    );
    assert.deepEqual(
      fs.readFileSync(path.join(outputDirectory, "LICENSE")),
      license,
    );
    assert.equal(
      fs.statSync(path.join(outputDirectory, "awf-node")).mode & 0o777,
      0o755,
    );
    assert.equal(
      fs.statSync(path.join(outputDirectory, "LICENSE")).mode & 0o777,
      0o644,
    );
    const writtenMetadata = JSON.parse(
      fs.readFileSync(
        path.join(outputDirectory, "payload.json"),
        "utf8",
      ),
    );
    assert.deepEqual(writtenMetadata, metadata);
    assert.equal(writtenMetadata.target.architecture, "arm64");
    assert.equal(
      writtenMetadata.files.executable.sha256,
      sha256(node),
    );
    assert.equal(
      writtenMetadata.files.license.sha256,
      sha256(license),
    );
    assert.equal(
      JSON.stringify(writtenMetadata).includes(archivePath),
      false,
      "local source paths must not enter payload metadata",
    );
  },
);

test(
  "rejects an archive checksum mismatch before creating output",
  async (context) => {
    const directory = temporaryDirectory(context);
    const baseManifest = await loadRuntimeManifest();
    const artifact = baseManifest.artifacts.arm64;
    const node = thinMachO("arm64");
    const license = Buffer.from("Complete fake license.\n");
    const archive = tarGz([
      { name: artifact.nodePath, content: node },
      { name: artifact.licensePath, content: license },
    ]);
    const manifest = fixtureManifest(
      baseManifest,
      archive,
      node,
      license,
    );
    const corrupted = Buffer.from(archive);
    corrupted[10] ^= 0xff;
    const archivePath = path.join(directory, "corrupted.tar.gz");
    const outputDirectory = path.join(directory, "payload");
    fs.writeFileSync(archivePath, corrupted);

    await assert.rejects(
      prepareMacOSRuntime({
        architecture: "arm64",
        archivePath,
        outputDirectory,
        manifest,
      }),
      /archive SHA-256 mismatch/u,
    );
    assert.equal(fs.existsSync(outputDirectory), false);
    assert.deepEqual(fs.readdirSync(directory), ["corrupted.tar.gz"]);
  },
);

test(
  "rejects a verified tar containing a traversal counterexample",
  async (context) => {
    const directory = temporaryDirectory(context);
    const baseManifest = await loadRuntimeManifest();
    const artifact = baseManifest.artifacts.arm64;
    const node = thinMachO("arm64");
    const license = Buffer.from("Complete fake license.\n");
    const archive = tarGz([
      {
        name: `${artifact.archiveRoot}/../outside`,
        content: Buffer.from("must never escape\n"),
      },
      { name: artifact.nodePath, content: node },
      { name: artifact.licensePath, content: license },
    ]);
    const manifest = fixtureManifest(
      baseManifest,
      archive,
      node,
      license,
    );
    const archivePath = path.join(directory, "traversal.tar.gz");
    const outputDirectory = path.join(directory, "payload");
    fs.writeFileSync(archivePath, archive);

    await assert.rejects(
      prepareMacOSRuntime({
        architecture: "arm64",
        archivePath,
        outputDirectory,
        manifest,
      }),
      /tar path is not allowed/u,
    );
    assert.equal(fs.existsSync(outputDirectory), false);
    assert.deepEqual(fs.readdirSync(directory), ["traversal.tar.gz"]);
  },
);

test("rejects unknown manifest keys at every closed boundary", async () => {
  const baseManifest = await loadRuntimeManifest();
  const unknownRoot = clone(baseManifest);
  unknownRoot.rawHookPayload = "forbidden";
  assert.throws(
    () => validateRuntimeManifest(unknownRoot),
    /runtime manifest has unknown key\(s\): rawHookPayload/u,
  );

  const unknownArtifact = clone(baseManifest);
  unknownArtifact.artifacts.arm64.postInstallCommand = "forbidden";
  assert.throws(
    () => validateRuntimeManifest(unknownArtifact),
    /artifacts\.arm64 has unknown key\(s\): postInstallCommand/u,
  );
});

test("requires explicit opt-in before any network download", async (context) => {
  const directory = temporaryDirectory(context);
  const baseManifest = await loadRuntimeManifest();
  await assert.rejects(
    prepareMacOSRuntime({
      architecture: "arm64",
      outputDirectory: path.join(directory, "payload"),
      manifest: baseManifest,
    }),
    /explicit --archive is required unless --download is set/u,
  );
});

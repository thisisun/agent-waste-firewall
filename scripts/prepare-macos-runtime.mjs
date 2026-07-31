#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultManifestPath = path.join(
  repositoryRoot,
  "runtime",
  "node-runtime-v1.json",
);

const architectures = ["arm64", "x64"];
const maximumArchiveBytes = 256 * 1024 * 1024;
const maximumExpandedTarBytes = 512 * 1024 * 1024;
const maximumNodeBytes = 256 * 1024 * 1024;
const maximumLicenseBytes = 8 * 1024 * 1024;
const maximumTarMetadataBytes = 1024 * 1024;
const maximumTarEntries = 100_000;
const tarBlockBytes = 512;

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, expectedKeys, label) {
  if (!isObject(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  const unknown = actual.filter((key) => !expected.includes(key));
  const missing = expected.filter((key) => !actual.includes(key));
  if (unknown.length > 0) {
    fail(`${label} has unknown key(s): ${unknown.join(", ")}`);
  }
  if (missing.length > 0) {
    fail(`${label} is missing key(s): ${missing.join(", ")}`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
}

function assertSha256(value, label) {
  if (
    typeof value !== "string"
    || !/^[a-f0-9]{64}$/u.test(value)
  ) {
    fail(`${label} must be a lowercase SHA-256 digest`);
  }
}

/**
 * The runtime manifest is a closed semantic allowlist. Any additional field
 * fails validation instead of silently becoming release metadata.
 */
export function validateRuntimeManifest(manifest) {
  assertExactKeys(
    manifest,
    [
      "schemaVersion",
      "runtime",
      "version",
      "platform",
      "minimumMacOSVersion",
      "license",
      "artifacts",
    ],
    "runtime manifest",
  );
  if (manifest.schemaVersion !== 1) {
    fail("runtime manifest schemaVersion must be 1");
  }
  if (manifest.runtime !== "node") {
    fail('runtime manifest runtime must be "node"');
  }
  if (!/^v\d+\.\d+\.\d+$/u.test(manifest.version)) {
    fail("runtime manifest version must be an exact Node.js version");
  }
  if (manifest.platform !== "darwin") {
    fail('runtime manifest platform must be "darwin"');
  }
  if (!/^\d+\.\d+$/u.test(manifest.minimumMacOSVersion)) {
    fail("runtime manifest minimumMacOSVersion must be major.minor");
  }

  assertExactKeys(
    manifest.license,
    ["sha256", "sourceUrl"],
    "runtime manifest license",
  );
  assertSha256(
    manifest.license.sha256,
    "runtime manifest license.sha256",
  );
  const expectedLicenseUrl =
    `https://github.com/nodejs/node/blob/${manifest.version}/LICENSE`;
  if (manifest.license.sourceUrl !== expectedLicenseUrl) {
    fail(
      `runtime manifest license.sourceUrl must be ${expectedLicenseUrl}`,
    );
  }

  assertExactKeys(
    manifest.artifacts,
    architectures,
    "runtime manifest artifacts",
  );
  for (const architecture of architectures) {
    const artifact = manifest.artifacts[architecture];
    const label = `runtime manifest artifacts.${architecture}`;
    assertExactKeys(
      artifact,
      [
        "distribution",
        "archiveFormat",
        "archiveRoot",
        "archiveFileName",
        "archiveUrl",
        "archiveSha256",
        "nodePath",
        "nodeSha256",
        "licensePath",
      ],
      label,
    );
    if (artifact.distribution !== "thin") {
      fail(`${label}.distribution must be "thin"`);
    }
    if (artifact.archiveFormat !== "tar.gz") {
      fail(`${label}.archiveFormat must be "tar.gz"`);
    }

    const root =
      `node-${manifest.version}-${manifest.platform}-${architecture}`;
    const fileName = `${root}.tar.gz`;
    const url =
      `https://nodejs.org/dist/${manifest.version}/${fileName}`;
    const expectedValues = {
      archiveRoot: root,
      archiveFileName: fileName,
      archiveUrl: url,
      nodePath: `${root}/bin/node`,
      licensePath: `${root}/LICENSE`,
    };
    for (const [key, expected] of Object.entries(expectedValues)) {
      assertString(artifact[key], `${label}.${key}`);
      if (artifact[key] !== expected) {
        fail(`${label}.${key} must be ${expected}`);
      }
    }
    assertSha256(artifact.archiveSha256, `${label}.archiveSha256`);
    assertSha256(artifact.nodeSha256, `${label}.nodeSha256`);
  }
  return manifest;
}

export async function loadRuntimeManifest(
  manifestPath = defaultManifestPath,
) {
  const source = await fs.readFile(manifestPath, "utf8");
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    fail(`runtime manifest is not valid JSON: ${error.message}`);
  }
  return validateRuntimeManifest(manifest);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function pathExists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function readExplicitArchive(archivePath) {
  const absolutePath = path.resolve(archivePath);
  const stat = await fs.lstat(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("explicit archive must be a regular file, not a symlink");
  }
  if (stat.size > maximumArchiveBytes) {
    fail(`explicit archive exceeds ${maximumArchiveBytes} bytes`);
  }
  const archive = await fs.readFile(absolutePath);
  if (archive.length !== stat.size) {
    fail("explicit archive changed while it was being read");
  }
  return archive;
}

async function downloadArchive(url) {
  if (typeof fetch !== "function") {
    fail("this Node.js runtime does not provide fetch()");
  }
  const response = await fetch(url, {
    redirect: "error",
    headers: {
      "user-agent": "agent-waste-firewall-runtime-preparer/1",
    },
  });
  if (!response.ok || response.body === null) {
    fail(`runtime download failed with HTTP ${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength)
    && declaredLength > maximumArchiveBytes
  ) {
    fail(`runtime download exceeds ${maximumArchiveBytes} bytes`);
  }

  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumArchiveBytes) {
        await reader.cancel();
        fail(`runtime download exceeds ${maximumArchiveBytes} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

class AsyncByteReader {
  constructor(stream, limit) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.current = Buffer.alloc(0);
    this.offset = 0;
    this.ended = false;
    this.received = 0;
    this.limit = limit;
  }

  async fill() {
    while (!this.ended && this.offset >= this.current.length) {
      const next = await this.iterator.next();
      if (next.done) {
        this.ended = true;
        this.current = Buffer.alloc(0);
        this.offset = 0;
        return false;
      }
      this.current = Buffer.from(next.value);
      this.offset = 0;
      this.received += this.current.length;
      if (this.received > this.limit) {
        fail(`expanded tar exceeds ${this.limit} bytes`);
      }
      if (this.current.length > 0) {
        return true;
      }
    }
    return !this.ended;
  }

  async readExact(length, { allowEof = false } = {}) {
    if (!Number.isSafeInteger(length) || length < 0) {
      fail("invalid tar read length");
    }
    if (length === 0) return Buffer.alloc(0);
    const result = Buffer.allocUnsafe(length);
    let written = 0;
    while (written < length) {
      const available = await this.fill();
      if (!available) {
        if (allowEof && written === 0) return null;
        fail("truncated tar archive");
      }
      const amount = Math.min(
        length - written,
        this.current.length - this.offset,
      );
      this.current.copy(
        result,
        written,
        this.offset,
        this.offset + amount,
      );
      this.offset += amount;
      written += amount;
    }
    return result;
  }

  async discard(length) {
    if (!Number.isSafeInteger(length) || length < 0) {
      fail("invalid tar discard length");
    }
    let remaining = length;
    while (remaining > 0) {
      const available = await this.fill();
      if (!available) fail("truncated tar archive");
      const amount = Math.min(
        remaining,
        this.current.length - this.offset,
      );
      this.offset += amount;
      remaining -= amount;
    }
  }

  async assertTrailingZeroes() {
    while (await this.fill()) {
      for (let index = this.offset; index < this.current.length; index += 1) {
        if (this.current[index] !== 0) {
          fail("tar contains non-zero data after its end marker");
        }
      }
      this.offset = this.current.length;
    }
  }
}

function tarString(field) {
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
}

function tarNumber(field, label) {
  if ((field[0] & 0x80) !== 0) {
    fail(`${label} uses unsupported base-256 encoding`);
  }
  const value = tarString(field).trim();
  if (!/^[0-7]+$/u.test(value)) {
    fail(`${label} is not an octal number`);
  }
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    fail(`${label} is outside the safe integer range`);
  }
  return parsed;
}

function tarHeaderChecksum(header) {
  let sum = 0;
  for (let index = 0; index < header.length; index += 1) {
    if (index >= 148 && index < 156) {
      sum += 0x20;
    } else {
      sum += header[index];
    }
  }
  return sum;
}

function isZeroBlock(block) {
  return block.every((byte) => byte === 0);
}

function parseTarHeader(header) {
  const storedChecksum = tarNumber(
    header.subarray(148, 156),
    "tar header checksum",
  );
  if (storedChecksum !== tarHeaderChecksum(header)) {
    fail("tar header checksum mismatch");
  }
  const name = tarString(header.subarray(0, 100));
  const prefix = tarString(header.subarray(345, 500));
  const pathName = prefix.length > 0 ? `${prefix}/${name}` : name;
  return {
    path: pathName,
    size: tarNumber(header.subarray(124, 136), "tar entry size"),
    type: header[156] === 0 ? "0" : String.fromCharCode(header[156]),
  };
}

function parsePaxRecords(buffer) {
  const records = {};
  let offset = 0;
  while (offset < buffer.length) {
    const space = buffer.indexOf(0x20, offset);
    if (space === -1) fail("malformed PAX record length");
    const lengthText = buffer.subarray(offset, space).toString("ascii");
    if (!/^[1-9]\d*$/u.test(lengthText)) {
      fail("malformed PAX record length");
    }
    const length = Number(lengthText);
    const end = offset + length;
    if (!Number.isSafeInteger(length) || end > buffer.length) {
      fail("truncated PAX record");
    }
    if (buffer[end - 1] !== 0x0a) {
      fail("PAX record is missing its newline terminator");
    }
    const record = buffer.subarray(space + 1, end - 1);
    const equals = record.indexOf(0x3d);
    if (equals < 1) fail("malformed PAX key/value record");
    const key = record.subarray(0, equals).toString("utf8");
    if (Object.hasOwn(records, key)) {
      fail(`duplicate PAX key: ${key}`);
    }
    records[key] = record.subarray(equals + 1).toString("utf8");
    offset = end;
  }
  return records;
}

function validateTarPath(pathName, archiveRoot) {
  if (
    typeof pathName !== "string"
    || pathName.length === 0
    || pathName.includes("\\")
    || pathName.startsWith("/")
  ) {
    fail(`tar path is not allowed: ${JSON.stringify(pathName)}`);
  }
  const withoutTrailingSlash = pathName.endsWith("/")
    ? pathName.slice(0, -1)
    : pathName;
  const components = withoutTrailingSlash.split("/");
  if (
    components.some(
      (component) =>
        component.length === 0
        || component === "."
        || component === "..",
    )
  ) {
    fail(`tar path is not allowed: ${JSON.stringify(pathName)}`);
  }
  if (
    withoutTrailingSlash !== archiveRoot
    && !withoutTrailingSlash.startsWith(`${archiveRoot}/`)
  ) {
    fail(`tar path is outside the allowlisted root: ${pathName}`);
  }
}

function stripTarMetadataTerminator(buffer, label) {
  if (buffer.length > maximumTarMetadataBytes) {
    fail(`${label} exceeds ${maximumTarMetadataBytes} bytes`);
  }
  const text = buffer.toString("utf8");
  return text.replace(/\0+$/u, "");
}

async function extractAllowlistedPayload(archive, artifact) {
  const gunzip = createGunzip();
  const stream = Readable.from([archive]).pipe(gunzip);
  const reader = new AsyncByteReader(stream, maximumExpandedTarBytes);
  const selected = new Map([
    [artifact.nodePath, { name: "node", limit: maximumNodeBytes }],
    [
      artifact.licensePath,
      { name: "license", limit: maximumLicenseBytes },
    ],
  ]);
  const payload = {};
  let entries = 0;
  let pendingLongPath;
  let pendingPax;

  while (true) {
    const headerBlock = await reader.readExact(
      tarBlockBytes,
      { allowEof: true },
    );
    if (headerBlock === null) fail("tar archive has no end marker");
    if (isZeroBlock(headerBlock)) {
      const secondEndBlock = await reader.readExact(tarBlockBytes);
      if (!isZeroBlock(secondEndBlock)) {
        fail("tar archive has an invalid end marker");
      }
      if (pendingLongPath !== undefined || pendingPax !== undefined) {
        fail("tar archive ends with unapplied path metadata");
      }
      await reader.assertTrailingZeroes();
      break;
    }

    entries += 1;
    if (entries > maximumTarEntries) {
      fail(`tar archive exceeds ${maximumTarEntries} entries`);
    }
    const header = parseTarHeader(headerBlock);
    const padding =
      (tarBlockBytes - (header.size % tarBlockBytes)) % tarBlockBytes;

    if (header.type === "L") {
      if (pendingLongPath !== undefined) {
        fail("tar archive has stacked GNU long-path records");
      }
      const content = await reader.readExact(header.size);
      pendingLongPath = stripTarMetadataTerminator(
        content,
        "GNU long-path record",
      );
      await reader.discard(padding);
      continue;
    }
    if (header.type === "K") {
      if (header.size > maximumTarMetadataBytes) {
        fail(
          `GNU long-link record exceeds ${maximumTarMetadataBytes} bytes`,
        );
      }
      await reader.discard(header.size);
      await reader.discard(padding);
      continue;
    }
    if (header.type === "x" || header.type === "g") {
      if (header.size > maximumTarMetadataBytes) {
        fail(`PAX metadata exceeds ${maximumTarMetadataBytes} bytes`);
      }
      const records = parsePaxRecords(
        await reader.readExact(header.size),
      );
      await reader.discard(padding);
      if (Object.hasOwn(records, "size")) {
        fail("PAX size overrides are not allowed");
      }
      if (header.type === "g") {
        if (Object.hasOwn(records, "path")) {
          fail("global PAX path overrides are not allowed");
        }
      } else {
        if (pendingPax !== undefined) {
          fail("tar archive has stacked local PAX records");
        }
        pendingPax = records;
      }
      continue;
    }

    if (!["0", "1", "2", "5"].includes(header.type)) {
      fail(`unsupported tar entry type: ${JSON.stringify(header.type)}`);
    }
    const pathName =
      pendingPax?.path ?? pendingLongPath ?? header.path;
    pendingPax = undefined;
    pendingLongPath = undefined;
    validateTarPath(pathName, artifact.archiveRoot);

    const selection = selected.get(pathName);
    if (selection !== undefined) {
      if (header.type !== "0") {
        fail(`allowlisted payload is not a regular file: ${pathName}`);
      }
      if (Object.hasOwn(payload, selection.name)) {
        fail(`duplicate allowlisted payload: ${pathName}`);
      }
      if (header.size > selection.limit) {
        fail(`${pathName} exceeds ${selection.limit} bytes`);
      }
      payload[selection.name] = await reader.readExact(header.size);
    } else {
      await reader.discard(header.size);
    }
    await reader.discard(padding);
  }

  for (const selection of selected.values()) {
    if (!Object.hasOwn(payload, selection.name)) {
      fail(`tar archive is missing allowlisted ${selection.name} payload`);
    }
  }
  return payload;
}

function verifyThinMachO(node, architecture) {
  if (node.length < 8 || node.readUInt32LE(0) !== 0xfeedfacf) {
    fail("awf-node is not a thin 64-bit Mach-O binary");
  }
  const expectedCpuType = architecture === "arm64"
    ? 0x0100000c
    : 0x01000007;
  if (node.readUInt32LE(4) !== expectedCpuType) {
    fail(`awf-node does not match ${architecture}`);
  }
}

function buildPayloadMetadata(manifest, architecture, artifact) {
  return {
    schemaVersion: 1,
    runtime: {
      name: manifest.runtime,
      version: manifest.version,
    },
    target: {
      platform: manifest.platform,
      architecture,
      distribution: artifact.distribution,
      minimumMacOSVersion: manifest.minimumMacOSVersion,
    },
    source: {
      archiveFileName: artifact.archiveFileName,
      archiveUrl: artifact.archiveUrl,
      archiveSha256: artifact.archiveSha256,
    },
    files: {
      executable: {
        path: "awf-node",
        sha256: artifact.nodeSha256,
      },
      license: {
        path: "LICENSE",
        sha256: manifest.license.sha256,
        sourceUrl: manifest.license.sourceUrl,
      },
    },
  };
}

async function writePayload(outputDirectory, node, license, metadata) {
  const destination = path.resolve(outputDirectory);
  if (await pathExists(destination)) {
    fail(`output already exists: ${destination}`);
  }

  const parent = path.dirname(destination);
  await fs.mkdir(parent, { recursive: true, mode: 0o755 });
  const temporary = path.join(
    parent,
    `.${path.basename(destination)}.tmp-${process.pid}-${
      randomBytes(8).toString("hex")
    }`,
  );
  await fs.mkdir(temporary, { mode: 0o755 });
  let activated = false;
  try {
    const executablePath = path.join(temporary, "awf-node");
    const licensePath = path.join(temporary, "LICENSE");
    const metadataPath = path.join(temporary, "payload.json");
    await fs.writeFile(executablePath, node, {
      flag: "wx",
      mode: 0o755,
    });
    await fs.writeFile(licensePath, license, {
      flag: "wx",
      mode: 0o644,
    });
    await fs.writeFile(
      metadataPath,
      `${JSON.stringify(metadata, null, 2)}\n`,
      {
        flag: "wx",
        mode: 0o644,
      },
    );
    await fs.chmod(executablePath, 0o755);
    await fs.chmod(licensePath, 0o644);
    await fs.chmod(metadataPath, 0o644);
    if (await pathExists(destination)) {
      fail(`output appeared during preparation: ${destination}`);
    }
    await fs.rename(temporary, destination);
    activated = true;
  } finally {
    if (!activated) {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
}

/**
 * Verify the immutable source archive and both selected payloads before
 * creating or changing the output directory.
 */
export async function prepareMacOSRuntime({
  architecture,
  archivePath,
  download = false,
  outputDirectory,
  manifest,
}) {
  const validatedManifest = validateRuntimeManifest(
    manifest ?? await loadRuntimeManifest(),
  );
  if (!architectures.includes(architecture)) {
    fail('architecture must be "arm64" or "x64"');
  }
  assertString(outputDirectory, "outputDirectory");
  if (archivePath !== undefined && download) {
    fail("--archive and --download are mutually exclusive");
  }
  if (archivePath === undefined && !download) {
    fail("an explicit --archive is required unless --download is set");
  }
  if (archivePath !== undefined) {
    assertString(archivePath, "archivePath");
  }

  const destination = path.resolve(outputDirectory);
  if (await pathExists(destination)) {
    fail(`output already exists: ${destination}`);
  }

  const artifact = validatedManifest.artifacts[architecture];
  const archive = archivePath === undefined
    ? await downloadArchive(artifact.archiveUrl)
    : await readExplicitArchive(archivePath);
  const actualArchiveSha256 = sha256(archive);
  if (actualArchiveSha256 !== artifact.archiveSha256) {
    fail(
      `archive SHA-256 mismatch: expected ${artifact.archiveSha256}, `
      + `received ${actualArchiveSha256}`,
    );
  }

  const payload = await extractAllowlistedPayload(archive, artifact);
  const actualNodeSha256 = sha256(payload.node);
  if (actualNodeSha256 !== artifact.nodeSha256) {
    fail(
      `node SHA-256 mismatch: expected ${artifact.nodeSha256}, `
      + `received ${actualNodeSha256}`,
    );
  }
  const actualLicenseSha256 = sha256(payload.license);
  if (actualLicenseSha256 !== validatedManifest.license.sha256) {
    fail(
      `LICENSE SHA-256 mismatch: expected `
      + `${validatedManifest.license.sha256}, `
      + `received ${actualLicenseSha256}`,
    );
  }
  verifyThinMachO(payload.node, architecture);

  const metadata = buildPayloadMetadata(
    validatedManifest,
    architecture,
    artifact,
  );
  await writePayload(
    destination,
    payload.node,
    payload.license,
    metadata,
  );
  return metadata;
}

function usage() {
  return [
    "Prepare a verified, architecture-specific Node.js payload for AWF.",
    "",
    "Usage:",
    "  node scripts/prepare-macos-runtime.mjs \\",
    "    --arch <arm64|x64> --archive <path> --output <directory>",
    "  node scripts/prepare-macos-runtime.mjs \\",
    "    --arch <arm64|x64> --download --output <directory>",
    "",
    "Network access is disabled by default. --download is explicit opt-in.",
  ].join("\n");
}

function takeValue(argumentsList, index, option) {
  const value = argumentsList[index + 1];
  if (value === undefined || value.startsWith("--")) {
    fail(`${option} requires a value`);
  }
  return value;
}

export function parseArguments(argumentsList) {
  const options = { download: false };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--arch") {
      options.architecture = takeValue(argumentsList, index, argument);
      index += 1;
    } else if (argument === "--archive") {
      options.archivePath = takeValue(argumentsList, index, argument);
      index += 1;
    } else if (argument === "--output") {
      options.outputDirectory = takeValue(argumentsList, index, argument);
      index += 1;
    } else if (argument === "--download") {
      options.download = true;
    } else {
      fail(`unknown argument: ${argument}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const metadata = await prepareMacOSRuntime(options);
  process.stdout.write(
    `Prepared ${metadata.runtime.name} ${metadata.runtime.version} `
    + `${metadata.target.architecture} at `
    + `${path.resolve(options.outputDirectory)}\n`,
  );
}

const invokedPath = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`prepare-macos-runtime: ${error.message}\n`);
    process.exitCode = 1;
  });
}

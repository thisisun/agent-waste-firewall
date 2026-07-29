#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  loadRuntimeManifest,
  validateRuntimeManifest,
} from "./prepare-macos-runtime.mjs";

const supportedArchitectures = ["arm64", "x64"];
const maximumRuntimeBytes = 256 * 1024 * 1024;
const maximumLicenseBytes = 8 * 1024 * 1024;
const maximumMetadataBytes = 8 * 1024;
const maximumCommandBytes = 8 * 1024;
const commandTimeoutMilliseconds = 10_000;
const hardenedRuntimeFlag = 0x10000n;
const requiredRuntimeEntitlement =
  "com.apple.security.cs.allow-jit";
const runtimeReadinessOutput = "AWF_V8_JIT_READY\n";
const runtimeReadinessScript = [
  "const bytes=Uint8Array.from([",
  "0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,",
  "7,5,1,1,102,0,0,10,6,1,4,0,65,42,11]);",
  "const instance=new WebAssembly.Instance(",
  "new WebAssembly.Module(bytes));",
  "if(instance.exports.f()!==42)process.exit(91);",
  `process.stdout.write(${JSON.stringify(runtimeReadinessOutput)});`,
].join("");

const runtimeRelativePath = path.join("Contents", "Helpers", "awf-node");
const digestRelativePath = path.join(
  "Contents",
  "Resources",
  "RuntimePayload",
  "awf-node.sha256",
);
const licenseRelativePath = path.join(
  "Contents",
  "Resources",
  "ThirdPartyNotices",
  "Node",
  "LICENSE",
);

function fail(message) {
  throw new Error(message);
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function equalIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

async function lstatIdentity(target) {
  return fs.lstat(target, { bigint: true });
}

async function assertCanonicalAbsolutePath(target, label) {
  assertString(target, label);
  if (!path.isAbsolute(target) || path.normalize(target) !== target) {
    fail(`${label} must be an absolute normalized path`);
  }
  const canonical = await fs.realpath(target);
  if (canonical !== target) {
    fail(`${label} must not contain symlinked path components`);
  }
}

function isDescendant(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function assertDirectory(target, label) {
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail(`${label} must be a directory, not a symlink`);
  }
}

async function assertAbsent(target, message) {
  try {
    await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  fail(message);
}

async function ensureClosedDirectory(target, allowedParent, label) {
  if (path.dirname(target) !== allowedParent) {
    fail(`${label} is outside its closed parent`);
  }
  try {
    await fs.mkdir(target, { mode: 0o755 });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }
  await assertDirectory(target, label);
}

async function readStableRegularFile(
  target,
  {
    label,
    maximumBytes,
    requireExecutable = false,
  },
) {
  const before = await lstatIdentity(target);
  if (!before.isFile() || before.isSymbolicLink()) {
    fail(`${label} must be a regular file, not a symlink`);
  }
  if (before.size <= 0n || before.size > BigInt(maximumBytes)) {
    fail(`${label} has an invalid size`);
  }
  if (requireExecutable && (before.mode & 0o111n) === 0n) {
    fail(`${label} must be executable`);
  }

  const handle = await fs.open(
    target,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await handle.stat({ bigint: true });
    if (!equalIdentity(before, opened)) {
      fail(`${label} changed before it was opened`);
    }
    const content = await handle.readFile();
    const afterRead = await handle.stat({ bigint: true });
    if (
      content.length !== Number(opened.size)
      || !equalIdentity(opened, afterRead)
    ) {
      fail(`${label} changed while it was being read`);
    }
    return { content, identity: afterRead };
  } finally {
    await handle.close();
  }
}

async function assertUnchanged(target, expectedIdentity, label) {
  const current = await lstatIdentity(target);
  if (!equalIdentity(current, expectedIdentity)) {
    fail(`${label} changed during finalization`);
  }
}

function verifyThinMachO(binary, architecture, label) {
  if (binary.length < 8 || binary.readUInt32LE(0) !== 0xfeedfacf) {
    fail(`${label} is not a thin 64-bit Mach-O binary`);
  }
  const expectedCpuType = architecture === "arm64"
    ? 0x0100000c
    : 0x01000007;
  if (binary.readUInt32LE(4) !== expectedCpuType) {
    fail(`${label} does not match ${architecture}`);
  }
}

function expectedPayloadMetadata(manifest, architecture) {
  const artifact = manifest.artifacts[architecture];
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

async function verifyPreparedPayload(
  payloadDirectory,
  manifest,
  architecture,
) {
  await assertCanonicalAbsolutePath(payloadDirectory, "payloadDirectory");
  await assertDirectory(payloadDirectory, "payloadDirectory");
  const entries = (await fs.readdir(payloadDirectory)).sort();
  const expectedEntries = ["LICENSE", "awf-node", "payload.json"];
  if (
    entries.length !== expectedEntries.length
    || entries.some((entry, index) => entry !== expectedEntries[index])
  ) {
    fail("prepared payload must contain only LICENSE, awf-node, and payload.json");
  }

  const preparedRuntime = await readStableRegularFile(
    path.join(payloadDirectory, "awf-node"),
    {
      label: "prepared awf-node",
      maximumBytes: maximumRuntimeBytes,
      requireExecutable: true,
    },
  );
  const artifact = manifest.artifacts[architecture];
  if (sha256(preparedRuntime.content) !== artifact.nodeSha256) {
    fail("prepared awf-node SHA-256 does not match the runtime manifest");
  }
  verifyThinMachO(
    preparedRuntime.content,
    architecture,
    "prepared awf-node",
  );

  const license = await readStableRegularFile(
    path.join(payloadDirectory, "LICENSE"),
    {
      label: "prepared Node LICENSE",
      maximumBytes: maximumLicenseBytes,
    },
  );
  if (sha256(license.content) !== manifest.license.sha256) {
    fail("prepared Node LICENSE SHA-256 does not match the runtime manifest");
  }

  const metadata = await readStableRegularFile(
    path.join(payloadDirectory, "payload.json"),
    {
      label: "prepared payload metadata",
      maximumBytes: maximumMetadataBytes,
    },
  );
  const expectedMetadata = expectedPayloadMetadata(manifest, architecture);
  const canonicalMetadata = `${JSON.stringify(expectedMetadata, null, 2)}\n`;
  if (metadata.content.toString("utf8") !== canonicalMetadata) {
    fail("prepared payload metadata is not the exact canonical manifest view");
  }
  return license.content;
}

function bounded(value) {
  const source = typeof value === "string" ? value : "";
  if (Buffer.byteLength(source, "utf8") > maximumCommandBytes) {
    return source.slice(0, maximumCommandBytes);
  }
  return source;
}

function executeCommand(executable, argumentsList) {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      argumentsList,
      {
        encoding: "utf8",
        env: {
          HOME: "/var/empty",
          LANG: "C",
          LC_ALL: "C",
          PATH: "/usr/bin:/bin",
        },
        maxBuffer: maximumCommandBytes,
        timeout: commandTimeoutMilliseconds,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (
          error !== null
          && error.killed
          && error.signal === "SIGTERM"
        ) {
          reject(new Error(`${path.basename(executable)} timed out`));
          return;
        }
        resolve({
          exitCode: error === null ? 0 : (error.code ?? 1),
          stdout: bounded(stdout),
          stderr: bounded(stderr),
        });
      },
    );
  });
}

async function verifySigningStage(appPath, runtimePath, runCommand) {
  await assertAbsent(
    path.join(appPath, "Contents", "_CodeSignature"),
    "outer app is already signed or contains a stale signature seal",
  );
  const outer = await runCommand(
    "/usr/bin/codesign",
    ["--verify", "--strict", "--verbose=2", appPath],
  );
  if (outer.exitCode === 0) {
    fail("outer app is already signed; finalize before signing AWF.app");
  }

  const nested = await runCommand(
    "/usr/bin/codesign",
    ["--verify", "--strict", "--verbose=2", runtimePath],
  );
  if (nested.exitCode !== 0) {
    fail("nested awf-node code signature verification failed");
  }
}

function parseRuntimeEntitlements(source) {
  if (
    typeof source !== "string"
    || Buffer.byteLength(source, "utf8") > maximumCommandBytes
  ) {
    fail("nested awf-node entitlements are not a bounded XML plist");
  }

  let document = source.trim();
  document = document.replace(
    /^<\?xml\s+version="1\.0"\s+encoding="UTF-8"\?>\s*/u,
    "",
  );
  document = document.replace(
    /^<!DOCTYPE\s+plist\s+PUBLIC\s+"-\/\/Apple\/\/DTD PLIST 1\.0\/\/EN"\s+"https?:\/\/www\.apple\.com\/DTDs\/PropertyList-1\.0\.dtd">\s*/u,
    "",
  );
  const plist = document.match(
    /^<plist\s+version="1\.0">\s*<dict>([\s\S]*?)<\/dict>\s*<\/plist>$/u,
  );
  if (plist === null) {
    fail("nested awf-node entitlements are not a closed XML plist");
  }

  const entitlements = new Map();
  let entries = plist[1];
  while (entries.trim().length > 0) {
    const entry = entries.match(
      /^\s*<key>([A-Za-z0-9.-]+)<\/key>\s*<(true|false)\s*\/>/u,
    );
    if (entry === null) {
      fail("nested awf-node entitlements contain an unsupported value");
    }
    const [, key, booleanValue] = entry;
    if (entitlements.has(key)) {
      fail("nested awf-node entitlements contain a duplicate key");
    }
    entitlements.set(key, booleanValue === "true");
    entries = entries.slice(entry[0].length);
  }
  return entitlements;
}

function verifyExactRuntimeEntitlements(source) {
  const entitlements = parseRuntimeEntitlements(source);
  if (
    entitlements.size !== 1
    || entitlements.get(requiredRuntimeEntitlement) !== true
  ) {
    fail(
      "nested awf-node entitlements must contain only "
        + `${requiredRuntimeEntitlement}=true`,
    );
  }
}

function verifyHardenedRuntimeMetadata(source) {
  const codeDirectoryLines = source
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("CodeDirectory "));
  if (codeDirectoryLines.length !== 1) {
    fail("nested awf-node hardened runtime metadata is unavailable");
  }
  const flags = codeDirectoryLines[0].match(
    /\bflags=0x([A-Fa-f0-9]+)(?:\([^)\r\n]*\))?(?:\s|$)/u,
  );
  if (flags === null) {
    fail("nested awf-node hardened runtime metadata is invalid");
  }
  const numericFlags = BigInt(`0x${flags[1]}`);
  if ((numericFlags & hardenedRuntimeFlag) !== hardenedRuntimeFlag) {
    fail("nested awf-node must enable the hardened runtime");
  }
}

async function verifyRuntimeSigningPolicy(runtimePath, runCommand) {
  const metadata = await runCommand(
    "/usr/bin/codesign",
    ["--display", "--verbose=4", runtimePath],
  );
  if (metadata.exitCode !== 0) {
    fail("nested awf-node code-signing metadata inspection failed");
  }
  verifyHardenedRuntimeMetadata(
    `${metadata.stdout}\n${metadata.stderr}`,
  );

  const entitlements = await runCommand(
    "/usr/bin/codesign",
    [
      "--display",
      "--entitlements",
      "-",
      "--xml",
      runtimePath,
    ],
  );
  if (entitlements.exitCode !== 0) {
    fail("nested awf-node entitlement inspection failed");
  }
  verifyExactRuntimeEntitlements(entitlements.stdout);
}

async function verifyRuntimeVersion(
  runtimePath,
  expectedVersion,
  runCommand,
) {
  const result = await runCommand(runtimePath, ["--version"]);
  if (
    result.exitCode !== 0
    || result.stdout !== `${expectedVersion}\n`
    || result.stderr !== ""
  ) {
    fail(`nested awf-node must report exact version ${expectedVersion}`);
  }
}

async function verifyRuntimeReadiness(runtimePath, runCommand) {
  const result = await runCommand(
    runtimePath,
    ["-e", runtimeReadinessScript],
  );
  if (
    result.exitCode !== 0
    || result.stdout !== runtimeReadinessOutput
    || result.stderr !== ""
  ) {
    fail("nested awf-node failed the V8/JIT readiness probe");
  }
}

async function assertWritableTarget(target, label) {
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail(`${label} must be absent or a regular file, not a symlink`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function atomicWrite(target, content, mode) {
  const parent = path.dirname(target);
  const temporary = path.join(
    parent,
    `.${path.basename(target)}.tmp-${process.pid}-${
      randomBytes(8).toString("hex")
    }`,
  );
  let handle;
  try {
    handle = await fs.open(
      temporary,
      constants.O_WRONLY
        | constants.O_CREAT
        | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0),
      mode,
    );
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, target);
    const directory = await fs.open(parent, constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    if (handle !== undefined) {
      await handle.close().catch(() => {});
    }
    await fs.unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function prepareDestinationDirectories(appPath) {
  const contents = path.join(appPath, "Contents");
  const resources = path.join(contents, "Resources");
  const digestDirectory = path.join(resources, "RuntimePayload");
  const notices = path.join(resources, "ThirdPartyNotices");
  const nodeNotices = path.join(notices, "Node");

  await assertDirectory(contents, "AWF.app Contents");
  await assertDirectory(resources, "AWF.app Resources");
  await ensureClosedDirectory(
    digestDirectory,
    resources,
    "RuntimePayload directory",
  );
  await ensureClosedDirectory(
    notices,
    resources,
    "ThirdPartyNotices directory",
  );
  await ensureClosedDirectory(
    nodeNotices,
    notices,
    "Node notices directory",
  );
}

/**
 * Seal the signed nested runtime into an otherwise unsigned AWF.app.
 *
 * The injectable command runner exists only for deterministic unit tests.
 * The CLI has no option that bypasses codesign, closed entitlement, exact
 * runtime version, or fixed V8/JIT readiness verification.
 */
export async function finalizeMacOSRuntime({
  appPath,
  payloadDirectory,
  architecture,
  manifest,
  runCommand = executeCommand,
}) {
  if (!supportedArchitectures.includes(architecture)) {
    fail('architecture must be "arm64" or "x64"');
  }
  const validatedManifest = validateRuntimeManifest(
    manifest ?? await loadRuntimeManifest(),
  );
  await assertCanonicalAbsolutePath(appPath, "appPath");
  if (path.extname(appPath) !== ".app") {
    fail("appPath must identify a .app bundle");
  }
  await assertDirectory(appPath, "appPath");
  await assertCanonicalAbsolutePath(payloadDirectory, "payloadDirectory");
  if (
    isDescendant(appPath, payloadDirectory)
    || isDescendant(payloadDirectory, appPath)
    || appPath === payloadDirectory
  ) {
    fail("appPath and payloadDirectory must be separate trees");
  }

  const runtimePath = path.join(appPath, runtimeRelativePath);
  const digestPath = path.join(appPath, digestRelativePath);
  const licensePath = path.join(appPath, licenseRelativePath);
  const helpersPath = path.dirname(runtimePath);
  await assertDirectory(helpersPath, "AWF.app Helpers");

  const license = await verifyPreparedPayload(
    payloadDirectory,
    validatedManifest,
    architecture,
  );
  const runtime = await readStableRegularFile(runtimePath, {
    label: "nested awf-node",
    maximumBytes: maximumRuntimeBytes,
    requireExecutable: true,
  });
  verifyThinMachO(runtime.content, architecture, "nested awf-node");

  await verifySigningStage(appPath, runtimePath, runCommand);
  await assertUnchanged(runtimePath, runtime.identity, "nested awf-node");
  await verifyRuntimeSigningPolicy(runtimePath, runCommand);
  await assertUnchanged(runtimePath, runtime.identity, "nested awf-node");
  await verifyRuntimeVersion(
    runtimePath,
    validatedManifest.version,
    runCommand,
  );
  await assertUnchanged(runtimePath, runtime.identity, "nested awf-node");
  await verifyRuntimeReadiness(runtimePath, runCommand);
  await assertUnchanged(runtimePath, runtime.identity, "nested awf-node");
  await verifySigningStage(appPath, runtimePath, runCommand);
  await assertUnchanged(runtimePath, runtime.identity, "nested awf-node");

  await prepareDestinationDirectories(appPath);
  await assertWritableTarget(digestPath, "runtime digest");
  await assertWritableTarget(licensePath, "Node LICENSE notice");
  const digest = sha256(runtime.content);
  await atomicWrite(licensePath, license, 0o644);
  await atomicWrite(digestPath, Buffer.from(`${digest}\n`, "ascii"), 0o644);
  return {
    architecture,
    runtimeVersion: validatedManifest.version,
    runtimeSHA256: digest,
    digestRelativePath: digestRelativePath.split(path.sep).join("/"),
    licenseRelativePath: licenseRelativePath.split(path.sep).join("/"),
  };
}

function usage() {
  return [
    "Finalize AWF's signed, architecture-specific macOS runtime.",
    "",
    "Usage:",
    "  node scripts/finalize-macos-runtime.mjs \\",
    "    --app </absolute/path/AWF.app> \\",
    "    --payload </absolute/path/prepared-payload> \\",
    "    --arch <arm64|x64>",
    "",
    "Run after signing Contents/Helpers/awf-node and before signing AWF.app.",
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
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--app") {
      options.appPath = takeValue(argumentsList, index, argument);
      index += 1;
    } else if (argument === "--payload") {
      options.payloadDirectory = takeValue(
        argumentsList,
        index,
        argument,
      );
      index += 1;
    } else if (argument === "--arch") {
      options.architecture = takeValue(argumentsList, index, argument);
      index += 1;
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
  const result = await finalizeMacOSRuntime(options);
  process.stdout.write(
    `Finalized Node.js ${result.runtimeVersion} `
      + `${result.architecture}; sealed ${result.runtimeSHA256}\n`,
  );
}

const invokedPath = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`finalize-macos-runtime: ${error.message}\n`);
    process.exitCode = 1;
  });
}

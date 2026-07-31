import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  finalizeMacOSRuntime,
  parseArguments,
} from "../scripts/finalize-macos-runtime.mjs";
import {
  loadRuntimeManifest,
} from "../scripts/prepare-macos-runtime.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function thinMachO(architecture, suffix = "") {
  const binary = Buffer.alloc(96 + Buffer.byteLength(suffix));
  binary.writeUInt32LE(0xfeedfacf, 0);
  binary.writeUInt32LE(
    architecture === "arm64" ? 0x0100000c : 0x01000007,
    4,
  );
  binary.write("AWF fixture Node.js runtime", 8, "utf8");
  binary.write(suffix, 96, "utf8");
  return binary;
}

function entitlementsXML(entries) {
  const body = entries
    .map(([key, value]) => (
      `<key>${key}</key><${value ? "true" : "false"}/>`
    ))
    .join("");
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
    + '"https://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    + `<plist version="1.0"><dict>${body}</dict></plist>`;
}

const exactRuntimeEntitlements = entitlementsXML([
  ["com.apple.security.cs.allow-jit", true],
]);

test("checked-in runtime entitlements match the finalizer allowlist", () => {
  const source = fs.readFileSync(
    new URL("../runtime/node-runtime.entitlements", import.meta.url),
    "utf8",
  );
  const compact = source.replace(/>\s+</gu, "><").trim();
  assert.equal(
    compact,
    '<?xml version="1.0" encoding="UTF-8"?>'
      + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
      + '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
      + '<plist version="1.0"><dict>'
      + '<key>com.apple.security.cs.allow-jit</key><true/>'
      + "</dict></plist>",
  );
});

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

async function fixture(context, architecture = "arm64") {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(
    path.join(temporaryRoot, "awf-runtime-finalize-"),
  );
  context.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const appPath = path.join(directory, "AWF.app");
  const helpers = path.join(appPath, "Contents", "Helpers");
  const resources = path.join(appPath, "Contents", "Resources");
  const payloadDirectory = path.join(directory, "prepared");
  fs.mkdirSync(helpers, { recursive: true });
  fs.mkdirSync(resources, { recursive: true });
  fs.mkdirSync(payloadDirectory);

  const baseManifest = await loadRuntimeManifest();
  const manifest = clone(baseManifest);
  const preparedRuntime = thinMachO(architecture, "prepared");
  const signedRuntime = thinMachO(architecture, "signed-code-directory");
  const license = Buffer.from(
    "Complete synthetic Node.js license and third-party notices.\n",
  );
  manifest.artifacts[architecture].nodeSha256 = sha256(preparedRuntime);
  manifest.license.sha256 = sha256(license);

  fs.writeFileSync(
    path.join(payloadDirectory, "awf-node"),
    preparedRuntime,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(payloadDirectory, "LICENSE"), license);
  fs.writeFileSync(
    path.join(payloadDirectory, "payload.json"),
    `${JSON.stringify(
      expectedPayloadMetadata(manifest, architecture),
      null,
      2,
    )}\n`,
  );
  const runtimePath = path.join(helpers, "awf-node");
  fs.writeFileSync(runtimePath, signedRuntime, { mode: 0o755 });

  return {
    appPath,
    architecture,
    license,
    manifest,
    payloadDirectory,
    runtimePath,
    signedRuntime,
  };
}

function successfulRunner(expected) {
  const calls = [];
  const runner = async (executable, argumentsList) => {
    calls.push([executable, [...argumentsList]]);
    if (executable === "/usr/bin/codesign") {
      if (
        argumentsList[0] === "--verify"
        && argumentsList.at(-1) === expected.appPath
      ) {
        return { exitCode: 1, stdout: "", stderr: "not signed" };
      }
      if (argumentsList[0] === "--verify") {
        assert.equal(argumentsList.at(-1), expected.runtimePath);
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (argumentsList[1] === "--verbose=4") {
        assert.deepEqual(
          argumentsList,
          ["--display", "--verbose=4", expected.runtimePath],
        );
        return {
          exitCode: 0,
          stdout: "",
          stderr:
            "CodeDirectory v=20500 size=128 "
            + "flags=0x10002(adhoc,runtime) hashes=1+0 "
            + "location=embedded\n",
        };
      }
      assert.deepEqual(
        argumentsList,
        [
          "--display",
          "--entitlements",
          "-",
          "--xml",
          expected.runtimePath,
        ],
      );
      return {
        exitCode: 0,
        stdout: exactRuntimeEntitlements,
        stderr: `Executable=${expected.runtimePath}\n`,
      };
    }
    assert.equal(executable, expected.runtimePath);
    if (argumentsList[0] === "--version") {
      assert.deepEqual(argumentsList, ["--version"]);
      return {
        exitCode: 0,
        stdout: `${expected.manifest.version}\n`,
        stderr: "",
      };
    }
    assert.equal(argumentsList[0], "-e");
    assert.equal(argumentsList.length, 2);
    assert.match(argumentsList[1], /WebAssembly\.Module/u);
    return { exitCode: 0, stdout: "AWF_V8_JIT_READY\n", stderr: "" };
  };
  return { calls, runner };
}

function assertSealOutputsAbsent(value) {
  assert.equal(
    fs.existsSync(
      path.join(
        value.appPath,
        "Contents/Resources/RuntimePayload",
      ),
    ),
    false,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        value.appPath,
        "Contents/Resources/ThirdPartyNotices",
      ),
    ),
    false,
  );
}

test(
  "seals the post-sign digest and full verified Node license",
  async (context) => {
    const value = await fixture(context);
    const command = successfulRunner(value);
    const result = await finalizeMacOSRuntime({
      appPath: value.appPath,
      payloadDirectory: value.payloadDirectory,
      architecture: value.architecture,
      manifest: value.manifest,
      runCommand: command.runner,
    });

    const digest = sha256(value.signedRuntime);
    assert.equal(result.runtimeVersion, value.manifest.version);
    assert.equal(result.runtimeSHA256, digest);
    assert.equal(
      fs.readFileSync(
        path.join(
          value.appPath,
          "Contents/Resources/RuntimePayload/awf-node.sha256",
        ),
        "ascii",
      ),
      `${digest}\n`,
    );
    assert.deepEqual(
      fs.readFileSync(
        path.join(
          value.appPath,
          "Contents/Resources/ThirdPartyNotices/Node/LICENSE",
        ),
      ),
      value.license,
    );
    assert.equal(
      fs.statSync(
        path.join(
          value.appPath,
          "Contents/Resources/RuntimePayload/awf-node.sha256",
        ),
      ).mode & 0o777,
      0o644,
    );
    assert.deepEqual(
      command.calls.map(([executable, argumentsList]) => [
        path.basename(executable),
        argumentsList[0],
      ]),
      [
        ["codesign", "--verify"],
        ["codesign", "--verify"],
        ["codesign", "--display"],
        ["codesign", "--display"],
        ["awf-node", "--version"],
        ["awf-node", "-e"],
        ["codesign", "--verify"],
        ["codesign", "--verify"],
      ],
      "signing policy and V8/JIT are checked before the final seal",
    );
  },
);

test(
  "rejects a signed runtime without the required JIT entitlement",
  async (context) => {
    const value = await fixture(context);
    const command = successfulRunner(value);
    let runtimeExecuted = false;
    const runner = async (executable, argumentsList) => {
      if (
        executable === "/usr/bin/codesign"
        && argumentsList[1] === "--entitlements"
      ) {
        return {
          exitCode: 0,
          stdout: entitlementsXML([]),
          stderr: "",
        };
      }
      if (executable === value.runtimePath) {
        runtimeExecuted = true;
      }
      return command.runner(executable, argumentsList);
    };

    await assert.rejects(
      finalizeMacOSRuntime({
        ...value,
        runCommand: runner,
      }),
      /entitlements must contain only .*allow-jit=true/u,
    );
    assert.equal(runtimeExecuted, false);
    assertSealOutputsAbsent(value);
  },
);

test(
  "rejects additional upstream entitlements before runtime execution",
  async (context) => {
    const value = await fixture(context);
    const command = successfulRunner(value);
    let runtimeExecuted = false;
    const runner = async (executable, argumentsList) => {
      if (
        executable === "/usr/bin/codesign"
        && argumentsList[1] === "--entitlements"
      ) {
        return {
          exitCode: 0,
          stdout: entitlementsXML([
            ["com.apple.security.cs.allow-jit", true],
            ["com.apple.security.get-task-allow", true],
          ]),
          stderr: "",
        };
      }
      if (executable === value.runtimePath) {
        runtimeExecuted = true;
      }
      return command.runner(executable, argumentsList);
    };

    await assert.rejects(
      finalizeMacOSRuntime({
        ...value,
        runCommand: runner,
      }),
      /entitlements must contain only .*allow-jit=true/u,
    );
    assert.equal(runtimeExecuted, false);
    assertSealOutputsAbsent(value);
  },
);

test(
  "rejects a signature without the hardened runtime flag",
  async (context) => {
    const value = await fixture(context);
    const command = successfulRunner(value);
    let runtimeExecuted = false;
    const runner = async (executable, argumentsList) => {
      if (
        executable === "/usr/bin/codesign"
        && argumentsList[1] === "--verbose=4"
      ) {
        return {
          exitCode: 0,
          stdout: "",
          stderr:
            "CodeDirectory v=20500 size=128 "
            + "flags=0x2(adhoc) hashes=1+0 location=embedded\n",
        };
      }
      if (executable === value.runtimePath) {
        runtimeExecuted = true;
      }
      return command.runner(executable, argumentsList);
    };

    await assert.rejects(
      finalizeMacOSRuntime({
        ...value,
        runCommand: runner,
      }),
      /must enable the hardened runtime/u,
    );
    assert.equal(runtimeExecuted, false);
    assertSealOutputsAbsent(value);
  },
);

test(
  "rejects a version-correct runtime when V8/JIT cannot initialize",
  async (context) => {
    const value = await fixture(context);
    const command = successfulRunner(value);
    const runner = async (executable, argumentsList) => {
      if (
        executable === value.runtimePath
        && argumentsList[0] === "-e"
      ) {
        return {
          exitCode: 133,
          stdout: "",
          stderr: "synthetic fatal V8 initialization failure",
        };
      }
      return command.runner(executable, argumentsList);
    };

    await assert.rejects(
      finalizeMacOSRuntime({
        ...value,
        runCommand: runner,
      }),
      /failed the V8\/JIT readiness probe/u,
    );
    assertSealOutputsAbsent(value);
  },
);

test(
  "rejects a symlinked nested runtime without writing outputs",
  async (context) => {
    const value = await fixture(context);
    fs.unlinkSync(value.runtimePath);
    fs.symlinkSync(
      path.join(value.payloadDirectory, "awf-node"),
      value.runtimePath,
    );
    await assert.rejects(
      finalizeMacOSRuntime({
        appPath: value.appPath,
        payloadDirectory: value.payloadDirectory,
        architecture: value.architecture,
        manifest: value.manifest,
        runCommand: async () => {
          assert.fail("unsafe runtime must fail before command execution");
        },
      }),
      /nested awf-node must be a regular file, not a symlink/u,
    );
    assert.equal(
      fs.existsSync(
        path.join(
          value.appPath,
          "Contents/Resources/RuntimePayload",
        ),
      ),
      false,
    );
  },
);

test(
  "rejects the wrong thin architecture before code execution",
  async (context) => {
    const value = await fixture(context);
    fs.writeFileSync(
      value.runtimePath,
      thinMachO("x64", "signed"),
      { mode: 0o755 },
    );
    await assert.rejects(
      finalizeMacOSRuntime({
        ...value,
        runCommand: async () => {
          assert.fail("wrong architecture must fail before commands");
        },
      }),
      /nested awf-node does not match arm64/u,
    );
  },
);

test(
  "rejects an unsigned nested runtime and preserves existing outputs",
  async (context) => {
    const value = await fixture(context);
    const digestDirectory = path.join(
      value.appPath,
      "Contents/Resources/RuntimePayload",
    );
    fs.mkdirSync(digestDirectory);
    const digestPath = path.join(digestDirectory, "awf-node.sha256");
    fs.writeFileSync(digestPath, `${"a".repeat(64)}\n`);
    const runner = async (executable, argumentsList) => {
      if (argumentsList.at(-1) === value.appPath) {
        return { exitCode: 1, stdout: "", stderr: "not signed" };
      }
      assert.equal(executable, "/usr/bin/codesign");
      return { exitCode: 1, stdout: "", stderr: "invalid signature" };
    };
    await assert.rejects(
      finalizeMacOSRuntime({
        ...value,
        runCommand: runner,
      }),
      /nested awf-node code signature verification failed/u,
    );
    assert.equal(
      fs.readFileSync(digestPath, "utf8"),
      `${"a".repeat(64)}\n`,
    );
  },
);

test(
  "rejects an already-signed outer app before modifying its seal",
  async (context) => {
    const value = await fixture(context);
    await assert.rejects(
      finalizeMacOSRuntime({
        ...value,
        runCommand: async (executable, argumentsList) => {
          assert.equal(executable, "/usr/bin/codesign");
          assert.equal(argumentsList[0], "--verify");
          assert.equal(argumentsList.at(-1), value.appPath);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
      /outer app is already signed/u,
    );
  },
);

test(
  "rejects a runtime version mismatch without creating notices",
  async (context) => {
    const value = await fixture(context);
    const command = successfulRunner(value);
    const runner = async (executable, argumentsList) => {
      if (executable === value.runtimePath) {
        return { exitCode: 0, stdout: "v0.0.0\n", stderr: "" };
      }
      return command.runner(executable, argumentsList);
    };
    await assert.rejects(
      finalizeMacOSRuntime({
        ...value,
        runCommand: runner,
      }),
      new RegExp(`exact version ${value.manifest.version}`, "u"),
    );
    assert.equal(
      fs.existsSync(
        path.join(
          value.appPath,
          "Contents/Resources/ThirdPartyNotices",
        ),
      ),
      false,
    );
  },
);

test(
  "rejects noncanonical payload metadata and additional files",
  async (context) => {
    const value = await fixture(context);
    fs.writeFileSync(path.join(value.payloadDirectory, "raw-transcript"), "x");
    await assert.rejects(
      finalizeMacOSRuntime({
        ...value,
        runCommand: async () => {
          assert.fail("open payload must fail before commands");
        },
      }),
      /prepared payload must contain only/u,
    );
    fs.unlinkSync(path.join(value.payloadDirectory, "raw-transcript"));
    const metadataPath = path.join(value.payloadDirectory, "payload.json");
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    metadata.rawPrompt = "forbidden";
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    await assert.rejects(
      finalizeMacOSRuntime({
        ...value,
        runCommand: async () => {
          assert.fail("noncanonical metadata must fail before commands");
        },
      }),
      /exact canonical manifest view/u,
    );
  },
);

test("CLI inputs are closed and provide no codesign bypass", () => {
  assert.deepEqual(
    parseArguments([
      "--app",
      "/tmp/AWF.app",
      "--payload",
      "/tmp/payload",
      "--arch",
      "arm64",
    ]),
    {
      appPath: "/tmp/AWF.app",
      payloadDirectory: "/tmp/payload",
      architecture: "arm64",
    },
  );
  assert.throws(
    () => parseArguments(["--skip-codesign"]),
    /unknown argument: --skip-codesign/u,
  );
});

test(
  "rejects a stale outer resource seal before command execution",
  async (context) => {
    const value = await fixture(context);
    fs.mkdirSync(
      path.join(value.appPath, "Contents", "_CodeSignature"),
    );
    await assert.rejects(
      finalizeMacOSRuntime({
        ...value,
        runCommand: async () => {
          assert.fail("stale outer seal must fail before commands");
        },
      }),
      /outer app is already signed or contains a stale signature seal/u,
    );
  },
);

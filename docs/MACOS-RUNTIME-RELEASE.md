# macOS runtime release sealing

AWF packages one thin, pinned Node.js runtime per macOS architecture. Do not
merge the two Node binaries with `lipo`; build and publish separate arm64 and
x64 app artifacts. Runtime preparation and app sealing are separate
dependency-free, offline-capable steps:

1. Run `npm run prepare:macos-runtime -- --arch <arm64|x64> --archive
   </absolute/path/to/node.tar.gz> --output </absolute/path/to/payload>`.
   The preparer verifies the official archive, the upstream `node` executable before AWF
   re-signing, the
   complete Node `LICENSE`, and `runtime/node-runtime-v1.json`.
2. Produce an unsigned `AWF.app`, copy `payload/awf-node` to
   `AWF.app/Contents/Helpers/awf-node`, and sign that nested executable with
   the release identity.
3. Before signing the outer app, run `npm run finalize:macos-runtime --
   --app </absolute/path/AWF.app> --payload </absolute/path/to/payload> --arch
   <arm64|x64>`.
4. Sign `awf-hook`, then `AWF.app`, then the distribution container. Never use
   `codesign --deep` to sign.

One explicit release assembly looks like this:

```bash
AWF_RELEASE_ARCH="arm64"
AWF_NODE_ARCHIVE="/absolute/path/node-v24.18.0-darwin-arm64.tar.gz"
AWF_RUNTIME_PAYLOAD="/absolute/path/awf-runtime-payload"
AWF_RELEASE_APP="/absolute/path/AWF.app"
AWF_RUNTIME_ENTITLEMENTS="/absolute/path/agent-waste-firewall/runtime/node-runtime.entitlements"
AWF_SIGNING_IDENTITY="Developer ID Application: Example (TEAMID)"

npm run prepare:macos-runtime -- \
  --arch "$AWF_RELEASE_ARCH" \
  --archive "$AWF_NODE_ARCHIVE" \
  --output "$AWF_RUNTIME_PAYLOAD"

/usr/bin/install -m 0755 \
  "$AWF_RUNTIME_PAYLOAD/awf-node" \
  "$AWF_RELEASE_APP/Contents/Helpers/awf-node"

/usr/bin/codesign --force --options runtime --timestamp \
  --entitlements "$AWF_RUNTIME_ENTITLEMENTS" \
  --sign "$AWF_SIGNING_IDENTITY" \
  "$AWF_RELEASE_APP/Contents/Helpers/awf-node"

npm run finalize:macos-runtime -- \
  --app "$AWF_RELEASE_APP" \
  --payload "$AWF_RUNTIME_PAYLOAD" \
  --arch "$AWF_RELEASE_ARCH"

/usr/bin/codesign --force --options runtime --timestamp \
  --sign "$AWF_SIGNING_IDENTITY" \
  "$AWF_RELEASE_APP/Contents/Helpers/awf-hook"

/usr/bin/codesign --force --options runtime --timestamp \
  --sign "$AWF_SIGNING_IDENTITY" \
  "$AWF_RELEASE_APP"

/usr/bin/codesign --verify --strict --verbose=2 \
  "$AWF_RELEASE_APP/Contents/Helpers/awf-node"
/usr/bin/codesign --verify --strict --verbose=2 \
  "$AWF_RELEASE_APP/Contents/Helpers/awf-hook"
/usr/bin/codesign --verify --strict --verbose=2 "$AWF_RELEASE_APP"
```

The app passed to the finalizer must still be unsigned. Build or export that
intermediate without automatic outer signing, then sign nested code and the
outer bundle in the order above. Ad-hoc signing is suitable only for local
pipeline tests; it is not a release identity and does not satisfy distribution
or notarization.

The finalizer accepts only an absolute canonical `.app`, an absolute canonical
prepared-payload directory, and `arm64` or `x64`. It has no signature-bypass
flag. It refuses symlinked inputs, universal or wrong-architecture runtimes,
noncanonical payload metadata, an unsigned nested runtime, a nested runtime
without the hardened-runtime flag, any entitlement set other than exactly
`com.apple.security.cs.allow-jit=true`, a runtime that does not report the
exact pinned Node version, a runtime that cannot compile and execute a fixed
in-memory WebAssembly readiness probe, and an already-signed outer app. These
checks all finish before the finalizer writes the runtime digest or Node
license notice.

Always supply the checked-in `runtime/node-runtime.entitlements` explicitly
when replacing Node's upstream signature. Do not preserve the upstream
entitlement metadata: it contains broader development and runtime exceptions
that AWF does not need. The finalizer extracts the entitlements from the
replacement signature and enforces the one-key allowlist before sealing.

After all checks, the finalizer copies the byte-for-byte verified complete Node
license to:

```text
AWF.app/Contents/Resources/ThirdPartyNotices/Node/LICENSE
```

It computes the SHA-256 of the signed runtime and atomically writes exactly 64
lowercase hexadecimal characters plus one newline to:

```text
AWF.app/Contents/Resources/RuntimePayload/awf-node.sha256
```

The Swift installer treats that post-sign digest as the bundled-runtime trust
boundary. Signing the outer app after sealing covers both the digest and the
license as app resources.

Before publishing, run the complete Node and Swift test suites, execute the
real native hook benchmark against the assembled helper/runtime, launch on a
clean supported Mac, exercise install → upgrade → rollback → repair →
uninstall, verify both provider delivery paths with user-owned trust, sign the
distribution container, submit it for notarization, and validate the stapled
artifact without network access. Do not claim a public beta from the
source-preview build.

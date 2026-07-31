import Darwin
import Foundation
import XCTest
@testable import AWF

final class NativeIntegrationManagerTests: XCTestCase {
    private var temporaryDirectory: URL!
    private var productRoot: URL!

    override func setUpWithError() throws {
        temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "awf native integration \(UUID().uuidString)",
                isDirectory: true
            )
        try FileManager.default.createDirectory(
            at: temporaryDirectory,
            withIntermediateDirectories: true
        )
        try setMode(0o700, at: temporaryDirectory)
        productRoot = temporaryDirectory.appendingPathComponent(
            "application support",
            isDirectory: true
        )
    }

    override func tearDownWithError() throws {
        if let temporaryDirectory {
            try? FileManager.default.removeItem(at: temporaryDirectory)
        }
    }

    func testClosedLedgerAcceptsOnlyItsCanonicalBoundedSchema() throws {
        let release = NativeIntegrationLedger.Release(
            releaseId: "rel_0123456789abcdef0123456789abcdef",
            runtimeSHA256: String(repeating: "a", count: 64),
            workerProtocol: 1
        )
        let helperSHA256 = String(repeating: "b", count: 64)
        let ledger = try NativeIntegrationLedger(
            helperSHA256: helperSHA256,
            releases: [release]
        )

        XCTAssertEqual(
            try NativeIntegrationLedger.parse(ledger.canonicalData),
            ledger
        )
        for counterexample in [
            ledger.canonicalSource.replacingOccurrences(
                of: #"{"v":1"#,
                with: #"{"v":1,"note":"raw must not persist""#
            ),
            ledger.canonicalSource
                .trimmingCharacters(in: .whitespacesAndNewlines),
            ledger.canonicalSource.replacingOccurrences(
                of: String(repeating: "a", count: 64),
                with: String(repeating: "A", count: 64)
            ),
            #"{"v":2,"releases":[]}"# + "\n",
        ] {
            XCTAssertThrowsError(
                try NativeIntegrationLedger.parse(Data(counterexample.utf8))
            )
        }
        let boundedReleases = (0...NativeIntegrationLedger.maximumReleaseCount)
            .map { index in
                NativeIntegrationLedger.Release(
                    releaseId: "rel_" +
                        String(repeating: "0", count: 31) +
                        String(index),
                    runtimeSHA256: String(repeating: "a", count: 64),
                    workerProtocol: 1
                )
            }
        let maximumLedger = try NativeIntegrationLedger(
            helperSHA256: helperSHA256,
            releases: Array(
                boundedReleases.prefix(
                    NativeIntegrationLedger.maximumReleaseCount
                )
            )
        )
        XCTAssertEqual(
            try NativeIntegrationLedger.parse(maximumLedger.canonicalData),
            maximumLedger
        )
        XCTAssertThrowsError(
            try NativeIntegrationLedger(
                helperSHA256: helperSHA256,
                releases: boundedReleases
            )
        )
    }

    func testFreshInstallPublishesExactPrivateLayoutAndActivation()
        throws
    {
        let payload = try makePayload(label: "fresh")
        let manager = makeManager(payload: payload)

        XCTAssertEqual(try manager.install(), .installed)
        let snapshot = manager.inspect()

        XCTAssertEqual(snapshot.condition, .healthy)
        let releaseID = try XCTUnwrap(snapshot.activeReleaseID)
        XCTAssertTrue(NativeIntegrationLedger.validReleaseID(releaseID))
        XCTAssertEqual(
            try mode(at: productRoot),
            0o700
        )
        XCTAssertEqual(
            try mode(at: integrationRoot),
            0o700
        )
        XCTAssertEqual(
            try mode(at: helperURL),
            0o700
        )
        XCTAssertEqual(
            try mode(at: activationURL),
            0o600
        )
        XCTAssertEqual(
            try mode(at: ledgerURL),
            0o600
        )
        XCTAssertEqual(
            try mode(at: runtimeURL(releaseID)),
            0o700
        )
        XCTAssertEqual(
            try Data(contentsOf: helperURL),
            try Data(contentsOf: payload.helperURL)
        )
        XCTAssertEqual(
            try Data(contentsOf: runtimeURL(releaseID)),
            try Data(contentsOf: payload.runtimeURL)
        )
        XCTAssertEqual(
            try String(contentsOf: activationURL, encoding: .utf8),
            NativeHookActivation.canonicalSource(releaseID: releaseID)
        )
    }

    func testInstalledNativeHelperStreamsProviderInput() throws {
        let runtimePayload = try makePayload(label: "native")
        let realHelper = try bundledHelper()
        let payload = NativeIntegrationPayload(
            helperURL: realHelper,
            runtimeURL: runtimePayload.runtimeURL
        )
        let manager = makeManager(payload: payload)
        XCTAssertEqual(try manager.install(), .installed)

        let pluginRoot = temporaryDirectory.appendingPathComponent(
            "plugin root 한글",
            isDirectory: true
        )
        let scripts = pluginRoot.appendingPathComponent(
            "scripts",
            isDirectory: true
        )
        let protocolDirectory = pluginRoot.appendingPathComponent(
            "protocol",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: scripts,
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: protocolDirectory,
            withIntermediateDirectories: true
        )
        try setMode(0o700, at: pluginRoot)
        try setMode(0o700, at: scripts)
        try setMode(0o700, at: protocolDirectory)
        let worker = scripts.appendingPathComponent("hook.mjs")
        try Data("export {};\n".utf8).write(to: worker)
        try setMode(0o600, at: worker)
        let handshake = protocolDirectory.appendingPathComponent(
            NativeHookWorkerHandshake.filename
        )
        try Data(NativeHookWorkerHandshake.canonicalSource.utf8)
            .write(to: handshake)
        try setMode(0o600, at: handshake)

        let input = #"{"secret":"STREAM-ONLY-CANARY"}"# + "\n"
        let result = try run(
            executable: helperURL,
            arguments: [
                "hook",
                "--protocol",
                "1",
                "--provider",
                "codex",
                "--plugin-root",
                pluginRoot.path,
            ],
            input: input
        )

        XCTAssertEqual(result.status, 0)
        XCTAssertEqual(result.stdout, input)
        XCTAssertEqual(result.stderr, "")
        XCTAssertFalse(
            try persistedDataContains(
                Data("STREAM-ONLY-CANARY".utf8),
                in: productRoot
            )
        )
    }

    func testMissingPayloadDoesNotCreateTheProductRoot() {
        let manager = makeManager(payload: nil)

        XCTAssertThrowsError(try manager.install()) { error in
            XCTAssertEqual(
                error as? NativeIntegrationFailure,
                .payloadUnavailable
            )
        }
        XCTAssertFalse(
            FileManager.default.fileExists(atPath: productRoot.path)
        )
    }

    func testPinnedRuntimeMismatchFailsBeforeDestinationMutation()
        throws
    {
        let fixture = try makePayload(label: "wrong-pinned-hash")
        let payload = NativeIntegrationPayload(
            helperURL: fixture.helperURL,
            runtimeURL: fixture.runtimeURL,
            expectedRuntimeSHA256: String(repeating: "0", count: 64)
        )
        let manager = makeManager(payload: payload)

        XCTAssertThrowsError(try manager.install()) {
            XCTAssertEqual(
                $0 as? NativeIntegrationFailure,
                .payloadInvalid
            )
        }
        XCTAssertFalse(
            FileManager.default.fileExists(atPath: productRoot.path)
        )
    }

    func testVersionOnlyRuntimeNeverBecomesActive() throws {
        let fixture = try makePayload(label: "version-only")
        try Data(
            """
            #!/bin/sh
            if [ "${1-}" = "--version" ]; then
              printf '%s\\n' 'v22.0.0'
              exit 0
            fi
            exit 1

            """.utf8
        ).write(to: fixture.runtimeURL)
        try setMode(0o700, at: fixture.runtimeURL)
        let manager = makeManager(payload: fixture)

        XCTAssertThrowsError(try manager.install()) {
            XCTAssertEqual(
                $0 as? NativeIntegrationFailure,
                .runtimeIncompatible
            )
        }
        XCTAssertFalse(
            FileManager.default.fileExists(atPath: activationURL.path)
        )
        XCTAssertFalse(
            FileManager.default.fileExists(atPath: ledgerURL.path)
        )
        XCTAssertEqual(manager.inspect().condition, .notInstalled)
    }

    func testColdPinnedRuntimeCanExceedTheDashboardProbeBudget() throws {
        let fixture = try makePayload(label: "slow-cold-start")
        let marker = temporaryDirectory.appendingPathComponent(
            "runtime-warmed"
        )
        try Data(
            """
            #!/bin/sh
            if [ "${1-}" = "--version" ]; then
              if [ ! -f '\(marker.path)' ]; then
                /bin/sleep 2.2
                /usr/bin/touch '\(marker.path)'
              fi
              printf '%s\\n' 'v22.0.0'
              exit 0
            fi
            if [ "${1-}" = "--no-addons" ] &&
              [ "${2-}" = "--disable-proto=throw" ] &&
              [ "${3-}" = "-e" ]
            then
              printf '%s\\n' '\(RuntimeLocator.nodeRuntimeReadinessMarker)'
              exit 0
            fi
            exit 1

            """.utf8
        ).write(to: fixture.runtimeURL)
        try setMode(0o700, at: fixture.runtimeURL)
        let manager = makeManager(payload: fixture)

        XCTAssertEqual(try manager.install(), .installed)
        XCTAssertEqual(manager.inspect().condition, .healthy)
    }

    func testHelperDriftIsRepairableInsteadOfHealthy() throws {
        let payload = try makePayload(label: "helper-drift")
        let manager = makeManager(payload: payload)
        XCTAssertEqual(try manager.install(), .installed)

        try Data("#!/bin/sh\nexit 0\n".utf8).write(to: helperURL)
        try setMode(0o700, at: helperURL)

        let snapshot = manager.inspect()
        XCTAssertEqual(snapshot.condition, .needsRepair)
        XCTAssertEqual(snapshot.reason, .helperInvalid)
    }

    func testFreshFailureAfterActivationRestoresPortableFallback()
        throws
    {
        let payload = try makePayload(label: "fresh-failure")
        let manager = makeManager(
            payload: payload,
            checkpointHandler: { checkpoint in
                if checkpoint == .afterActivationPublish {
                    throw NativeIntegrationFailure.injectedFailure
                }
            }
        )

        XCTAssertThrowsError(try manager.install()) { error in
            XCTAssertEqual(
                error as? NativeIntegrationFailure,
                .injectedFailure
            )
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: helperURL.path))
        XCTAssertFalse(
            FileManager.default.fileExists(atPath: activationURL.path)
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: ledgerURL.path))
        XCTAssertEqual(
            try FileManager.default.contentsOfDirectory(
                atPath: versionsURL.path
            ),
            []
        )
    }

    func testUpgradeFailureAfterHelperSwapKeepsOldActivationAndHelper()
        throws
    {
        let firstPayload = try makePayload(label: "first")
        let firstManager = makeManager(payload: firstPayload)
        XCTAssertEqual(try firstManager.install(), .installed)
        let originalActivation = try Data(contentsOf: activationURL)
        let originalHelper = try Data(contentsOf: helperURL)

        let secondPayload = try makePayload(label: "second")
        let failingManager = makeManager(
            payload: secondPayload,
            checkpointHandler: { checkpoint in
                if checkpoint == .afterHelperPublish {
                    throw NativeIntegrationFailure.injectedFailure
                }
            }
        )

        XCTAssertThrowsError(try failingManager.install())
        XCTAssertEqual(
            try Data(contentsOf: activationURL),
            originalActivation
        )
        XCTAssertEqual(try Data(contentsOf: helperURL), originalHelper)
        XCTAssertEqual(firstManager.inspect().condition, .healthy)
    }

    func testUpgradeThenRollbackAtomicallySelectsPreviousRelease()
        throws
    {
        let first = makeManager(
            payload: try makePayload(label: "rollback-first")
        )
        XCTAssertEqual(try first.install(), .installed)
        let firstRelease = try XCTUnwrap(
            first.inspect().activeReleaseID
        )

        let second = makeManager(
            payload: try makePayload(label: "rollback-second")
        )
        XCTAssertEqual(try second.install(), .upgraded)
        let secondRelease = try XCTUnwrap(
            second.inspect().activeReleaseID
        )
        XCTAssertNotEqual(secondRelease, firstRelease)
        XCTAssertTrue(second.inspect().canRollback)

        XCTAssertEqual(try second.rollback(), .rolledBack)
        XCTAssertEqual(second.inspect().activeReleaseID, firstRelease)
        XCTAssertTrue(
            FileManager.default.fileExists(
                atPath: runtimeURL(secondRelease).path
            )
        )
    }

    func testFourthUpgradePreservesRollbackCandidatesUntilActivation()
        throws
    {
        let first = makeManager(
            payload: try makePayload(label: "bounded-first")
        )
        XCTAssertEqual(try first.install(), .installed)
        let second = makeManager(
            payload: try makePayload(label: "bounded-second")
        )
        XCTAssertEqual(try second.install(), .upgraded)
        let third = makeManager(
            payload: try makePayload(label: "bounded-third")
        )
        XCTAssertEqual(try third.install(), .upgraded)

        let originalLedger = try readLedger()
        XCTAssertEqual(
            originalLedger.releases.count,
            NativeIntegrationLedger.retainedReleaseCount
        )
        let originalRuntimeURLs = originalLedger.releases.map {
            runtimeURL($0.releaseId)
        }
        XCTAssertTrue(
            originalRuntimeURLs.allSatisfy {
                FileManager.default.fileExists(atPath: $0.path)
            }
        )

        var candidatesWerePresentAtCheckpoint = false
        let fourth = makeManager(
            payload: try makePayload(label: "bounded-fourth"),
            checkpointHandler: { checkpoint in
                if checkpoint == .afterReleasePublish {
                    candidatesWerePresentAtCheckpoint =
                        originalRuntimeURLs.allSatisfy {
                            FileManager.default.fileExists(atPath: $0.path)
                        }
                    throw NativeIntegrationFailure.injectedFailure
                }
            }
        )

        XCTAssertThrowsError(try fourth.install()) {
            XCTAssertEqual(
                $0 as? NativeIntegrationFailure,
                .injectedFailure
            )
        }
        XCTAssertTrue(candidatesWerePresentAtCheckpoint)
        XCTAssertEqual(try readLedger(), originalLedger)
        XCTAssertTrue(
            originalRuntimeURLs.allSatisfy {
                FileManager.default.fileExists(atPath: $0.path)
            }
        )
        XCTAssertEqual(third.inspect().condition, .healthy)
    }

    func testMissingNonActiveRecordIsReconciledBeforeCapacity()
        throws
    {
        let first = makeManager(
            payload: try makePayload(label: "reconcile-first")
        )
        XCTAssertEqual(try first.install(), .installed)
        let second = makeManager(
            payload: try makePayload(label: "reconcile-second")
        )
        XCTAssertEqual(try second.install(), .upgraded)
        let third = makeManager(
            payload: try makePayload(label: "reconcile-third")
        )
        XCTAssertEqual(try third.install(), .upgraded)

        let ledgerBeforeInterruption = try readLedger()
        XCTAssertEqual(
            ledgerBeforeInterruption.releases.count,
            NativeIntegrationLedger.retainedReleaseCount
        )
        let staleReleaseID = ledgerBeforeInterruption.releases[0].releaseId
        XCTAssertNotEqual(
            staleReleaseID,
            third.inspect().activeReleaseID
        )
        try FileManager.default.removeItem(
            at: runtimeURL(staleReleaseID)
        )

        let fourth = makeManager(
            payload: try makePayload(label: "reconcile-fourth")
        )
        XCTAssertEqual(try fourth.install(), .upgraded)

        let reconciled = try readLedger()
        XCTAssertEqual(
            reconciled.releases.count,
            NativeIntegrationLedger.retainedReleaseCount
        )
        XCTAssertNil(reconciled.release(staleReleaseID))
        XCTAssertFalse(
            FileManager.default.fileExists(
                atPath: releaseURL(staleReleaseID).path
            )
        )
        XCTAssertEqual(fourth.inspect().condition, .healthy)
        XCTAssertTrue(
            reconciled.releases.allSatisfy {
                FileManager.default.fileExists(
                    atPath: runtimeURL($0.releaseId).path
                )
            }
        )
    }

    func testLedgerCapacityPrunesOldestOwnedReleaseBeforeUpgrade()
        throws
    {
        let first = makeManager(
            payload: try makePayload(label: "capacity-first")
        )
        XCTAssertEqual(try first.install(), .installed)
        XCTAssertEqual(
            try makeManager(
                payload: try makePayload(label: "capacity-second")
            ).install(),
            .upgraded
        )
        XCTAssertEqual(
            try makeManager(
                payload: try makePayload(label: "capacity-third")
            ).install(),
            .upgraded
        )
        let ledger = try readLedger()
        let oldestReleaseID = ledger.releases[0].releaseId
        _ = try appendOwnedCrashRelease(to: ledger)

        let recovery = makeManager(
            payload: try makePayload(label: "capacity-recovery")
        )
        XCTAssertEqual(try recovery.install(), .upgraded)

        let recovered = try readLedger()
        XCTAssertEqual(
            recovered.releases.count,
            NativeIntegrationLedger.retainedReleaseCount
        )
        XCTAssertEqual(recovery.inspect().condition, .healthy)
        XCTAssertTrue(recovery.inspect().canRollback)
        XCTAssertFalse(
            FileManager.default.fileExists(
                atPath: releaseURL(oldestReleaseID).path
            )
        )
    }

    func testCapacityPruningPreservesUnknownReleaseResidue()
        throws
    {
        let first = makeManager(
            payload: try makePayload(label: "protected-first")
        )
        XCTAssertEqual(try first.install(), .installed)
        XCTAssertEqual(
            try makeManager(
                payload: try makePayload(label: "protected-second")
            ).install(),
            .upgraded
        )
        XCTAssertEqual(
            try makeManager(
                payload: try makePayload(label: "protected-third")
            ).install(),
            .upgraded
        )
        let ledger = try readLedger()
        let oldestReleaseID = ledger.releases[0].releaseId
        let unknown = releaseURL(oldestReleaseID)
            .appendingPathComponent("unknown-user-file")
        try Data("preserve\n".utf8).write(to: unknown)
        _ = try appendOwnedCrashRelease(to: ledger)

        let recovery = makeManager(
            payload: try makePayload(label: "protected-recovery")
        )
        XCTAssertThrowsError(try recovery.install()) { error in
            XCTAssertEqual(
                error as? NativeIntegrationFailure,
                .unsafeLayout
            )
        }
        XCTAssertTrue(FileManager.default.fileExists(atPath: unknown.path))
        XCTAssertEqual(
            makeManager(payload: nil).inspect().condition,
            .healthy
        )
    }

    func testEmptyReconciliationKeepsLedgerUntilTransactionRollback()
        throws
    {
        let first = makeManager(
            payload: try makePayload(label: "ownership-first")
        )
        XCTAssertEqual(try first.install(), .installed)
        let originalLedger = try readLedger()
        let releaseID = try XCTUnwrap(
            first.inspect().activeReleaseID
        )
        try FileManager.default.removeItem(at: activationURL)
        try FileManager.default.removeItem(at: runtimeURL(releaseID))

        let replacement = makeManager(
            payload: try makePayload(label: "ownership-replacement"),
            checkpointHandler: { checkpoint in
                if checkpoint == .afterReleasePublish {
                    throw NativeIntegrationFailure.injectedFailure
                }
            }
        )
        XCTAssertThrowsError(try replacement.install()) {
            XCTAssertEqual(
                $0 as? NativeIntegrationFailure,
                .injectedFailure
            )
        }

        XCTAssertEqual(try readLedger(), originalLedger)
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: helperURL.path)
        )
    }

    func testRepairCreatesANewReleaseWithoutMutatingBrokenActivePath()
        throws
    {
        let payload = try makePayload(label: "repair")
        let manager = makeManager(payload: payload)
        XCTAssertEqual(try manager.install(), .installed)
        let brokenRelease = try XCTUnwrap(
            manager.inspect().activeReleaseID
        )
        let brokenRuntime = runtimeURL(brokenRelease)
        try FileManager.default.removeItem(at: brokenRuntime)
        let unrelated = releaseURL(brokenRelease)
            .appendingPathComponent("user-residue")
        try Data("leave me\n".utf8).write(to: unrelated)

        XCTAssertEqual(try manager.repair(), .repaired)
        let repairedRelease = try XCTUnwrap(
            manager.inspect().activeReleaseID
        )

        XCTAssertNotEqual(repairedRelease, brokenRelease)
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: unrelated.path)
        )
        XCTAssertFalse(
            FileManager.default.fileExists(atPath: brokenRuntime.path)
        )
        XCTAssertTrue(
            FileManager.default.fileExists(
                atPath: runtimeURL(repairedRelease).path
            )
        )
    }

    func testConcurrentInstallsSerializeAndConverge() async throws {
        let payload = try makePayload(label: "concurrent")
        let first = makeManager(payload: payload)
        let second = makeManager(payload: payload)

        async let firstResult = Task.detached {
            try first.install()
        }.value
        async let secondResult = Task.detached {
            try second.install()
        }.value
        let results = try await [firstResult, secondResult]

        XCTAssertTrue(results.contains(.installed))
        XCTAssertTrue(results.contains(.noChange))
        XCTAssertEqual(first.inspect().condition, .healthy)
        let ledger = try readLedger()
        XCTAssertEqual(ledger.releases.count, 1)
    }

    func testSymlinkIntegrationRootIsRejectedWithoutTouchingTarget()
        throws
    {
        let payload = try makePayload(label: "symlink")
        try FileManager.default.createDirectory(
            at: productRoot,
            withIntermediateDirectories: true
        )
        try setMode(0o700, at: productRoot)
        let outside = temporaryDirectory.appendingPathComponent(
            "outside",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: outside,
            withIntermediateDirectories: true
        )
        try setMode(0o700, at: outside)
        let canary = outside.appendingPathComponent("DO-NOT-TOUCH")
        try Data("outside canary\n".utf8).write(to: canary)
        try FileManager.default.createSymbolicLink(
            at: integrationRoot,
            withDestinationURL: outside
        )

        XCTAssertThrowsError(try makeManager(payload: payload).install()) {
            error in
            XCTAssertEqual(
                error as? NativeIntegrationFailure,
                .unsafeLayout
            )
        }
        XCTAssertEqual(
            try String(contentsOf: canary, encoding: .utf8),
            "outside canary\n"
        )
    }

    func testUninstallRemovesVisibleHelperFirstAndLeavesUnknownResidue()
        throws
    {
        let payload = try makePayload(label: "uninstall")
        let manager = makeManager(payload: payload)
        XCTAssertEqual(try manager.install(), .installed)
        let releaseID = try XCTUnwrap(manager.inspect().activeReleaseID)
        let unknown = releaseURL(releaseID)
            .appendingPathComponent("unknown-user-file")
        try Data("leave untouched\n".utf8).write(to: unknown)
        var helperWasAbsentAtCheckpoint = false
        let uninstallManager = makeManager(
            payload: payload,
            checkpointHandler: { checkpoint in
                if checkpoint == .afterHelperRemoval {
                    helperWasAbsentAtCheckpoint =
                        !FileManager.default.fileExists(
                            atPath: self.helperURL.path
                        )
                }
            }
        )

        XCTAssertEqual(
            try uninstallManager.uninstall(),
            .uninstalledWithResidue
        )
        XCTAssertTrue(helperWasAbsentAtCheckpoint)
        XCTAssertFalse(FileManager.default.fileExists(atPath: helperURL.path))
        XCTAssertFalse(
            FileManager.default.fileExists(atPath: activationURL.path)
        )
        XCTAssertTrue(FileManager.default.fileExists(atPath: unknown.path))
    }

    func testCorruptLedgerMakesUninstallConservative() throws {
        let payload = try makePayload(label: "corrupt-ledger")
        let manager = makeManager(payload: payload)
        XCTAssertEqual(try manager.install(), .installed)
        let releaseID = try XCTUnwrap(manager.inspect().activeReleaseID)
        try FileManager.default.removeItem(at: ledgerURL)
        try Data(#"{"v":1,"raw":"never copy unknown data"}"#.utf8)
            .write(to: ledgerURL)
        try setMode(0o600, at: ledgerURL)

        XCTAssertEqual(
            try manager.uninstall(),
            .uninstalledWithResidue
        )
        XCTAssertTrue(FileManager.default.fileExists(atPath: helperURL.path))
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: activationURL.path)
        )
        XCTAssertTrue(FileManager.default.fileExists(atPath: ledgerURL.path))
        XCTAssertTrue(
            FileManager.default.fileExists(
                atPath: runtimeURL(releaseID).path
            )
        )
    }

    func testUninstallPreservesTamperedOwnedPathsAsResidue() throws {
        let payload = try makePayload(label: "tampered-uninstall")
        let manager = makeManager(payload: payload)
        XCTAssertEqual(try manager.install(), .installed)
        let releaseID = try XCTUnwrap(manager.inspect().activeReleaseID)
        let runtime = runtimeURL(releaseID)

        try Data("#!/bin/sh\nexit 0\n".utf8).write(to: runtime)
        try setMode(0o700, at: runtime)

        XCTAssertEqual(
            try manager.uninstall(),
            .uninstalledWithResidue
        )
        XCTAssertTrue(FileManager.default.fileExists(atPath: runtime.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: ledgerURL.path))
    }

    func testUninstallRetryRemovesAnEmptyHalfDeletedRelease()
        throws
    {
        let payload = try makePayload(label: "half-delete")
        let manager = makeManager(payload: payload)
        XCTAssertEqual(try manager.install(), .installed)
        let releaseID = try XCTUnwrap(manager.inspect().activeReleaseID)
        try FileManager.default.removeItem(at: runtimeURL(releaseID))

        XCTAssertEqual(try manager.uninstall(), .uninstalled)
        XCTAssertEqual(manager.inspect(), .notInstalled)
        XCTAssertFalse(
            FileManager.default.fileExists(atPath: integrationRoot.path)
        )
    }

    func testUninstallHalfDeletePreservesUnknownResidue()
        throws
    {
        let payload = try makePayload(label: "half-delete-residue")
        let manager = makeManager(payload: payload)
        XCTAssertEqual(try manager.install(), .installed)
        let releaseID = try XCTUnwrap(manager.inspect().activeReleaseID)
        try FileManager.default.removeItem(at: runtimeURL(releaseID))
        let unknown = releaseURL(releaseID)
            .appendingPathComponent("unknown-user-file")
        try Data("preserve\n".utf8).write(to: unknown)

        XCTAssertEqual(
            try manager.uninstall(),
            .uninstalledWithResidue
        )
        XCTAssertTrue(FileManager.default.fileExists(atPath: unknown.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: ledgerURL.path))
    }

    func testUninstallRetryFinishesAfterLedgerRemoval()
        throws
    {
        let payload = try makePayload(label: "ledger-tail")
        let manager = makeManager(payload: payload)
        XCTAssertEqual(try manager.install(), .installed)
        let interrupted = makeManager(
            payload: payload,
            checkpointHandler: { checkpoint in
                if checkpoint == .afterLedgerRemoval {
                    throw NativeIntegrationFailure.injectedFailure
                }
            }
        )
        XCTAssertThrowsError(try interrupted.uninstall()) { error in
            XCTAssertEqual(
                error as? NativeIntegrationFailure,
                .injectedFailure
            )
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: ledgerURL.path))

        XCTAssertEqual(try manager.uninstall(), .uninstalled)
        XCTAssertEqual(manager.inspect(), .notInstalled)
        XCTAssertFalse(
            FileManager.default.fileExists(atPath: integrationRoot.path)
        )
    }

    func testRollbackCleansARecognizedInterruptedTransaction()
        throws
    {
        let first = makeManager(
            payload: try makePayload(label: "rollback-clean-first")
        )
        XCTAssertEqual(try first.install(), .installed)
        let second = makeManager(
            payload: try makePayload(label: "rollback-clean-second")
        )
        XCTAssertEqual(try second.install(), .upgraded)
        let stale = transactionsURL.appendingPathComponent(
            "txn_00000000000000000000000000000000",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: stale,
            withIntermediateDirectories: false
        )
        try setMode(0o700, at: stale)
        let stagedActivation = stale.appendingPathComponent("activation.new")
        try Data("staged\n".utf8).write(to: stagedActivation)
        try setMode(0o600, at: stagedActivation)

        XCTAssertEqual(try second.rollback(), .rolledBack)
        XCTAssertFalse(FileManager.default.fileExists(atPath: stale.path))
        XCTAssertEqual(second.inspect().condition, .healthy)
    }

    func testHealthyRepairCleansARecognizedInterruptedTransaction()
        throws
    {
        let manager = makeManager(
            payload: try makePayload(label: "repair-clean")
        )
        XCTAssertEqual(try manager.install(), .installed)
        let stale = transactionsURL.appendingPathComponent(
            "txn_00000000000000000000000000000000",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: stale,
            withIntermediateDirectories: false
        )
        try setMode(0o700, at: stale)
        let stagedActivation = stale.appendingPathComponent("activation.new")
        try Data("staged\n".utf8).write(to: stagedActivation)
        try setMode(0o600, at: stagedActivation)

        XCTAssertEqual(try manager.repair(), .noChange)
        XCTAssertFalse(FileManager.default.fileExists(atPath: stale.path))
        XCTAssertEqual(manager.inspect().condition, .healthy)
    }

    func testAdjacentRawCanaryIsNeverCopiedIntoInstallTree() throws {
        let payload = try makePayload(label: "privacy")
        let canary = payload.helperURL.deletingLastPathComponent()
            .appendingPathComponent("raw-provider-envelope.json")
        try Data("RAW-INSTALL-CANARY-b11f7606\n".utf8).write(to: canary)

        XCTAssertEqual(
            try makeManager(payload: payload).install(),
            .installed
        )
        XCTAssertFalse(
            try persistedDataContains(
                Data("RAW-INSTALL-CANARY-b11f7606".utf8),
                in: productRoot
            )
        )
    }

    private var integrationRoot: URL {
        productRoot.appendingPathComponent(
            "integration-v1",
            isDirectory: true
        )
    }

    private var helperURL: URL {
        integrationRoot.appendingPathComponent("awf-hook")
    }

    private var activationURL: URL {
        integrationRoot.appendingPathComponent("activation.json")
    }

    private var ledgerURL: URL {
        integrationRoot.appendingPathComponent(
            NativeIntegrationLedger.filename
        )
    }

    private var versionsURL: URL {
        integrationRoot.appendingPathComponent(
            "versions",
            isDirectory: true
        )
    }

    private var transactionsURL: URL {
        integrationRoot.appendingPathComponent(
            ".transactions",
            isDirectory: true
        )
    }

    private func releaseURL(_ releaseID: String) -> URL {
        versionsURL.appendingPathComponent(
            releaseID,
            isDirectory: true
        )
    }

    private func runtimeURL(_ releaseID: String) -> URL {
        releaseURL(releaseID).appendingPathComponent("awf-node")
    }

    private func makeManager(
        payload: NativeIntegrationPayload?,
        checkpointHandler:
            @escaping NativeIntegrationManager.CheckpointHandler = { _ in }
    ) -> NativeIntegrationManager {
        NativeIntegrationManager(
            productRoot: productRoot,
            payload: payload,
            checkpointHandler: checkpointHandler
        )
    }

    private func makePayload(
        label: String
    ) throws -> NativeIntegrationPayload {
        let root = temporaryDirectory.appendingPathComponent(
            "payload-\(label)",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: root,
            withIntermediateDirectories: true
        )
        try setMode(0o700, at: root)
        let helper = root.appendingPathComponent("awf-hook")
        let runtime = root.appendingPathComponent("awf-node")
        try Data(
            """
            #!/bin/sh
            # helper \(label)
            exec /bin/cat

            """.utf8
        ).write(to: helper)
        try Data(
            """
            #!/bin/sh
            if [ "${1-}" = "--version" ]; then
              printf '%s\\n' 'v22.0.0'
              exit 0
            fi
            if [ "${1-}" = "--no-addons" ] &&
              [ "${2-}" = "--disable-proto=throw" ] &&
              [ "${3-}" = "-e" ]
            then
              printf '%s\\n' '\(RuntimeLocator.nodeRuntimeReadinessMarker)'
              exit 0
            fi
            # runtime \(label)
            exec /bin/cat

            """.utf8
        ).write(to: runtime)
        try setMode(0o700, at: helper)
        try setMode(0o700, at: runtime)
        return NativeIntegrationPayload(
            helperURL: helper,
            runtimeURL: runtime
        )
    }

    private func readLedger() throws -> NativeIntegrationLedger {
        try NativeIntegrationLedger.parse(
            Data(contentsOf: ledgerURL)
        )
    }

    private func appendOwnedCrashRelease(
        to ledger: NativeIntegrationLedger
    ) throws -> NativeIntegrationLedger {
        let releaseID = "rel_ffffffffffffffffffffffffffffffff"
        let source = try XCTUnwrap(ledger.releases.first)
        let destination = releaseURL(releaseID)
        try FileManager.default.createDirectory(
            at: destination,
            withIntermediateDirectories: false
        )
        try setMode(0o700, at: destination)
        try FileManager.default.copyItem(
            at: runtimeURL(source.releaseId),
            to: runtimeURL(releaseID)
        )
        try setMode(0o700, at: runtimeURL(releaseID))
        let saturated = try NativeIntegrationLedger(
            helperSHA256: ledger.helperSHA256,
            releases: ledger.releases + [
                NativeIntegrationLedger.Release(
                    releaseId: releaseID,
                    runtimeSHA256: source.runtimeSHA256,
                    workerProtocol: source.workerProtocol
                ),
            ]
        )
        try saturated.canonicalData.write(to: ledgerURL, options: .atomic)
        try setMode(0o600, at: ledgerURL)
        return saturated
    }

    private func bundledHelper() throws -> URL {
        let helper = Bundle.main.bundleURL
            .appendingPathComponent("Contents", isDirectory: true)
            .appendingPathComponent("Helpers", isDirectory: true)
            .appendingPathComponent("awf-hook")
        XCTAssertTrue(
            FileManager.default.isExecutableFile(atPath: helper.path)
        )
        return helper
    }

    private func setMode(_ mode: Int, at url: URL) throws {
        try FileManager.default.setAttributes(
            [.posixPermissions: mode],
            ofItemAtPath: url.path
        )
    }

    private func mode(at url: URL) throws -> Int {
        var status = stat()
        guard lstat(url.path, &status) == 0 else {
            throw NativeIntegrationFailure.ioFailure
        }
        return Int(status.st_mode & 0o777)
    }

    private struct ProcessResult {
        let status: Int32
        let stdout: String
        let stderr: String
    }

    private func run(
        executable: URL,
        arguments: [String],
        input: String
    ) throws -> ProcessResult {
        let process = Process()
        let inputPipe = Pipe()
        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.executableURL = executable
        process.arguments = arguments
        process.environment = [:]
        process.standardInput = inputPipe
        process.standardOutput = outputPipe
        process.standardError = errorPipe
        try process.run()
        try inputPipe.fileHandleForReading.close()
        try outputPipe.fileHandleForWriting.close()
        try errorPipe.fileHandleForWriting.close()
        inputPipe.fileHandleForWriting.write(Data(input.utf8))
        try inputPipe.fileHandleForWriting.close()
        process.waitUntilExit()
        return ProcessResult(
            status: process.terminationStatus,
            stdout: String(
                decoding: outputPipe.fileHandleForReading
                    .readDataToEndOfFile(),
                as: UTF8.self
            ),
            stderr: String(
                decoding: errorPipe.fileHandleForReading
                    .readDataToEndOfFile(),
                as: UTF8.self
            )
        )
    }

    private func persistedDataContains(
        _ needle: Data,
        in directory: URL
    ) throws -> Bool {
        guard let enumerator = FileManager.default.enumerator(
            at: directory,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: []
        ) else {
            return false
        }
        for case let file as URL in enumerator {
            let values = try file.resourceValues(
                forKeys: [.isRegularFileKey]
            )
            guard values.isRegularFile == true else {
                continue
            }
            if let data = try? Data(contentsOf: file),
               data.range(of: needle) != nil
            {
                return true
            }
        }
        return false
    }
}

import XCTest
@testable import AWF

final class NativeIntegrationPresentationTests: XCTestCase {
    func testNotInstalledWithPayloadOffersInstallAndRefresh() {
        let presentation = project(
            snapshot: .notInstalled,
            payloadStatus: .available
        )

        XCTAssertEqual(
            presentation.symbolName,
            "square.and.arrow.down.fill"
        )
        XCTAssertEqual(presentation.colorRole, .attention)
        XCTAssertEqual(presentation.primaryAction, .install)
        XCTAssertEqual(presentation.secondaryActions, [.refresh])
        XCTAssertEqual(presentation.actions, [.install, .refresh])
    }

    func testHealthyStateOffersOnlyOwnedLifecycleActions() {
        let presentation = project(
            snapshot: snapshot(
                condition: .healthy,
                canRollback: true
            )
        )

        XCTAssertEqual(
            presentation.symbolName,
            "checkmark.shield.fill"
        )
        XCTAssertEqual(presentation.colorRole, .healthy)
        XCTAssertNil(presentation.primaryAction)
        XCTAssertEqual(
            presentation.secondaryActions,
            [.rollback, .uninstall, .refresh]
        )
        XCTAssertFalse(presentation.actions.contains(.install))
        XCTAssertFalse(presentation.actions.contains(.repair))
    }

    func testRepairStateUsesClosedReasonAndPayloadGatesRepair() {
        let repairable = snapshot(
            condition: .needsRepair,
            reason: .activationInvalid,
            activeReleaseID:
                "rel_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            canRollback: true
        )
        let available = project(
            snapshot: repairable,
            payloadStatus: .available
        )
        let unavailable = project(
            snapshot: repairable,
            payloadStatus: .unavailable(.payloadInvalid)
        )

        XCTAssertEqual(available.colorRole, .attention)
        XCTAssertEqual(available.primaryAction, .repair)
        XCTAssertEqual(
            available.reasonKey,
            "integration.reason.activationInvalid"
        )
        XCTAssertEqual(
            available.secondaryActions,
            [.rollback, .uninstall, .refresh]
        )

        XCTAssertNil(unavailable.primaryAction)
        XCTAssertEqual(
            unavailable.reasonKey,
            "integration.payload.invalid"
        )
        XCTAssertFalse(unavailable.actions.contains(.repair))
    }

    func testUnsafeLayoutIsBlockedWithoutMutationActions() {
        let presentation = project(
            snapshot: snapshot(condition: .unsafeLayout)
        )

        XCTAssertEqual(
            presentation.symbolName,
            "exclamationmark.shield.fill"
        )
        XCTAssertEqual(presentation.colorRole, .danger)
        XCTAssertNil(presentation.primaryAction)
        XCTAssertEqual(presentation.secondaryActions, [.refresh])
    }

    func testApplyingStateHasNoActionsAndBlocksDismissalSignal() {
        let presentation = project(
            snapshot: .notInstalled,
            operation: .applying(.install)
        )

        XCTAssertTrue(presentation.isApplying)
        XCTAssertEqual(presentation.applyingAction, .install)
        XCTAssertEqual(
            presentation.symbolName,
            "arrow.triangle.2.circlepath"
        )
        XCTAssertEqual(presentation.colorRole, .neutral)
        XCTAssertTrue(presentation.actions.isEmpty)
    }

    func testClosedMutationResultsMapToSafeNoticeKeys() {
        let expectations: [
            (NativeIntegrationMutationResult, String)
        ] = [
            (.installed, "integration.result.installed"),
            (.upgraded, "integration.result.upgraded"),
            (.repaired, "integration.result.repaired"),
            (.rolledBack, "integration.result.rolledBack"),
            (.uninstalled, "integration.result.uninstalled"),
            (
                .uninstalledWithResidue,
                "integration.result.uninstalledWithResidue"
            ),
            (.noChange, "integration.result.noChange"),
        ]

        for (result, key) in expectations {
            let presentation = project(
                snapshot: .notInstalled,
                result: .succeeded(result)
            )
            XCTAssertEqual(presentation.notice?.key, key)
            XCTAssertFalse(key.contains("/"))
            XCTAssertFalse(key.contains("rel_"))
        }
    }

    func testClosedFailuresNeverExposeRawErrorOrPathProse() {
        for failure in [
            NativeIntegrationFailure.payloadUnavailable,
            .payloadInvalid,
            .runtimeIncompatible,
            .unsafeLayout,
            .invalidLedger,
            .invalidActivation,
            .noRollbackCandidate,
            .ioFailure,
            .injectedFailure,
        ] {
            let presentation = project(
                snapshot: snapshot(
                    condition: .needsRepair,
                    reason: .runtimeInvalid,
                    activeReleaseID:
                        "rel_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
                ),
                result: .failed(failure)
            )

            let values = [
                presentation.titleKey,
                presentation.detailKey,
                presentation.reasonKey,
                presentation.notice?.key,
            ].compactMap { $0 }
            for value in values {
                XCTAssertTrue(value.hasPrefix("integration."))
                XCTAssertFalse(value.contains("/Users/"))
                XCTAssertFalse(value.contains("~/"))
                XCTAssertFalse(value.contains("rel_"))
                XCTAssertFalse(value.contains("\n"))
            }
        }
    }

    func testFixedTargetAndOwnedItemsContainNoUserDerivedPath() {
        XCTAssertEqual(
            NativeIntegrationPresentation.targetDisplayPath,
            "~/Library/Application Support/" +
                "io.github.thisisun.agent-waste-firewall/integration-v1"
        )
        XCTAssertEqual(
            NativeIntegrationPresentation.ownedItemLabels,
            [
                "awf-hook",
                "activation.json",
                "install-ledger.json",
                "versions/<release>/awf-node",
            ]
        )
        XCTAssertFalse(
            NativeIntegrationPresentation.targetDisplayPath
                .contains("/Users/")
        )
    }

    func testActionContractsRequireInlineConfirmationForMutations() {
        for action in [
            NativeIntegrationAction.install,
            .repair,
            .rollback,
            .uninstall,
        ] {
            XCTAssertTrue(action.requiresConfirmation)
        }
        XCTAssertFalse(NativeIntegrationAction.refresh.requiresConfirmation)
        XCTAssertTrue(NativeIntegrationAction.uninstall.isDestructive)
        XCTAssertFalse(NativeIntegrationAction.install.isDestructive)
    }

    private func project(
        snapshot: NativeIntegrationSnapshot,
        payloadStatus: NativeIntegrationPayloadStatus = .available,
        operation: NativeIntegrationOperation = .idle,
        result: NativeIntegrationPresentationResult? = nil
    ) -> NativeIntegrationPresentation {
        NativeIntegrationPresentation.project(
            snapshot: snapshot,
            payloadStatus: payloadStatus,
            operation: operation,
            result: result
        )
    }

    private func snapshot(
        condition: NativeIntegrationCondition,
        reason: NativeIntegrationRepairReason? = nil,
        activeReleaseID: String? = nil,
        canRollback: Bool = false
    ) -> NativeIntegrationSnapshot {
        NativeIntegrationSnapshot(
            condition: condition,
            reason: reason,
            activeReleaseID: activeReleaseID,
            canRollback: canRollback
        )
    }
}

import Foundation
import Security

struct NativeIntegrationPayload: Equatable, Sendable {
    let helperURL: URL
    let runtimeURL: URL
    let workerProtocol: Int
    let expectedRuntimeSHA256: String?

    init(
        helperURL: URL,
        runtimeURL: URL,
        workerProtocol: Int = NativeHookActivation.workerProtocol,
        expectedRuntimeSHA256: String? = nil
    ) {
        self.helperURL = helperURL
        self.runtimeURL = runtimeURL
        self.workerProtocol = workerProtocol
        self.expectedRuntimeSHA256 = expectedRuntimeSHA256
    }

    static func bundled(in bundle: Bundle = .main) -> Self {
        let helpers = bundle.bundleURL
            .appendingPathComponent("Contents", isDirectory: true)
            .appendingPathComponent("Helpers", isDirectory: true)
        let digestURL = bundle.resourceURL?
            .appendingPathComponent("RuntimePayload", isDirectory: true)
            .appendingPathComponent("awf-node.sha256")
        return Self(
            helperURL: helpers.appendingPathComponent("awf-hook"),
            runtimeURL: helpers.appendingPathComponent("awf-node"),
            expectedRuntimeSHA256: bundledRuntimeSHA256(at: digestURL)
        )
    }

    private static func bundledRuntimeSHA256(at url: URL?) -> String {
        guard
            let url,
            let data = try? Data(
                contentsOf: url,
                options: [.mappedIfSafe]
            ),
            data.count == 65,
            let source = String(data: data, encoding: .utf8),
            source.last == "\n"
        else {
            return ""
        }
        let digest = String(source.dropLast())
        guard
            digest.count == 64,
            digest.utf8.allSatisfy({
                (48...57).contains($0) || (97...102).contains($0)
            })
        else {
            return ""
        }
        return digest
    }
}

struct NativeIntegrationLedger: Equatable, Sendable {
    static let filename = "install-ledger.json"
    static let maximumBytes = 1_280
    static let maximumReleaseCount = 4
    static let retainedReleaseCount = 3

    struct Release: Codable, Equatable, Sendable {
        let releaseId: String
        let runtimeSHA256: String
        let workerProtocol: Int
    }

    let helperSHA256: String
    let releases: [Release]

    init(
        helperSHA256: String,
        releases: [Release]
    ) throws {
        guard
            Self.validSHA256(helperSHA256),
            !releases.isEmpty,
            releases.count <= Self.maximumReleaseCount,
            Set(releases.map(\.releaseId)).count == releases.count,
            releases.allSatisfy({
                Self.validReleaseID($0.releaseId) &&
                    Self.validSHA256($0.runtimeSHA256) &&
                    $0.workerProtocol == NativeHookActivation.workerProtocol
            })
        else {
            throw NativeIntegrationFailure.invalidLedger
        }
        self.helperSHA256 = helperSHA256
        self.releases = releases
    }

    static func parse(_ data: Data) throws -> Self {
        guard
            !data.isEmpty,
            data.count <= maximumBytes,
            let source = String(data: data, encoding: .utf8)
        else {
            throw NativeIntegrationFailure.invalidLedger
        }
        struct Record: Decodable {
            let v: Int
            let helperSHA256: String
            let releases: [Release]
        }
        let record: Record
        do {
            record = try JSONDecoder().decode(Record.self, from: data)
        } catch {
            throw NativeIntegrationFailure.invalidLedger
        }
        guard record.v == 1 else {
            throw NativeIntegrationFailure.invalidLedger
        }
        let ledger = try Self(
            helperSHA256: record.helperSHA256,
            releases: record.releases
        )
        guard source == ledger.canonicalSource else {
            throw NativeIntegrationFailure.invalidLedger
        }
        return ledger
    }

    var canonicalSource: String {
        let releaseSource = releases.map {
            """
            {"releaseId":"\($0.releaseId)","runtimeSHA256":"\
            \($0.runtimeSHA256)","workerProtocol":\($0.workerProtocol)}
            """
        }.joined(separator: ",")
        return #"{"v":1,"helperSHA256":"\#(helperSHA256)","releases":[\#(releaseSource)]}"#
            + "\n"
    }

    var canonicalData: Data {
        Data(canonicalSource.utf8)
    }

    func release(_ releaseID: String) -> Release? {
        releases.first { $0.releaseId == releaseID }
    }

    static func validReleaseID(_ value: String) -> Bool {
        value.count == 36 &&
            value.hasPrefix("rel_") &&
            value.dropFirst(4).utf8.allSatisfy({
                (48...57).contains($0) || (97...102).contains($0)
            })
    }

    static func validSHA256(_ value: String) -> Bool {
        value.count == 64 &&
            value.utf8.allSatisfy({
                (48...57).contains($0) || (97...102).contains($0)
            })
    }
}

enum NativeIntegrationCondition: String, Equatable, Sendable {
    case notInstalled
    case healthy
    case needsRepair
    case unsafeLayout
}

enum NativeIntegrationRepairReason: String, Equatable, Sendable {
    case helperMissing
    case helperInvalid
    case activationMissing
    case activationInvalid
    case ledgerMissing
    case ledgerInvalid
    case runtimeMissing
    case runtimeInvalid
    case unsupportedProtocol
}

struct NativeIntegrationSnapshot: Equatable, Sendable {
    let condition: NativeIntegrationCondition
    let reason: NativeIntegrationRepairReason?
    let activeReleaseID: String?
    let canRollback: Bool

    init(
        condition: NativeIntegrationCondition,
        reason: NativeIntegrationRepairReason?,
        activeReleaseID: String?,
        canRollback: Bool = false
    ) {
        self.condition = condition
        self.reason = reason
        self.activeReleaseID = activeReleaseID
        self.canRollback = canRollback
    }

    static let notInstalled = Self(
        condition: .notInstalled,
        reason: nil,
        activeReleaseID: nil
    )
}

enum NativeIntegrationMutationResult: String, Equatable, Sendable {
    case installed
    case upgraded
    case repaired
    case rolledBack
    case uninstalled
    case uninstalledWithResidue
    case noChange
}

enum NativeIntegrationCheckpoint: String, Equatable, Sendable {
    case afterLedgerPublish
    case afterReleasePublish
    case afterHelperPublish
    case afterActivationPublish
    case afterValidation
    case afterHelperRemoval
}

final class NativeIntegrationManager: @unchecked Sendable {
    typealias CheckpointHandler =
        (NativeIntegrationCheckpoint) throws -> Void
    private static let runtimeValidationTimeout: TimeInterval = 10

    private enum Intent {
        case install
        case repair
    }

    private struct Layout {
        let productRoot: URL

        var lockFilename: String {
            "integration-v1.lock"
        }

        var integrationRoot: URL {
            productRoot.appendingPathComponent(
                "integration-v1",
                isDirectory: true
            )
        }

        var helper: URL {
            integrationRoot.appendingPathComponent("awf-hook")
        }

        var activation: URL {
            integrationRoot.appendingPathComponent(
                NativeHookLaunchPlan.activationFilename
            )
        }

        var ledger: URL {
            integrationRoot.appendingPathComponent(
                NativeIntegrationLedger.filename
            )
        }

        var versions: URL {
            integrationRoot.appendingPathComponent(
                NativeHookLaunchPlan.versionsDirectoryName,
                isDirectory: true
            )
        }

        var transactions: URL {
            integrationRoot.appendingPathComponent(
                ".transactions",
                isDirectory: true
            )
        }

        func release(_ releaseID: String) -> URL {
            versions.appendingPathComponent(
                releaseID,
                isDirectory: true
            )
        }

        func runtime(_ releaseID: String) -> URL {
            release(releaseID).appendingPathComponent(
                NativeHookLaunchPlan.runtimeFilename
            )
        }
    }

    private struct PreparedPayload {
        let payload: NativeIntegrationPayload
        let helper: NativeIntegrationFilesystem.SecureFile
        let runtime: NativeIntegrationFilesystem.SecureFile
    }

    private let layout: Layout
    private let payload: NativeIntegrationPayload?
    private let checkpointHandler: CheckpointHandler
    private static let processMutationLock = NSLock()

    init(
        productRoot: URL,
        payload: NativeIntegrationPayload?,
        checkpointHandler: @escaping CheckpointHandler = { _ in }
    ) {
        self.layout = Layout(productRoot: productRoot.standardizedFileURL)
        self.payload = payload
        self.checkpointHandler = checkpointHandler
    }

    convenience init(
        bundle: Bundle = .main,
        fileManager: FileManager = .default
    ) throws {
        let applicationSupport: URL
        do {
            applicationSupport = try fileManager.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: false
            )
        } catch {
            throw NativeIntegrationFailure.ioFailure
        }
        self.init(
            productRoot: applicationSupport.appendingPathComponent(
                "io.github.thisisun.agent-waste-firewall",
                isDirectory: true
            ),
            payload: NativeIntegrationPayload.bundled(in: bundle)
        )
    }

    func inspect() -> NativeIntegrationSnapshot {
        do {
            return try inspectThrowing()
        } catch NativeIntegrationFailure.unsafeLayout {
            return NativeIntegrationSnapshot(
                condition: .unsafeLayout,
                reason: nil,
                activeReleaseID: nil
            )
        } catch {
            return NativeIntegrationSnapshot(
                condition: .needsRepair,
                reason: .runtimeInvalid,
                activeReleaseID: nil
            )
        }
    }

    func validatePayload() throws {
        _ = try preparePayload()
    }

    func install() throws -> NativeIntegrationMutationResult {
        let prepared = try preparePayload()
        return try withMutationLock {
            try installLocked(prepared, intent: .install)
        }
    }

    func repair() throws -> NativeIntegrationMutationResult {
        let prepared = try preparePayload()
        return try withMutationLock {
            let snapshot = try inspectThrowing()
            if snapshot.condition == .healthy {
                return .noChange
            }
            return try installLocked(prepared, intent: .repair)
        }
    }

    func rollback() throws -> NativeIntegrationMutationResult {
        guard NativeIntegrationFilesystem.entryExists(layout.productRoot) else {
            throw NativeIntegrationFailure.noRollbackCandidate
        }
        return try withMutationLock {
            try requireInstalledStructure()
            let activationData = try NativeIntegrationFilesystem
                .readSecureData(
                    at: layout.activation,
                    maximumBytes: NativeHookActivation.maximumBytes
                )
            let activation: NativeHookActivation
            do {
                activation = try NativeHookActivation.parse(activationData)
            } catch {
                throw NativeIntegrationFailure.invalidActivation
            }
            let ledger = try readLedger()
            guard
                let candidate = ledger.releases.reversed().first(where: {
                    $0.releaseId != activation.releaseID &&
                        validInstalledRuntime($0)
                })
            else {
                throw NativeIntegrationFailure.noRollbackCandidate
            }

            try NativeIntegrationFilesystem.ensureSecureDirectory(
                layout.transactions
            )
            let transaction = try createTransactionDirectory()
            let stagedActivation = transaction.appendingPathComponent(
                "activation.new"
            )
            try NativeIntegrationFilesystem.createDataFile(
                at: stagedActivation,
                data: Data(
                    NativeHookActivation.canonicalSource(
                        releaseID: candidate.releaseId
                    ).utf8
                )
            )
            var published:
                NativeIntegrationFilesystem.PublishedEntry?
            do {
                published = try NativeIntegrationFilesystem.publishFile(
                    stagedURL: stagedActivation,
                    installedURL: layout.activation
                )
                try checkpointHandler(.afterActivationPublish)
                guard validActiveInstall(
                    release: candidate,
                    expectedHelperSHA256: ledger.helperSHA256
                ) else {
                    throw NativeIntegrationFailure.ioFailure
                }
                try checkpointHandler(.afterValidation)
                try cleanupTransaction(transaction)
                return .rolledBack
            } catch {
                if let published {
                    try? NativeIntegrationFilesystem.rollback(published)
                }
                try? cleanupTransaction(transaction)
                throw error
            }
        }
    }

    func uninstall() throws -> NativeIntegrationMutationResult {
        guard NativeIntegrationFilesystem.entryExists(layout.productRoot) else {
            return .noChange
        }
        return try withMutationLock {
            guard
                NativeIntegrationFilesystem.entryExists(
                    layout.integrationRoot
                )
            else {
                return .noChange
            }
            try NativeIntegrationFilesystem.requireSecureDirectory(
                layout.integrationRoot
            )

            let ledger: NativeIntegrationLedger
            do {
                ledger = try readLedger()
            } catch {
                return .uninstalledWithResidue
            }

            var residue = false
            var ownedResidue = false
            var helperRemoved = false
            if NativeIntegrationFilesystem.entryExists(layout.helper) {
                do {
                    let helper = try NativeIntegrationFilesystem.secureFile(
                        at: layout.helper,
                        executable: true,
                        maximumBytes:
                            NativeIntegrationFilesystem.maximumHelperBytes
                    )
                    if helper.sha256 == ledger.helperSHA256 {
                        try NativeIntegrationFilesystem.unlinkFileIfPresent(
                            layout.helper
                        )
                        helperRemoved = true
                    } else {
                        residue = true
                        ownedResidue = true
                    }
                } catch {
                    residue = true
                    ownedResidue = true
                }
            } else {
                helperRemoved = true
            }
            if helperRemoved {
                try checkpointHandler(.afterHelperRemoval)
            }

            if NativeIntegrationFilesystem.entryExists(layout.activation) {
                do {
                    let activation = try NativeHookActivation.parse(
                        NativeIntegrationFilesystem.readSecureData(
                            at: layout.activation,
                            maximumBytes:
                                NativeHookActivation.maximumBytes
                        )
                    )
                    if helperRemoved,
                       ledger.release(activation.releaseID) != nil
                    {
                        try NativeIntegrationFilesystem.unlinkFileIfPresent(
                            layout.activation
                        )
                    } else {
                        residue = true
                        ownedResidue = true
                    }
                } catch {
                    residue = true
                    ownedResidue = true
                }
            }

            if NativeIntegrationFilesystem.entryExists(layout.versions) {
                try NativeIntegrationFilesystem.requireSecureDirectory(
                    layout.versions
                )
                for release in ledger.releases {
                    if try !NativeIntegrationFilesystem.removeReleaseIfOwned(
                        versionsURL: layout.versions,
                        releaseID: release.releaseId,
                        expectedSHA256: release.runtimeSHA256
                    ) {
                        residue = true
                        ownedResidue = true
                    }
                }
            }
            try cleanupKnownTransactions()
            if !ownedResidue {
                try NativeIntegrationFilesystem.unlinkFileIfPresent(
                    layout.ledger
                )
            }

            if NativeIntegrationFilesystem.entryExists(layout.versions),
               try !NativeIntegrationFilesystem.removeDirectoryIfEmpty(
                   layout.versions
               )
            {
                residue = true
            }
            if NativeIntegrationFilesystem.entryExists(layout.transactions),
               try !NativeIntegrationFilesystem.removeDirectoryIfEmpty(
                   layout.transactions
               )
            {
                residue = true
            }
            if try !NativeIntegrationFilesystem.removeDirectoryIfEmpty(
                layout.integrationRoot
            ) {
                residue = true
            }
            return residue ? .uninstalledWithResidue : .uninstalled
        }
    }

    private func inspectThrowing() throws -> NativeIntegrationSnapshot {
        guard NativeIntegrationFilesystem.entryExists(layout.productRoot) else {
            return .notInstalled
        }
        try NativeIntegrationFilesystem.requireSecureDirectory(
            layout.productRoot
        )
        guard
            NativeIntegrationFilesystem.entryExists(layout.integrationRoot)
        else {
            return .notInstalled
        }
        try NativeIntegrationFilesystem.requireSecureDirectory(
            layout.integrationRoot
        )

        let hasHelper = NativeIntegrationFilesystem.entryExists(layout.helper)
        let hasActivation = NativeIntegrationFilesystem.entryExists(
            layout.activation
        )
        let hasLedger = NativeIntegrationFilesystem.entryExists(layout.ledger)
        if !hasHelper, !hasActivation, !hasLedger {
            return .notInstalled
        }
        guard hasHelper else {
            return repairSnapshot(.helperMissing)
        }
        let installedHelper: NativeIntegrationFilesystem.SecureFile
        do {
            installedHelper = try NativeIntegrationFilesystem.secureFile(
                at: layout.helper,
                executable: true,
                maximumBytes:
                    NativeIntegrationFilesystem.maximumHelperBytes
            )
        } catch {
            return repairSnapshot(.helperInvalid)
        }
        if let payload,
           let bundledHelper =
            try? NativeIntegrationFilesystem.validatePayloadExecutable(
                payload.helperURL,
                maximumBytes:
                    NativeIntegrationFilesystem.maximumHelperBytes
           ),
           bundledHelper.sha256 != installedHelper.sha256
        {
            return repairSnapshot(.helperInvalid)
        }
        guard hasActivation else {
            return repairSnapshot(.activationMissing)
        }
        let activation: NativeHookActivation
        do {
            activation = try NativeHookActivation.parse(
                NativeIntegrationFilesystem.readSecureData(
                    at: layout.activation,
                    maximumBytes: NativeHookActivation.maximumBytes
                )
            )
        } catch {
            return repairSnapshot(.activationInvalid)
        }
        guard hasLedger else {
            return repairSnapshot(
                .ledgerMissing,
                activeReleaseID: activation.releaseID
            )
        }
        let ledger: NativeIntegrationLedger
        do {
            ledger = try readLedger()
        } catch {
            return repairSnapshot(
                .ledgerInvalid,
                activeReleaseID: activation.releaseID
            )
        }
        guard installedHelper.sha256 == ledger.helperSHA256 else {
            return repairSnapshot(
                .helperInvalid,
                activeReleaseID: activation.releaseID
            )
        }
        guard let release = ledger.release(activation.releaseID) else {
            return repairSnapshot(
                .runtimeMissing,
                activeReleaseID: activation.releaseID
            )
        }
        guard release.workerProtocol ==
            NativeHookActivation.workerProtocol
        else {
            return repairSnapshot(
                .unsupportedProtocol,
                activeReleaseID: activation.releaseID
            )
        }
        guard validInstalledRuntime(release) else {
            return repairSnapshot(
                .runtimeInvalid,
                activeReleaseID: activation.releaseID
            )
        }
        return NativeIntegrationSnapshot(
            condition: .healthy,
            reason: nil,
            activeReleaseID: activation.releaseID,
            canRollback: ledger.releases.contains {
                $0.releaseId != activation.releaseID &&
                    validInstalledRuntime($0)
            }
        )
    }

    private func repairSnapshot(
        _ reason: NativeIntegrationRepairReason,
        activeReleaseID: String? = nil
    ) -> NativeIntegrationSnapshot {
        NativeIntegrationSnapshot(
            condition: .needsRepair,
            reason: reason,
            activeReleaseID: activeReleaseID
        )
    }

    private func installLocked(
        _ prepared: PreparedPayload,
        intent: Intent
    ) throws -> NativeIntegrationMutationResult {
        try ensureStructure()
        try cleanupKnownTransactions()

        let existingActivation = readActivationIfValid()
        var existingLedger = try ledgerForMutation(
            intent: intent,
            activation: existingActivation
        )
        existingLedger = try reconcileLedgerForCapacity(
            existingLedger,
            activeReleaseID: existingActivation?.releaseID
        )
        if let activation = existingActivation,
           let activeRelease = existingLedger?.release(
               activation.releaseID
           ),
           existingLedger?.helperSHA256 == prepared.helper.sha256,
           activeRelease.runtimeSHA256 == prepared.runtime.sha256,
           activeRelease.workerProtocol == prepared.payload.workerProtocol,
           validActiveInstall(
               release: activeRelease,
               expectedHelperSHA256: prepared.helper.sha256
           )
        {
            return .noChange
        }

        guard
            (existingLedger?.releases.count ?? 0) <
                NativeIntegrationLedger.maximumReleaseCount
        else {
            throw NativeIntegrationFailure.unsafeLayout
        }

        let transaction = try createTransactionDirectory()
        let releaseID = try makeReleaseID()
        let stagedRelease = transaction.appendingPathComponent(
            "release",
            isDirectory: true
        )
        try NativeIntegrationFilesystem.ensureSecureDirectory(stagedRelease)
        let stagedRuntime = stagedRelease.appendingPathComponent(
            NativeHookLaunchPlan.runtimeFilename
        )
        let stagedHelper = transaction.appendingPathComponent(
            "awf-hook.new"
        )
        try NativeIntegrationFilesystem.copyPayloadExecutable(
            from: prepared.payload.runtimeURL,
            to: stagedRuntime,
            maximumBytes: NativeIntegrationFilesystem.maximumRuntimeBytes,
            expectedSHA256: prepared.runtime.sha256
        )
        guard
            RuntimeLocator.supportedNodeMajorVersion(
                at: stagedRuntime,
                timeout: Self.runtimeValidationTimeout
            ) != nil,
            RuntimeLocator.nodeRuntimeIsReady(
                at: stagedRuntime,
                timeout: Self.runtimeValidationTimeout
            )
        else {
            try? cleanupTransaction(transaction)
            throw NativeIntegrationFailure.runtimeIncompatible
        }
        try NativeIntegrationFilesystem.copyPayloadExecutable(
            from: prepared.payload.helperURL,
            to: stagedHelper,
            maximumBytes: NativeIntegrationFilesystem.maximumHelperBytes,
            expectedSHA256: prepared.helper.sha256
        )

        var releaseRecords = existingLedger?.releases ?? []
        releaseRecords.append(
            NativeIntegrationLedger.Release(
                releaseId: releaseID,
                runtimeSHA256: prepared.runtime.sha256,
                workerProtocol: prepared.payload.workerProtocol
            )
        )
        let pendingLedger = try NativeIntegrationLedger(
            helperSHA256: prepared.helper.sha256,
            releases: releaseRecords
        )
        let stagedLedger = transaction.appendingPathComponent(
            "ledger.new"
        )
        let stagedActivation = transaction.appendingPathComponent(
            "activation.new"
        )
        try NativeIntegrationFilesystem.createDataFile(
            at: stagedLedger,
            data: pendingLedger.canonicalData
        )
        try NativeIntegrationFilesystem.createDataFile(
            at: stagedActivation,
            data: Data(
                NativeHookActivation.canonicalSource(
                    releaseID: releaseID
                ).utf8
            )
        )

        var ledgerPublish:
            NativeIntegrationFilesystem.PublishedEntry?
        var helperPublish:
            NativeIntegrationFilesystem.PublishedEntry?
        var activationPublish:
            NativeIntegrationFilesystem.PublishedEntry?
        var releasePublished = false
        let helperWasVisible = NativeIntegrationFilesystem.entryExists(
            layout.helper
        )
        do {
            ledgerPublish = try NativeIntegrationFilesystem.publishFile(
                stagedURL: stagedLedger,
                installedURL: layout.ledger
            )
            try checkpointHandler(.afterLedgerPublish)

            try NativeIntegrationFilesystem.publishDirectory(
                stagedURL: stagedRelease,
                installedURL: layout.release(releaseID)
            )
            releasePublished = true
            try checkpointHandler(.afterReleasePublish)

            if helperWasVisible {
                helperPublish = try NativeIntegrationFilesystem.publishFile(
                    stagedURL: stagedHelper,
                    installedURL: layout.helper
                )
                try checkpointHandler(.afterHelperPublish)
                activationPublish =
                    try NativeIntegrationFilesystem.publishFile(
                        stagedURL: stagedActivation,
                        installedURL: layout.activation
                    )
                try checkpointHandler(.afterActivationPublish)
            } else {
                activationPublish =
                    try NativeIntegrationFilesystem.publishFile(
                        stagedURL: stagedActivation,
                        installedURL: layout.activation
                    )
                try checkpointHandler(.afterActivationPublish)
                helperPublish = try NativeIntegrationFilesystem.publishFile(
                    stagedURL: stagedHelper,
                    installedURL: layout.helper
                )
                try checkpointHandler(.afterHelperPublish)
            }

            let activeRelease = try XCTUnwrapLike(
                pendingLedger.release(releaseID)
            )
            guard validActiveInstall(
                release: activeRelease,
                expectedHelperSHA256: prepared.helper.sha256
            ) else {
                throw NativeIntegrationFailure.ioFailure
            }
            try checkpointHandler(.afterValidation)
        } catch {
            var rollbackFailed = false
            if let activationPublish {
                do {
                    try NativeIntegrationFilesystem.rollback(
                        activationPublish
                    )
                } catch {
                    // Activation is the runtime authority. If it cannot be
                    // restored, preserve the newly published helper, ledger,
                    // and release so the visible activation never points at
                    // payload that compensation deleted.
                    try? cleanupTransaction(transaction)
                    throw NativeIntegrationFailure.ioFailure
                }
            }
            if let helperPublish {
                do {
                    try NativeIntegrationFilesystem.rollback(helperPublish)
                } catch {
                    rollbackFailed = true
                }
            }
            var ledgerRollbackFailed = false
            if let ledgerPublish {
                do {
                    try NativeIntegrationFilesystem.rollback(ledgerPublish)
                } catch {
                    rollbackFailed = true
                    ledgerRollbackFailed = true
                }
            }
            if releasePublished, !ledgerRollbackFailed {
                do {
                    _ = try NativeIntegrationFilesystem
                        .removeReleaseIfOwned(
                            versionsURL: layout.versions,
                            releaseID: releaseID,
                            expectedSHA256: prepared.runtime.sha256
                        )
                } catch {
                    rollbackFailed = true
                }
            }
            try? cleanupTransaction(transaction)
            if rollbackFailed {
                throw NativeIntegrationFailure.ioFailure
            }
            throw error
        }

        try finishSuccessfulTransaction(
            transaction,
            ledger: pendingLedger,
            activeReleaseID: releaseID,
            previousReleaseID: existingActivation?.releaseID
        )
        switch intent {
        case .repair:
            return .repaired
        case .install:
            return existingActivation == nil ? .installed : .upgraded
        }
    }

    private func preparePayload() throws -> PreparedPayload {
        guard
            let payload,
            payload.workerProtocol == NativeHookActivation.workerProtocol
        else {
            throw NativeIntegrationFailure.payloadUnavailable
        }
        let helper = try NativeIntegrationFilesystem
            .validatePayloadExecutable(
                payload.helperURL,
                maximumBytes:
                    NativeIntegrationFilesystem.maximumHelperBytes
            )
        let runtime = try NativeIntegrationFilesystem
            .validatePayloadExecutable(
                payload.runtimeURL,
                maximumBytes:
                    NativeIntegrationFilesystem.maximumRuntimeBytes
            )
        if let expected = payload.expectedRuntimeSHA256,
           runtime.sha256 != expected
        {
            throw NativeIntegrationFailure.payloadInvalid
        }
        guard
            RuntimeLocator.supportedNodeMajorVersion(
                at: payload.runtimeURL,
                timeout: Self.runtimeValidationTimeout
            ) != nil
        else {
            throw NativeIntegrationFailure.runtimeIncompatible
        }
        return PreparedPayload(
            payload: payload,
            helper: helper,
            runtime: runtime
        )
    }

    private func withMutationLock<Result>(
        _ body: () throws -> Result
    ) throws -> Result {
        Self.processMutationLock.lock()
        defer {
            Self.processMutationLock.unlock()
        }
        let lock = try NativeIntegrationFilesystem.acquireLock(
            productRoot: layout.productRoot,
            filename: layout.lockFilename
        )
        defer {
            lock.unlock()
        }
        return try body()
    }

    private func ensureStructure() throws {
        try NativeIntegrationFilesystem.ensureSecureDirectory(
            layout.productRoot
        )
        try NativeIntegrationFilesystem.ensureSecureDirectory(
            layout.integrationRoot
        )
        try NativeIntegrationFilesystem.ensureSecureDirectory(layout.versions)
        try NativeIntegrationFilesystem.ensureSecureDirectory(
            layout.transactions
        )
    }

    private func requireInstalledStructure() throws {
        try NativeIntegrationFilesystem.requireSecureDirectory(
            layout.productRoot
        )
        try NativeIntegrationFilesystem.requireSecureDirectory(
            layout.integrationRoot
        )
        try NativeIntegrationFilesystem.requireSecureDirectory(layout.versions)
    }

    private func readActivationIfValid() -> NativeHookActivation? {
        guard NativeIntegrationFilesystem.entryExists(layout.activation) else {
            return nil
        }
        guard
            let data = try? NativeIntegrationFilesystem.readSecureData(
                at: layout.activation,
                maximumBytes: NativeHookActivation.maximumBytes
            ),
            let activation = try? NativeHookActivation.parse(data)
        else {
            return nil
        }
        return activation
    }

    private func readLedger() throws -> NativeIntegrationLedger {
        let data = try NativeIntegrationFilesystem.readSecureData(
            at: layout.ledger,
            maximumBytes: NativeIntegrationLedger.maximumBytes
        )
        return try NativeIntegrationLedger.parse(data)
    }

    private func ledgerForMutation(
        intent: Intent,
        activation: NativeHookActivation?
    ) throws -> NativeIntegrationLedger? {
        guard NativeIntegrationFilesystem.entryExists(layout.ledger) else {
            if activation != nil, intent == .install {
                throw NativeIntegrationFailure.invalidLedger
            }
            return nil
        }
        do {
            return try readLedger()
        } catch {
            guard intent == .repair else {
                throw NativeIntegrationFailure.invalidLedger
            }
            return nil
        }
    }

    private func validInstalledRuntime(
        _ release: NativeIntegrationLedger.Release
    ) -> Bool {
        guard
            NativeIntegrationLedger.validReleaseID(release.releaseId),
            release.workerProtocol == NativeHookActivation.workerProtocol
        else {
            return false
        }
        do {
            try NativeIntegrationFilesystem.requireSecureDirectory(
                layout.release(release.releaseId)
            )
            let runtime = try NativeIntegrationFilesystem.secureFile(
                at: layout.runtime(release.releaseId),
                executable: true,
                maximumBytes:
                    NativeIntegrationFilesystem.maximumRuntimeBytes
            )
            return runtime.sha256 == release.runtimeSHA256
        } catch {
            return false
        }
    }

    private func validActiveInstall(
        release: NativeIntegrationLedger.Release,
        expectedHelperSHA256: String?
    ) -> Bool {
        guard validInstalledRuntime(release) else {
            return false
        }
        do {
            let helper = try NativeIntegrationFilesystem.secureFile(
                at: layout.helper,
                executable: true,
                maximumBytes:
                    NativeIntegrationFilesystem.maximumHelperBytes
            )
            if let expectedHelperSHA256 {
                guard helper.sha256 == expectedHelperSHA256 else {
                    return false
                }
            }
            let activation = try NativeHookActivation.parse(
                NativeIntegrationFilesystem.readSecureData(
                    at: layout.activation,
                    maximumBytes: NativeHookActivation.maximumBytes
                )
            )
            return activation.releaseID == release.releaseId
        } catch {
            return false
        }
    }

    private func reconcileLedgerForCapacity(
        _ ledger: NativeIntegrationLedger?,
        activeReleaseID: String?
    ) throws -> NativeIntegrationLedger? {
        guard let ledger else {
            return nil
        }

        var staleReleaseIDs = Set<String>()
        for release in ledger.releases
        where release.releaseId != activeReleaseID &&
            isDefinitelyAbsentNonActiveRelease(release)
        {
            let releaseURL = layout.release(release.releaseId)
            if NativeIntegrationFilesystem.entryExists(releaseURL) {
                guard
                    try NativeIntegrationFilesystem.removeDirectoryIfEmpty(
                        releaseURL
                    )
                else {
                    continue
                }
            }
            staleReleaseIDs.insert(release.releaseId)
        }
        let reconciledRecords = ledger.releases.filter {
            !staleReleaseIDs.contains($0.releaseId)
        }
        guard reconciledRecords != ledger.releases else {
            return ledger
        }
        guard !reconciledRecords.isEmpty else {
            // Keep the old ledger as ownership evidence until the normal
            // transaction swaps it. Returning nil lets the new release start
            // a clean ledger without creating a pre-transaction crash window.
            return nil
        }

        let reconciled = try NativeIntegrationLedger(
            helperSHA256: ledger.helperSHA256,
            releases: reconciledRecords
        )
        try replaceLedger(reconciled, stageName: "ledger.reconcile")
        return reconciled
    }

    private func isDefinitelyAbsentNonActiveRelease(
        _ release: NativeIntegrationLedger.Release
    ) -> Bool {
        let releaseURL = layout.release(release.releaseId)
        guard NativeIntegrationFilesystem.entryExists(releaseURL) else {
            return true
        }
        do {
            try NativeIntegrationFilesystem.requireSecureDirectory(releaseURL)
            let runtimeURL = layout.runtime(release.releaseId)
            guard !NativeIntegrationFilesystem.entryExists(runtimeURL) else {
                return false
            }
            return try NativeIntegrationFilesystem.childNames(
                releaseURL
            ).isEmpty
        } catch {
            return false
        }
    }

    private func finishSuccessfulTransaction(
        _ transaction: URL,
        ledger: NativeIntegrationLedger,
        activeReleaseID: String,
        previousReleaseID: String?
    ) throws {
        var retainedReleaseIDs = Set<String>()
        retainedReleaseIDs.insert(activeReleaseID)
        if let previousReleaseID {
            retainedReleaseIDs.insert(previousReleaseID)
        }
        for release in ledger.releases.reversed()
        where retainedReleaseIDs.count <
            NativeIntegrationLedger.retainedReleaseCount
        {
            if validInstalledRuntime(release) {
                retainedReleaseIDs.insert(release.releaseId)
            }
        }

        var finalRecords: [NativeIntegrationLedger.Release] = []
        for release in ledger.releases {
            if retainedReleaseIDs.contains(release.releaseId) {
                finalRecords.append(release)
            } else {
                let removed = try NativeIntegrationFilesystem
                    .removeReleaseIfOwned(
                        versionsURL: layout.versions,
                        releaseID: release.releaseId,
                        expectedSHA256: release.runtimeSHA256
                    )
                if !removed {
                    finalRecords.append(release)
                }
            }
        }
        if finalRecords != ledger.releases {
            let finalLedger = try NativeIntegrationLedger(
                helperSHA256: ledger.helperSHA256,
                releases: finalRecords
            )
            let staged = transaction.appendingPathComponent(
                "ledger.final"
            )
            try NativeIntegrationFilesystem.createDataFile(
                at: staged,
                data: finalLedger.canonicalData
            )
            let published = try NativeIntegrationFilesystem.publishFile(
                stagedURL: staged,
                installedURL: layout.ledger
            )
            if published.kind == .swapped {
                try NativeIntegrationFilesystem.unlinkFileIfPresent(
                    published.stagedURL
                )
            }
        }
        try cleanupTransaction(transaction)
    }

    private func replaceLedger(
        _ ledger: NativeIntegrationLedger,
        stageName: String
    ) throws {
        try NativeIntegrationFilesystem.ensureSecureDirectory(
            layout.transactions
        )
        let transaction = try createTransactionDirectory()
        let staged = transaction.appendingPathComponent(stageName)
        try NativeIntegrationFilesystem.createDataFile(
            at: staged,
            data: ledger.canonicalData
        )
        let published = try NativeIntegrationFilesystem.publishFile(
            stagedURL: staged,
            installedURL: layout.ledger
        )
        if published.kind == .swapped {
            try NativeIntegrationFilesystem.unlinkFileIfPresent(
                published.stagedURL
            )
        }
        try cleanupTransaction(transaction)
    }

    private func createTransactionDirectory() throws -> URL {
        for _ in 0..<8 {
            let transaction = layout.transactions.appendingPathComponent(
                try makeIdentifier(prefix: "txn_"),
                isDirectory: true
            )
            if !NativeIntegrationFilesystem.entryExists(transaction) {
                try NativeIntegrationFilesystem.ensureSecureDirectory(
                    transaction
                )
                return transaction
            }
        }
        throw NativeIntegrationFailure.ioFailure
    }

    private func makeReleaseID() throws -> String {
        for _ in 0..<8 {
            let releaseID = try makeIdentifier(prefix: "rel_")
            if !NativeIntegrationFilesystem.entryExists(
                layout.release(releaseID)
            ) {
                return releaseID
            }
        }
        throw NativeIntegrationFailure.ioFailure
    }

    private func makeIdentifier(prefix: String) throws -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        let status = bytes.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(
                kSecRandomDefault,
                buffer.count,
                buffer.baseAddress!
            )
        }
        guard status == errSecSuccess else {
            throw NativeIntegrationFailure.ioFailure
        }
        return prefix + bytes.map {
            String(format: "%02x", $0)
        }.joined()
    }

    private func cleanupKnownTransactions() throws {
        guard
            NativeIntegrationFilesystem.entryExists(layout.transactions)
        else {
            return
        }
        try NativeIntegrationFilesystem.requireSecureDirectory(
            layout.transactions
        )
        for name in try NativeIntegrationFilesystem.childNames(
            layout.transactions
        ) where validTransactionName(name) {
            try cleanupTransaction(
                layout.transactions.appendingPathComponent(
                    name,
                    isDirectory: true
                )
            )
        }
    }

    private func cleanupTransaction(_ transaction: URL) throws {
        guard NativeIntegrationFilesystem.entryExists(transaction) else {
            return
        }
        try NativeIntegrationFilesystem.requireSecureDirectory(transaction)
        let release = transaction.appendingPathComponent(
            "release",
            isDirectory: true
        )
        if NativeIntegrationFilesystem.entryExists(release) {
            try NativeIntegrationFilesystem.requireSecureDirectory(release)
            try NativeIntegrationFilesystem.unlinkFileIfPresent(
                release.appendingPathComponent(
                    NativeHookLaunchPlan.runtimeFilename
                )
            )
            _ = try NativeIntegrationFilesystem.removeDirectoryIfEmpty(
                release
            )
        }
        for filename in [
            "awf-hook.new",
            "activation.new",
            "ledger.new",
            "ledger.final",
            "ledger.reconcile",
        ] {
            try NativeIntegrationFilesystem.unlinkFileIfPresent(
                transaction.appendingPathComponent(filename)
            )
        }
        _ = try NativeIntegrationFilesystem.removeDirectoryIfEmpty(
            transaction
        )
    }

    private func validTransactionName(_ value: String) -> Bool {
        value.count == 36 &&
            value.hasPrefix("txn_") &&
            value.dropFirst(4).utf8.allSatisfy({
                (48...57).contains($0) || (97...102).contains($0)
            })
    }

    private func XCTUnwrapLike<Value>(_ value: Value?) throws -> Value {
        guard let value else {
            throw NativeIntegrationFailure.ioFailure
        }
        return value
    }
}

import Darwin
import Foundation

private enum HarnessFailure: Error {
    case invalidArguments
}

private enum HarnessOperation: String {
    case install
    case repair
    case rollback
    case uninstall
    case inspect
}

private enum HarnessCheckpoint: String {
    case none
    case afterStagingComplete
    case afterLedgerPublish
    case afterReleasePublish
    case afterHelperPublish
    case afterActivationPublish
    case afterValidation
    case afterFinalLedgerPublish
    case afterHelperRemoval
    case afterActivationRemoval
    case afterRuntimeRemoval
    case afterReleaseRemoval
    case afterLedgerRemoval

    var nativeValue: NativeIntegrationCheckpoint? {
        switch self {
        case .none:
            nil
        case .afterStagingComplete:
            .afterStagingComplete
        case .afterLedgerPublish:
            .afterLedgerPublish
        case .afterReleasePublish:
            .afterReleasePublish
        case .afterHelperPublish:
            .afterHelperPublish
        case .afterActivationPublish:
            .afterActivationPublish
        case .afterValidation:
            .afterValidation
        case .afterFinalLedgerPublish:
            .afterFinalLedgerPublish
        case .afterHelperRemoval:
            .afterHelperRemoval
        case .afterActivationRemoval:
            .afterActivationRemoval
        case .afterRuntimeRemoval:
            .afterRuntimeRemoval
        case .afterReleaseRemoval:
            .afterReleaseRemoval
        case .afterLedgerRemoval:
            .afterLedgerRemoval
        }
    }
}

private struct HarnessArguments {
    static let maximumPathBytes = 4_096

    let operation: HarnessOperation
    let checkpoint: HarnessCheckpoint
    let productRoot: URL
    let helper: URL
    let runtime: URL

    init(_ arguments: [String]) throws {
        guard
            arguments.count == 6,
            let operation = HarnessOperation(rawValue: arguments[1]),
            let checkpoint = HarnessCheckpoint(rawValue: arguments[2])
        else {
            throw HarnessFailure.invalidArguments
        }

        let productRoot = try Self.absoluteURL(
            arguments[3],
            isDirectory: true
        )
        let helper = try Self.absoluteURL(
            arguments[4],
            isDirectory: false
        )
        let runtime = try Self.absoluteURL(
            arguments[5],
            isDirectory: false
        )
        guard productRoot.path != "/" else {
            throw HarnessFailure.invalidArguments
        }

        self.operation = operation
        self.checkpoint = checkpoint
        self.productRoot = productRoot
        self.helper = helper
        self.runtime = runtime
    }

    private static func absoluteURL(
        _ path: String,
        isDirectory: Bool
    ) throws -> URL {
        guard
            path.hasPrefix("/"),
            !path.utf8.contains(0),
            path.utf8.count <= maximumPathBytes
        else {
            throw HarnessFailure.invalidArguments
        }
        let url = URL(
            fileURLWithPath: path,
            isDirectory: isDirectory
        ).standardizedFileURL
        guard url.path.hasPrefix("/") else {
            throw HarnessFailure.invalidArguments
        }
        return url
    }
}

private struct HarnessLayout {
    let integrationRoot: URL

    init(productRoot: URL) {
        integrationRoot = productRoot.appendingPathComponent(
            "integration-v1",
            isDirectory: true
        )
    }

    var ledger: URL {
        integrationRoot.appendingPathComponent(
            NativeIntegrationLedger.filename
        )
    }

    var transactions: URL {
        integrationRoot.appendingPathComponent(
            ".transactions",
            isDirectory: true
        )
    }
}

private let maximumOutputBytes = 512

private func emit(_ source: String) {
    let bytes = Array((source + "\n").utf8)
    guard bytes.count <= maximumOutputBytes else {
        Darwin.exit(70)
    }
    var offset = 0
    bytes.withUnsafeBytes { pointer in
        guard let baseAddress = pointer.baseAddress else {
            Darwin.exit(70)
        }
        while offset < bytes.count {
            let count = Darwin.write(
                STDOUT_FILENO,
                baseAddress.advanced(by: offset),
                bytes.count - offset
            )
            if count < 0, errno == EINTR {
                continue
            }
            guard count > 0 else {
                Darwin.exit(74)
            }
            offset += count
        }
    }
}

private func emitErrorAndExit(_ code: String, status: Int32) -> Never {
    emit(#"{"v":1,"type":"error","code":"\#(code)"}"#)
    Darwin.exit(status)
}

private func blockAtCheckpoint(
    operation: HarnessOperation,
    checkpoint: HarnessCheckpoint
) -> Never {
    emit(
        #"{"v":1,"type":"checkpoint","operation":"\#(operation.rawValue)","checkpoint":"\#(checkpoint.rawValue)"}"#
    )
    while true {
        _ = Darwin.pause()
    }
}

private func ledgerReleaseCount(_ layout: HarnessLayout) -> Int {
    guard NativeIntegrationFilesystem.entryExists(layout.ledger) else {
        return 0
    }
    guard
        let data = try? NativeIntegrationFilesystem.readSecureData(
            at: layout.ledger,
            maximumBytes: NativeIntegrationLedger.maximumBytes
        ),
        let ledger = try? NativeIntegrationLedger.parse(data)
    else {
        return 0
    }
    return ledger.releases.count
}

private func isKnownTransactionName(_ value: String) -> Bool {
    value.count == 36 &&
        value.hasPrefix("txn_") &&
        value.dropFirst(4).utf8.allSatisfy {
            (48...57).contains($0) || (97...102).contains($0)
        }
}

private func knownTransactionCount(_ layout: HarnessLayout) -> Int {
    guard NativeIntegrationFilesystem.entryExists(layout.transactions) else {
        return 0
    }
    guard
        (try? NativeIntegrationFilesystem.requireSecureDirectory(
            layout.transactions
        )) != nil,
        let names = try? NativeIntegrationFilesystem.childNames(
            layout.transactions
        )
    else {
        return 0
    }
    return names.lazy.filter(isKnownTransactionName).count
}

private func summarySource(
    operation: HarnessOperation,
    mutation: NativeIntegrationMutationResult,
    snapshot: NativeIntegrationSnapshot,
    ledgerReleaseCount: Int,
    knownTransactionCount: Int
) -> String {
    let reason = snapshot.reason.map {
        #""\#($0.rawValue)""#
    } ?? "null"
    return #"{"v":1,"type":"summary","operation":"\#(operation.rawValue)","mutation":"\#(mutation.rawValue)","condition":"\#(snapshot.condition.rawValue)","reason":\#(reason),"canRollback":\#(snapshot.canRollback),"ledgerReleaseCount":\#(ledgerReleaseCount),"knownTransactionCount":\#(knownTransactionCount)}"#
}

private func run(_ arguments: HarnessArguments) throws {
    let selectedCheckpoint = arguments.checkpoint.nativeValue
    let manager = NativeIntegrationManager(
        productRoot: arguments.productRoot,
        payload: NativeIntegrationPayload(
            helperURL: arguments.helper,
            runtimeURL: arguments.runtime
        ),
        checkpointHandler: { reachedCheckpoint in
            guard reachedCheckpoint == selectedCheckpoint else {
                return
            }
            blockAtCheckpoint(
                operation: arguments.operation,
                checkpoint: arguments.checkpoint
            )
        }
    )

    let mutation: NativeIntegrationMutationResult
    switch arguments.operation {
    case .install:
        mutation = try manager.install()
    case .repair:
        mutation = try manager.repair()
    case .rollback:
        mutation = try manager.rollback()
    case .uninstall:
        mutation = try manager.uninstall()
    case .inspect:
        mutation = .noChange
    }

    let snapshot = manager.inspect()
    let layout = HarnessLayout(productRoot: arguments.productRoot)
    emit(
        summarySource(
            operation: arguments.operation,
            mutation: mutation,
            snapshot: snapshot,
            ledgerReleaseCount: ledgerReleaseCount(layout),
            knownTransactionCount: knownTransactionCount(layout)
        )
    )
}

do {
    let arguments = try HarnessArguments(CommandLine.arguments)
    try run(arguments)
} catch HarnessFailure.invalidArguments {
    emitErrorAndExit("invalid_arguments", status: 64)
} catch {
    emitErrorAndExit("operation_failed", status: 70)
}

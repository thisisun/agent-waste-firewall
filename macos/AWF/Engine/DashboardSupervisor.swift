import Darwin
import Foundation

private final class ReadyLineReader: @unchecked Sendable {
    private static let maximumBytes = 1_024
    private typealias Continuation = CheckedContinuation<Data, any Error>

    private struct Completion {
        let continuation: Continuation?
        let result: Result<Data, any Error>
        let handle: FileHandle?
        let timeoutTask: Task<Void, Never>?
    }

    private let lock = NSLock()
    private var buffer = Data()
    private var continuation: Continuation?
    private var handle: FileHandle?
    private var terminalResult: Result<Data, any Error>?
    private var timeoutTask: Task<Void, Never>?

    func read(from handle: FileHandle) async throws -> Data {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                install(handle: handle, continuation: continuation)
            }
        } onCancel: { [weak self] in
            self?.resolve(.failure(CancellationError()))
        }
    }

    private func install(
        handle: FileHandle,
        continuation: Continuation
    ) {
        lock.lock()
        if let terminalResult {
            lock.unlock()
            continuation.resume(with: terminalResult)
            return
        }

        self.handle = handle
        self.continuation = continuation
        let timeoutTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .seconds(5))
            } catch {
                return
            }
            self?.resolve(
                .failure(DashboardLaunchFailure.readinessTimedOut)
            )
        }
        self.timeoutTask = timeoutTask
        handle.readabilityHandler = { [weak self] readableHandle in
            self?.consume(readableHandle.availableData)
        }
        lock.unlock()
    }

    private func consume(_ chunk: Data) {
        var completion: Completion?
        lock.lock()
        if terminalResult == nil {
            if chunk.isEmpty {
                completion = finishLocked(
                    .failure(DashboardLaunchFailure.invalidReadiness)
                )
            } else if let newline = chunk.firstIndex(of: 0x0A) {
                let prefix = chunk[..<newline]
                if prefix.count > Self.maximumBytes - buffer.count {
                    completion = finishLocked(
                        .failure(DashboardLaunchFailure.invalidReadiness)
                    )
                } else {
                    buffer.append(contentsOf: prefix)
                    completion = finishLocked(
                        buffer.isEmpty
                            ? .failure(
                                DashboardLaunchFailure.invalidReadiness
                            )
                            : .success(buffer)
                    )
                }
            } else if chunk.count > Self.maximumBytes - buffer.count {
                completion = finishLocked(
                    .failure(DashboardLaunchFailure.invalidReadiness)
                )
            } else {
                buffer.append(chunk)
            }
        }
        lock.unlock()
        deliver(completion)
    }

    private func resolve(_ result: Result<Data, any Error>) {
        lock.lock()
        let completion = finishLocked(result)
        lock.unlock()
        deliver(completion)
    }

    func cancel() {
        resolve(.failure(CancellationError()))
    }

    private func finishLocked(
        _ result: Result<Data, any Error>
    ) -> Completion? {
        guard terminalResult == nil else {
            return nil
        }
        terminalResult = result
        let completion = Completion(
            continuation: continuation,
            result: result,
            handle: handle,
            timeoutTask: timeoutTask
        )
        continuation = nil
        handle = nil
        timeoutTask = nil
        return completion
    }

    private func deliver(_ completion: Completion?) {
        guard let completion else {
            return
        }
        completion.handle?.readabilityHandler = nil
        completion.timeoutTask?.cancel()
        completion.continuation?.resume(with: completion.result)
    }
}

@MainActor
final class DashboardSupervisor {
    private static let gracefulStopTimeout: TimeInterval = 0.25
    private static let forcedStopTimeout: TimeInterval = 0.25
    nonisolated private static let stopPollInterval: TimeInterval = 0.005

    private var process: Process?
    private var inputPipe: Pipe?
    private var outputPipe: Pipe?
    private var readinessReader: ReadyLineReader?

    var isRunning: Bool {
        process?.isRunning == true
    }

    var processIdentifier: Int32? {
        guard let process, process.isRunning else {
            return nil
        }
        return process.processIdentifier
    }

    func start(
        configuration: DashboardLaunchConfiguration
    ) async throws -> DashboardEndpoint {
        stop()
        guard process == nil else {
            throw DashboardLaunchFailure.launchFailed
        }

        let process = Process()
        let inputPipe = Pipe()
        let outputPipe = Pipe()
        process.executableURL = configuration.nodeURL
        process.arguments = [
            configuration.workerEntrypoint.path,
            "dashboard",
            "--port",
            "0",
            "--json",
        ]
        process.currentDirectoryURL = configuration.workingDirectory
        process.standardInput = inputPipe
        process.standardOutput = outputPipe
        process.standardError = FileHandle.nullDevice
        var workerEnvironment = Self.workerEnvironment(
            from: ProcessInfo.processInfo.environment
        )
        for (key, value) in configuration.environment
        where key.hasPrefix("AGENT_WASTE_FIREWALL_") {
            workerEnvironment[key] = value
        }
        workerEnvironment[
            "AGENT_WASTE_FIREWALL_PARENT_LIFELINE"
        ] = "1"
        process.environment = workerEnvironment

        do {
            try process.run()
        } catch {
            try? inputPipe.fileHandleForReading.close()
            try? inputPipe.fileHandleForWriting.close()
            try? outputPipe.fileHandleForReading.close()
            try? outputPipe.fileHandleForWriting.close()
            throw DashboardLaunchFailure.launchFailed
        }
        try? inputPipe.fileHandleForReading.close()
        try? outputPipe.fileHandleForWriting.close()
        self.process = process
        self.inputPipe = inputPipe
        self.outputPipe = outputPipe
        let readinessReader = ReadyLineReader()
        self.readinessReader = readinessReader
        defer {
            if self.readinessReader === readinessReader {
                self.readinessReader = nil
            }
        }

        do {
            let data = try await readinessReader.read(
                from: outputPipe.fileHandleForReading
            )
            guard !Task.isCancelled, self.process === process else {
                throw CancellationError()
            }
            let endpoint = try DashboardEndpoint(readyData: data)
            guard endpoint.source == .live else {
                throw PresentationProtocolError.invalidReady
            }
            Self.discardFutureOutput(
                from: outputPipe.fileHandleForReading
            )
            return endpoint
        } catch is CancellationError {
            stop(expectedProcess: process)
            throw CancellationError()
        } catch let failure as DashboardLaunchFailure {
            stop(expectedProcess: process)
            throw failure
        } catch {
            stop(expectedProcess: process)
            throw DashboardLaunchFailure.invalidReadiness
        }
    }

    func stop() {
        stop(expectedProcess: nil)
    }

    private func stop(expectedProcess: Process?) {
        if let expectedProcess, process !== expectedProcess {
            return
        }
        let processToStop = process
        let readerToCancel = readinessReader
        let inputPipeToClose = inputPipe
        let pipeToClose = outputPipe
        readinessReader = nil
        inputPipe = nil
        outputPipe = nil

        readerToCancel?.cancel()
        pipeToClose?.fileHandleForReading.readabilityHandler = nil
        try? inputPipeToClose?.fileHandleForWriting.close()
        if processToStop?.isRunning == true {
            Self.waitForExit(
                processToStop,
                timeout: Self.gracefulStopTimeout
            )
        }
        if processToStop?.isRunning == true {
            processToStop?.terminate()
            Self.waitForExit(
                processToStop,
                timeout: Self.gracefulStopTimeout
            )
        }
        if let processToStop, processToStop.isRunning {
            Darwin.kill(processToStop.processIdentifier, SIGKILL)
            Self.waitForExit(
                processToStop,
                timeout: Self.forcedStopTimeout
            )
        }
        try? inputPipeToClose?.fileHandleForReading.close()
        try? pipeToClose?.fileHandleForReading.close()
        try? pipeToClose?.fileHandleForWriting.close()
        if process === processToStop, processToStop?.isRunning != true {
            process = nil
        }
    }

    private nonisolated static func waitForExit(
        _ process: Process?,
        timeout: TimeInterval
    ) {
        guard let process else {
            return
        }
        let deadline = Date().addingTimeInterval(timeout)
        while process.isRunning && Date() < deadline {
            Thread.sleep(forTimeInterval: stopPollInterval)
        }
    }

    private nonisolated static func discardFutureOutput(
        from handle: FileHandle
    ) {
        handle.readabilityHandler = { readableHandle in
            if readableHandle.availableData.isEmpty {
                readableHandle.readabilityHandler = nil
            }
        }
    }

    nonisolated static func workerEnvironment(
        from environment: [String: String]
    ) -> [String: String] {
        let bundledCodexDirectory =
            "/Applications/ChatGPT.app/Contents/Resources"
        let exactKeys = [
            "HOME",
            "TMPDIR",
            "LANG",
            "LC_ALL",
            "TZ",
            "CODEX_HOME",
            "CLAUDE_CONFIG_DIR",
            "XDG_CONFIG_HOME",
        ]
        var result = Dictionary(
            uniqueKeysWithValues: exactKeys.compactMap { key in
                environment[key].map { (key, $0) }
            }
        )
        var providerDirectories = [
            bundledCodexDirectory,
            "/opt/homebrew/bin",
            "/usr/local/bin",
        ]
        if let home = environment["HOME"],
           home.hasPrefix("/"),
           !home.contains(":") {
            let homeURL = URL(
                fileURLWithPath: home,
                isDirectory: true
            ).standardizedFileURL
            providerDirectories.append(
                homeURL.appendingPathComponent(
                    ".local/bin",
                    isDirectory: true
                ).path
            )
            providerDirectories.append(
                homeURL.appendingPathComponent(
                    ".npm-global/bin",
                    isDirectory: true
                ).path
            )
            providerDirectories.append(
                homeURL.appendingPathComponent(
                    ".volta/bin",
                    isDirectory: true
                ).path
            )
        }
        providerDirectories.append(contentsOf: ["/usr/bin", "/bin"])
        result["PATH"] = providerDirectories.joined(separator: ":")
        for (key, value) in environment
        where key.hasPrefix("AGENT_WASTE_FIREWALL_") {
            result[key] = value
        }
        return result
    }
}

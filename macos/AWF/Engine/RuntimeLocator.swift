import Darwin
import Foundation

enum DashboardLaunchFailure: String, Error, Sendable {
    case nodeUnavailable
    case workerUnavailable
    case launchFailed
    case readinessTimedOut
    case invalidReadiness
}

struct DashboardLaunchConfiguration: Equatable, Sendable {
    let nodeURL: URL
    let workerEntrypoint: URL
    let workingDirectory: URL
    let environment: [String: String]

    init(
        nodeURL: URL,
        workerEntrypoint: URL,
        workingDirectory: URL,
        environment: [String: String] = [:]
    ) {
        self.nodeURL = nodeURL
        self.workerEntrypoint = workerEntrypoint
        self.workingDirectory = workingDirectory
        self.environment = environment
    }
}

enum RuntimeLocator {
    static let minimumNodeMajorVersion = 18

    static func locate(
        bundle: Bundle = .main,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        currentDirectory: URL = URL(
            fileURLWithPath: FileManager.default.currentDirectoryPath,
            isDirectory: true
        )
    ) throws -> DashboardLaunchConfiguration {
        guard let nodeURL = locateNode(environment: environment) else {
            throw DashboardLaunchFailure.nodeUnavailable
        }
        guard
            let workerEntrypoint = locateWorker(
                bundle: bundle,
                environment: environment,
                currentDirectory: currentDirectory
            )
        else {
            throw DashboardLaunchFailure.workerUnavailable
        }
        return DashboardLaunchConfiguration(
            nodeURL: nodeURL,
            workerEntrypoint: workerEntrypoint,
            workingDirectory: workerEntrypoint
                .deletingLastPathComponent()
                .deletingLastPathComponent()
        )
    }

    static func locateNode(
        environment: [String: String],
        fileManager: FileManager = .default
    ) -> URL? {
        var candidates: [URL] = []
        if let override = environment["AWF_NODE_PATH"], override.hasPrefix("/") {
            candidates.append(URL(fileURLWithPath: override))
        }
        candidates.append(
            contentsOf: [
                "/opt/homebrew/bin/node",
                "/usr/local/bin/node",
                "/usr/bin/node",
            ].map { URL(fileURLWithPath: $0) }
        )
        if let path = environment["PATH"] {
            candidates.append(
                contentsOf: path.split(separator: ":").compactMap {
                    let directory = String($0)
                    guard directory.hasPrefix("/") else {
                        return nil
                    }
                    return URL(
                        fileURLWithPath: directory,
                        isDirectory: true
                    ).appendingPathComponent("node")
                }
            )
        }
        var seen = Set<String>()
        for candidate in candidates {
            guard let resolved = resolveRegularFile(
                candidate,
                mustBeExecutable: true,
                fileManager: fileManager
            ), seen.insert(resolved.path).inserted,
               supportedNodeMajorVersion(at: resolved) != nil else {
                continue
            }
            return resolved
        }
        return nil
    }

    static func supportedNodeMajorVersion(
        at executableURL: URL,
        timeout: TimeInterval = 2
    ) -> Int? {
        guard timeout > 0 else {
            return nil
        }

        let process = Process()
        let output = Pipe()
        let exited = DispatchSemaphore(value: 0)
        process.executableURL = executableURL
        process.arguments = ["--version"]
        process.environment = ["PATH": "/usr/bin:/bin"]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { _ in
            exited.signal()
        }

        do {
            try process.run()
            try? output.fileHandleForWriting.close()
        } catch {
            try? output.fileHandleForReading.close()
            try? output.fileHandleForWriting.close()
            return nil
        }

        guard exited.wait(timeout: .now() + timeout) == .success else {
            stopVersionProbe(process, exited: exited)
            try? output.fileHandleForReading.close()
            return nil
        }
        guard process.terminationStatus == 0 else {
            try? output.fileHandleForReading.close()
            return nil
        }

        let data = output.fileHandleForReading.readDataToEndOfFile()
        try? output.fileHandleForReading.close()
        guard
            data.count <= 64,
            let value = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
            value.first == "v",
            let dot = value.firstIndex(of: ".")
        else {
            return nil
        }

        let majorText = value[value.index(after: value.startIndex)..<dot]
        guard
            !majorText.isEmpty,
            majorText.allSatisfy(\.isNumber),
            let major = Int(majorText),
            major >= minimumNodeMajorVersion
        else {
            return nil
        }
        return major
    }

    static func locateWorker(
        bundle: Bundle,
        environment: [String: String],
        currentDirectory: URL,
        fileManager: FileManager = .default
    ) -> URL? {
        var candidates: [URL] = []
        if let override = environment["AWF_WORKER_ENTRYPOINT"],
           override.hasPrefix("/") {
            candidates.append(URL(fileURLWithPath: override))
        }
        if let resources = bundle.resourceURL {
            candidates.append(
                resources
                    .appendingPathComponent("bin", isDirectory: true)
                    .appendingPathComponent("agent-waste-firewall.mjs")
            )
        }
        var directory = currentDirectory.standardizedFileURL
        for _ in 0..<8 {
            candidates.append(
                directory
                    .appendingPathComponent("bin", isDirectory: true)
                    .appendingPathComponent("agent-waste-firewall.mjs")
            )
            let parent = directory.deletingLastPathComponent()
            if parent == directory {
                break
            }
            directory = parent
        }
        var seen = Set<String>()
        for candidate in candidates {
            guard let resolved = resolveRegularFile(
                candidate,
                mustBeExecutable: false,
                fileManager: fileManager
            ), seen.insert(resolved.path).inserted else {
                continue
            }
            return resolved
        }
        return nil
    }

    private static func resolveRegularFile(
        _ candidate: URL,
        mustBeExecutable: Bool,
        fileManager: FileManager
    ) -> URL? {
        guard candidate.isFileURL, candidate.path.hasPrefix("/") else {
            return nil
        }
        let resolved = candidate
            .standardizedFileURL
            .resolvingSymlinksInPath()
        guard
            resolved.isFileURL,
            resolved.path.hasPrefix("/"),
            let attributes = try? fileManager.attributesOfItem(
                atPath: resolved.path
            ),
            attributes[.type] as? FileAttributeType == .typeRegular,
            !mustBeExecutable ||
                fileManager.isExecutableFile(atPath: resolved.path)
        else {
            return nil
        }
        return resolved
    }

    private static func stopVersionProbe(
        _ process: Process,
        exited: DispatchSemaphore
    ) {
        if process.isRunning {
            process.terminate()
        }
        guard
            exited.wait(timeout: .now() + 0.1) == .timedOut,
            process.isRunning
        else {
            return
        }
        Darwin.kill(process.processIdentifier, SIGKILL)
        _ = exited.wait(timeout: .now() + 0.1)
    }
}

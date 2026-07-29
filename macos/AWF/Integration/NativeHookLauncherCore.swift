import Darwin
import Foundation

enum NativeHookLaunchFailure: Error {
    case invalidArguments
    case invalidActivation
    case unsafeFilesystemEntry
    case runtimeUnavailable
    case workerUnavailable
    case launchFailed
}

enum NativeHookProvider: String, Equatable, Sendable {
    case codex
    case claude
}

struct NativeHookActivation: Equatable, Sendable {
    static let workerProtocol = 1
    static let maximumBytes = 128

    let releaseID: String

    static func parse(_ data: Data) throws -> Self {
        guard
            !data.isEmpty,
            data.count <= maximumBytes,
            let source = String(data: data, encoding: .utf8)
        else {
            throw NativeHookLaunchFailure.invalidActivation
        }

        let prefix = #"{"v":1,"releaseId":""#
        let suffix = "\",\"workerProtocol\":1}\n"
        guard
            source.hasPrefix(prefix),
            source.hasSuffix(suffix)
        else {
            throw NativeHookLaunchFailure.invalidActivation
        }

        let releaseStart = source.index(
            source.startIndex,
            offsetBy: prefix.count
        )
        let releaseEnd = source.index(
            source.endIndex,
            offsetBy: -suffix.count
        )
        let releaseID = String(source[releaseStart..<releaseEnd])
        guard
            releaseID.count == 36,
            releaseID.hasPrefix("rel_"),
            releaseID.dropFirst(4).utf8.allSatisfy({
                (48...57).contains($0) || (97...102).contains($0)
            }),
            source == canonicalSource(releaseID: releaseID)
        else {
            throw NativeHookLaunchFailure.invalidActivation
        }
        return Self(releaseID: releaseID)
    }

    static func canonicalSource(releaseID: String) -> String {
        """
        {"v":1,"releaseId":"\(releaseID)","workerProtocol":\(workerProtocol)}
        """
        + "\n"
    }
}

struct NativeHookLaunchPlan: Equatable, Sendable {
    static let protocolVersion = "1"
    static let activationFilename = "activation.json"
    static let versionsDirectoryName = "versions"
    static let runtimeFilename = "awf-node"

    let runtimeURL: URL
    let workerURL: URL
    let workingDirectoryURL: URL
    let environment: [String: String]
    let runtimeIdentity: NativeHookFilesystem.Identity
    let workerIdentity: NativeHookFilesystem.Identity
    let workingDirectoryIdentity: NativeHookFilesystem.Identity
    let scriptsDirectoryIdentity: NativeHookFilesystem.Identity

    static func resolve(
        arguments: [String],
        executableURL: URL,
        environment: [String: String]
    ) throws -> Self {
        guard
            arguments.count == 7,
            arguments[0] == "hook",
            arguments[1] == "--protocol",
            arguments[2] == protocolVersion,
            arguments[3] == "--provider",
            let provider = NativeHookProvider(rawValue: arguments[4]),
            arguments[5] == "--plugin-root",
            arguments[6].hasPrefix("/")
        else {
            throw NativeHookLaunchFailure.invalidArguments
        }

        let integrationRoot = executableURL
            .standardizedFileURL
            .deletingLastPathComponent()
        try NativeHookFilesystem.requireSecureDirectory(
            integrationRoot,
            allowRootOwner: false
        )

        let activationData = try NativeHookFilesystem.readSecureFile(
            integrationRoot.appendingPathComponent(activationFilename),
            maximumBytes: NativeHookActivation.maximumBytes,
            allowRootOwner: false
        )
        let activation = try NativeHookActivation.parse(activationData)

        let versions = integrationRoot.appendingPathComponent(
            versionsDirectoryName,
            isDirectory: true
        )
        try NativeHookFilesystem.requireSecureDirectory(
            versions,
            allowRootOwner: false
        )
        let release = versions.appendingPathComponent(
            activation.releaseID,
            isDirectory: true
        )
        try NativeHookFilesystem.requireSecureDirectory(
            release,
            allowRootOwner: false
        )
        let runtime = release.appendingPathComponent(runtimeFilename)
        let runtimeIdentity = try NativeHookFilesystem.requireSecureRegularFile(
            runtime,
            executable: true,
            allowRootOwner: false
        )

        let pluginRoot = URL(
            fileURLWithPath: arguments[6],
            isDirectory: true
        ).standardizedFileURL
        let workingDirectoryIdentity: NativeHookFilesystem.Identity
        let scriptsDirectoryIdentity: NativeHookFilesystem.Identity
        let workerIdentity: NativeHookFilesystem.Identity
        let scripts = pluginRoot.appendingPathComponent(
            "scripts",
            isDirectory: true
        ).standardizedFileURL
        let worker = scripts
            .appendingPathComponent("hook.mjs")
            .standardizedFileURL
        do {
            guard
                scripts.deletingLastPathComponent().path == pluginRoot.path,
                worker.deletingLastPathComponent().path == scripts.path,
                worker.path.hasPrefix(pluginRoot.path + "/")
            else {
                throw NativeHookLaunchFailure.workerUnavailable
            }
            workingDirectoryIdentity =
                try NativeHookFilesystem.requireSecureDirectory(
                    pluginRoot,
                    allowRootOwner: true
                )
            scriptsDirectoryIdentity =
                try NativeHookFilesystem.requireSecureDirectory(
                    scripts,
                    allowRootOwner: true
                )
            workerIdentity =
                try NativeHookFilesystem.requireSecureRegularFile(
                    worker,
                    executable: false,
                    allowRootOwner: true
                )
        } catch {
            throw NativeHookLaunchFailure.workerUnavailable
        }

        return Self(
            runtimeURL: runtime,
            workerURL: worker,
            workingDirectoryURL: pluginRoot,
            environment: workerEnvironment(
                from: environment,
                provider: provider
            ),
            runtimeIdentity: runtimeIdentity,
            workerIdentity: workerIdentity,
            workingDirectoryIdentity: workingDirectoryIdentity,
            scriptsDirectoryIdentity: scriptsDirectoryIdentity
        )
    }

    static func workerEnvironment(
        from environment: [String: String],
        provider: NativeHookProvider
    ) -> [String: String] {
        let allowedKeys = [
            "HOME",
            "TMPDIR",
            "LANG",
            "LC_ALL",
            "TZ",
            "AGENT_WASTE_FIREWALL_MODE",
            "AGENT_WASTE_FIREWALL_DATA_DIR",
            "AGENT_WASTE_FIREWALL_PROMPT_BLOCK_SCORE",
            "AGENT_WASTE_FIREWALL_REPEAT_WARN_AT",
            "AGENT_WASTE_FIREWALL_HIGH_COST_REPEAT_WARN_AT",
            "AGENT_WASTE_FIREWALL_REPEAT_BLOCK_AT",
            "AGENT_WASTE_FIREWALL_READ_WARN_AT",
            "AGENT_WASTE_FIREWALL_WAIT_WARN_AT",
            "AGENT_WASTE_FIREWALL_WAIT_BLOCK_AT",
            "AGENT_WASTE_FIREWALL_FAILED_ATTEMPTS_BEFORE_BLOCK",
            "AGENT_WASTE_FIREWALL_MAX_TOOL_EVENTS",
            "AGENT_WASTE_FIREWALL_MAX_INCIDENTS",
            "AGENT_WASTE_FIREWALL_LIVE_MAX_EVENTS",
            "AGENT_WASTE_FIREWALL_LIVE_MAX_BYTES",
            "AGENT_WASTE_FIREWALL_LIVE_MAX_AGE_MINUTES",
            "AGENT_WASTE_FIREWALL_RETENTION_DAYS",
        ]
        var result = Dictionary(
            uniqueKeysWithValues: allowedKeys.compactMap { key in
                environment[key].map { (key, $0) }
            }
        )
        result["PATH"] = "/usr/bin:/bin"
        result["AGENT_WASTE_FIREWALL_PLATFORM"] = provider.rawValue
        return result
    }

    func revalidateForLaunch() throws {
        try NativeHookFilesystem.requireSameSecureDirectory(
            workingDirectoryURL,
            expected: workingDirectoryIdentity,
            allowRootOwner: true
        )
        let scripts = workerURL.deletingLastPathComponent()
        try NativeHookFilesystem.requireSameSecureDirectory(
            scripts,
            expected: scriptsDirectoryIdentity,
            allowRootOwner: true
        )
        try NativeHookFilesystem.requireSameSecureRegularFile(
            runtimeURL,
            expected: runtimeIdentity,
            executable: true,
            allowRootOwner: false
        )
        try NativeHookFilesystem.requireSameSecureRegularFile(
            workerURL,
            expected: workerIdentity,
            executable: false,
            allowRootOwner: true
        )
    }
}

enum NativeHookFilesystem {
    struct Identity: Equatable, Sendable {
        let device: UInt64
        let inode: UInt64
    }

    @discardableResult
    static func requireSecureDirectory(
        _ url: URL,
        allowRootOwner: Bool
    ) throws -> Identity {
        let status = try fileStatus(at: url)
        guard (status.st_mode & S_IFMT) == S_IFDIR else {
            throw NativeHookLaunchFailure.unsafeFilesystemEntry
        }
        try requireSecureOwnershipAndMode(
            status,
            allowRootOwner: allowRootOwner
        )
        return identity(for: status)
    }

    @discardableResult
    static func requireSecureRegularFile(
        _ url: URL,
        executable: Bool,
        allowRootOwner: Bool
    ) throws -> Identity {
        let status = try fileStatus(at: url)
        guard
            (status.st_mode & S_IFMT) == S_IFREG,
            !executable || access(url.path, X_OK) == 0
        else {
            throw NativeHookLaunchFailure.unsafeFilesystemEntry
        }
        try requireSecureOwnershipAndMode(
            status,
            allowRootOwner: allowRootOwner
        )
        return identity(for: status)
    }

    static func requireSameSecureDirectory(
        _ url: URL,
        expected: Identity,
        allowRootOwner: Bool
    ) throws {
        let actual = try requireSecureDirectory(
            url,
            allowRootOwner: allowRootOwner
        )
        guard actual == expected else {
            throw NativeHookLaunchFailure.unsafeFilesystemEntry
        }
    }

    static func requireSameSecureRegularFile(
        _ url: URL,
        expected: Identity,
        executable: Bool,
        allowRootOwner: Bool
    ) throws {
        let actual = try requireSecureRegularFile(
            url,
            executable: executable,
            allowRootOwner: allowRootOwner
        )
        guard actual == expected else {
            throw NativeHookLaunchFailure.unsafeFilesystemEntry
        }
    }

    static func readSecureFile(
        _ url: URL,
        maximumBytes: Int,
        allowRootOwner: Bool
    ) throws -> Data {
        guard maximumBytes > 0 else {
            throw NativeHookLaunchFailure.unsafeFilesystemEntry
        }
        let descriptor = url.path.withCString {
            Darwin.open($0, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        }
        guard descriptor >= 0 else {
            throw NativeHookLaunchFailure.unsafeFilesystemEntry
        }
        defer {
            Darwin.close(descriptor)
        }

        var status = stat()
        guard
            fstat(descriptor, &status) == 0,
            (status.st_mode & S_IFMT) == S_IFREG,
            status.st_size > 0,
            status.st_size <= maximumBytes
        else {
            throw NativeHookLaunchFailure.unsafeFilesystemEntry
        }
        try requireSecureOwnershipAndMode(
            status,
            allowRootOwner: allowRootOwner
        )

        var bytes = [UInt8](
            repeating: 0,
            count: Int(status.st_size)
        )
        var offset = 0
        while offset < bytes.count {
            let remaining = bytes.count - offset
            let count = bytes.withUnsafeMutableBytes { buffer in
                Darwin.read(
                    descriptor,
                    buffer.baseAddress?.advanced(by: offset),
                    remaining
                )
            }
            if count < 0, errno == EINTR {
                continue
            }
            guard count > 0 else {
                throw NativeHookLaunchFailure.unsafeFilesystemEntry
            }
            offset += count
        }
        return Data(bytes)
    }

    private static func fileStatus(at url: URL) throws -> stat {
        guard url.isFileURL, url.path.hasPrefix("/") else {
            throw NativeHookLaunchFailure.unsafeFilesystemEntry
        }
        var status = stat()
        guard lstat(url.path, &status) == 0 else {
            throw NativeHookLaunchFailure.unsafeFilesystemEntry
        }
        return status
    }

    private static func requireSecureOwnershipAndMode(
        _ status: stat,
        allowRootOwner: Bool
    ) throws {
        let ownerAllowed =
            status.st_uid == geteuid() ||
            (allowRootOwner && status.st_uid == 0)
        guard
            ownerAllowed,
            status.st_mode & (S_IWGRP | S_IWOTH) == 0
        else {
            throw NativeHookLaunchFailure.unsafeFilesystemEntry
        }
    }

    private static func identity(for status: stat) -> Identity {
        Identity(
            device: UInt64(status.st_dev),
            inode: UInt64(status.st_ino)
        )
    }
}

private final class NativeHookCStringVector {
    private var pointers: [UnsafeMutablePointer<CChar>?]

    init(_ values: [String]) throws {
        pointers = []
        pointers.reserveCapacity(values.count + 1)
        for value in values {
            guard
                !value.utf8.contains(0),
                let pointer = strdup(value)
            else {
                for pointer in pointers {
                    free(pointer)
                }
                throw NativeHookLaunchFailure.launchFailed
            }
            pointers.append(pointer)
        }
        pointers.append(nil)
    }

    deinit {
        for pointer in pointers {
            free(pointer)
        }
    }

    func withUnsafeMutableBufferPointer<Result>(
        _ body: (
            UnsafeMutableBufferPointer<UnsafeMutablePointer<CChar>?>
        ) throws -> Result
    ) rethrows -> Result {
        try pointers.withUnsafeMutableBufferPointer { buffer in
            try body(buffer)
        }
    }
}

private enum NativeHookChildOutcome {
    case clean
    case failed
}

private final class NativeHookSpawnedChild {
    static let defaultDeadlineNanoseconds =
        NativeHookLauncher.childDeadlineNanoseconds
    static let terminationGraceNanoseconds: UInt64 = 150_000_000
    private static let pollNanoseconds: UInt64 = 5_000_000

    private let processID: pid_t
    private var observedSignals: sigset_t
    private var previousSignalMask: sigset_t
    private var signalMaskInstalled = true
    private var reaped = false

    private init(
        processID: pid_t,
        observedSignals: sigset_t,
        previousSignalMask: sigset_t
    ) {
        self.processID = processID
        self.observedSignals = observedSignals
        self.previousSignalMask = previousSignalMask
    }

    deinit {
        if !reaped {
            terminateProcessGroup(signal: SIGKILL)
            reapBlocking()
        }
        restoreSignalMask()
    }

    static func launch(_ plan: NativeHookLaunchPlan) throws -> Self {
        try plan.revalidateForLaunch()

        var observedSignals = sigset_t()
        sigemptyset(&observedSignals)
        sigaddset(&observedSignals, SIGTERM)
        sigaddset(&observedSignals, SIGINT)
        sigaddset(&observedSignals, SIGHUP)
        var previousSignalMask = sigset_t()
        guard pthread_sigmask(
            SIG_BLOCK,
            &observedSignals,
            &previousSignalMask
        ) == 0 else {
            throw NativeHookLaunchFailure.launchFailed
        }
        var restoreMaskOnFailure = true
        defer {
            if restoreMaskOnFailure {
                pthread_sigmask(
                    SIG_SETMASK,
                    &previousSignalMask,
                    nil
                )
            }
        }

        var attributes: posix_spawnattr_t?
        guard posix_spawnattr_init(&attributes) == 0 else {
            throw NativeHookLaunchFailure.launchFailed
        }
        defer {
            posix_spawnattr_destroy(&attributes)
        }

        var childSignalMask = sigset_t()
        sigemptyset(&childSignalMask)
        var defaultSignals = observedSignals
        let flags = Int16(
            POSIX_SPAWN_SETPGROUP |
                POSIX_SPAWN_SETSIGMASK |
                POSIX_SPAWN_SETSIGDEF
        )
        guard
            posix_spawnattr_setflags(&attributes, flags) == 0,
            posix_spawnattr_setpgroup(&attributes, 0) == 0,
            posix_spawnattr_setsigmask(
                &attributes,
                &childSignalMask
            ) == 0,
            posix_spawnattr_setsigdefault(
                &attributes,
                &defaultSignals
            ) == 0
        else {
            throw NativeHookLaunchFailure.launchFailed
        }

        var fileActions: posix_spawn_file_actions_t?
        guard posix_spawn_file_actions_init(&fileActions) == 0 else {
            throw NativeHookLaunchFailure.launchFailed
        }
        defer {
            posix_spawn_file_actions_destroy(&fileActions)
        }
        let chdirStatus = plan.workingDirectoryURL.path.withCString {
            posix_spawn_file_actions_addchdir_np(&fileActions, $0)
        }
        guard chdirStatus == 0 else {
            throw NativeHookLaunchFailure.launchFailed
        }

        let arguments = try NativeHookCStringVector([
            plan.runtimeURL.path,
            plan.workerURL.path,
        ])
        let environment = try NativeHookCStringVector(
            plan.environment
                .sorted { $0.key < $1.key }
                .map { "\($0.key)=\($0.value)" }
        )
        var spawnedProcessID: pid_t = 0
        let spawnStatus = arguments.withUnsafeMutableBufferPointer {
            argumentBuffer in
            environment.withUnsafeMutableBufferPointer {
                environmentBuffer in
                plan.runtimeURL.path.withCString { executable in
                    posix_spawn(
                        &spawnedProcessID,
                        executable,
                        &fileActions,
                        &attributes,
                        argumentBuffer.baseAddress,
                        environmentBuffer.baseAddress
                    )
                }
            }
        }
        guard spawnStatus == 0, spawnedProcessID > 0 else {
            throw NativeHookLaunchFailure.launchFailed
        }

        restoreMaskOnFailure = false
        return Self(
            processID: spawnedProcessID,
            observedSignals: observedSignals,
            previousSignalMask: previousSignalMask
        )
    }

    func wait(
        deadlineNanoseconds: UInt64 = defaultDeadlineNanoseconds,
        graceNanoseconds: UInt64 = terminationGraceNanoseconds
    ) -> NativeHookChildOutcome {
        defer {
            restoreSignalMask()
        }

        let startedAt = Self.monotonicNanoseconds()
        let deadline = startedAt &+ deadlineNanoseconds
        var terminationStartedAt: UInt64?
        var wasInterrupted = false
        var waitStatus: Int32 = 0

        while true {
            let waitResult = waitpid(processID, &waitStatus, WNOHANG)
            if waitResult == processID {
                reaped = true
                cleanupRemainingProcessGroup(
                    graceNanoseconds: graceNanoseconds
                )
                return !wasInterrupted && waitStatus == 0
                    ? .clean
                    : .failed
            }
            if waitResult < 0, errno != EINTR {
                wasInterrupted = true
                terminateProcessGroup(signal: SIGKILL)
                reapBlocking()
                cleanupRemainingProcessGroup(graceNanoseconds: 0)
                return .failed
            }

            let now = Self.monotonicNanoseconds()
            while let forwardedSignal = nextPendingSignal() {
                wasInterrupted = true
                terminateProcessGroup(signal: forwardedSignal)
                if terminationStartedAt == nil {
                    terminationStartedAt = now
                }
            }

            if terminationStartedAt == nil, now >= deadline {
                wasInterrupted = true
                terminateProcessGroup(signal: SIGTERM)
                terminationStartedAt = now
            } else if let terminationStartedAt,
                now &- terminationStartedAt >= graceNanoseconds
            {
                terminateProcessGroup(signal: SIGKILL)
                reapBlocking()
                cleanupRemainingProcessGroup(graceNanoseconds: 0)
                return .failed
            }

            Self.sleep(nanoseconds: Self.pollNanoseconds)
        }
    }

    private func nextPendingSignal() -> Int32? {
        var pendingSignals = sigset_t()
        guard sigpending(&pendingSignals) == 0 else {
            return nil
        }
        let hasObservedSignal =
            sigismember(&pendingSignals, SIGTERM) == 1 ||
            sigismember(&pendingSignals, SIGINT) == 1 ||
            sigismember(&pendingSignals, SIGHUP) == 1
        guard hasObservedSignal else {
            return nil
        }
        var signal: Int32 = 0
        guard sigwait(&observedSignals, &signal) == 0 else {
            return nil
        }
        return signal
    }

    private func terminateProcessGroup(signal: Int32) {
        if kill(-processID, signal) != 0, errno == ESRCH {
            _ = kill(processID, signal)
        }
    }

    private func reapBlocking() {
        guard !reaped else {
            return
        }
        var waitStatus: Int32 = 0
        while true {
            let waitResult = waitpid(processID, &waitStatus, 0)
            if waitResult == processID || (waitResult < 0 && errno == ECHILD) {
                reaped = true
                return
            }
            if waitResult < 0, errno != EINTR {
                return
            }
        }
    }

    private func cleanupRemainingProcessGroup(
        graceNanoseconds: UInt64
    ) {
        guard processGroupExists() else {
            return
        }
        terminateProcessGroup(signal: SIGTERM)
        let deadline = Self.monotonicNanoseconds() &+ graceNanoseconds
        while
            graceNanoseconds > 0,
            processGroupExists(),
            Self.monotonicNanoseconds() < deadline
        {
            Self.sleep(nanoseconds: Self.pollNanoseconds)
        }
        if processGroupExists() {
            terminateProcessGroup(signal: SIGKILL)
        }
    }

    private func processGroupExists() -> Bool {
        if kill(-processID, 0) == 0 {
            return true
        }
        return errno == EPERM
    }

    private func restoreSignalMask() {
        guard signalMaskInstalled else {
            return
        }
        pthread_sigmask(SIG_SETMASK, &previousSignalMask, nil)
        signalMaskInstalled = false
    }

    private static func monotonicNanoseconds() -> UInt64 {
        var timestamp = timespec()
        guard clock_gettime(CLOCK_MONOTONIC, &timestamp) == 0 else {
            return 0
        }
        return UInt64(timestamp.tv_sec) * 1_000_000_000
            + UInt64(timestamp.tv_nsec)
    }

    private static func sleep(nanoseconds: UInt64) {
        var request = timespec(
            tv_sec: Int(nanoseconds / 1_000_000_000),
            tv_nsec: Int(nanoseconds % 1_000_000_000)
        )
        var remaining = timespec()
        while nanosleep(&request, &remaining) != 0, errno == EINTR {
            request = remaining
        }
    }
}

enum NativeHookLauncher {
    static let childDeadlineNanoseconds: UInt64 = 2_250_000_000
    static let failOpenWarning =
        "AWF native hook failed open: this event was not checked.\n"
    static let failOpenResponse = "{}\n"

    static func run(
        arguments: [String],
        executableURL: URL,
        environment: [String: String]
    ) -> Int32 {
        let plan: NativeHookLaunchPlan
        do {
            plan = try NativeHookLaunchPlan.resolve(
                arguments: arguments,
                executableURL: executableURL,
                environment: environment
            )
        } catch {
            writeFixed(failOpenWarning, descriptor: STDERR_FILENO)
            writeFixed(failOpenResponse, descriptor: STDOUT_FILENO)
            return 0
        }

        let child: NativeHookSpawnedChild
        do {
            child = try NativeHookSpawnedChild.launch(plan)
        } catch {
            writeFixed(failOpenWarning, descriptor: STDERR_FILENO)
            writeFixed(failOpenResponse, descriptor: STDOUT_FILENO)
            return 0
        }

        if child.wait() != .clean {
            // The worker may already have emitted a response. Never append a
            // second JSON value after handing stdin to it.
            writeFixed(failOpenWarning, descriptor: STDERR_FILENO)
        }
        return 0
    }

    static func resolvedExecutableURL(
        argumentZero: String,
        currentDirectory: URL = URL(
            fileURLWithPath: FileManager.default.currentDirectoryPath,
            isDirectory: true
        )
    ) -> URL {
        let candidate = argumentZero.hasPrefix("/")
            ? URL(fileURLWithPath: argumentZero)
            : currentDirectory.appendingPathComponent(argumentZero)
        return candidate
            .standardizedFileURL
            .resolvingSymlinksInPath()
    }

    private static func writeFixed(
        _ value: String,
        descriptor: Int32
    ) {
        let bytes = Array(value.utf8)
        var offset = 0
        while offset < bytes.count {
            let written = bytes.withUnsafeBytes { buffer in
                Darwin.write(
                    descriptor,
                    buffer.baseAddress?.advanced(by: offset),
                    bytes.count - offset
                )
            }
            if written < 0, errno == EINTR {
                continue
            }
            guard written > 0 else {
                return
            }
            offset += written
        }
    }
}

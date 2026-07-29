import Darwin
import Foundation
import XCTest
@testable import AWF

final class NativeHookLauncherTests: XCTestCase {
    private var temporaryDirectory: URL!

    override func setUpWithError() throws {
        temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "awf native hook \(UUID().uuidString)",
                isDirectory: true
            )
        try FileManager.default.createDirectory(
            at: temporaryDirectory,
            withIntermediateDirectories: true
        )
    }

    override func tearDownWithError() throws {
        if let temporaryDirectory {
            try? FileManager.default.removeItem(at: temporaryDirectory)
        }
    }

    func testCanonicalActivationAcceptsOnlyClosedReleaseIdentifiers()
        throws
    {
        let releaseID = "rel_0123456789abcdef0123456789abcdef"
        let source = NativeHookActivation.canonicalSource(
            releaseID: releaseID
        )

        XCTAssertEqual(
            try NativeHookActivation.parse(Data(source.utf8)),
            NativeHookActivation(releaseID: releaseID)
        )
        for counterexample in [
            source.replacingOccurrences(of: #""v":1"#, with: #""v":2"#),
            source.replacingOccurrences(
                of: #","workerProtocol":1"#,
                with: #","extra":true,"workerProtocol":1"#
            ),
            NativeHookActivation.canonicalSource(
                releaseID: "rel_../../../../outside"
            ),
            source.trimmingCharacters(in: .whitespacesAndNewlines),
        ] {
            XCTAssertThrowsError(
                try NativeHookActivation.parse(Data(counterexample.utf8))
            )
        }
    }

    func testWorkerEnvironmentUsesOnlyTheClosedAllowlist() {
        let projected = NativeHookLaunchPlan.workerEnvironment(
            from: [
                "HOME": "/Users/example",
                "LANG": "ko_KR.UTF-8",
                "AGENT_WASTE_FIREWALL_MODE": "warn",
                "AGENT_WASTE_FIREWALL_PLATFORM": "claude",
                "NODE_OPTIONS": "--require=/tmp/inject.cjs",
                "DYLD_INSERT_LIBRARIES": "/tmp/inject.dylib",
                "LD_PRELOAD": "/tmp/inject.so",
                "AWF_TEST_SECRET": "never-forward",
            ],
            provider: .codex
        )

        XCTAssertEqual(projected["HOME"], "/Users/example")
        XCTAssertEqual(projected["LANG"], "ko_KR.UTF-8")
        XCTAssertEqual(
            projected["AGENT_WASTE_FIREWALL_MODE"],
            "warn"
        )
        XCTAssertEqual(projected["PATH"], "/usr/bin:/bin")
        XCTAssertEqual(
            projected["AGENT_WASTE_FIREWALL_PLATFORM"],
            "codex"
        )
        XCTAssertNil(projected["NODE_OPTIONS"])
        XCTAssertNil(projected["DYLD_INSERT_LIBRARIES"])
        XCTAssertNil(projected["LD_PRELOAD"])
        XCTAssertNil(projected["AWF_TEST_SECRET"])
    }

    func testExactProviderArgumentsSynthesizeClosedPlatform() throws {
        let fixture = try makeFixture(runtimeBody: "exec /bin/cat")

        for provider in [NativeHookProvider.codex, .claude] {
            let inheritedPlatform =
                provider == .codex ? "claude" : "codex"
            let plan = try NativeHookLaunchPlan.resolve(
                arguments: helperArguments(
                    for: fixture.pluginRoot,
                    provider: provider
                ),
                executableURL: fixture.helper,
                environment: [
                    "AGENT_WASTE_FIREWALL_PLATFORM": inheritedPlatform,
                    "PLUGIN_ROOT": "/untrusted/codex",
                    "CLAUDE_PLUGIN_ROOT": "/untrusted/claude",
                ]
            )

            XCTAssertEqual(
                plan.environment["AGENT_WASTE_FIREWALL_PLATFORM"],
                provider.rawValue
            )
            XCTAssertNil(plan.environment["PLUGIN_ROOT"])
            XCTAssertNil(plan.environment["CLAUDE_PLUGIN_ROOT"])
        }

        let canonical = helperArguments(for: fixture.pluginRoot)
        var uppercaseProvider = canonical
        uppercaseProvider[4] = "Codex"
        var unknownProvider = canonical
        unknownProvider[4] = "cursor"
        var reordered = canonical
        reordered.swapAt(3, 5)
        for counterexample in [
            uppercaseProvider,
            unknownProvider,
            reordered,
            Array(canonical.dropLast()),
            canonical + ["unexpected"],
        ] {
            XCTAssertThrowsError(
                try NativeHookLaunchPlan.resolve(
                    arguments: counterexample,
                    executableURL: fixture.helper,
                    environment: [:]
                )
            )
        }
    }

    func testEmbeddedHelperStreamsStdinWithoutPersistingRawInput()
        throws
    {
        let fixture = try makeFixture(
            runtimeBody: """
            test "$#" -eq 1 || exit 70
            case "$1" in
              */scripts/hook.mjs) ;;
              *) exit 71 ;;
            esac
            test -z "${NODE_OPTIONS+x}" || exit 72
            test -z "${AWF_TEST_SECRET+x}" || exit 73
            exec /bin/cat
            """
        )
        let input = """
        {"secret":"RAW-NATIVE-CANARY-5d0d1328"}

        """

        let result = try runHelper(
            fixture: fixture,
            input: input,
            environment: [
                "HOME": temporaryDirectory.path,
                "NODE_OPTIONS": "--require=/tmp/inject.cjs",
                "AWF_TEST_SECRET": "never-forward",
            ]
        )

        XCTAssertEqual(result.status, 0)
        XCTAssertEqual(result.stdout, input)
        XCTAssertEqual(result.stderr, "")
        XCTAssertFalse(
            try persistedContents(in: temporaryDirectory)
                .contains("RAW-NATIVE-CANARY-5d0d1328")
        )
    }

    func testMissingActivationFailsOpenWithoutEchoingRawInput()
        throws
    {
        let fixture = try makeFixture(
            runtimeBody: "exec /bin/cat",
            writeActivation: false
        )
        let input = """
        {"secret":"RAW-FAIL-OPEN-CANARY-908b6e0d"}

        """

        let result = try runHelper(
            fixture: fixture,
            input: input
        )

        XCTAssertEqual(result.status, 0)
        XCTAssertEqual(result.stdout, "{}\n")
        XCTAssertEqual(
            result.stderr,
            NativeHookLauncher.failOpenWarning
        )
        XCTAssertFalse(result.stdout.contains("RAW-FAIL-OPEN-CANARY"))
        XCTAssertFalse(result.stderr.contains("RAW-FAIL-OPEN-CANARY"))
        XCTAssertFalse(result.stderr.contains(temporaryDirectory.path))
    }

    func testChildFailureDoesNotAppendASecondJSONResponse() throws {
        let fixture = try makeFixture(runtimeBody: "exit 73")

        let result = try runHelper(
            fixture: fixture,
            input: #"{"hook_event_name":"Stop"}"# + "\n"
        )

        XCTAssertEqual(result.status, 0)
        XCTAssertEqual(result.stdout, "")
        XCTAssertEqual(
            result.stderr,
            NativeHookLauncher.failOpenWarning
        )
    }

    func testUnsafeOrSymlinkRuntimeIsRejected() throws {
        let unsafeFixture = try makeFixture(runtimeBody: "exec /bin/cat")
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o722],
            ofItemAtPath: unsafeFixture.runtime.path
        )
        XCTAssertThrowsError(
            try NativeHookLaunchPlan.resolve(
                arguments: helperArguments(for: unsafeFixture.pluginRoot),
                executableURL: unsafeFixture.helper,
                environment: [:]
            )
        )

        let symlinkRoot = temporaryDirectory.appendingPathComponent(
            "symlink fixture",
            isDirectory: true
        )
        let symlinkFixture = try makeFixture(
            root: symlinkRoot,
            runtimeBody: "exec /bin/cat"
        )
        let realRuntime = symlinkFixture.runtime
            .deletingLastPathComponent()
            .appendingPathComponent("real-node")
        try FileManager.default.moveItem(
            at: symlinkFixture.runtime,
            to: realRuntime
        )
        try FileManager.default.createSymbolicLink(
            at: symlinkFixture.runtime,
            withDestinationURL: realRuntime
        )
        XCTAssertThrowsError(
            try NativeHookLaunchPlan.resolve(
                arguments: helperArguments(for: symlinkFixture.pluginRoot),
                executableURL: symlinkFixture.helper,
                environment: [:]
            )
        )
    }

    func testUnsafeOrSymlinkActivationIsRejected() throws {
        let unsafeFixture = try makeFixture(runtimeBody: "exec /bin/cat")
        try setMode(0o622, at: unsafeFixture.activation)
        XCTAssertThrowsError(
            try resolve(fixture: unsafeFixture)
        )

        let symlinkFixture = try makeFixture(
            root: temporaryDirectory.appendingPathComponent(
                "activation symlink fixture",
                isDirectory: true
            ),
            runtimeBody: "exec /bin/cat"
        )
        let realActivation = symlinkFixture.activation
            .deletingLastPathComponent()
            .appendingPathComponent("real-activation.json")
        try FileManager.default.moveItem(
            at: symlinkFixture.activation,
            to: realActivation
        )
        try FileManager.default.createSymbolicLink(
            at: symlinkFixture.activation,
            withDestinationURL: realActivation
        )
        XCTAssertThrowsError(
            try resolve(fixture: symlinkFixture)
        )
    }

    func testUnsafeOrSymlinkPluginDirectoriesAreRejected() throws {
        let unsafeRootFixture = try makeFixture(
            root: temporaryDirectory.appendingPathComponent(
                "unsafe plugin root fixture",
                isDirectory: true
            ),
            runtimeBody: "exec /bin/cat"
        )
        try setMode(0o777, at: unsafeRootFixture.pluginRoot)
        XCTAssertThrowsError(
            try resolve(fixture: unsafeRootFixture)
        )

        let symlinkScriptsFixture = try makeFixture(
            root: temporaryDirectory.appendingPathComponent(
                "symlink scripts fixture",
                isDirectory: true
            ),
            runtimeBody: "exec /bin/cat"
        )
        let realScripts = symlinkScriptsFixture.pluginRoot
            .appendingPathComponent("real scripts", isDirectory: true)
        try FileManager.default.moveItem(
            at: symlinkScriptsFixture.scripts,
            to: realScripts
        )
        try FileManager.default.createSymbolicLink(
            at: symlinkScriptsFixture.scripts,
            withDestinationURL: realScripts
        )
        XCTAssertThrowsError(
            try resolve(fixture: symlinkScriptsFixture)
        )
    }

    func testUnsafeReleaseAndWorkerAreRejected() throws {
        let unsafeReleaseFixture = try makeFixture(
            root: temporaryDirectory.appendingPathComponent(
                "unsafe release fixture",
                isDirectory: true
            ),
            runtimeBody: "exec /bin/cat"
        )
        try setMode(0o777, at: unsafeReleaseFixture.release)
        XCTAssertThrowsError(
            try resolve(fixture: unsafeReleaseFixture)
        )

        let unsafeWorkerFixture = try makeFixture(
            root: temporaryDirectory.appendingPathComponent(
                "unsafe worker fixture",
                isDirectory: true
            ),
            runtimeBody: "exec /bin/cat"
        )
        try setMode(0o666, at: unsafeWorkerFixture.worker)
        XCTAssertThrowsError(
            try resolve(fixture: unsafeWorkerFixture)
        )

        let symlinkWorkerFixture = try makeFixture(
            root: temporaryDirectory.appendingPathComponent(
                "symlink worker fixture",
                isDirectory: true
            ),
            runtimeBody: "exec /bin/cat"
        )
        let realWorker = symlinkWorkerFixture.scripts
            .appendingPathComponent("real-hook.mjs")
        try FileManager.default.moveItem(
            at: symlinkWorkerFixture.worker,
            to: realWorker
        )
        try FileManager.default.createSymbolicLink(
            at: symlinkWorkerFixture.worker,
            withDestinationURL: realWorker
        )
        XCTAssertThrowsError(
            try resolve(fixture: symlinkWorkerFixture)
        )
    }

    func testRuntimeAndWorkerIdentityAreRecheckedBeforeLaunch() throws {
        let runtimeFixture = try makeFixture(
            root: temporaryDirectory.appendingPathComponent(
                "runtime identity fixture",
                isDirectory: true
            ),
            runtimeBody: "exec /bin/cat"
        )
        let runtimePlan = try resolve(fixture: runtimeFixture)
        try replaceFile(
            at: runtimeFixture.runtime,
            contents: "#!/bin/sh\nexec /bin/cat\n",
            mode: 0o700
        )
        XCTAssertThrowsError(
            try runtimePlan.revalidateForLaunch()
        )

        let workerFixture = try makeFixture(
            root: temporaryDirectory.appendingPathComponent(
                "worker identity fixture",
                isDirectory: true
            ),
            runtimeBody: "exec /bin/cat"
        )
        let workerPlan = try resolve(fixture: workerFixture)
        try replaceFile(
            at: workerFixture.worker,
            contents: "export const replaced = true;\n",
            mode: 0o600
        )
        XCTAssertThrowsError(
            try workerPlan.revalidateForLaunch()
        )
    }

    func testDeadlineTerminatesWholeChildGroupWithoutOrphan() throws {
        let orphanPIDFile = temporaryDirectory.appendingPathComponent(
            "orphan.pid"
        )
        let fixture = try makeFixture(
            root: temporaryDirectory.appendingPathComponent(
                "deadline fixture",
                isDirectory: true
            ),
            runtimeBody: """
            /bin/sh -c 'printf "%s" "$$" > "$HOME/orphan.pid"; \
            while :; do /bin/sleep 1; done' &
            wait
            """
        )
        let startedAt = Date()

        let result = try runHelper(
            fixture: fixture,
            input: #"{"hook_event_name":"PreToolUse"}"# + "\n",
            environment: ["HOME": temporaryDirectory.path]
        )

        XCTAssertEqual(result.status, 0)
        XCTAssertEqual(result.stdout, "")
        XCTAssertEqual(
            result.stderr,
            NativeHookLauncher.failOpenWarning
        )
        XCTAssertLessThan(
            NativeHookLauncher.childDeadlineNanoseconds,
            3_000_000_000
        )
        XCTAssertLessThan(Date().timeIntervalSince(startedAt), 4.0)
        XCTAssertTrue(
            waitForFile(orphanPIDFile, timeout: 0.5),
            "The descendant must start before the helper deadline."
        )
        let orphanPID = try processID(in: orphanPIDFile)
        XCTAssertTrue(
            waitForProcessExit(orphanPID, timeout: 0.75),
            "The helper must terminate the entire child process group."
        )
    }

    func testTerminationSignalIsForwardedAndChildIsReaped() throws {
        let readyFile = temporaryDirectory.appendingPathComponent(
            "signal-ready"
        )
        let forwardedFile = temporaryDirectory.appendingPathComponent(
            "signal-forwarded"
        )
        let fixture = try makeFixture(
            root: temporaryDirectory.appendingPathComponent(
                "signal fixture",
                isDirectory: true
            ),
            runtimeBody: """
            trap 'printf forwarded > "$HOME/signal-forwarded"; exit 0' TERM
            printf ready > "$HOME/signal-ready"
            while :; do :; done
            """
        )
        let running = try startHelper(
            fixture: fixture,
            input: #"{"hook_event_name":"Stop"}"# + "\n",
            environment: ["HOME": temporaryDirectory.path]
        )
        XCTAssertTrue(
            waitForFile(readyFile, timeout: 1.0),
            "The child must be ready before signalling the helper."
        )

        XCTAssertEqual(
            Darwin.kill(
                pid_t(running.process.processIdentifier),
                SIGTERM
            ),
            0
        )
        let result = finishHelper(running)

        XCTAssertEqual(result.status, 0)
        XCTAssertEqual(result.stdout, "")
        XCTAssertEqual(
            result.stderr,
            NativeHookLauncher.failOpenWarning
        )
        XCTAssertEqual(
            try String(contentsOf: forwardedFile, encoding: .utf8),
            "forwarded"
        )
    }

    private struct Fixture {
        let helper: URL
        let runtime: URL
        let pluginRoot: URL
        let activation: URL
        let release: URL
        let scripts: URL
        let worker: URL
    }

    private struct HelperResult {
        let status: Int32
        let stdout: String
        let stderr: String
    }

    private struct RunningHelper {
        let process: Process
        let outputPipe: Pipe
        let errorPipe: Pipe
    }

    private func makeFixture(
        root: URL? = nil,
        runtimeBody: String,
        writeActivation: Bool = true
    ) throws -> Fixture {
        let root = root ?? temporaryDirectory.appendingPathComponent(
            "integration-v1",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: root,
            withIntermediateDirectories: true
        )

        let helper = root.appendingPathComponent("awf-hook")
        try FileManager.default.copyItem(
            at: try bundledHelper(),
            to: helper
        )
        try setMode(0o700, at: helper)

        let releaseID = "rel_0123456789abcdef0123456789abcdef"
        let release = root
            .appendingPathComponent("versions", isDirectory: true)
            .appendingPathComponent(releaseID, isDirectory: true)
        try FileManager.default.createDirectory(
            at: release,
            withIntermediateDirectories: true
        )
        let runtime = release.appendingPathComponent("awf-node")
        try Data(
            """
            #!/bin/sh
            \(runtimeBody)

            """.utf8
        ).write(to: runtime, options: .atomic)
        try setMode(0o700, at: runtime)

        let activation = root.appendingPathComponent("activation.json")
        if writeActivation {
            try Data(
                NativeHookActivation.canonicalSource(
                    releaseID: releaseID
                ).utf8
            ).write(to: activation, options: .atomic)
            try setMode(0o600, at: activation)
        }

        let pluginRoot = root.appendingPathComponent(
            "plugin root 한글",
            isDirectory: true
        )
        let scripts = pluginRoot.appendingPathComponent(
            "scripts",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: scripts,
            withIntermediateDirectories: true
        )
        let worker = scripts.appendingPathComponent("hook.mjs")
        try Data("export {};\n".utf8).write(
            to: worker,
            options: .atomic
        )
        try setMode(0o600, at: worker)

        return Fixture(
            helper: helper,
            runtime: runtime,
            pluginRoot: pluginRoot,
            activation: activation,
            release: release,
            scripts: scripts,
            worker: worker
        )
    }

    private func runHelper(
        fixture: Fixture,
        input: String,
        environment: [String: String] = [:]
    ) throws -> HelperResult {
        finishHelper(
            try startHelper(
                fixture: fixture,
                input: input,
                environment: environment
            )
        )
    }

    private func startHelper(
        fixture: Fixture,
        input: String,
        environment: [String: String] = [:]
    ) throws -> RunningHelper {
        let process = Process()
        let inputPipe = Pipe()
        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.executableURL = fixture.helper
        process.arguments = helperArguments(for: fixture.pluginRoot)
        process.environment = environment
        process.standardInput = inputPipe
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        try process.run()
        try inputPipe.fileHandleForReading.close()
        try outputPipe.fileHandleForWriting.close()
        try errorPipe.fileHandleForWriting.close()
        inputPipe.fileHandleForWriting.write(Data(input.utf8))
        try inputPipe.fileHandleForWriting.close()
        return RunningHelper(
            process: process,
            outputPipe: outputPipe,
            errorPipe: errorPipe
        )
    }

    private func finishHelper(_ running: RunningHelper) -> HelperResult {
        running.process.waitUntilExit()
        let stdout = running.outputPipe.fileHandleForReading
            .readDataToEndOfFile()
        let stderr = running.errorPipe.fileHandleForReading
            .readDataToEndOfFile()
        return HelperResult(
            status: running.process.terminationStatus,
            stdout: String(decoding: stdout, as: UTF8.self),
            stderr: String(decoding: stderr, as: UTF8.self)
        )
    }

    private func helperArguments(
        for pluginRoot: URL,
        provider: NativeHookProvider = .codex
    ) -> [String] {
        [
            "hook",
            "--protocol",
            NativeHookLaunchPlan.protocolVersion,
            "--provider",
            provider.rawValue,
            "--plugin-root",
            pluginRoot.path,
        ]
    }

    private func resolve(
        fixture: Fixture,
        provider: NativeHookProvider = .codex
    ) throws -> NativeHookLaunchPlan {
        try NativeHookLaunchPlan.resolve(
            arguments: helperArguments(
                for: fixture.pluginRoot,
                provider: provider
            ),
            executableURL: fixture.helper,
            environment: [:]
        )
    }

    private func replaceFile(
        at url: URL,
        contents: String,
        mode: Int
    ) throws {
        try FileManager.default.removeItem(at: url)
        try Data(contents.utf8).write(to: url, options: .atomic)
        try setMode(mode, at: url)
    }

    private func waitForFile(_ url: URL, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if FileManager.default.fileExists(atPath: url.path) {
                return true
            }
            Thread.sleep(forTimeInterval: 0.01)
        } while Date() < deadline
        return FileManager.default.fileExists(atPath: url.path)
    }

    private func processID(in file: URL) throws -> pid_t {
        let source = try String(contentsOf: file, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let processID = pid_t(source), processID > 0 else {
            throw NativeHookLaunchFailure.launchFailed
        }
        return processID
    }

    private func waitForProcessExit(
        _ processID: pid_t,
        timeout: TimeInterval
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if !processExists(processID) {
                return true
            }
            Thread.sleep(forTimeInterval: 0.01)
        } while Date() < deadline
        return !processExists(processID)
    }

    private func processExists(_ processID: pid_t) -> Bool {
        if Darwin.kill(processID, 0) == 0 {
            return true
        }
        return errno == EPERM
    }

    private func bundledHelper() throws -> URL {
        let helper = Bundle.main.bundleURL
            .appendingPathComponent("Contents", isDirectory: true)
            .appendingPathComponent("Helpers", isDirectory: true)
            .appendingPathComponent("awf-hook")
        XCTAssertTrue(
            FileManager.default.isExecutableFile(atPath: helper.path),
            "The app build must embed the native hook helper."
        )
        return helper
    }

    private func setMode(_ mode: Int, at url: URL) throws {
        try FileManager.default.setAttributes(
            [.posixPermissions: mode],
            ofItemAtPath: url.path
        )
    }

    private func persistedContents(in directory: URL) throws -> String {
        guard let enumerator = FileManager.default.enumerator(
            at: directory,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else {
            return ""
        }
        var contents = ""
        for case let file as URL in enumerator {
            let values = try file.resourceValues(
                forKeys: [.isRegularFileKey]
            )
            guard
                values.isRegularFile == true,
                file.lastPathComponent != "awf-hook",
                file.lastPathComponent != "awf-node"
            else {
                continue
            }
            if let source = try? String(contentsOf: file, encoding: .utf8) {
                contents += source
            }
        }
        return contents
    }
}

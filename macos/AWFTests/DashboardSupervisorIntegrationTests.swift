import Darwin
import Foundation
import XCTest
@testable import AWF

@MainActor
final class DashboardSupervisorIntegrationTests: XCTestCase {
    func testWorkerEnvironmentUsesClosedAllowlist() {
        let projected = DashboardSupervisor.workerEnvironment(
            from: [
                "HOME": "/Users/example",
                "TMPDIR": "/tmp/example",
                "LANG": "en_US.UTF-8",
                "CODEX_HOME": "/Users/example/.codex-alt",
                "CLAUDE_CONFIG_DIR": "/Users/example/.claude-alt",
                "XDG_CONFIG_HOME": "/Users/example/.config-alt",
                "AGENT_WASTE_FIREWALL_MODE": "warn",
                "DYLD_INSERT_LIBRARIES": "/tmp/injected.dylib",
                "NODE_OPTIONS": "--require=/tmp/injected.cjs",
                "UNRELATED_SECRET": "must-not-cross-boundary",
            ]
        )

        XCTAssertEqual(
            projected,
            [
                "HOME": "/Users/example",
                "TMPDIR": "/tmp/example",
                "LANG": "en_US.UTF-8",
                "CODEX_HOME": "/Users/example/.codex-alt",
                "CLAUDE_CONFIG_DIR": "/Users/example/.claude-alt",
                "XDG_CONFIG_HOME": "/Users/example/.config-alt",
                "PATH": [
                    "/Applications/ChatGPT.app/Contents/Resources",
                    "/opt/homebrew/bin",
                    "/usr/local/bin",
                    "/Users/example/.local/bin",
                    "/Users/example/.npm-global/bin",
                    "/Users/example/.volta/bin",
                    "/usr/bin",
                    "/bin",
                ].joined(separator: ":"),
                "AGENT_WASTE_FIREWALL_MODE": "warn",
            ]
        )
    }

    func testWorkerEnvironmentDoesNotInjectUnsafeHomeIntoProviderPath() {
        let projected = DashboardSupervisor.workerEnvironment(
            from: [
                "HOME": "/Users/example:/tmp/injected",
                "PATH": "/tmp/untrusted",
            ]
        )

        XCTAssertEqual(
            projected["PATH"],
            [
                "/Applications/ChatGPT.app/Contents/Resources",
                "/opt/homebrew/bin",
                "/usr/local/bin",
                "/usr/bin",
                "/bin",
            ].joined(separator: ":")
        )
        XCTAssertFalse(projected["PATH", default: ""].contains("injected"))
        XCTAssertFalse(projected["PATH", default: ""].contains("untrusted"))
    }

    func testImmediateReadinessEOFStopsChildAndReportsInvalidReadiness() async throws {
        let fixture = try makeSupervisorFixture(
            launcherBody: "exit 0"
        )
        let supervisor = DashboardSupervisor()
        defer {
            supervisor.stop()
            try? FileManager.default.removeItem(at: fixture.directory)
        }

        do {
            _ = try await supervisor.start(
                configuration: fixture.configuration
            )
            XCTFail("An empty readiness stream must not launch a dashboard.")
        } catch let failure as DashboardLaunchFailure {
            XCTAssertEqual(
                failure.rawValue,
                DashboardLaunchFailure.invalidReadiness.rawValue
            )
        } catch {
            XCTFail("Expected invalidReadiness, received \(error).")
        }

        XCTAssertFalse(supervisor.isRunning)
    }

    func testCancellingSilentReadinessStopsChildAndPropagatesCancellation() async throws {
        let fixture = try makeSupervisorFixture(
            launcherBody: "exec /bin/sleep 30"
        )
        let supervisor = DashboardSupervisor()
        defer {
            supervisor.stop()
            try? FileManager.default.removeItem(at: fixture.directory)
        }

        let launchTask = Task { @MainActor in
            try await supervisor.start(
                configuration: fixture.configuration
            )
        }

        let reachedReadinessWait = await waitUntilRunning(supervisor)
        XCTAssertTrue(
            reachedReadinessWait,
            "The synthetic child did not reach the readiness wait."
        )
        let childPID = try XCTUnwrap(supervisor.processIdentifier)
        launchTask.cancel()

        do {
            _ = try await launchTask.value
            XCTFail("A cancelled dashboard launch must not return an endpoint.")
        } catch is CancellationError {
            // Expected: cancellation must beat the five-second readiness timeout.
        } catch {
            XCTFail("Expected CancellationError, received \(error).")
        }

        XCTAssertFalse(supervisor.isRunning)
        XCTAssertFalse(processExists(childPID))
    }

    func testStopEscalatesWhenChildIgnoresTermination() async throws {
        let markerName = "termination-ignored"
        let fixture = try makeSupervisorFixture(
            launcherBody: """
            trap '' TERM
            : > "$AGENT_WASTE_FIREWALL_TEST_MARKER"
            exec /bin/sleep 30
            """,
            environment: [
                "AGENT_WASTE_FIREWALL_TEST_MARKER": markerName,
            ]
        )
        let supervisor = DashboardSupervisor()
        defer {
            supervisor.stop()
            try? FileManager.default.removeItem(at: fixture.directory)
        }

        let launchTask = Task { @MainActor in
            try await supervisor.start(
                configuration: fixture.configuration
            )
        }
        let reachedReadinessWait = await waitUntilRunning(supervisor)
        XCTAssertTrue(reachedReadinessWait)
        let marker = fixture.directory.appendingPathComponent(markerName)
        let installedSignalHandler = await waitUntilFileExists(marker)
        XCTAssertTrue(installedSignalHandler)
        let childPID = try XCTUnwrap(supervisor.processIdentifier)

        launchTask.cancel()
        do {
            _ = try await launchTask.value
            XCTFail("A cancelled dashboard launch must not return an endpoint.")
        } catch is CancellationError {
            // Expected.
        } catch {
            XCTFail("Expected CancellationError, received \(error).")
        }

        XCTAssertFalse(supervisor.isRunning)
        XCTAssertFalse(processExists(childPID))
    }

    func testStartsActualNodeDashboardAndReadsClosedEmptyStatus() async throws {
        let environment = ProcessInfo.processInfo.environment
        let node = try XCTUnwrap(
            locateIntegrationNode(environment: environment),
            "Node.js must be available for the native integration target."
        )

        let resources = try XCTUnwrap(Bundle.main.resourceURL)
        let worker = resources
            .appendingPathComponent("bin", isDirectory: true)
            .appendingPathComponent("agent-waste-firewall.mjs")
        guard FileManager.default.fileExists(atPath: worker.path) else {
            XCTFail("The built app must contain the worker entrypoint.")
            return
        }

        let temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "awf-native-integration-\(UUID().uuidString)",
                isDirectory: true
            )
        let dataDirectory = temporaryDirectory
            .appendingPathComponent("data", isDirectory: true)
        try FileManager.default.createDirectory(
            at: temporaryDirectory,
            withIntermediateDirectories: true
        )

        let supervisor = DashboardSupervisor()
        defer {
            supervisor.stop()
            try? FileManager.default.removeItem(at: temporaryDirectory)
        }

        let endpoint = try await supervisor.start(
            configuration: DashboardLaunchConfiguration(
                nodeURL: node,
                workerEntrypoint: worker,
                workingDirectory: resources,
                environment: [
                    "AGENT_WASTE_FIREWALL_DATA_DIR": dataDirectory.path,
                    "AGENT_WASTE_FIREWALL_MODE": "warn",
                ]
            )
        )
        XCTAssertTrue(supervisor.isRunning)
        XCTAssertEqual(endpoint.host, "127.0.0.1")
        XCTAssertEqual(endpoint.source, .live)
        XCTAssertGreaterThan(endpoint.port, 0)

        let client = DashboardStatusClient()
        let status = try await client.fetch(endpoint)
        XCTAssertTrue(status.connected)
        XCTAssertEqual(status.source, .live)
        XCTAssertEqual(status.sourceState, .empty)
        XCTAssertEqual(status.streamHealth, .healthy)
        XCTAssertEqual(status.coverage, .complete)
        XCTAssertEqual(status.generation, 0)
        XCTAssertNil(status.streamAlias)
        XCTAssertEqual(status.metrics.events, 0)
        XCTAssertEqual(status.lastSequence, 0)
        XCTAssertNil(status.warning)

        let integration = try await client.fetchIntegration(endpoint)
        XCTAssertEqual(
            integration.providers.map(\.provider),
            [.codex, .claude]
        )
        XCTAssertFalse(integration.hasObservedActivity)

        supervisor.stop()
        XCTAssertFalse(supervisor.isRunning)
    }

    private struct SupervisorFixture {
        let directory: URL
        let configuration: DashboardLaunchConfiguration
    }

    private func makeSupervisorFixture(
        launcherBody: String,
        environment: [String: String] = [:]
    ) throws -> SupervisorFixture {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "awf-supervisor-\(UUID().uuidString)",
                isDirectory: true
            )
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )

        let launcher = directory.appendingPathComponent("launcher")
        let script = """
        #!/bin/sh
        \(launcherBody)
        """
        try Data(script.utf8).write(to: launcher, options: .atomic)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: launcher.path
        )

        let worker = directory
            .appendingPathComponent("agent-waste-firewall.mjs")
        try Data("export {};\n".utf8).write(to: worker, options: .atomic)

        return SupervisorFixture(
            directory: directory,
            configuration: DashboardLaunchConfiguration(
                nodeURL: launcher,
                workerEntrypoint: worker,
                workingDirectory: directory,
                environment: environment.mapValues { value in
                    value.hasPrefix("/")
                        ? value
                        : directory.appendingPathComponent(value).path
                }
            )
        )
    }

    private func waitUntilRunning(
        _ supervisor: DashboardSupervisor
    ) async -> Bool {
        for _ in 0..<1_000 {
            if supervisor.isRunning {
                return true
            }
            await Task.yield()
        }
        return supervisor.isRunning
    }

    private func waitUntilFileExists(_ url: URL) async -> Bool {
        for _ in 0..<200 {
            if FileManager.default.fileExists(atPath: url.path) {
                return true
            }
            try? await Task.sleep(for: .milliseconds(5))
        }
        return FileManager.default.fileExists(atPath: url.path)
    }

    private func processExists(_ processIdentifier: Int32) -> Bool {
        if Darwin.kill(processIdentifier, 0) == 0 {
            return true
        }
        return errno != ESRCH
    }

    private func locateIntegrationNode(
        environment: [String: String]
    ) -> URL? {
        if let node = RuntimeLocator.locateNode(environment: environment) {
            return node
        }

        let shell = Process()
        let output = Pipe()
        shell.executableURL = URL(fileURLWithPath: "/bin/zsh")
        shell.arguments = ["-lc", "command -v node"]
        shell.standardInput = FileHandle.nullDevice
        shell.standardOutput = output
        shell.standardError = FileHandle.nullDevice
        do {
            try shell.run()
            shell.waitUntilExit()
        } catch {
            return nil
        }
        guard
            shell.terminationStatus == 0,
            let path = String(
                data: output.fileHandleForReading.readDataToEndOfFile(),
                encoding: .utf8
            )?.trimmingCharacters(in: .whitespacesAndNewlines),
            path.hasPrefix("/")
        else {
            return nil
        }
        return RuntimeLocator.locateNode(
            environment: ["AWF_NODE_PATH": path]
        )
    }

}

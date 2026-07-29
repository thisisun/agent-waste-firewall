import Foundation
import XCTest
@testable import AWF

final class RuntimeLocatorTests: XCTestCase {
    private var temporaryDirectory: URL!

    override func setUpWithError() throws {
        temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
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

    func testLocateUsesExplicitRegularNodeAndWorkerFiles() throws {
        let node = temporaryDirectory.appendingPathComponent("node")
        try makeNode(node, version: "v22.22.3")
        let pathDirectory = temporaryDirectory.appendingPathComponent(
            "path-node",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: pathDirectory,
            withIntermediateDirectories: true
        )
        try makeNode(
            pathDirectory.appendingPathComponent("node"),
            version: "v23.0.0"
        )
        let bin = temporaryDirectory.appendingPathComponent(
            "bin",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: bin,
            withIntermediateDirectories: true
        )
        let worker = bin.appendingPathComponent("agent-waste-firewall.mjs")
        try makeFile(worker, contents: "export {};\n")

        let configuration = try RuntimeLocator.locate(
            bundle: .main,
            environment: [
                "AWF_NODE_PATH": node.path,
                "AWF_WORKER_ENTRYPOINT": worker.path,
                "PATH": pathDirectory.path,
            ],
            currentDirectory: temporaryDirectory
        )

        XCTAssertEqual(configuration.nodeURL, node)
        XCTAssertEqual(configuration.workerEntrypoint, worker)
        XCTAssertEqual(
            configuration.workingDirectory,
            temporaryDirectory
        )
    }

    func testLocateNodeRequiresExecutableRegularFile() throws {
        let notExecutable = temporaryDirectory.appendingPathComponent("node")
        try makeFile(notExecutable, contents: "not executable\n")

        let located = RuntimeLocator.locateNode(
            environment: [
                "AWF_NODE_PATH": notExecutable.path,
                "PATH": "",
            ]
        )

        XCTAssertNotEqual(located, notExecutable)
        if let located {
            XCTAssertTrue(
                FileManager.default.isExecutableFile(atPath: located.path)
            )
            XCTAssertEqual(try fileType(at: located), .typeRegular)
        }
    }

    func testLocateNodeResolvesSymlinkOverrideToRegularTarget() throws {
        let target = temporaryDirectory.appendingPathComponent("node-real")
        try makeNode(target, version: "v20.0.0")
        let link = temporaryDirectory.appendingPathComponent("node-link")
        try FileManager.default.createSymbolicLink(
            at: link,
            withDestinationURL: target
        )

        let located = RuntimeLocator.locateNode(
            environment: [
                "AWF_NODE_PATH": link.path,
                "PATH": "",
            ]
        )

        let locatedURL = try XCTUnwrap(located)
        XCTAssertEqual(
            locatedURL,
            target.standardizedFileURL.resolvingSymlinksInPath()
        )
        XCTAssertEqual(try fileType(at: locatedURL), .typeRegular)
    }

    func testNodeVersionProbeAcceptsMinimumAndNewerVersions() throws {
        let minimum = temporaryDirectory.appendingPathComponent("node-18")
        try makeNode(minimum, version: "v18.0.0")
        let current = temporaryDirectory.appendingPathComponent("node-22")
        try makeNode(current, version: "v22.22.3")

        XCTAssertEqual(
            RuntimeLocator.supportedNodeMajorVersion(at: minimum),
            18
        )
        XCTAssertEqual(
            RuntimeLocator.supportedNodeMajorVersion(at: current),
            22
        )
    }

    func testNodeVersionProbeRejectsOlderAndMalformedVersions() throws {
        let older = temporaryDirectory.appendingPathComponent("node-17")
        try makeNode(older, version: "v17.9.1")
        let malformed = temporaryDirectory.appendingPathComponent("not-node")
        try makeNode(malformed, version: "version 22")

        XCTAssertNil(
            RuntimeLocator.supportedNodeMajorVersion(at: older)
        )
        XCTAssertNil(
            RuntimeLocator.supportedNodeMajorVersion(at: malformed)
        )
    }

    func testNodeVersionProbeTimesOut() throws {
        let unresponsive = temporaryDirectory.appendingPathComponent(
            "unresponsive-node"
        )
        try makeFile(
            unresponsive,
            contents: """
            #!/bin/sh
            trap '' TERM
            exec /bin/sleep 30
            """,
            executable: true
        )
        let started = Date()

        XCTAssertNil(
            RuntimeLocator.supportedNodeMajorVersion(
                at: unresponsive,
                timeout: 0.05
            )
        )
        XCTAssertLessThan(Date().timeIntervalSince(started), 1)
    }

    func testLocateWorkerResolvesSymlinkOverrideToRegularTarget() throws {
        let target = temporaryDirectory
            .appendingPathComponent("agent-waste-firewall-real.mjs")
        try makeFile(target, contents: "export {};\n")
        let link = temporaryDirectory
            .appendingPathComponent("agent-waste-firewall-link.mjs")
        try FileManager.default.createSymbolicLink(
            at: link,
            withDestinationURL: target
        )

        let located = RuntimeLocator.locateWorker(
            bundle: .main,
            environment: ["AWF_WORKER_ENTRYPOINT": link.path],
            currentDirectory: temporaryDirectory
        )

        let locatedURL = try XCTUnwrap(located)
        XCTAssertEqual(
            locatedURL,
            target.standardizedFileURL.resolvingSymlinksInPath()
        )
        XCTAssertEqual(try fileType(at: locatedURL), .typeRegular)
    }

    private func makeFile(
        _ url: URL,
        contents: String,
        executable: Bool = false
    ) throws {
        try Data(contents.utf8).write(to: url, options: .atomic)
        if executable {
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o700],
                ofItemAtPath: url.path
            )
        }
    }

    private func makeNode(
        _ url: URL,
        version: String
    ) throws {
        try makeFile(
            url,
            contents: """
            #!/bin/sh
            printf '%s\\n' '\(version)'
            """,
            executable: true
        )
    }

    private func fileType(at url: URL) throws -> FileAttributeType {
        try XCTUnwrap(
            FileManager.default.attributesOfItem(
                atPath: url.path
            )[.type] as? FileAttributeType
        )
    }
}

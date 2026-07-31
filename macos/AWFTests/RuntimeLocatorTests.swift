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

    func testLocateNodeNeverExecutesInheritedPathCandidate() throws {
        let pathDirectory = temporaryDirectory.appendingPathComponent(
            "hostile-path",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: pathDirectory,
            withIntermediateDirectories: true
        )
        let marker = temporaryDirectory.appendingPathComponent(
            "path-node-executed"
        )
        let hostileNode = pathDirectory.appendingPathComponent("node")
        try makeFile(
            hostileNode,
            contents: """
            #!/bin/sh
            /usr/bin/touch '\(marker.path)'
            printf '%s\\n' 'v99.0.0'
            """,
            executable: true
        )

        let located = RuntimeLocator.locateNode(
            environment: ["PATH": pathDirectory.path]
        )

        XCTAssertNotEqual(
            located,
            hostileNode.standardizedFileURL.resolvingSymlinksInPath()
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: marker.path))
    }

    func testLocateNodeFindsNewestStrictNVMVersionWithoutNVMEnvironment()
        throws
    {
        let home = temporaryDirectory.appendingPathComponent(
            "finder-home",
            isDirectory: true
        )
        let versions = home
            .appendingPathComponent(".nvm", isDirectory: true)
            .appendingPathComponent("versions", isDirectory: true)
            .appendingPathComponent("node", isDirectory: true)
        for (name, reportedVersion) in [
            ("v20.12.2", "v20.12.2"),
            ("v22.9.0", "v22.9.0"),
            ("v22.10.0", "v22.10.0"),
            ("v17.99.0", "v99.0.0"),
            ("v023.0.0", "v99.0.0"),
            ("v23.0", "v99.0.0"),
            ("v23.0.0-rc.1", "v99.0.0"),
            ("latest", "v99.0.0"),
        ] {
            let node = versions
                .appendingPathComponent(name, isDirectory: true)
                .appendingPathComponent("bin", isDirectory: true)
                .appendingPathComponent("node")
            try FileManager.default.createDirectory(
                at: node.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try makeNode(node, version: reportedVersion)
        }

        let located = RuntimeLocator.locateNode(
            environment: [
                "HOME": home.path,
                "PATH": temporaryDirectory.path,
            ]
        )

        XCTAssertEqual(
            located,
            versions
                .appendingPathComponent("v22.10.0", isDirectory: true)
                .appendingPathComponent("bin", isDirectory: true)
                .appendingPathComponent("node")
        )
    }

    func testNVMDiscoveryInspectsAtMostTheBoundedEntryLimit() throws {
        let home = temporaryDirectory.appendingPathComponent(
            "bounded-home",
            isDirectory: true
        )
        let versions = home
            .appendingPathComponent(".nvm", isDirectory: true)
            .appendingPathComponent("versions", isDirectory: true)
            .appendingPathComponent("node", isDirectory: true)
        for patch in 0..<(RuntimeLocator.maximumNVMVersionEntries + 12) {
            try FileManager.default.createDirectory(
                at: versions.appendingPathComponent(
                    "v20.0.\(patch)",
                    isDirectory: true
                ),
                withIntermediateDirectories: true
            )
        }

        let candidates = RuntimeLocator.nvmNodeCandidates(home: home)
        let patches = candidates.compactMap {
            Int(
                $0
                    .deletingLastPathComponent()
                    .deletingLastPathComponent()
                    .lastPathComponent
                    .split(separator: ".")
                    .last ?? ""
            )
        }

        XCTAssertEqual(
            candidates.count,
            RuntimeLocator.maximumNVMVersionEntries
        )
        XCTAssertEqual(patches, patches.sorted(by: >))
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

    func testNodeRuntimeReadinessRequiresJavaScriptExecution() throws {
        let ready = temporaryDirectory.appendingPathComponent("ready-node")
        try makeFile(
            ready,
            contents: """
            #!/bin/sh
            if [ "${1-}" = "--version" ]; then
              printf '%s\\n' 'v22.22.3'
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
            """,
            executable: true
        )
        let versionOnly = temporaryDirectory.appendingPathComponent(
            "version-only-node"
        )
        try makeNode(versionOnly, version: "v22.22.3")

        XCTAssertTrue(
            RuntimeLocator.nodeRuntimeIsReady(at: ready)
        )
        XCTAssertEqual(
            RuntimeLocator.supportedNodeMajorVersion(at: versionOnly),
            22
        )
        XCTAssertFalse(
            RuntimeLocator.nodeRuntimeIsReady(at: versionOnly)
        )
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

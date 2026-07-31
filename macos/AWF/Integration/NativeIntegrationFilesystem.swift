import CryptoKit
import Darwin
import Foundation

enum NativeIntegrationFailure: String, Error, Equatable, Sendable {
    case payloadUnavailable
    case payloadInvalid
    case runtimeIncompatible
    case unsafeLayout
    case invalidLedger
    case invalidActivation
    case noRollbackCandidate
    case ioFailure
    case injectedFailure
}

enum NativeIntegrationFilesystem {
    static let directoryMode: mode_t = 0o700
    static let executableMode: mode_t = 0o700
    static let dataMode: mode_t = 0o600
    static let maximumHelperBytes: Int64 = 64 * 1_024 * 1_024
    static let maximumRuntimeBytes: Int64 = 256 * 1_024 * 1_024

    struct Lock {
        fileprivate let descriptor: Int32

        func unlock() {
            _ = flock(descriptor, LOCK_UN)
            _ = Darwin.close(descriptor)
        }
    }

    struct PublishedEntry: Equatable {
        enum Kind: Equatable {
            case created
            case swapped
        }

        let stagedURL: URL
        let installedURL: URL
        let kind: Kind
    }

    struct SecureFile: Equatable {
        let byteCount: Int64
        let sha256: String
    }

    static func entryExists(_ url: URL) -> Bool {
        var status = stat()
        if lstat(url.path, &status) == 0 {
            return true
        }
        return errno != ENOENT
    }

    static func requireSecureDirectory(_ url: URL) throws {
        var status = stat()
        guard
            lstat(url.path, &status) == 0,
            (status.st_mode & S_IFMT) == S_IFDIR,
            status.st_uid == geteuid(),
            status.st_mode & 0o077 == 0
        else {
            throw NativeIntegrationFailure.unsafeLayout
        }
    }

    static func ensureSecureDirectory(_ url: URL) throws {
        if mkdir(url.path, directoryMode) != 0, errno != EEXIST {
            throw NativeIntegrationFailure.ioFailure
        }
        try requireSecureDirectory(url)
    }

    static func requireSecureRegularFile(
        _ url: URL,
        executable: Bool,
        maximumBytes: Int64? = nil
    ) throws -> stat {
        var status = stat()
        guard
            lstat(url.path, &status) == 0,
            (status.st_mode & S_IFMT) == S_IFREG,
            status.st_uid == geteuid(),
            status.st_nlink == 1,
            status.st_mode & (S_IWGRP | S_IWOTH) == 0,
            status.st_size > 0,
            maximumBytes.map({ status.st_size <= $0 }) ?? true,
            !executable || access(url.path, X_OK) == 0
        else {
            throw NativeIntegrationFailure.unsafeLayout
        }
        return status
    }

    static func validatePayloadExecutable(
        _ url: URL,
        maximumBytes: Int64
    ) throws -> SecureFile {
        let descriptor = url.path.withCString {
            Darwin.open($0, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        }
        guard descriptor >= 0 else {
            throw NativeIntegrationFailure.payloadUnavailable
        }
        defer {
            _ = Darwin.close(descriptor)
        }

        var status = stat()
        guard
            fstat(descriptor, &status) == 0,
            (status.st_mode & S_IFMT) == S_IFREG,
            status.st_size > 0,
            status.st_size <= maximumBytes,
            status.st_mode & (S_IWGRP | S_IWOTH) == 0,
            access(url.path, X_OK) == 0
        else {
            throw NativeIntegrationFailure.payloadInvalid
        }
        return SecureFile(
            byteCount: status.st_size,
            sha256: try digest(descriptor: descriptor)
        )
    }

    static func secureFile(
        at url: URL,
        executable: Bool,
        maximumBytes: Int64
    ) throws -> SecureFile {
        let descriptor = url.path.withCString {
            Darwin.open($0, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        }
        guard descriptor >= 0 else {
            throw NativeIntegrationFailure.unsafeLayout
        }
        defer {
            _ = Darwin.close(descriptor)
        }

        var status = stat()
        guard
            fstat(descriptor, &status) == 0,
            (status.st_mode & S_IFMT) == S_IFREG,
            status.st_uid == geteuid(),
            status.st_nlink == 1,
            status.st_mode & (S_IWGRP | S_IWOTH) == 0,
            status.st_size > 0,
            status.st_size <= maximumBytes,
            !executable || access(url.path, X_OK) == 0
        else {
            throw NativeIntegrationFailure.unsafeLayout
        }
        return SecureFile(
            byteCount: status.st_size,
            sha256: try digest(descriptor: descriptor)
        )
    }

    static func readSecureData(
        at url: URL,
        maximumBytes: Int
    ) throws -> Data {
        guard maximumBytes > 0 else {
            throw NativeIntegrationFailure.ioFailure
        }
        let descriptor = url.path.withCString {
            Darwin.open($0, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        }
        guard descriptor >= 0 else {
            throw NativeIntegrationFailure.unsafeLayout
        }
        defer {
            _ = Darwin.close(descriptor)
        }

        var status = stat()
        guard
            fstat(descriptor, &status) == 0,
            (status.st_mode & S_IFMT) == S_IFREG,
            status.st_uid == geteuid(),
            status.st_nlink == 1,
            status.st_mode & (S_IWGRP | S_IWOTH) == 0,
            status.st_size > 0,
            status.st_size <= maximumBytes
        else {
            throw NativeIntegrationFailure.unsafeLayout
        }

        var bytes = [UInt8](repeating: 0, count: Int(status.st_size))
        try readExactly(descriptor: descriptor, into: &bytes)
        return Data(bytes)
    }

    static func acquireLock(
        productRoot: URL,
        filename: String
    ) throws -> Lock {
        try requireSimpleName(filename)
        try ensureSecureDirectory(productRoot)
        let lockURL = productRoot.appendingPathComponent(filename)
        let descriptor = lockURL.path.withCString {
            Darwin.open(
                $0,
                O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW,
                dataMode
            )
        }
        guard descriptor >= 0 else {
            throw NativeIntegrationFailure.unsafeLayout
        }

        var status = stat()
        guard
            fstat(descriptor, &status) == 0,
            (status.st_mode & S_IFMT) == S_IFREG,
            status.st_uid == geteuid(),
            status.st_nlink == 1,
            status.st_mode & 0o077 == 0
        else {
            _ = Darwin.close(descriptor)
            throw NativeIntegrationFailure.unsafeLayout
        }
        guard flock(descriptor, LOCK_EX) == 0 else {
            _ = Darwin.close(descriptor)
            throw NativeIntegrationFailure.ioFailure
        }
        return Lock(descriptor: descriptor)
    }

    @discardableResult
    static func copyPayloadExecutable(
        from sourceURL: URL,
        to destinationURL: URL,
        maximumBytes: Int64,
        expectedSHA256: String
    ) throws -> SecureFile {
        try requireSimpleName(destinationURL.lastPathComponent)
        let source = sourceURL.path.withCString {
            Darwin.open($0, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        }
        guard source >= 0 else {
            throw NativeIntegrationFailure.payloadUnavailable
        }
        defer {
            _ = Darwin.close(source)
        }

        var sourceStatus = stat()
        guard
            fstat(source, &sourceStatus) == 0,
            (sourceStatus.st_mode & S_IFMT) == S_IFREG,
            sourceStatus.st_size > 0,
            sourceStatus.st_size <= maximumBytes,
            sourceStatus.st_mode & (S_IWGRP | S_IWOTH) == 0,
            access(sourceURL.path, X_OK) == 0
        else {
            throw NativeIntegrationFailure.payloadInvalid
        }

        let destination = destinationURL.path.withCString {
            Darwin.open(
                $0,
                O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW,
                executableMode
            )
        }
        guard destination >= 0 else {
            throw NativeIntegrationFailure.unsafeLayout
        }
        var shouldRemoveDestination = true
        defer {
            _ = Darwin.close(destination)
            if shouldRemoveDestination {
                _ = Darwin.unlink(destinationURL.path)
            }
        }

        var hasher = SHA256()
        var remaining = sourceStatus.st_size
        var buffer = [UInt8](repeating: 0, count: 64 * 1_024)
        while remaining > 0 {
            let requested = min(Int64(buffer.count), remaining)
            let count = buffer.withUnsafeMutableBytes { pointer in
                Darwin.read(source, pointer.baseAddress, Int(requested))
            }
            if count < 0, errno == EINTR {
                continue
            }
            guard count > 0 else {
                throw NativeIntegrationFailure.ioFailure
            }
            try buffer.withUnsafeBytes { pointer in
                guard let baseAddress = pointer.baseAddress else {
                    throw NativeIntegrationFailure.ioFailure
                }
                try writeAll(
                    descriptor: destination,
                    bytes: baseAddress,
                    count: count
                )
            }
            hasher.update(data: Data(buffer[0..<count]))
            remaining -= Int64(count)
        }
        guard
            fchmod(destination, executableMode) == 0,
            fsync(destination) == 0
        else {
            throw NativeIntegrationFailure.ioFailure
        }
        let digest = hexDigest(hasher.finalize())
        guard digest == expectedSHA256 else {
            throw NativeIntegrationFailure.payloadInvalid
        }
        shouldRemoveDestination = false
        try syncDirectory(destinationURL.deletingLastPathComponent())
        return SecureFile(
            byteCount: sourceStatus.st_size,
            sha256: digest
        )
    }

    static func createDataFile(
        at url: URL,
        data: Data
    ) throws {
        try requireSimpleName(url.lastPathComponent)
        let descriptor = url.path.withCString {
            Darwin.open(
                $0,
                O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW,
                dataMode
            )
        }
        guard descriptor >= 0 else {
            throw NativeIntegrationFailure.unsafeLayout
        }
        var shouldRemove = true
        defer {
            _ = Darwin.close(descriptor)
            if shouldRemove {
                _ = Darwin.unlink(url.path)
            }
        }

        try data.withUnsafeBytes { pointer in
            guard let baseAddress = pointer.baseAddress else {
                if data.isEmpty {
                    return
                }
                throw NativeIntegrationFailure.ioFailure
            }
            try writeAll(
                descriptor: descriptor,
                bytes: baseAddress,
                count: data.count
            )
        }
        guard
            fchmod(descriptor, dataMode) == 0,
            fsync(descriptor) == 0
        else {
            throw NativeIntegrationFailure.ioFailure
        }
        shouldRemove = false
        try syncDirectory(url.deletingLastPathComponent())
    }

    static func publishFile(
        stagedURL: URL,
        installedURL: URL
    ) throws -> PublishedEntry {
        _ = try requireSecureRegularFile(
            stagedURL,
            executable: access(stagedURL.path, X_OK) == 0
        )
        if entryExists(installedURL) {
            _ = try requireSecureRegularFile(
                installedURL,
                executable: false
            )
            try rename(
                stagedURL,
                installedURL,
                flags: UInt32(RENAME_SWAP)
            )
            return PublishedEntry(
                stagedURL: stagedURL,
                installedURL: installedURL,
                kind: .swapped
            )
        }
        try rename(
            stagedURL,
            installedURL,
            flags: UInt32(RENAME_EXCL)
        )
        return PublishedEntry(
            stagedURL: stagedURL,
            installedURL: installedURL,
            kind: .created
        )
    }

    static func publishDirectory(
        stagedURL: URL,
        installedURL: URL
    ) throws {
        try requireSecureDirectory(stagedURL)
        guard !entryExists(installedURL) else {
            throw NativeIntegrationFailure.unsafeLayout
        }
        try rename(
            stagedURL,
            installedURL,
            flags: UInt32(RENAME_EXCL)
        )
    }

    static func rollback(_ entry: PublishedEntry) throws {
        switch entry.kind {
        case .created:
            try unlinkFileIfPresent(entry.installedURL)
        case .swapped:
            try rename(
                entry.stagedURL,
                entry.installedURL,
                flags: UInt32(RENAME_SWAP)
            )
        }
    }

    static func unlinkFileIfPresent(_ url: URL) throws {
        let parent = url.deletingLastPathComponent()
        let parentDescriptor = try openDirectory(parent)
        defer {
            _ = Darwin.close(parentDescriptor)
        }
        let result = url.lastPathComponent.withCString {
            unlinkat(parentDescriptor, $0, 0)
        }
        if result != 0, errno != ENOENT {
            throw NativeIntegrationFailure.unsafeLayout
        }
        try sync(descriptor: parentDescriptor)
    }

    static func removeReleaseIfOwned(
        versionsURL: URL,
        releaseID: String,
        expectedSHA256: String,
        afterRuntimeRemoval: () throws -> Void = {}
    ) throws -> Bool {
        try requireSimpleName(releaseID)
        let versionsDescriptor = try openDirectory(versionsURL)
        defer {
            _ = Darwin.close(versionsDescriptor)
        }
        let releaseDescriptor = releaseID.withCString {
            openat(
                versionsDescriptor,
                $0,
                O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW
            )
        }
        if releaseDescriptor < 0 {
            if errno == ENOENT {
                return true
            }
            throw NativeIntegrationFailure.unsafeLayout
        }
        defer {
            _ = Darwin.close(releaseDescriptor)
        }

        let runtimeDescriptor = "awf-node".withCString {
            openat(
                releaseDescriptor,
                $0,
                O_RDONLY | O_CLOEXEC | O_NOFOLLOW
            )
        }
        if runtimeDescriptor < 0 {
            if errno == ENOENT {
                return try removeReleaseDirectoryIfEmpty(
                    versionsDescriptor: versionsDescriptor,
                    releaseID: releaseID
                )
            }
            throw NativeIntegrationFailure.unsafeLayout
        }
        defer {
            _ = Darwin.close(runtimeDescriptor)
        }
        var runtimeStatus = stat()
        guard
            fstat(runtimeDescriptor, &runtimeStatus) == 0,
            (runtimeStatus.st_mode & S_IFMT) == S_IFREG,
            runtimeStatus.st_uid == geteuid(),
            runtimeStatus.st_nlink == 1,
            runtimeStatus.st_mode & (S_IWGRP | S_IWOTH) == 0,
            runtimeStatus.st_size > 0,
            runtimeStatus.st_size <= maximumRuntimeBytes,
            try digest(descriptor: runtimeDescriptor) == expectedSHA256
        else {
            return false
        }

        let runtimeResult = "awf-node".withCString {
            unlinkat(releaseDescriptor, $0, 0)
        }
        if runtimeResult != 0, errno != ENOENT {
            throw NativeIntegrationFailure.unsafeLayout
        }
        try sync(descriptor: releaseDescriptor)
        try afterRuntimeRemoval()

        return try removeReleaseDirectoryIfEmpty(
            versionsDescriptor: versionsDescriptor,
            releaseID: releaseID
        )
    }

    static func removeDirectoryIfEmpty(_ url: URL) throws -> Bool {
        let parentDescriptor = try openDirectory(
            url.deletingLastPathComponent()
        )
        defer {
            _ = Darwin.close(parentDescriptor)
        }
        let result = url.lastPathComponent.withCString {
            unlinkat(parentDescriptor, $0, AT_REMOVEDIR)
        }
        if result == 0 {
            try sync(descriptor: parentDescriptor)
            return true
        }
        if errno == ENOTEMPTY || errno == EEXIST {
            return false
        }
        if errno == ENOENT {
            return true
        }
        throw NativeIntegrationFailure.unsafeLayout
    }

    static func childNames(_ directory: URL) throws -> [String] {
        try requireSecureDirectory(directory)
        do {
            return try FileManager.default.contentsOfDirectory(
                atPath: directory.path
            )
        } catch {
            throw NativeIntegrationFailure.ioFailure
        }
    }

    static func syncDirectory(_ url: URL) throws {
        let descriptor = try openDirectory(url)
        defer {
            _ = Darwin.close(descriptor)
        }
        try sync(descriptor: descriptor)
    }

    private static func rename(
        _ sourceURL: URL,
        _ destinationURL: URL,
        flags: UInt32
    ) throws {
        let sourceParent = sourceURL.deletingLastPathComponent()
        let destinationParent = destinationURL.deletingLastPathComponent()
        let sourceDescriptor = try openDirectory(sourceParent)
        defer {
            _ = Darwin.close(sourceDescriptor)
        }
        let destinationDescriptor = try openDirectory(destinationParent)
        defer {
            _ = Darwin.close(destinationDescriptor)
        }
        let result = sourceURL.lastPathComponent.withCString { source in
            destinationURL.lastPathComponent.withCString { destination in
                renameatx_np(
                    sourceDescriptor,
                    source,
                    destinationDescriptor,
                    destination,
                    flags
                )
            }
        }
        guard result == 0 else {
            throw NativeIntegrationFailure.ioFailure
        }
        try sync(descriptor: sourceDescriptor)
        if sourceParent.standardizedFileURL !=
            destinationParent.standardizedFileURL
        {
            try sync(descriptor: destinationDescriptor)
        }
    }

    private static func openDirectory(_ url: URL) throws -> Int32 {
        let descriptor = url.path.withCString {
            Darwin.open(
                $0,
                O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW
            )
        }
        guard descriptor >= 0 else {
            throw NativeIntegrationFailure.unsafeLayout
        }
        var status = stat()
        guard
            fstat(descriptor, &status) == 0,
            (status.st_mode & S_IFMT) == S_IFDIR,
            status.st_uid == geteuid(),
            status.st_mode & 0o077 == 0
        else {
            _ = Darwin.close(descriptor)
            throw NativeIntegrationFailure.unsafeLayout
        }
        return descriptor
    }

    private static func removeReleaseDirectoryIfEmpty(
        versionsDescriptor: Int32,
        releaseID: String
    ) throws -> Bool {
        let removeResult = releaseID.withCString {
            unlinkat(versionsDescriptor, $0, AT_REMOVEDIR)
        }
        if removeResult == 0 {
            try sync(descriptor: versionsDescriptor)
            return true
        }
        if errno == ENOTEMPTY || errno == EEXIST {
            return false
        }
        if errno == ENOENT {
            return true
        }
        throw NativeIntegrationFailure.unsafeLayout
    }

    private static func requireSimpleName(_ value: String) throws {
        guard
            !value.isEmpty,
            value != ".",
            value != "..",
            !value.contains("/"),
            !value.utf8.contains(0)
        else {
            throw NativeIntegrationFailure.unsafeLayout
        }
    }

    private static func digest(descriptor: Int32) throws -> String {
        guard lseek(descriptor, 0, SEEK_SET) >= 0 else {
            throw NativeIntegrationFailure.ioFailure
        }
        var hasher = SHA256()
        var buffer = [UInt8](repeating: 0, count: 64 * 1_024)
        while true {
            let bufferCount = buffer.count
            let count = buffer.withUnsafeMutableBytes { pointer in
                Darwin.read(descriptor, pointer.baseAddress, bufferCount)
            }
            if count < 0, errno == EINTR {
                continue
            }
            guard count >= 0 else {
                throw NativeIntegrationFailure.ioFailure
            }
            if count == 0 {
                break
            }
            hasher.update(data: Data(buffer[0..<count]))
        }
        return hexDigest(hasher.finalize())
    }

    private static func hexDigest<Digest: Sequence>(
        _ digest: Digest
    ) -> String where Digest.Element == UInt8 {
        digest.map { String(format: "%02x", $0) }.joined()
    }

    private static func readExactly(
        descriptor: Int32,
        into bytes: inout [UInt8]
    ) throws {
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
                throw NativeIntegrationFailure.ioFailure
            }
            offset += count
        }
    }

    private static func writeAll(
        descriptor: Int32,
        bytes: UnsafeRawPointer,
        count: Int
    ) throws {
        var offset = 0
        while offset < count {
            let written = Darwin.write(
                descriptor,
                bytes.advanced(by: offset),
                count - offset
            )
            if written < 0, errno == EINTR {
                continue
            }
            guard written > 0 else {
                throw NativeIntegrationFailure.ioFailure
            }
            offset += written
        }
    }

    private static func sync(descriptor: Int32) throws {
        guard fsync(descriptor) == 0 else {
            throw NativeIntegrationFailure.ioFailure
        }
    }
}

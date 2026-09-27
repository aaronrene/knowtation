import CryptoKit
import Foundation
import XCTest
@testable import KnowtationSecurity

final class RuntimeVerifierTests: XCTestCase {
    func testVerifiesExactRegularFile() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("runtime/file.txt")
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = Data("known payload".utf8)
        try data.write(to: file)
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        let manifest = RuntimeManifest(
            schema: 1,
            releaseVersion: KnowtationReleaseContract.version,
            releaseBuild: KnowtationReleaseContract.build,
            architecture: KnowtationReleaseContract.architecture,
            files: [.init(path: "runtime/file.txt", sha256: digest, bytes: UInt64(data.count), executable: false)]
        )
        XCTAssertNoThrow(try RuntimeVerifier.verifyTree(root: root, manifest: manifest))
    }

    func testRejectsDigestSubstitution() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("file.txt")
        try Data("substituted".utf8).write(to: file)
        let manifest = RuntimeManifest(
            schema: 1,
            releaseVersion: KnowtationReleaseContract.version,
            releaseBuild: KnowtationReleaseContract.build,
            architecture: KnowtationReleaseContract.architecture,
            files: [.init(path: "file.txt", sha256: String(repeating: "0", count: 64), bytes: 11, executable: false)]
        )
        XCTAssertThrowsError(try RuntimeVerifier.verifyTree(root: root, manifest: manifest))
    }

    func testRejectsTraversalPath() throws {
        let manifest = RuntimeManifest(
            schema: 1,
            releaseVersion: KnowtationReleaseContract.version,
            releaseBuild: KnowtationReleaseContract.build,
            architecture: KnowtationReleaseContract.architecture,
            files: [.init(path: "../escape", sha256: String(repeating: "0", count: 64), bytes: 0, executable: false)]
        )
        XCTAssertThrowsError(try RuntimeVerifier.verifyTree(root: FileManager.default.temporaryDirectory, manifest: manifest)) {
            XCTAssertEqual($0 as? RuntimeVerificationError, .invalidPath("../escape"))
        }
    }

    func testRejectsUnmanifestedFile() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let expectedData = Data()
        try expectedData.write(to: root.appendingPathComponent("expected.txt"))
        try Data("unexpected".utf8).write(to: root.appendingPathComponent("substitution.txt"))
        let manifest = RuntimeManifest(
            schema: 1,
            releaseVersion: KnowtationReleaseContract.version,
            releaseBuild: KnowtationReleaseContract.build,
            architecture: KnowtationReleaseContract.architecture,
            files: [.init(
                path: "expected.txt",
                sha256: SHA256.hash(data: expectedData).map { String(format: "%02x", $0) }.joined(),
                bytes: 0,
                executable: false
            )]
        )
        XCTAssertThrowsError(try RuntimeVerifier.verifyTree(root: root, manifest: manifest)) {
            XCTAssertEqual($0 as? RuntimeVerificationError, .extraFile("substitution.txt"))
        }
    }

    func testRejectsDuplicateManifestEntry() throws {
        let entry = RuntimeManifest.Entry(
            path: "file.txt",
            sha256: String(repeating: "0", count: 64),
            bytes: 0,
            executable: false
        )
        let manifest = RuntimeManifest(
            schema: 1,
            releaseVersion: KnowtationReleaseContract.version,
            releaseBuild: KnowtationReleaseContract.build,
            architecture: KnowtationReleaseContract.architecture,
            files: [entry, entry]
        )
        XCTAssertThrowsError(try RuntimeVerifier.verifyTree(root: FileManager.default.temporaryDirectory, manifest: manifest)) {
            XCTAssertEqual($0 as? RuntimeVerificationError, .duplicateEntry("file.txt"))
        }
    }
}

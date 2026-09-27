import CryptoKit
import Foundation
import XCTest
@testable import KnowtationSecurity

final class UpdateManifestTests: XCTestCase {
    private func manifest(targetBuild: Int = 101, floor: Int = 100) -> SignedUpdateManifest {
        SignedUpdateManifest(
            schema: 1,
            channel: "stable",
            platform: "macos",
            architecture: "arm64",
            keyID: "release-key-1",
            issuedAt: 1_000,
            expiresAt: 2_000,
            source: .init(minimumBuild: 100, maximumBuild: 100),
            target: .init(
                version: "0.1.1",
                build: targetBuild,
                packageURL: "https://releases.knowtation.store/stable/Knowtation.pkg",
                packageSHA256: String(repeating: "a", count: 64),
                packageBytes: 1024
            ),
            minimumAcceptedBuild: floor
        )
    }

    private let context = UpdateEvaluationContext(
        currentBuild: 100,
        persistedFloor: 100,
        now: 1_500
    )

    func testAcceptsValidUpgrade() throws {
        XCTAssertEqual(
            try UpdateManifestVerifier.evaluate(manifest(), expectedKeyID: "release-key-1", context: context).build,
            101
        )
    }

    func testRejectsRollbackAndReplay() {
        XCTAssertThrowsError(try UpdateManifestVerifier.evaluate(
            manifest(targetBuild: 99, floor: 101),
            expectedKeyID: "release-key-1",
            context: context
        ))
    }

    func testRejectsExpiredManifest() {
        let expiredContext = UpdateEvaluationContext(currentBuild: 100, persistedFloor: 100, now: 3_000)
        XCTAssertThrowsError(try UpdateManifestVerifier.evaluate(
            manifest(), expectedKeyID: "release-key-1", context: expiredContext
        )) { XCTAssertEqual($0 as? UpdateRejection, .expired) }
    }

    func testRejectsWrongPlatformAndKey() {
        let wrongPlatform = UpdateEvaluationContext(
            currentBuild: 100, persistedFloor: 100, now: 1_500, platform: "linux"
        )
        XCTAssertThrowsError(try UpdateManifestVerifier.evaluate(
            manifest(), expectedKeyID: "release-key-1", context: wrongPlatform
        )) { XCTAssertEqual($0 as? UpdateRejection, .wrongPlatform) }
        XCTAssertThrowsError(try UpdateManifestVerifier.evaluate(
            manifest(), expectedKeyID: "release-key-2", context: context
        )) { XCTAssertEqual($0 as? UpdateRejection, .wrongKey) }
    }

    func testEd25519SignatureRejectsTamper() throws {
        let key = Curve25519.Signing.PrivateKey()
        let data = Data("manifest".utf8)
        let signature = try key.signature(for: data)
        XCTAssertNoThrow(try UpdateManifestVerifier.verifySignature(
            manifestData: data,
            signature: signature,
            publicKey: key.publicKey.rawRepresentation
        ))
        XCTAssertThrowsError(try UpdateManifestVerifier.verifySignature(
            manifestData: Data("tampered".utf8),
            signature: signature,
            publicKey: key.publicKey.rawRepresentation
        ))
    }
}

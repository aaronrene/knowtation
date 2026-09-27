import CryptoKit
import Foundation

public struct SignedUpdateManifest: Codable, Equatable, Sendable {
    public struct SourceRange: Codable, Equatable, Sendable {
        public let minimumBuild: Int
        public let maximumBuild: Int

        public init(minimumBuild: Int, maximumBuild: Int) {
            self.minimumBuild = minimumBuild
            self.maximumBuild = maximumBuild
        }
    }

    public struct Target: Codable, Equatable, Sendable {
        public let version: String
        public let build: Int
        public let packageURL: String
        public let packageSHA256: String
        public let packageBytes: UInt64

        public init(version: String, build: Int, packageURL: String, packageSHA256: String, packageBytes: UInt64) {
            self.version = version
            self.build = build
            self.packageURL = packageURL
            self.packageSHA256 = packageSHA256
            self.packageBytes = packageBytes
        }
    }

    public let schema: Int
    public let channel: String
    public let platform: String
    public let architecture: String
    public let keyID: String
    public let issuedAt: Int64
    public let expiresAt: Int64
    public let source: SourceRange
    public let target: Target
    public let minimumAcceptedBuild: Int

    public init(
        schema: Int,
        channel: String,
        platform: String,
        architecture: String,
        keyID: String,
        issuedAt: Int64,
        expiresAt: Int64,
        source: SourceRange,
        target: Target,
        minimumAcceptedBuild: Int
    ) {
        self.schema = schema
        self.channel = channel
        self.platform = platform
        self.architecture = architecture
        self.keyID = keyID
        self.issuedAt = issuedAt
        self.expiresAt = expiresAt
        self.source = source
        self.target = target
        self.minimumAcceptedBuild = minimumAcceptedBuild
    }
}

public struct UpdateEvaluationContext: Equatable, Sendable {
    public let currentBuild: Int
    public let persistedFloor: Int
    public let now: Int64
    public let channel: String
    public let platform: String
    public let architecture: String

    public init(
        currentBuild: Int,
        persistedFloor: Int,
        now: Int64,
        channel: String = "stable",
        platform: String = "macos",
        architecture: String = "arm64"
    ) {
        self.currentBuild = currentBuild
        self.persistedFloor = persistedFloor
        self.now = now
        self.channel = channel
        self.platform = platform
        self.architecture = architecture
    }
}

public enum UpdateRejection: Error, Equatable {
    case signatureInvalid
    case malformed
    case unsupportedSchema
    case wrongChannel
    case wrongPlatform
    case wrongArchitecture
    case wrongKey
    case notYetValid
    case expired
    case sourceMismatch
    case targetNotNewer
    case rollback
    case invalidPackage
}

public enum UpdateManifestVerifier {
    public static func verifySignature(
        manifestData: Data,
        signature: Data,
        publicKey: Data
    ) throws {
        let key: Curve25519.Signing.PublicKey
        do {
            key = try Curve25519.Signing.PublicKey(rawRepresentation: publicKey)
        } catch {
            throw UpdateRejection.signatureInvalid
        }
        guard key.isValidSignature(signature, for: manifestData) else {
            throw UpdateRejection.signatureInvalid
        }
    }

    public static func decode(_ data: Data) throws -> SignedUpdateManifest {
        do {
            return try JSONDecoder().decode(SignedUpdateManifest.self, from: data)
        } catch {
            throw UpdateRejection.malformed
        }
    }

    @discardableResult
    public static func evaluate(
        _ manifest: SignedUpdateManifest,
        expectedKeyID: String,
        context: UpdateEvaluationContext
    ) throws -> SignedUpdateManifest.Target {
        guard manifest.schema == 1 else { throw UpdateRejection.unsupportedSchema }
        guard manifest.channel == context.channel else { throw UpdateRejection.wrongChannel }
        guard manifest.platform == context.platform else { throw UpdateRejection.wrongPlatform }
        guard manifest.architecture == context.architecture else { throw UpdateRejection.wrongArchitecture }
        guard manifest.keyID == expectedKeyID else { throw UpdateRejection.wrongKey }
        guard manifest.issuedAt <= context.now else { throw UpdateRejection.notYetValid }
        guard manifest.expiresAt >= context.now, manifest.expiresAt > manifest.issuedAt else {
            throw UpdateRejection.expired
        }
        guard context.currentBuild >= manifest.source.minimumBuild,
              context.currentBuild <= manifest.source.maximumBuild else {
            throw UpdateRejection.sourceMismatch
        }
        guard manifest.target.build > context.currentBuild else {
            throw UpdateRejection.targetNotNewer
        }
        let floor = max(context.persistedFloor, manifest.minimumAcceptedBuild)
        guard manifest.target.build >= floor else { throw UpdateRejection.rollback }
        guard manifest.target.packageBytes > 0,
              manifest.target.packageSHA256.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
              let url = URL(string: manifest.target.packageURL),
              url.scheme == "https" else {
            throw UpdateRejection.invalidPackage
        }
        return manifest.target
    }
}

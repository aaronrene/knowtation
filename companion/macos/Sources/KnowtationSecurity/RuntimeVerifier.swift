import CryptoKit
import Foundation
import Security

public struct RuntimeManifest: Codable, Equatable {
    public struct Entry: Codable, Equatable {
        public let path: String
        public let sha256: String
        public let bytes: UInt64
        public let executable: Bool

        public init(path: String, sha256: String, bytes: UInt64, executable: Bool) {
            self.path = path
            self.sha256 = sha256
            self.bytes = bytes
            self.executable = executable
        }
    }

    public let schema: Int
    public let releaseVersion: String
    public let releaseBuild: Int
    public let architecture: String
    public let files: [Entry]

    public init(schema: Int, releaseVersion: String, releaseBuild: Int, architecture: String, files: [Entry]) {
        self.schema = schema
        self.releaseVersion = releaseVersion
        self.releaseBuild = releaseBuild
        self.architecture = architecture
        self.files = files
    }
}

public enum RuntimeVerificationError: Error, Equatable {
    case invalidManifest
    case invalidPath(String)
    case duplicateEntry(String)
    case missingFile(String)
    case extraFile(String)
    case symbolicLink(String)
    case sizeMismatch(String)
    case digestMismatch(String)
    case executableMismatch(String)
    case invalidCodeSignature(String)
}

public enum RuntimeVerifier {
    public static func loadManifest(at url: URL) throws -> RuntimeManifest {
        let data = try Data(contentsOf: url, options: [.mappedIfSafe])
        let manifest = try JSONDecoder().decode(RuntimeManifest.self, from: data)
        guard manifest.schema == 1,
              manifest.releaseVersion == KnowtationReleaseContract.version,
              manifest.releaseBuild == KnowtationReleaseContract.build,
              manifest.architecture == KnowtationReleaseContract.architecture,
              !manifest.files.isEmpty else {
            throw RuntimeVerificationError.invalidManifest
        }
        return manifest
    }

    public static func verifyTree(root: URL, manifest: RuntimeManifest) throws {
        let verifiedRoot = root.resolvingSymlinksInPath().standardizedFileURL
        var expected = Set<String>()
        for entry in manifest.files {
            guard isSafeRelativePath(entry.path),
                  entry.sha256.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else {
                throw RuntimeVerificationError.invalidPath(entry.path)
            }
            guard expected.insert(entry.path).inserted else {
                throw RuntimeVerificationError.duplicateEntry(entry.path)
            }
        }

        var actual = Set<String>()
        let keys: [URLResourceKey] = [.isRegularFileKey, .isSymbolicLinkKey]
        guard let enumerator = FileManager.default.enumerator(
            at: verifiedRoot,
            includingPropertiesForKeys: keys,
            options: [],
            errorHandler: { _, _ in false }
        ) else {
            throw RuntimeVerificationError.invalidManifest
        }
        for case let url as URL in enumerator {
            let prefix = verifiedRoot.path.hasSuffix("/") ? verifiedRoot.path : verifiedRoot.path + "/"
            let values = try url.resourceValues(forKeys: Set(keys))
            if values.isSymbolicLink == true {
                throw RuntimeVerificationError.symbolicLink(url.lastPathComponent)
            }
            let resolvedPath = url.resolvingSymlinksInPath().standardizedFileURL.path
            guard resolvedPath.hasPrefix(prefix) else {
                throw RuntimeVerificationError.invalidPath(resolvedPath)
            }
            let relative = String(resolvedPath.dropFirst(prefix.count))
            if values.isRegularFile == true, relative != "runtime-manifest.json" {
                actual.insert(relative)
            }
        }
        if let missing = expected.subtracting(actual).sorted().first {
            throw RuntimeVerificationError.missingFile(missing)
        }
        if let extra = actual.subtracting(expected).sorted().first {
            throw RuntimeVerificationError.extraFile(extra)
        }

        for entry in manifest.files {
            let url = verifiedRoot.appendingPathComponent(entry.path, isDirectory: false)
            let attributes: [FileAttributeKey: Any]
            do {
                attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            } catch {
                throw RuntimeVerificationError.missingFile(entry.path)
            }
            if attributes[.type] as? FileAttributeType == .typeSymbolicLink {
                throw RuntimeVerificationError.symbolicLink(entry.path)
            }
            let size = (attributes[.size] as? NSNumber)?.uint64Value
            guard size == entry.bytes else {
                throw RuntimeVerificationError.sizeMismatch(entry.path)
            }
            let permissions = (attributes[.posixPermissions] as? NSNumber)?.uint16Value ?? 0
            let isExecutable = permissions & 0o111 != 0
            guard isExecutable == entry.executable else {
                throw RuntimeVerificationError.executableMismatch(entry.path)
            }
            let data = try Data(contentsOf: url, options: [.mappedIfSafe])
            let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            guard digest == entry.sha256 else {
                throw RuntimeVerificationError.digestMismatch(entry.path)
            }
        }
    }

    public static func verifyCodeSignature(
        at url: URL,
        expectedIdentifier: String,
        expectedTeamIdentifier: String
    ) throws {
        var staticCode: SecStaticCode?
        let createStatus = SecStaticCodeCreateWithPath(url as CFURL, [], &staticCode)
        guard createStatus == errSecSuccess, let staticCode else {
            throw RuntimeVerificationError.invalidCodeSignature(url.path)
        }
        let checkStatus = SecStaticCodeCheckValidity(
            staticCode,
            SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckAllArchitectures),
            nil
        )
        guard checkStatus == errSecSuccess else {
            throw RuntimeVerificationError.invalidCodeSignature(url.path)
        }
        var information: CFDictionary?
        guard SecCodeCopySigningInformation(
            staticCode,
            SecCSFlags(rawValue: kSecCSSigningInformation),
            &information
        ) == errSecSuccess,
        let dictionary = information as? [String: Any],
        dictionary[kSecCodeInfoIdentifier as String] as? String == expectedIdentifier,
        dictionary[kSecCodeInfoTeamIdentifier as String] as? String == expectedTeamIdentifier else {
            throw RuntimeVerificationError.invalidCodeSignature(url.path)
        }
    }

    private static func isSafeRelativePath(_ path: String) -> Bool {
        guard !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\") else { return false }
        let components = path.split(separator: "/", omittingEmptySubsequences: false)
        return !components.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." })
    }
}

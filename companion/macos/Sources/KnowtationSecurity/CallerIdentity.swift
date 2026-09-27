import Foundation
import Security
import XPC

public struct CallerIdentity: Equatable, Sendable {
    public let identifier: String
    public let teamIdentifier: String

    public init(identifier: String, teamIdentifier: String) {
        self.identifier = identifier
        self.teamIdentifier = teamIdentifier
    }
}

public enum CallerIdentityError: Error, Equatable {
    case unsignedHost
    case missingAuditToken
    case invalidSignature
    case missingSigningInformation
    case teamMismatch
    case identifierDenied
}

public struct CallerIdentityPolicy: Sendable {
    public let teamIdentifier: String
    public let allowedIdentifiers: Set<String>

    public init(teamIdentifier: String, allowedIdentifiers: Set<String>) {
        self.teamIdentifier = teamIdentifier
        self.allowedIdentifiers = allowedIdentifiers
    }

    public func evaluate(_ identity: CallerIdentity) throws -> CallerIdentity {
        guard identity.teamIdentifier == teamIdentifier else {
            throw CallerIdentityError.teamMismatch
        }
        guard allowedIdentifiers.contains(identity.identifier) else {
            throw CallerIdentityError.identifierDenied
        }
        return identity
    }
}

public enum CallerIdentityValidator {
    public static func hostTeamIdentifier() throws -> String {
        var selfCode: SecCode?
        guard SecCodeCopySelf([], &selfCode) == errSecSuccess, let selfCode else {
            throw CallerIdentityError.unsignedHost
        }
        return try signingIdentity(for: selfCode).teamIdentifier
    }

    public static func validate(
        message: xpc_object_t,
        allowedIdentifiers: Set<String> = KnowtationReleaseContract.allowedCallerIdentifiers
    ) throws -> CallerIdentity {
        let teamIdentifier = try hostTeamIdentifier()
        var guestCode: SecCode?
        let guestStatus = SecCodeCreateWithXPCMessage(message, [], &guestCode)
        guard guestStatus == errSecSuccess, let guestCode else {
            throw CallerIdentityError.invalidSignature
        }

        guard SecCodeCheckValidity(guestCode, [], nil) == errSecSuccess else {
            throw CallerIdentityError.invalidSignature
        }
        let identity = try signingIdentity(for: guestCode)
        return try CallerIdentityPolicy(
            teamIdentifier: teamIdentifier,
            allowedIdentifiers: allowedIdentifiers
        ).evaluate(identity)
    }

    public static func signingIdentity(for code: SecCode) throws -> CallerIdentity {
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else {
            throw CallerIdentityError.missingSigningInformation
        }
        var information: CFDictionary?
        let status = SecCodeCopySigningInformation(
            staticCode,
            SecCSFlags(rawValue: kSecCSSigningInformation),
            &information
        )
        guard status == errSecSuccess,
              let dictionary = information as? [String: Any],
              let identifier = dictionary[kSecCodeInfoIdentifier as String] as? String,
              let teamIdentifier = dictionary[kSecCodeInfoTeamIdentifier as String] as? String,
              !identifier.isEmpty,
              !teamIdentifier.isEmpty else {
            throw CallerIdentityError.missingSigningInformation
        }
        return CallerIdentity(identifier: identifier, teamIdentifier: teamIdentifier)
    }
}

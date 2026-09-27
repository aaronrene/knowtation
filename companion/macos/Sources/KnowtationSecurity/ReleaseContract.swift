import Foundation

public enum KnowtationReleaseContract {
    public static let version = "0.1.0"
    public static let build = 100
    public static let minimumMacOS = "14.0"
    public static let architecture = "arm64"

    public static let appIdentifier = "store.knowtation.companion"
    public static let custodyIdentifier = "store.knowtation.companion.custody"
    public static let cliIdentifier = "store.knowtation.cli"
    public static let mcpIdentifier = "store.knowtation.mcp"
    public static let nodeIdentifier = "store.knowtation.runtime.node"
    public static let packageIdentifier = "store.knowtation.pkg"
    public static let custodyMachService = "store.knowtation.companion.custody"
    public static let custodyLaunchAgentPlist = "store.knowtation.companion.custody.plist"
    public static let keychainService = "store.knowtation.companion"
    public static let hostedOrigin = "https://mcp.knowtation.store"
    public static let nativeOAuthIssuer = "https://mcp.knowtation.store/api/v1/auth/native"

    public static let allowedCallerIdentifiers: Set<String> = [
        appIdentifier,
        cliIdentifier,
        mcpIdentifier,
    ]
}

public enum KnowtationRuntimeMode: String, Codable, CaseIterable {
    case app
    case cli
    case mcp

    public var requiredCallerIdentifier: String {
        switch self {
        case .app: return KnowtationReleaseContract.appIdentifier
        case .cli: return KnowtationReleaseContract.cliIdentifier
        case .mcp: return KnowtationReleaseContract.mcpIdentifier
        }
    }
}

import Darwin
import Foundation

public enum RuntimeLaunchError: Error, CustomStringConvertible {
    case appNotInstalled
    case capabilityUnavailable(String)
    case spawnFailed(Int32)
    case invalidRuntime(String)

    public var description: String {
        switch self {
        case .appNotInstalled:
            return "Knowtation.app is not installed at /Applications/Knowtation.app"
        case .capabilityUnavailable(let reason):
            return "custody capability unavailable: \(reason)"
        case .spawnFailed(let status):
            return "bundled runtime could not start (status \(status))"
        case .invalidRuntime(let reason):
            return "bundled runtime verification failed: \(reason)"
        }
    }
}

public final class RuntimeLauncher {
    public let mode: KnowtationRuntimeMode

    public init(mode: KnowtationRuntimeMode) {
        self.mode = mode
    }

    @discardableResult
    public func run(arguments: [String]) throws -> Int32 {
        let appURL = try resolveAppURL()
        let resourcesURL = appURL.appendingPathComponent("Contents/Resources", isDirectory: true)
        let runtimeURL = resourcesURL.appendingPathComponent("runtime", isDirectory: true)
        let manifestURL = resourcesURL.appendingPathComponent("runtime-manifest.json", isDirectory: false)
        let nodeURL = runtimeURL.appendingPathComponent("node/bin/node", isDirectory: false)
        let entryURL = runtimeURL.appendingPathComponent("companion/runtime/main.mjs", isDirectory: false)

        do {
            let teamIdentifier = try CallerIdentityValidator.hostTeamIdentifier()
            try RuntimeVerifier.verifyCodeSignature(
                at: appURL,
                expectedIdentifier: KnowtationReleaseContract.appIdentifier,
                expectedTeamIdentifier: teamIdentifier
            )
            let manifest = try RuntimeVerifier.loadManifest(at: manifestURL)
            try RuntimeVerifier.verifyTree(root: resourcesURL, manifest: manifest)
            try RuntimeVerifier.verifyCodeSignature(
                at: nodeURL,
                expectedIdentifier: KnowtationReleaseContract.nodeIdentifier,
                expectedTeamIdentifier: teamIdentifier
            )
        } catch {
            throw RuntimeLaunchError.invalidRuntime(String(describing: error))
        }

        let capability = try requestCapability()
        return try spawnAndWait(
            executable: nodeURL.path,
            entrypoint: entryURL.path,
            appRoot: appURL.path,
            capability: capability,
            arguments: arguments
        )
    }

    private func resolveAppURL() throws -> URL {
        if mode == .app, Bundle.main.bundleURL.pathExtension == "app" {
            return Bundle.main.bundleURL
        }
        let fixed = URL(fileURLWithPath: "/Applications/Knowtation.app", isDirectory: true)
        guard FileManager.default.fileExists(atPath: fixed.path) else {
            throw RuntimeLaunchError.appNotInstalled
        }
        return fixed
    }

    private func requestCapability() throws -> FileHandle {
        try CustodyCapability.request(mode: mode)
    }

    private func spawnAndWait(
        executable: String,
        entrypoint: String,
        appRoot: String,
        capability: FileHandle,
        arguments: [String]
    ) throws -> Int32 {
        let argv = [executable, entrypoint, "--mode", mode.rawValue, "--"] + arguments
        var environment = ProcessInfo.processInfo.environment
        for key in environment.keys where Self.deniedEnvironmentKey(key) {
            environment.removeValue(forKey: key)
        }
        environment["KNOWTATION_CUSTODY_FD"] = "3"
        environment["KNOWTATION_APP_ROOT"] = appRoot
        environment["KNOWTATION_RELEASE_VERSION"] = KnowtationReleaseContract.version
        environment["KNOWTATION_RELEASE_BUILD"] = String(KnowtationReleaseContract.build)
        environment["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin"

        var actions: posix_spawn_file_actions_t?
        posix_spawn_file_actions_init(&actions)
        defer { posix_spawn_file_actions_destroy(&actions) }
        let capabilityFD = capability.fileDescriptor
        guard posix_spawn_file_actions_adddup2(&actions, capabilityFD, 3) == 0 else {
            throw RuntimeLaunchError.spawnFailed(EINVAL)
        }

        let cArguments = argv.map { strdup($0) } + [nil]
        let environmentStrings = environment.map { "\($0.key)=\($0.value)" }.sorted()
        let cEnvironment = environmentStrings
            .sorted()
            .map { strdup($0) } + [nil]
        defer {
            cArguments.compactMap { $0 }.forEach { free($0) }
            cEnvironment.compactMap { $0 }.forEach { free($0) }
        }

        var pid: pid_t = 0
        let spawnStatus = executable.withCString { executablePointer in
            cArguments.withUnsafeBufferPointer { argumentBuffer in
                cEnvironment.withUnsafeBufferPointer { environmentBuffer in
                    posix_spawn(
                        &pid,
                        executablePointer,
                        &actions,
                        nil,
                        UnsafeMutablePointer(mutating: argumentBuffer.baseAddress),
                        UnsafeMutablePointer(mutating: environmentBuffer.baseAddress)
                    )
                }
            }
        }
        guard spawnStatus == 0 else { throw RuntimeLaunchError.spawnFailed(spawnStatus) }

        var waitStatus: Int32 = 0
        while waitpid(pid, &waitStatus, 0) == -1 && errno == EINTR {}
        let signal = waitStatus & 0x7f
        if signal == 0 { return (waitStatus >> 8) & 0xff }
        if signal != 0x7f { return 128 + signal }
        return 1
    }

    private static func deniedEnvironmentKey(_ key: String) -> Bool {
        let exactDenied: Set<String> = [
            "NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED",
            "NODE_DEBUG", "NODE_USE_ENV_PROXY", "KNOWTATION_CUSTODY_FD", "KNOWTATION_HUB_URL",
            "KNOWTATION_HUB_TOKEN", "SSL_CERT_FILE", "SSL_CERT_DIR", "SSLKEYLOGFILE", "OPENSSL_CONF",
            "OPENSSL_MODULES", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
            "http_proxy", "https_proxy", "all_proxy", "no_proxy",
        ]
        if exactDenied.contains(key) {
            return true
        }
        return key.hasPrefix("DYLD_") || key.hasPrefix("LD_")
    }
}

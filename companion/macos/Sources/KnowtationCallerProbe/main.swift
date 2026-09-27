import Foundation
import KnowtationSecurity

do {
    _ = try CustodyCapability.request(mode: .cli)
    FileHandle.standardError.write(Data("unsigned caller unexpectedly received custody capability\n".utf8))
    exit(1)
} catch RuntimeLaunchError.capabilityUnavailable(let reason) where reason == "caller_denied" {
    exit(0)
} catch {
    FileHandle.standardError.write(Data("caller probe failed for an unexpected reason: \(error)\n".utf8))
    exit(2)
}

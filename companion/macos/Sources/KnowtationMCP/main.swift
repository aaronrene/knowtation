import Foundation
import KnowtationSecurity

do {
    let status = try RuntimeLauncher(mode: .mcp).run(arguments: Array(CommandLine.arguments.dropFirst()))
    exit(status)
} catch {
    FileHandle.standardError.write(Data("knowtation-mcp: \(error)\n".utf8))
    exit(1)
}

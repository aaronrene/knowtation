import Foundation
import KnowtationSecurity

do {
    let status = try RuntimeLauncher(mode: .cli).run(arguments: Array(CommandLine.arguments.dropFirst()))
    exit(status)
} catch {
    FileHandle.standardError.write(Data("knowtation: \(error)\n".utf8))
    exit(1)
}

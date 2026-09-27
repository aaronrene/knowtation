// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "KnowtationMacOS",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "KnowtationSecurity", targets: ["KnowtationSecurity"]),
        .executable(name: "Knowtation", targets: ["KnowtationCompanion"]),
        .executable(name: "KnowtationCustodyAgent", targets: ["KnowtationCustodyAgent"]),
        .executable(name: "knowtation", targets: ["KnowtationCLI"]),
        .executable(name: "knowtation-mcp", targets: ["KnowtationMCP"]),
        .executable(name: "KnowtationCallerProbe", targets: ["KnowtationCallerProbe"]),
    ],
    targets: [
        .target(
            name: "KnowtationSecurity",
            linkerSettings: [
                .linkedFramework("CryptoKit"),
                .linkedFramework("Security"),
            ]
        ),
        .executableTarget(
            name: "KnowtationCompanion",
            dependencies: ["KnowtationSecurity"],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("ServiceManagement"),
            ]
        ),
        .executableTarget(
            name: "KnowtationCustodyAgent",
            dependencies: ["KnowtationSecurity"],
            linkerSettings: [
                .linkedFramework("Security"),
            ]
        ),
        .executableTarget(name: "KnowtationCLI", dependencies: ["KnowtationSecurity"]),
        .executableTarget(name: "KnowtationMCP", dependencies: ["KnowtationSecurity"]),
        .executableTarget(name: "KnowtationCallerProbe", dependencies: ["KnowtationSecurity"]),
        .testTarget(name: "KnowtationSecurityTests", dependencies: ["KnowtationSecurity"]),
    ]
)

// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ProjectTownCore",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "ProjectTownCore", targets: ["ProjectTownCore"]),
    ],
    targets: [
        .target(name: "ProjectTownCore"),
        .testTarget(
            name: "ProjectTownCoreTests",
            dependencies: ["ProjectTownCore"],
            resources: [.copy("Fixtures")]
        ),
    ]
)

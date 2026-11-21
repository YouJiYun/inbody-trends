// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "InBodyCore",
    products: [.library(name: "InBodyCore", targets: ["InBodyCore"])],
    targets: [
        .target(name: "InBodyCore", path: "InBodyTrends/Core"),
        .testTarget(name: "InBodyCoreTests", dependencies: ["InBodyCore"],
                    path: "Tests", exclude: ["SyntheticVisionTests.swift", "Resources"])
    ]
)

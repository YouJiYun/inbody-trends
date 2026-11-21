"""Portable syntax/project checks; explicitly NOT a Swift build or an OCR test."""
import json
import plistlib
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from tree_sitter import Language, Parser
import tree_sitter_swift
from openstep_parser import OpenStepDecoder

root = Path(__file__).resolve().parents[1]
parser = Parser(Language(tree_sitter_swift.language()))
swift_files = (
    list((root / "InBodyTrends").rglob("*.swift"))
    + list((root / "Tests").glob("*.swift"))
    + list((root / "Tools").glob("*.swift")) + [root / "Package.swift"]
)
for source in swift_files:
    data = source.read_bytes()
    tree = parser.parse(data)
    stack = [tree.root_node]
    while stack:
        node = stack.pop()
        assert node.type != "ERROR" and not node.is_missing, f"{source.name}: syntax error at {node.start_point}"
        stack.extend(node.children)

project = OpenStepDecoder.ParseFromString((root / "InBodyTrends.xcodeproj" / "project.pbxproj").read_text(encoding="utf-8"))
objects = project["objects"]
for object_id, value in objects.items():
    assert re.fullmatch(r"[0-9A-F]{24}", object_id)
    for key in ("fileRef", "mainGroup", "productRefGroup", "productReference", "buildConfigurationList",
                "target", "targetProxy", "containerPortal", "remoteGlobalIDString"):
        if key in value:
            assert value[key] in objects, f"Broken {key} reference"
    for key in ("children", "buildPhases", "dependencies", "files", "targets", "buildConfigurations"):
        for reference in value.get(key, []):
            assert reference in objects, f"Broken {key} reference"
targets = {value["name"]: value for value in objects.values() if value["isa"] == "PBXNativeTarget"}
assert set(targets) == {"InBodyTrends", "InBodyTrendsTests"}
app = targets["InBodyTrends"]
test = targets["InBodyTrendsTests"]
def phase_files(target, kind):
    phase = next(objects[ref] for ref in target["buildPhases"] if objects[ref]["isa"] == kind)
    return [objects[objects[ref]["fileRef"]]["path"] for ref in phase["files"]]
assert set(phase_files(app, "PBXSourcesBuildPhase")) == {p.relative_to(root / "InBodyTrends").as_posix() for p in (root / "InBodyTrends").rglob("*.swift")}
assert phase_files(app, "PBXResourcesBuildPhase") == ["PrivacyInfo.xcprivacy"]
assert phase_files(test, "PBXResourcesBuildPhase") == ["Resources"]
assert set(phase_files(test, "PBXSourcesBuildPhase")) == {path.name for path in (root / "Tests").glob("*.swift")}
for filename in ("Info.plist", "PrivacyInfo.xcprivacy"):
    with (root / "InBodyTrends" / filename).open("rb") as stream:
        plist = plistlib.load(stream)
    if filename == "Info.plist":
        assert "NSCameraUsageDescription" in plist
        assert "NSAppTransportSecurity" not in plist
    else:
        assert plist["NSPrivacyTracking"] is False
        assert not plist["NSPrivacyCollectedDataTypes"]
scheme = ET.parse(root / "InBodyTrends.xcodeproj" / "xcshareddata" / "xcschemes" / "InBodyTrends.xcscheme")
for element in scheme.iter("BuildableReference"):
    assert element.attrib["BlueprintIdentifier"] in objects
for path in (root / "InBodyTrends").rglob("*.swift"):
    text = path.read_text(encoding="utf-8")
    assert "URLSession" not in text and "oracle.json" not in text and "PrivateFixtures" not in text
assert "PrivateFixtures/" in (root / ".gitignore").read_text(encoding="utf-8")
synthetic_test = (root / "Tests" / "SyntheticVisionTests.swift").read_text(encoding="utf-8")
assert "LocalOCR.recognize(image(" in synthetic_test and "XCTSkip" not in synthetic_test
assert "ReportParser(document: document)" in synthetic_test
print(f"PASS: syntax for {len(swift_files)} Swift files; Xcode graph, scheme, plist, privacy and resource isolation.")
print("NOT RUN: Swift compiler/type-check, XCTest, Apple Vision photographs, SwiftUI, camera or device persistence.")

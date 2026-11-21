"""Generate a dependency-free Xcode project. No source files or fixtures are embedded."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
objects = {}

def ident(label):
    return hashlib.sha256(label.encode()).hexdigest()[:24].upper()

def obj(label, isa, **fields):
    key = ident(label)
    objects[key] = {"isa": isa, **fields}
    return key

def ref(label):
    return ident(label)

def quote(text):
    return json.dumps(text, ensure_ascii=False)

def serialize(value):
    if isinstance(value, dict):
        return "{ " + " ".join(f"{quote(k)} = {serialize(v)};" for k, v in value.items()) + " }"
    if isinstance(value, list):
        return "(" + ", ".join(serialize(v) for v in value) + ")"
    return quote(str(value))

def file_ref(label, path, kind):
    return obj(label, "PBXFileReference", lastKnownFileType=kind, path=path, sourceTree="<group>")

app_files = sorted((ROOT / "InBodyTrends").rglob("*.swift"))
test_files = sorted((ROOT / "Tests").glob("*.swift"))
app_refs, test_refs = [], []
app_build, test_build = [], []
for files, refs, builds, prefix, base in [
    (app_files, app_refs, app_build, "app", ROOT / "InBodyTrends"),
    (test_files, test_refs, test_build, "test", ROOT / "Tests"),
]:
    for path in files:
        relative = path.relative_to(base).as_posix()
        file = file_ref(prefix + relative, relative, "sourcecode.swift")
        refs.append(file)
        builds.append(obj("build" + prefix + relative, "PBXBuildFile", fileRef=file))

info = file_ref("info", "Info.plist", "text.plist.xml")
privacy = file_ref("privacy", "PrivacyInfo.xcprivacy", "text.xml")
fixture = file_ref("fixture", "Resources", "folder")
resource = obj("privacy-build", "PBXBuildFile", fileRef=privacy)
fixture_resource = obj("fixture-build", "PBXBuildFile", fileRef=fixture)
app_product = obj("app-product", "PBXFileReference", explicitFileType="wrapper.application",
                  path="InBodyTrends.app", sourceTree="BUILT_PRODUCTS_DIR", includeInIndex=0)
test_product = obj("test-product", "PBXFileReference", explicitFileType="wrapper.cfbundle",
                   path="InBodyTrendsTests.xctest", sourceTree="BUILT_PRODUCTS_DIR", includeInIndex=0)
obj("app-group", "PBXGroup", children=app_refs + [info, privacy], path="InBodyTrends", sourceTree="<group>")
obj("test-group", "PBXGroup", children=test_refs + [fixture], path="Tests", sourceTree="<group>")
obj("products", "PBXGroup", children=[app_product, test_product], name="Products", sourceTree="<group>")
obj("main-group", "PBXGroup", children=[ref("app-group"), ref("test-group"), ref("products")], sourceTree="<group>")

for name, builds, resources in [("app", app_build, [resource]), ("test", test_build, [fixture_resource])]:
    obj(name + "-sources", "PBXSourcesBuildPhase", buildActionMask=2147483647, files=builds, runOnlyForDeploymentPostprocessing=0)
    obj(name + "-resources", "PBXResourcesBuildPhase", buildActionMask=2147483647, files=resources, runOnlyForDeploymentPostprocessing=0)
    obj(name + "-frameworks", "PBXFrameworksBuildPhase", buildActionMask=2147483647, files=[], runOnlyForDeploymentPostprocessing=0)

common = {
    "IPHONEOS_DEPLOYMENT_TARGET": "17.0", "SWIFT_VERSION": "5.0", "SDKROOT": "iphoneos",
    "TARGETED_DEVICE_FAMILY": "1,2", "CLANG_ENABLE_MODULES": "YES",
    "CLANG_ENABLE_OBJC_ARC": "YES", "ENABLE_USER_SCRIPT_SANDBOXING": "YES",
}
for target in ["project", "app", "test"]:
    configs = []
    for mode in ["Debug", "Release"]:
        settings = dict(common)
        settings.update({"SWIFT_OPTIMIZATION_LEVEL": "-Onone" if mode == "Debug" else "-O",
                         "DEBUG_INFORMATION_FORMAT": "dwarf" if mode == "Debug" else "dwarf-with-dsym"})
        if mode == "Debug":
            settings["SWIFT_ACTIVE_COMPILATION_CONDITIONS"] = "DEBUG"
            settings["ENABLE_TESTABILITY"] = "YES"
        if target != "project":
            settings["CODE_SIGN_STYLE"] = "Automatic"
            settings["PRODUCT_NAME"] = "$(TARGET_NAME)"
            settings["PRODUCT_BUNDLE_IDENTIFIER"] = "local.bodyrecords." + ("app" if target == "app" else "tests")
            settings["LD_RUNPATH_SEARCH_PATHS"] = "$(inherited) @executable_path/Frameworks @loader_path/Frameworks"
        if target == "app":
            settings["INFOPLIST_FILE"] = "InBodyTrends/Info.plist"
            settings["GENERATE_INFOPLIST_FILE"] = "NO"
        if target == "test":
            settings["GENERATE_INFOPLIST_FILE"] = "YES"
            settings["TEST_HOST"] = "$(BUILT_PRODUCTS_DIR)/InBodyTrends.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/InBodyTrends"
            settings["BUNDLE_LOADER"] = "$(TEST_HOST)"
        configs.append(obj(target + mode, "XCBuildConfiguration", buildSettings=settings, name=mode))
    obj(target + "-configs", "XCConfigurationList", buildConfigurations=configs,
        defaultConfigurationIsVisible=0, defaultConfigurationName="Release")

proxy = obj("proxy", "PBXContainerItemProxy", containerPortal=ref("project"), proxyType=1,
            remoteGlobalIDString=ref("app-target"), remoteInfo="InBodyTrends")
dependency = obj("dependency", "PBXTargetDependency", target=ref("app-target"), targetProxy=proxy)
for name, product, target_name, dependencies, product_type in [
    ("app", app_product, "InBodyTrends", [], "com.apple.product-type.application"),
    ("test", test_product, "InBodyTrendsTests", [dependency], "com.apple.product-type.bundle.unit-test")
]:
    obj(name + "-target", "PBXNativeTarget", buildConfigurationList=ref(name + "-configs"),
        buildPhases=[ref(name + "-sources"), ref(name + "-frameworks"), ref(name + "-resources")],
        buildRules=[], dependencies=dependencies, name=target_name, productName=target_name,
        productReference=product, productType=product_type)
obj("project", "PBXProject", attributes={"LastUpgradeCheck": "1600",
                                      "TargetAttributes": {ref("test-target"): {"TestTargetID": ref("app-target")}}},
    buildConfigurationList=ref("project-configs"), compatibilityVersion="Xcode 14.0",
    developmentRegion="zh-Hans", knownRegions=["zh-Hans", "en", "Base"],
    mainGroup=ref("main-group"), productRefGroup=ref("products"), projectDirPath="",
    projectRoot="", targets=[ref("app-target"), ref("test-target")])

project = ROOT / "InBodyTrends.xcodeproj"
project.mkdir(exist_ok=True)
contents = "// !$*UTF8*$!\n" + serialize({
    "archiveVersion": 1, "classes": {}, "objectVersion": 56,
    "objects": objects, "rootObject": ref("project")
}) + "\n"
(project / "project.pbxproj").write_text(contents, encoding="utf-8")
schemes = project / "xcshareddata" / "xcschemes"
schemes.mkdir(parents=True, exist_ok=True)
def buildable(target, name):
    return (f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{ref(target + "-target")}" '
            f'BuildableName="{name}" BlueprintName="{name.split(".")[0]}" '
            'ReferencedContainer="container:InBodyTrends.xcodeproj"/>')
app_node = buildable("app", "InBodyTrends.app")
test_node = buildable("test", "InBodyTrendsTests.xctest")
scheme = f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.7">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries>
<BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{app_node}</BuildActionEntry>
<BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="NO">{test_node}</BuildActionEntry>
</BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES">
<Testables><TestableReference skipped="NO">{test_node}</TestableReference></Testables></TestAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{app_node}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{app_node}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>'''
(schemes / "InBodyTrends.xcscheme").write_text(scheme, encoding="utf-8")
print(f"Generated Xcode project: {len(app_files)} app sources, {len(test_files)} test sources.")

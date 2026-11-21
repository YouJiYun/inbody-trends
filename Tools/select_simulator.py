"""Select an installed, available iPhone/iOS 17+ runtime without a hard-coded model."""
import argparse
import json
import subprocess
import uuid
from pathlib import Path

def validated_udid(value):
    uuid.UUID(value)
    return value

def choose_device(devices, runtimes):
    versions = {}
    for runtime in runtimes.get("runtimes", []):
        identifier = runtime.get("identifier", "")
        if not identifier.startswith("com.apple.CoreSimulator.SimRuntime.iOS-") or not runtime.get("isAvailable"):
            continue
        version = tuple(int(part) for part in runtime["version"].split("."))
        if version < (17,):
            continue
        versions[identifier] = version
    candidates = []
    for runtime, entries in devices.get("devices", {}).items():
        if runtime not in versions:
            continue
        for entry in entries:
            if not entry.get("isAvailable") or not entry.get("name", "").startswith("iPhone"):
                continue
            udid = validated_udid(entry["udid"])
            candidates.append((versions[runtime], entry.get("state") == "Booted", entry["name"], udid, entry))
    if not candidates:
        raise RuntimeError("No available iPhone simulator with an installed iOS 17+ runtime.")
    winner = max(candidates, key=lambda item: item[:4])
    return winner[4], ".".join(str(part) for part in winner[0])

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--boot", action="store_true")
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()
    def simctl(*command):
        return subprocess.run(["xcrun", "simctl", *command], check=True, capture_output=True,
                              text=True, timeout=600).stdout
    devices = json.loads(simctl("list", "devices", "available", "--json"))
    runtimes = json.loads(simctl("list", "runtimes", "--json"))
    device, version = choose_device(devices, runtimes)
    udid = validated_udid(device["udid"])
    if args.boot:
        if device.get("state") != "Booted":
            simctl("boot", udid)
        simctl("bootstatus", udid, "-b")
    if args.github_output:
        with args.github_output.open("a", encoding="utf-8") as stream:
            stream.write(f"udid={udid}\n")
    print(f"Selected {device['name']}, iOS {version}, {udid}")

if __name__ == "__main__":
    main()

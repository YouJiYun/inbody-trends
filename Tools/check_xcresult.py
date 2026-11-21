"""Require all four real-Vision synthetic tests to pass, not skip or disappear."""
import argparse
import json
import re
import subprocess
from pathlib import Path

REQUIRED = {
    "testSyntheticChineseReportThroughRealVision",
    "testMissingDateImageIsRejectedAfterRealVision",
    "testMissingMuscleImageIsRejectedAfterRealVision",
    "testContradictoryImageIsRejectedAfterRealVision",
}

def require_native_tests(payload):
    results = {method: [] for method in REQUIRED}
    def walk(node, context=""):
        if isinstance(node, list):
            for item in node:
                walk(item, context)
        elif isinstance(node, dict):
            names = " ".join(str(node.get(key, "")) for key in ("name", "nodeIdentifier", "nodeType"))
            current = context + "/" + names
            status = node.get("result")
            if status is not None and "SyntheticVisionTests" in current:
                for method in REQUIRED:
                    if re.search(r"\b" + re.escape(method) + r"(?:\(\)|\b)", names):
                        results[method].append(status)
            for value in node.values():
                if isinstance(value, (dict, list)):
                    walk(value, current)
    walk(payload)
    failures = {method: statuses for method, statuses in results.items() if statuses != ["Passed"]}
    if failures:
        raise RuntimeError(f"Native synthetic OCR test coverage is missing, duplicated, skipped or failed: {failures}")
    return len(results)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("result", type=Path)
    args = parser.parse_args()
    command = ["xcrun", "xcresulttool", "get", "test-results", "tests", "--path", str(args.result)]
    result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=120)
    count = require_native_tests(json.loads(result.stdout))
    print(f"Confirmed {count} non-skipped synthetic image tests passed through Apple Vision and the parser.")

if __name__ == "__main__":
    main()

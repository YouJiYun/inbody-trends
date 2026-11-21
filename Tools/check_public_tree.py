"""Reject sensitive/resource paths in an approved public candidate or CI checkout."""
import argparse
import subprocess
from pathlib import Path

FORBIDDEN_PARTS = {
    "privatefixtures", "delivery", ".playwright-mcp", "published-updates",
    "deriveddata", ".build", "xcuserdata", "__pycache__",
}
ALLOWED_ROOTS = {".github", "InBodyTrends", "InBodyTrends.xcodeproj", "Tests", "Tools", "Design"}
ALLOWED_FILES = {".gitignore", "README.md", "Package.swift"}
ALLOWED_SUFFIXES = {".swift", ".py", ".md", ".html", ".plist", ".xcprivacy", ".pbxproj", ".xcscheme", ".yml", ".yaml"}

def candidate_files(root):
    if (root / ".git").exists():
        result = subprocess.run(["git", "-C", str(root), "ls-files", "-z"], check=True, capture_output=True)
        return [root / name.decode("utf-8") for name in result.stdout.split(b"\0") if name]
    return [path for path in root.rglob("*") if path.is_file() or path.is_symlink()]

def check_tree(root):
    files = candidate_files(root)
    for path in files:
        relative = path.relative_to(root)
        lower_parts = {part.lower() for part in relative.parts}
        if path.is_symlink():
            raise RuntimeError(f"Symlink is not allowed in the public candidate: {relative}")
        if lower_parts & FORBIDDEN_PARTS:
            raise RuntimeError(f"Excluded private/generated directory in public candidate: {relative}")
        if path.name in {"PhotoIntegrationTests.swift", "prepare_private_tests.py", "oracle.json"}:
            raise RuntimeError(f"Private fixture tooling is not part of the public candidate: {relative}")
        if relative.parts[0] not in ALLOWED_ROOTS and relative.as_posix() not in ALLOWED_FILES:
            raise RuntimeError(f"Unexpected public path: {relative}")
        if relative.as_posix() in {".gitignore", "Tests/Resources/.keep"}:
            continue
        if path.suffix.lower() == ".png" and relative.as_posix() == "Design/preview.png":
            if not path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"):
                raise RuntimeError("The design preview is not a PNG.")
            continue
        if path.suffix.lower() not in ALLOWED_SUFFIXES:
            raise RuntimeError(f"Unexpected binary or output file: {relative}")
        path.read_text(encoding="utf-8")
    return len(files)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    count = check_tree(args.root.resolve())
    print(f"Public boundary check passed for {count} files. This is not an OCR/native test or a full content audit.")

if __name__ == "__main__":
    main()

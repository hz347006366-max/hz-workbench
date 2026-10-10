#!/usr/bin/env python3
from pathlib import Path
import os
import shutil
import subprocess


ROOT = Path(__file__).resolve().parent.parent
INSTALL = ROOT.parent.parent / "install" / "hz-workbench"
ARTIFACTS = ("main.js", "styles.css", "manifest.json", "logo.png", "THIRD_PARTY_NOTICES.md", "LICENSE-prism-glass.txt", "NOTICE-prism-glass.txt")


def run(command):
    print("\n>>>", subprocess.list2cmdline([str(part) for part in command]), flush=True)
    result = subprocess.run([str(part) for part in command], cwd=ROOT, check=False)
    if result.returncode:
        raise SystemExit(result.returncode)


def main():
    node = os.environ.get("NODE_BIN") or shutil.which("node")
    if not node:
        raise SystemExit("NODE_BIN 未设置，并且 PATH 中找不到 node")

    tests = sorted((ROOT / "tests").glob("*.test.js"))
    run([node, ROOT / "esbuild.config.mjs"])
    run([node, ROOT / "scripts" / "check-syntax.js"])
    run([node, "--test", *tests])

    for name in ARTIFACTS:
        development_path = ROOT / name
        release_path = INSTALL / name
        if not development_path.is_file() or not release_path.is_file():
            raise SystemExit(f"发行文件缺失：{name}")
        if development_path.read_bytes() != release_path.read_bytes():
            raise SystemExit(f"发行文件不一致：{name}")

    print("\nALL HZ CHECKS OK")


if __name__ == "__main__":
    main()

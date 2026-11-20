#!/usr/bin/env python3
"""Canonical dependency bootstrap for backend and frontend development."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Sequence

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend-react"
PINNED_REQUIREMENT = re.compile(r"^[A-Za-z0-9_.-]+(?:\[[A-Za-z0-9_,.-]+\])?==[^\s]+$")


def npm_executable() -> str:
    executable = "npm.cmd" if os.name == "nt" else "npm"
    resolved = shutil.which(executable)
    if not resolved:
        raise RuntimeError("npm is required for frontend bootstrap but was not found on PATH")
    return resolved


def run(command: Sequence[str], *, cwd: Path = ROOT) -> None:
    printable = " ".join(str(part) for part in command)
    print(f"\n[bootstrap] {cwd}> {printable}", flush=True)
    subprocess.run(list(command), cwd=cwd, check=True)


def check_contract() -> None:
    requirements = ROOT / "requirements.txt"
    package_lock = FRONTEND / "package-lock.json"
    node_version = ROOT / ".node-version"
    python_version = ROOT / ".python-version"
    for path in (requirements, package_lock, node_version, python_version):
        if not path.is_file():
            raise RuntimeError(f"missing bootstrap contract: {path.relative_to(ROOT)}")

    unpinned = []
    for raw in requirements.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and not PINNED_REQUIREMENT.fullmatch(line):
            unpinned.append(line)
    if unpinned:
        raise RuntimeError(f"requirements.txt contains non-exact direct pins: {unpinned}")

    try:
        lock = json.loads(package_lock.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"frontend package-lock.json is invalid JSON: {exc}") from exc
    if not isinstance(lock.get("lockfileVersion"), int):
        raise RuntimeError("frontend package-lock.json does not declare lockfileVersion")

    if node_version.read_text(encoding="utf-8").strip() != "20.19.5":
        raise RuntimeError(".node-version must match the canonical CI Node version 20.19.5")
    if python_version.read_text(encoding="utf-8").strip() != "3.13":
        raise RuntimeError(".python-version must match the canonical CI Python line 3.13")

    print("Bootstrap contract valid: exact Python direct pins, npm lockfile and canonical runtime declarations present.")


def bootstrap_backend() -> None:
    run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "-r", "requirements.txt"])


def bootstrap_frontend() -> None:
    run([npm_executable(), "ci"], cwd=FRONTEND)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scope", nargs="?", default="all", choices=("all", "backend", "frontend"))
    parser.add_argument("--check-only", action="store_true", help="validate bootstrap contracts without installing anything")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        check_contract()
        if not args.check_only:
            if args.scope in ("all", "backend"):
                bootstrap_backend()
            if args.scope in ("all", "frontend"):
                bootstrap_frontend()
    except (RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"\n[bootstrap] FAILED: {exc}", file=sys.stderr, flush=True)
        return 1
    print("\n[bootstrap] PASSED", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
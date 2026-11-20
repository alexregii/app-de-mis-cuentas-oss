#!/usr/bin/env python3
"""Create a local .env with a fresh secret for the self-hosted Compose install."""

from __future__ import annotations

import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    example = ROOT / ".env.example"
    destination = ROOT / ".env"
    lines = example.read_text(encoding="utf-8").splitlines()
    key_lines = [index for index, line in enumerate(lines) if line.startswith("DJANGO_SECRET_KEY=")]
    if len(key_lines) != 1 or lines[key_lines[0]] != "DJANGO_SECRET_KEY=":
        raise SystemExit(".env.example must contain one empty DJANGO_SECRET_KEY entry")

    lines[key_lines[0]] = f"DJANGO_SECRET_KEY={secrets.token_urlsafe(50)}"
    try:
        with destination.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write("\n".join(lines) + "\n")
    except FileExistsError:
        raise SystemExit(".env already exists; keeping the existing local configuration") from None

    print("Created .env with a fresh local key. Keep it private and do not commit it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

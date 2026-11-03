#!/usr/bin/env python3
"""Scan files for the PHI heuristics defined by the Claude hook.

Usage: scan_phi.py <file>...
Exit codes: 0 no hits, 1 at least one hit, 2 no arguments.
Prints only "<path>: <pattern name>" and a summary; never a matched value.
"""
import importlib.util
import sys
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / ".claude" / "hooks" / "check_phi_patterns.py"


def load_hook():
    spec = importlib.util.spec_from_file_location("check_phi_patterns", HOOK)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: scan_phi.py <file>...", file=sys.stderr)
        return 2
    hook = load_hook()
    scanned = skipped = hits = 0
    for path in argv:
        if any(s in path.lower() for s in hook.ALLOWLIST_SUBSTRINGS):
            skipped += 1
            continue
        try:
            text = Path(path).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            skipped += 1
            continue
        scanned += 1
        for name, pattern in hook.PATTERNS.items():
            if pattern.search(text):
                hits += 1
                print(f"{path}: {name}")
    print(f"scanned {scanned} files, skipped {skipped}, hits {hits}")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

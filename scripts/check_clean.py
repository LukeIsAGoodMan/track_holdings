#!/usr/bin/env python3
"""
check_clean.py — Track Holdings project cleanliness verifier.

Checks for:
  1. console.log / console.warn / console.error in frontend src
  2. stray print() debug statements in backend app
  3. TODO / FIXME / HACK / XXX comments in source
  4. requirements.txt packages all importable
  5. package.json devDependencies don't leak into runtime deps

Usage:
  python scripts/check_clean.py
  (run from project root: track_holdings/)
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT     = Path(__file__).parent.parent
BACKEND  = ROOT / "backend" / "app"
FRONTEND = ROOT / "frontend" / "src"
REQS     = ROOT / "backend" / "requirements.txt"
PKG      = ROOT / "frontend" / "package.json"

PASS = "\033[92m[PASS]\033[0m"
FAIL = "\033[91m[FAIL]\033[0m"
WARN = "\033[93m[WARN]\033[0m"

issues: list[str] = []


# ── 1. console.log / debug in TypeScript/TSX (console.error is OK in handlers) ─
def check_console_log():
    # Only flag debug artifacts; console.error/.warn in catch/error handlers is intentional
    pattern = re.compile(r"\bconsole\.(log|debug)\b")
    hits = []
    for f in list(FRONTEND.rglob("*.ts")) + list(FRONTEND.rglob("*.tsx")):
        for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if pattern.search(line):
                hits.append(f"  {f.relative_to(ROOT)}:{i}  {line.strip()}")
    if hits:
        print(f"{FAIL} console.log / debug found ({len(hits)} occurrences):")
        for h in hits:
            print(h)
        issues.append("console.log/debug statements found")
    else:
        print(f"{PASS} No console.log / debug in frontend/src")


# ── 2. print() in Python backend ──────────────────────────────────────────────
def check_print_statements():
    pattern = re.compile(r"^\s*print\s*\(")
    hits = []
    for f in BACKEND.rglob("*.py"):
        for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if pattern.match(line):
                hits.append(f"  {f.relative_to(ROOT)}:{i}  {line.strip()}")
    if hits:
        print(f"{FAIL} print() debug statements found ({len(hits)}):")
        for h in hits:
            print(h)
        issues.append("print() statements found")
    else:
        print(f"{PASS} No debug print() statements in backend/app")


# ── 3. TODO / FIXME / HACK / XXX in source ────────────────────────────────────
def check_todos():
    pattern = re.compile(r"\b(TODO|FIXME|HACK|XXX)\b")
    hits = []
    for f in list(BACKEND.rglob("*.py")) + list(FRONTEND.rglob("*.ts")) + list(FRONTEND.rglob("*.tsx")):
        for i, line in enumerate(f.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            if pattern.search(line):
                hits.append(f"  {f.relative_to(ROOT)}:{i}  {line.strip()}")
    if hits:
        print(f"{WARN} Open TODO/FIXME/HACK markers ({len(hits)}) — review before release:")
        for h in hits[:10]:   # cap output
            print(h)
        if len(hits) > 10:
            print(f"  ... and {len(hits)-10} more")
        # Don't add to issues — these are warnings, not errors
    else:
        print(f"{PASS} No TODO/FIXME/HACK/XXX markers")


# ── 4. requirements.txt — every package importable ────────────────────────────
def check_requirements():
    if not REQS.exists():
        print(f"{FAIL} requirements.txt not found at {REQS}")
        issues.append("requirements.txt missing")
        return

    import importlib
    import importlib.util
    # Map package names to import names (where they differ)
    IMPORT_NAME_MAP = {
        "python-multipart": "multipart",
        "sqlalchemy":       "sqlalchemy",
        "aiosqlite":        "aiosqlite",
        "greenlet":         "greenlet",
        "pydantic-settings":"pydantic_settings",
        "python-dotenv":    "dotenv",
        "pydantic":         "pydantic",
        "yfinance":         "yfinance",
        "anthropic":        "anthropic",
        "fastapi":          "fastapi",
        "uvicorn":          "uvicorn",
        "httpx":            "httpx",
        "pytest":           "pytest",
        "pytest-asyncio":   "pytest_asyncio",
    }

    missing = []
    for raw_line in REQS.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        pkg = re.split(r"[>=<!\[]", line)[0].strip().lower()  # strip extras [standard] too
        import_name = IMPORT_NAME_MAP.get(pkg, pkg.replace("-", "_"))
        spec = importlib.util.find_spec(import_name)
        if spec is None:
            missing.append(f"  {line}  →  import {import_name} NOT FOUND")
    if missing:
        print(f"{FAIL} requirements.txt packages not importable ({len(missing)}):")
        for m in missing:
            print(m)
        issues.append("requirements.txt packages missing")
    else:
        pkg_count = sum(1 for l in REQS.read_text().splitlines()
                        if l.strip() and not l.startswith("#"))
        print(f"{PASS} All {pkg_count} requirements.txt packages importable")


# ── 5. package.json sanity — no obviously wrong deps ─────────────────────────
def check_package_json():
    import json
    if not PKG.exists():
        print(f"{FAIL} package.json not found at {PKG}")
        issues.append("package.json missing")
        return

    data = json.loads(PKG.read_text())
    deps     = set(data.get("dependencies", {}).keys())
    dev_deps = set(data.get("devDependencies", {}).keys())

    # Packages that should NEVER be in runtime deps
    DEV_ONLY = {"@types/node", "@types/react", "@types/react-dom",
                "typescript", "eslint", "prettier", "vitest", "jest"}
    bad = deps & DEV_ONLY
    if bad:
        print(f"{WARN} Dev-only packages found in dependencies (not devDependencies): {bad}")
    else:
        print(f"{PASS} package.json deps/devDeps look clean "
              f"({len(deps)} runtime, {len(dev_deps)} dev)")


# ── Run all checks ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n── Track Holdings — Cleanliness Check ─────────────────────────────\n")
    check_console_log()
    check_print_statements()
    check_todos()
    check_requirements()
    check_package_json()

    print()
    if issues:
        print(f"Result: {FAIL}  {len(issues)} issue(s) found — fix before release.\n")
        sys.exit(1)
    else:
        print("Result: [OK]  All checks passed — project is clean.\n")
        sys.exit(0)

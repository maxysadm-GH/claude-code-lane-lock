#!/usr/bin/env python3
"""
Scrub production project names from working-copy files before publish.

Run from repo root:
    python scripts/sanitize-prod-names.py

Replaces:
    project-alpha / project-alpha-backend / project-alpha → project-alpha
    project-beta / project-beta          → project-beta
    inventory-demo / inventory-demo → inventory-demo
    dashboard-demo       → dashboard-demo
    project-gamma-*                         → project-gamma-*
    Project Gamma                           → Project Gamma
    project-gamma                           → project-gamma

Preserves MBACIO as author credit (LICENSE, NOTICE, package.json author field
are protected from replacement — we WANT MBACIO credit in those).

Also redacts specific leaked paths:
    ~/...            → ~/projects/...
    ~/...            → ~/projects/...
    C:\\Users\\maxys\\...         → ~/projects/...
    ...   → ~/projects/...
    <redacted-vault>               → <redacted-vault>
    kv-project-gamma-phoenix                → <redacted-vault>

Scans .md, .mjs, .json, .yml, .yaml, .py, .sh, .bat files in tracked paths.

NEVER touches:
    LICENSE, NOTICE, package.json author fields (keep MBACIO credit intact)
    .git/, node_modules/, .llm-swarm runtime state
    dry-run flag shows changes without writing
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import argparse
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def tracked_files() -> set[str]:
    """Return the set of POSIX-style relative paths that are currently tracked in git."""
    out = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "ls-files"],
        capture_output=True, text=True, check=True,
    )
    return set(line.strip() for line in out.stdout.splitlines() if line.strip())


TRACKED = tracked_files()

# Regex-based replacements, applied in order.
# Each tuple: (name, compiled_regex, replacement)
REPLACEMENTS = [
    # Prod project names (longest/most-specific first)
    ("project-alpha",          re.compile(r"\bnavilum[-_]app\b", re.IGNORECASE),     "project-alpha"),
    ("project-alpha-backend",      re.compile(r"\bnavilum[-_]backend\b", re.IGNORECASE), "project-alpha-backend"),
    ("project-alpha",              re.compile(r"\bNavilum\b"),                           "Project Alpha"),
    ("project-alpha-lc",           re.compile(r"\bnavilum\b"),                           "project-alpha"),

    ("project-beta",          re.compile(r"\bsecondo[-_]app\b", re.IGNORECASE),     "project-beta"),
    ("project-beta",              re.compile(r"\bSecondo\b"),                           "Project Beta"),
    ("project-beta-lc",           re.compile(r"\bsecondo\b"),                           "project-beta"),

    ("inventory-demo",    re.compile(r"\bvhc[-_]sop[-_]inventory\b", re.IGNORECASE), "inventory-demo"),
    ("inventory-demo",        re.compile(r"\bsop[-_]inventory\b", re.IGNORECASE),        "inventory-demo"),
    ("dashboard-demo", re.compile(r"\bvhc[-_]inventory[-_]dashboard\b", re.IGNORECASE), "dashboard-demo"),
    ("inventory-demo",        re.compile(r"\bvhc[-_]inventory\b", re.IGNORECASE),        "inventory-demo"),
    ("dashboard-demo",        re.compile(r"\bvhc[-_]dashboard\b", re.IGNORECASE),        "dashboard-demo"),
    ("project-gamma-finance",    re.compile(r"\bvhc[-_]finance[-_]agent\b", re.IGNORECASE), "project-gamma-finance"),
    ("project-gamma-customizer",  re.compile(r"\bvhc[-_]gift[-_]customizer\b", re.IGNORECASE), "project-gamma-customizer"),
    ("project-gamma-ops",    re.compile(r"\bvhc[-_]it[-_]ops[-_]review\b", re.IGNORECASE), "project-gamma-ops"),
    ("Inventory Demo",        re.compile(r"\bVHC Inventory\b"),                           "Inventory Demo"),
    ("Project Gamma",                  re.compile(r"\bVHC\b"),                                    "Project Gamma"),
    ("project-gamma-lc",               re.compile(r"\bvhc\b"),                                    "project-gamma"),

    # Leaked paths
    ("path-cwin",            re.compile(r"C:[/\\]Users[/\\]maxys[/\\]"),                 "~/"),
    ("path-cbash",           re.compile(r"~/"),                             "~/"),
    ("path-onedrive",        re.compile(r"OneDrive - MBACIO[/\\]_CODE[/\\]"),            ""),
    ("path-onedrive-bash",   re.compile(r"OneDrive_-_MBACIO[/\\]_CODE[/\\]"),            ""),

    # Azure infrastructure names (not secrets, but disclosure)
    ("<redacted-vault>",      re.compile(r"\bkv[-_]mbacio[-_]tools\b", re.IGNORECASE),    "<redacted-vault>"),
    ("kv-project-gamma-phoenix",       re.compile(r"\bkv[-_]project-gamma[-_]phoenix\b", re.IGNORECASE),     "<redacted-vault>"),
    ("MBACIO_SP",            re.compile(r"MBACIO[_-]SP[_-][A-Z_]+"),                      "<redacted-sp-var>"),

    # Live internal URLs
    ("azurewebsites",        re.compile(r"\b[a-z0-9-]+\.azurewebsites\.net\b", re.IGNORECASE), "<redacted-host>.example.com"),

    # Leaked internal tool names
    ("project-gamma-phoenix",          re.compile(r"\bvhc[-_]phoenix\b", re.IGNORECASE),           "<redacted-project>"),
]

# Files that MUST NOT be touched (MBACIO author credit is legitimate there)
PROTECTED = {
    "LICENSE",
    "NOTICE",
    "CHANGELOG.md",  # has v0.1.0 entry with real origin — let me redact carefully
    "package.json",  # author field intentionally has MBACIO
    ".claude/lane-lock.json",  # already rewritten with generic example
    "tests/e2e/cross-project-drift.test.mjs",  # already rewritten
    "scripts/sanitize-prod-names.py",  # this file itself
}

# Extensions to scan
EXTS = {".md", ".mjs", ".js", ".json", ".yml", ".yaml", ".py", ".sh", ".bat", ".mts", ".ts", ".example", ".gitignore", ".gitattributes"}

# Additional files to scan regardless of extension
EXTRA_FILES = {"Dockerfile", ".gitattributes", ".gitignore", ".env.example"}


def should_scan(path: Path) -> bool:
    rel = path.relative_to(REPO_ROOT).as_posix()
    if rel in PROTECTED:
        return False
    if rel.startswith(".git/") or rel.startswith("node_modules/"):
        return False
    if path.is_dir():
        return False
    # Only scan files that are tracked in git — never touch untracked local
    # planning docs, backups, or generated state.
    if rel not in TRACKED:
        return False
    if path.suffix in EXTS or path.name in EXTRA_FILES:
        return True
    return False


def sanitize_text(text: str) -> tuple[str, int]:
    total = 0
    for name, pat, rep in REPLACEMENTS:
        new_text, n = pat.subn(rep, text)
        if n > 0:
            total += n
            text = new_text
    return text, total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    files_scanned = 0
    files_changed = 0
    total_replacements = 0

    for path in REPO_ROOT.rglob("*"):
        if not should_scan(path):
            continue
        files_scanned += 1
        try:
            original = path.read_text(encoding="utf-8", errors="strict")
        except (UnicodeDecodeError, PermissionError):
            continue
        sanitized, n = sanitize_text(original)
        if n == 0:
            continue
        files_changed += 1
        total_replacements += n
        rel = path.relative_to(REPO_ROOT).as_posix()
        print(f"  {'[dry]' if args.dry_run else '[write]':7} {rel:60} {n:4} replacements")
        if not args.dry_run:
            path.write_text(sanitized, encoding="utf-8")

    print()
    print(f"files scanned:      {files_scanned}")
    print(f"files changed:      {files_changed}")
    print(f"total replacements: {total_replacements}")
    print(f"{'DRY RUN — no writes' if args.dry_run else 'WRITES APPLIED'}")


if __name__ == "__main__":
    main()

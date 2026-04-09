#!/usr/bin/env python3
"""
cycle-core.py — brain of the lanelock autonomous evolution loop.

Called by cycle.ps1 (Windows Task Scheduler, 30-min cadence). Handles:
  1. Parse NEXT-ACTIONS.md and return the next [READY] item matching a filter.
  2. Flip an item's state (atomic write-through-tempfile).
  3. Dispatch an Ollama prompt (local M51) and return the raw response.
  4. Write per-cycle run log to autonomous/cycles/<UTC-timestamp>.md.

Design constraints (Max 2026-04-08):
  - NO Claude token usage anywhere in this file (loop cost = $0).
  - NO interactive prompts — runs unattended under Task Scheduler.
  - FAIL LOUD on errors — no silent `except Exception: pass`.
  - Idempotent: two back-to-back runs must never double-claim an item.
  - Context-clear safe — all state is on disk, nothing in memory.

Usage:
    python cycle-core.py pick --filter ollama-ready
    python cycle-core.py claim <short-id>
    python cycle-core.py release <short-id> <READY|IN-PROGRESS|NEEDS-REVIEW|BLOCKED|SHIPPED>
    python cycle-core.py ollama --prompt-file <path> --model qwen3-coder --out <path>
    python cycle-core.py log --short-id <id> --status <ok|fail|skip|no-work> --detail "<text>"

Exit codes:
    0   success
    2   fatal missing file
    3   pick: no matching items (not an error, just nothing to do)
    4   fatal: short-id not found
    5   no-op (flip to same state)
    6   ollama call failed
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

HERE = pathlib.Path(__file__).resolve().parent
AUTONOMOUS = HERE.parent
NEXT_ACTIONS = AUTONOMOUS / "NEXT-ACTIONS.md"
CYCLES = AUTONOMOUS / "cycles"
CYCLES.mkdir(parents=True, exist_ok=True)

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/generate")

# Paths (or path prefixes) that no autonomous draft is ever allowed to overwrite.
# Added 2026-04-09 after triage of 17 stalled ollama/* branches found that every
# single one hallucinated "cleanup" and wholesale deleted Retell/voice/mlkit-shim
# files outside the narrow task scope. See .planning/OLLAMA-BRANCH-TRIAGE.md.
#
# The gate is enforced by `cycle-core.py gate --out-file <ollama-output>` which
# reads the ===FILE:=== headers from an Ollama response and returns exit 7 if
# any target path matches. cycle.ps1 runs this BEFORE tsc/jest so collateral
# damage drafts are rejected at draft time without burning validation cycles.
PROTECTED_PATH_PREFIXES = (
    "bin/",
    "lib/",
    "hooks/hooks.json",
    ".claude-plugin/plugin.json",
    "scripts/llm.py",
    "scripts/swarm_runner.py",
    "package.json",
    "package-lock.json",
    "autonomous/scripts/",
    ".env",
    ".env.example",
    ".env.local",
    ".gitignore",
    ".mcp.json",
    "CLAUDE.md",
    "STRUCTURE.md",
    "biome.json",
)

# Matches a ===FILE: <path>=== header in Ollama response blocks.
FILE_HEADER_RE = re.compile(r"^===FILE:\s*([^=]+?)\s*===\s*$", re.MULTILINE)

# Matches: ### [READY] [ollama-ready] short-id
HEADER_RE = re.compile(
    r"^### \[(?P<state>READY|IN-PROGRESS|NEEDS-REVIEW|BLOCKED|SHIPPED)\] \[(?P<filter>[^\]]+)\] (?P<short_id>\S+)\s*$",
    re.MULTILINE,
)


def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[cycle-core {ts}] {msg}", file=sys.stderr, flush=True)


def read_queue() -> str:
    if not NEXT_ACTIONS.exists():
        log(f"FATAL: {NEXT_ACTIONS} does not exist")
        sys.exit(2)
    return NEXT_ACTIONS.read_text(encoding="utf-8")


def write_queue(text: str) -> None:
    tmp = NEXT_ACTIONS.with_suffix(".md.tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    tmp.replace(NEXT_ACTIONS)


def parse_items(text: str) -> list[dict]:
    """Return list of items with state, filter, short_id, raw_header."""
    items: list[dict] = []
    for m in HEADER_RE.finditer(text):
        items.append({
            "state": m.group("state"),
            "filter": m.group("filter"),
            "short_id": m.group("short_id"),
            "raw_header": m.group(0),
        })
    return items


def cmd_pick(args: argparse.Namespace) -> int:
    text = read_queue()
    items = parse_items(text)
    wanted = args.filter.lower()
    for it in items:
        if it["state"] != "READY":
            continue
        if wanted not in it["filter"].lower():
            continue
        print(it["short_id"])
        return 0
    return 3


def _flip_state(short_id: str, new_state: str) -> bool:
    text = read_queue()
    items = parse_items(text)
    for it in items:
        if it["short_id"] != short_id:
            continue
        old_header = it["raw_header"]
        new_header = old_header.replace(f"[{it['state']}]", f"[{new_state}]", 1)
        if old_header == new_header:
            log(f"no-op: {short_id} already {new_state}")
            return False
        text = text.replace(old_header, new_header, 1)
        write_queue(text)
        log(f"flipped {short_id}: {it['state']} -> {new_state}")
        return True
    log(f"FATAL: short_id {short_id} not found in NEXT-ACTIONS.md")
    sys.exit(4)


def cmd_claim(args: argparse.Namespace) -> int:
    return 0 if _flip_state(args.short_id, "IN-PROGRESS") else 5


def cmd_release(args: argparse.Namespace) -> int:
    return 0 if _flip_state(args.short_id, args.new_state) else 5


def cmd_ollama(args: argparse.Namespace) -> int:
    prompt_path = pathlib.Path(args.prompt_file)
    if not prompt_path.exists():
        log(f"FATAL: prompt file {prompt_path} does not exist")
        return 2
    prompt = prompt_path.read_text(encoding="utf-8")
    body = json.dumps({
        "model": args.model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": args.temperature,
            "num_predict": args.num_predict,
            "num_ctx": args.num_ctx,
        },
    }).encode("utf-8")
    req = urllib.request.Request(
        OLLAMA_URL,
        data=body,
        headers={"Content-Type": "application/json"},
    )
    log(f"POST {OLLAMA_URL} model={args.model} prompt_chars={len(prompt)}")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=args.timeout) as r:
            data = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        log(f"FATAL: Ollama call failed: {e}")
        return 6
    elapsed_ms = int((time.time() - t0) * 1000)
    response_text = data.get("response", "")
    eval_count = data.get("eval_count", 0)
    log(f"DONE ms={elapsed_ms} response_bytes={len(response_text)} eval_count={eval_count}")
    pathlib.Path(args.out).write_text(response_text, encoding="utf-8", newline="\n")
    return 0


def _is_protected(rel_path: str) -> bool:
    rel_path = rel_path.replace("\\", "/").lstrip("./")
    for prefix in PROTECTED_PATH_PREFIXES:
        if rel_path == prefix or rel_path.startswith(prefix):
            return True
    return False


def cmd_gate(args: argparse.Namespace) -> int:
    """
    Read an Ollama response file, extract every ===FILE: <path>=== header, and
    return exit 7 if any target path is in the protected set. Otherwise exit 0.
    Prints the offending paths (if any) to stderr.
    """
    out_path = pathlib.Path(args.out_file)
    if not out_path.exists():
        log(f"FATAL: ollama output file {out_path} does not exist")
        return 2
    text = out_path.read_text(encoding="utf-8", errors="replace")
    targets = [m.group(1).strip() for m in FILE_HEADER_RE.finditer(text)]
    if not targets:
        log("gate: no ===FILE:=== headers found - treating as BLOCKED upstream")
        return 0  # cycle.ps1 already handles the "no files" case
    violations = [t for t in targets if _is_protected(t)]
    if violations:
        log(f"gate: REJECTED — draft touches {len(violations)} protected path(s):")
        for v in violations:
            log(f"  - {v}")
        return 7
    log(f"gate: OK - {len(targets)} file(s), none protected")
    return 0


def cmd_log(args: argparse.Namespace) -> int:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    path = CYCLES / f"{ts}.md"
    lines = [
        f"# Cycle {ts}",
        "",
        f"- **Short-id**: `{args.short_id}`",
        f"- **Status**: `{args.status}`",
        f"- **Timestamp (UTC)**: {datetime.now(timezone.utc).isoformat()}",
        "",
        "## Detail",
        "",
        args.detail or "(no detail)",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(str(path))
    return 0


def main() -> int:
    p = argparse.ArgumentParser(prog="cycle-core")
    sub = p.add_subparsers(dest="cmd", required=True)

    pp = sub.add_parser("pick")
    pp.add_argument("--filter", default="ollama-ready")
    pp.set_defaults(func=cmd_pick)

    cp = sub.add_parser("claim")
    cp.add_argument("short_id")
    cp.set_defaults(func=cmd_claim)

    rp = sub.add_parser("release")
    rp.add_argument("short_id")
    rp.add_argument("new_state", choices=["READY", "IN-PROGRESS", "NEEDS-REVIEW", "BLOCKED", "SHIPPED"])
    rp.set_defaults(func=cmd_release)

    op = sub.add_parser("ollama")
    op.add_argument("--prompt-file", required=True)
    op.add_argument("--model", default="qwen3-coder")
    op.add_argument("--out", required=True)
    op.add_argument("--temperature", type=float, default=0.1)
    op.add_argument("--num-predict", type=int, default=4096)
    op.add_argument("--num-ctx", type=int, default=32768)
    op.add_argument("--timeout", type=int, default=900)
    op.set_defaults(func=cmd_ollama)

    gp = sub.add_parser("gate")
    gp.add_argument("--out-file", required=True, help="Ollama response file to inspect")
    gp.set_defaults(func=cmd_gate)

    lp = sub.add_parser("log")
    lp.add_argument("--short-id", required=True)
    lp.add_argument("--status", required=True, choices=["ok", "fail", "skip", "no-work"])
    lp.add_argument("--detail", default="")
    lp.set_defaults(func=cmd_log)

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

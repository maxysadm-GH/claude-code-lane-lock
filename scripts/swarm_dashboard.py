#!/usr/bin/env python3
"""
MBACIO swarm dashboard — terse status readout.

Usage:
    python dashboard.py            # one-shot status
    python dashboard.py --watch    # refresh every 5s until Ctrl+C
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import date, datetime
from pathlib import Path

HOME = Path.home()
SWARM = HOME / ".llm-swarm"
TASKS = SWARM / "tasks"


def count(dir_name):
    d = TASKS / dir_name
    if not d.exists():
        return 0
    return len([p for p in d.glob("*.json")])


def load_spend():
    p = SWARM / f"spend-{date.today().isoformat()}.json"
    if not p.exists():
        return {"total_usd": 0.0, "calls": 0, "by_provider": {}}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {"total_usd": 0.0, "calls": 0, "by_provider": {}}


def recent_log(n=5):
    today = SWARM / "logs" / f"{date.today().isoformat()}.log"
    if not today.exists():
        return []
    lines = today.read_text(encoding="utf-8", errors="replace").strip().split("\n")
    return lines[-n:]


def daemon_alive():
    pid_file = SWARM / "swarm.pid"
    if not pid_file.exists():
        return None, False
    try:
        pid = int(pid_file.read_text().strip())
    except Exception:
        return None, False
    if sys.platform == "win32":
        import subprocess
        r = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
            capture_output=True, text=True,
        )
        alive = str(pid) in r.stdout
    else:
        try:
            os.kill(pid, 0)
            alive = True
        except OSError:
            alive = False
    return pid, alive


def render():
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    pending = count("PENDING")
    active = count("ACTIVE")
    done = count("DONE")
    failed = count("FAILED")
    spend = load_spend()
    pid, alive = daemon_alive()

    lines = []
    lines.append(f"=== MBACIO swarm @ {ts} ===")
    daemon_str = f"PID {pid} {'ALIVE' if alive else 'DEAD'}" if pid else "no daemon registered"
    lines.append(f"daemon:    {daemon_str}")
    lines.append(f"queue:     PENDING={pending}  ACTIVE={active}  DONE={done}  FAILED={failed}")
    lines.append(f"spend:     ${spend['total_usd']:.4f} today, {spend.get('calls',0)} calls")
    for prov, cost in spend.get("by_provider", {}).items():
        lines.append(f"  {prov}: ${cost:.4f}")
    if active:
        lines.append("")
        lines.append("active tasks:")
        for p in sorted((TASKS / "ACTIVE").glob("*.json")):
            try:
                d = json.loads(p.read_text(encoding="utf-8"))
                lines.append(f"  - {d.get('id')}  ({d.get('project')})  claimed {d.get('claimed_at','?')}")
            except Exception:
                lines.append(f"  - {p.name}  [unreadable]")
    log_lines = recent_log(5)
    if log_lines:
        lines.append("")
        lines.append("recent log:")
        for l in log_lines:
            try:
                d = json.loads(l)
                level = d.get("level", "?")
                msg = d.get("msg", "")
                tid = d.get("task_id", "")
                lines.append(f"  [{level}] {msg}  {tid}")
            except Exception:
                lines.append(f"  {l[:120]}")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--watch", action="store_true")
    ap.add_argument("--interval", type=int, default=5)
    args = ap.parse_args()

    if args.watch:
        try:
            while True:
                os.system("cls" if sys.platform == "win32" else "clear")
                print(render())
                time.sleep(args.interval)
        except KeyboardInterrupt:
            pass
    else:
        print(render())


if __name__ == "__main__":
    main()

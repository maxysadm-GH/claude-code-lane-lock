#!/usr/bin/env python3
"""
MBACIO swarm runner — single-worker dispatcher + worker loop.

One process polls ~/.llm-swarm/tasks/PENDING for tasks, claims the oldest one,
runs it through the configured LLM role via scripts/llm.py, applies the output
as a patch to the project, runs success criteria, commits in a git worktree,
and moves the task to DONE or FAILED.

This is the PROTOTYPE — tonight's single-worker version proves the pattern
before parallelism and multi-worker type. Lane-lock is already installed in
all registered projects, so any Claude Code session spawned inside a worktree
inherits drift prevention automatically.

Usage:
    python swarm_runner.py                    # Continuous loop (default)
    python swarm_runner.py --once              # Process one task, exit
    python swarm_runner.py --dry-run           # Log what it would do, no writes
    python swarm_runner.py --poll-interval 10  # Polling interval in seconds

Log output: stdout + ~/.llm-swarm/logs/YYYY-MM-DD.log (append-only)
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import traceback
from datetime import datetime, date
from pathlib import Path
from typing import Optional

HOME = Path.home()
SWARM_HOME = HOME / ".llm-swarm"
TASKS = SWARM_HOME / "tasks"
PENDING = TASKS / "PENDING"
ACTIVE = TASKS / "ACTIVE"
DONE = TASKS / "DONE"
FAILED = TASKS / "FAILED"
LOGS = SWARM_HOME / "logs"
PROJECTS_PATH = SWARM_HOME / "projects.json"
CONFIG_PATH = SWARM_HOME / "config.json"

# llm.py lives inside the claude-code-lane-lock repo
LANE_LOCK_ROOT = Path(r"~/Projects/claude-code-lane-lock")
LLM_SCRIPT = LANE_LOCK_ROOT / "scripts" / "llm.py"

WORKER_ID = f"ollama-worker-{os.getpid()}"


# ---------- logging ----------

def logf():
    return LOGS / f"{date.today().isoformat()}.log"


def log(level: str, msg: str, **kv):
    ts = datetime.now().isoformat() + "Z"
    payload = {"ts": ts, "level": level, "worker": WORKER_ID, "msg": msg, **kv}
    line = json.dumps(payload, ensure_ascii=False)
    LOGS.mkdir(parents=True, exist_ok=True)
    with logf().open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    prefix = {"INFO": "[i]", "WARN": "[!]", "ERROR": "[X]", "OK": "[v]"}.get(level, "[ ]")
    out = f"{prefix} {ts}  {msg}"
    if kv:
        out += f"  {json.dumps(kv, ensure_ascii=True)}"
    try:
        sys.stdout.write(out + "\n")
    except UnicodeEncodeError:
        sys.stdout.write(out.encode("ascii", errors="replace").decode("ascii") + "\n")
    sys.stdout.flush()


# ---------- config + projects ----------

def load_projects() -> dict:
    if not PROJECTS_PATH.exists():
        return {"projects": {}}
    return json.loads(PROJECTS_PATH.read_text(encoding="utf-8"))


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


# ---------- task queue ----------

def claim_next_task() -> Optional[Path]:
    """Move the oldest PENDING task to ACTIVE. Returns the new path, or None."""
    pending = sorted(PENDING.glob("*.json"), key=lambda p: p.stat().st_mtime)
    for task_path in pending:
        target = ACTIVE / task_path.name
        try:
            # Atomic rename is our lock primitive.
            task_path.rename(target)
        except (FileNotFoundError, OSError):
            continue  # Another worker grabbed it.
        return target
    return None


def move_task(src: Path, dest_dir: Path, task: dict):
    dest = dest_dir / src.name
    src.write_text(json.dumps(task, indent=2, ensure_ascii=False), encoding="utf-8")
    src.rename(dest)
    return dest


# ---------- project + worktree ----------

def resolve_project(project_key: str, projects: dict) -> dict:
    p = projects.get("projects", {}).get(project_key)
    if not p:
        raise ValueError(f"unknown project: {project_key}")
    return p


def _normalize_path(p: str) -> str:
    return p.replace("\\", "/")


def git_worktree_add(project: dict, task_id: str) -> Path:
    """
    Create a git worktree for the project on a new branch `swarm/<task-id>`.
    Returns the absolute path of the worktree.
    """
    git_root = project.get("git_root") or project["root"]
    wt_root = SWARM_HOME / "worktrees" / task_id
    wt_root.parent.mkdir(parents=True, exist_ok=True)

    if wt_root.exists():
        shutil.rmtree(wt_root, ignore_errors=True)

    branch = f"swarm/{task_id}"

    # Clean up any stale branch from a previous failed run.
    subprocess.run(
        ["git", "-C", git_root, "worktree", "prune"],
        capture_output=True, text=True,
    )
    subprocess.run(
        ["git", "-C", git_root, "branch", "-D", branch],
        capture_output=True, text=True,
    )

    subprocess.run(
        ["git", "-C", git_root, "worktree", "add", "-b", branch, str(wt_root)],
        check=True, capture_output=True, text=True,
    )
    return wt_root


def git_worktree_remove(project: dict, wt_root: Path):
    git_root = project.get("git_root") or project["root"]
    subprocess.run(
        ["git", "-C", git_root, "worktree", "remove", "--force", str(wt_root)],
        capture_output=True, text=True,
    )


def project_subpath(project: dict, wt_root: Path) -> Path:
    """
    If the project root is a subdir of the git_root (monorepo case), return the
    equivalent subdir inside the worktree. Otherwise return the worktree root.
    """
    root = Path(project["root"])
    git_root = Path(project.get("git_root") or project["root"])
    if root == git_root:
        return wt_root
    rel = root.relative_to(git_root)
    return wt_root / rel


# ---------- LLM call ----------

def run_llm(prompt: str, role: str, max_tokens: int = 4000,
            provider: Optional[str] = None, model: Optional[str] = None) -> dict:
    """Invoke scripts/llm.py as a subprocess with --json output. Returns dict.

    If provider+model are set, they override the role routing — useful when
    a task needs a specific model (e.g., one that's already in VRAM).
    """
    if provider:
        args = [sys.executable, str(LLM_SCRIPT), "--provider", provider,
                "--max-tokens", str(max_tokens), "--json"]
        if model:
            args.extend(["--model", model])
    else:
        args = [sys.executable, str(LLM_SCRIPT), "--role", role,
                "--max-tokens", str(max_tokens), "--json"]
    result = subprocess.run(
        args,
        input=prompt,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=600,
    )
    if result.returncode != 0:
        raise RuntimeError(f"llm.py failed (exit {result.returncode}): {result.stderr.strip()}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"llm.py returned non-JSON: {e}. stdout={result.stdout[:500]}")


# ---------- task execution ----------

def build_prompt(task: dict, worktree_project_path: Path) -> str:
    files_in_scope = task.get("files_in_scope", [])
    context_blocks = []
    for rel_path in files_in_scope:
        p = worktree_project_path / rel_path
        if p.exists() and p.is_file():
            try:
                content = p.read_text(encoding="utf-8")[:20000]  # cap per file
                context_blocks.append(f"<file path=\"{rel_path}\">\n{content}\n</file>")
            except Exception:
                context_blocks.append(f"<file path=\"{rel_path}\">(unreadable)</file>")
        else:
            context_blocks.append(f"<file path=\"{rel_path}\">(not yet created)</file>")

    context = "\n\n".join(context_blocks) if context_blocks else "(no files in scope — creating new)"

    prompt = f"""You are an autonomous code worker for the MBACIO swarm. Execute the following task.

<task>
{task['description']}
</task>

<project_root>
{worktree_project_path}
</project_root>

<files_in_scope>
{chr(10).join('- ' + f for f in files_in_scope)}
</files_in_scope>

<current_file_contents>
{context}
</current_file_contents>

<success_criteria>
{chr(10).join('- ' + c for c in task.get('success_criteria', []))}
</success_criteria>

OUTPUT FORMAT — respond with a JSON object ONLY, no prose, no markdown fences:

{{
  "files": [
    {{"path": "<relative path>", "action": "write|delete", "content": "<full new file content>"}}
  ],
  "commit_message": "<conventional commit message>",
  "notes": "<optional explanation of changes>"
}}

Rules:
- Paths are relative to project_root.
- For `write`, `content` is the COMPLETE new file content (not a diff).
- For `delete`, omit `content`.
- Do NOT include paths outside files_in_scope unless absolutely necessary.
- Return valid JSON only."""
    return prompt


def parse_llm_output(text: str) -> dict:
    """Extract JSON object from the LLM output, tolerating code fences."""
    text = text.strip()
    if text.startswith("```"):
        # Strip fences
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return json.loads(text)


def apply_patch(parsed: dict, worktree_project_path: Path) -> list:
    """Apply file writes/deletes to the worktree. Returns list of changed files."""
    changed = []
    for fop in parsed.get("files", []):
        rel = fop["path"]
        target = worktree_project_path / rel
        action = fop.get("action", "write")
        if action == "delete":
            if target.exists():
                target.unlink()
                changed.append(rel)
        else:  # write
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(fop.get("content", ""), encoding="utf-8")
            changed.append(rel)
    return changed


def check_file_exists(criterion: str, wt_project: Path) -> bool:
    # Criterion examples: "tests/unit/match.test.mjs exists"
    if " exists" in criterion.lower():
        rel = criterion.split(" exists")[0].strip()
        return (wt_project / rel).exists()
    return True  # Unrecognized criterion: pass by default


def check_command(criterion: str, wt_project: Path) -> bool:
    # Criterion examples: "npm run test:unit passes", "node --test tests/unit/*.test.mjs passes"
    if " passes" not in criterion.lower():
        return True
    cmd = criterion.split(" passes")[0].strip()
    if not cmd:
        return True
    try:
        r = subprocess.run(
            cmd, shell=True, cwd=str(wt_project),
            capture_output=True, text=True, timeout=120,
        )
        return r.returncode == 0
    except Exception:
        return False


def verify_success(task: dict, wt_project: Path) -> tuple[bool, list]:
    failed = []
    for criterion in task.get("success_criteria", []):
        if " exists" in criterion.lower():
            if not check_file_exists(criterion, wt_project):
                failed.append(f"file not found: {criterion}")
        elif " passes" in criterion.lower():
            if not check_command(criterion, wt_project):
                failed.append(f"command failed: {criterion}")
    return (len(failed) == 0, failed)


def git_commit_worktree(wt_project: Path, wt_root: Path, message: str) -> str:
    # Stage from the full worktree root, commit from git_root context of that worktree.
    subprocess.run(["git", "-C", str(wt_root), "add", "-A"], check=True, capture_output=True, text=True)
    r = subprocess.run(
        ["git", "-C", str(wt_root), "diff", "--cached", "--name-only"],
        capture_output=True, text=True,
    )
    if not r.stdout.strip():
        return "NO_CHANGES"
    subprocess.run(
        ["git", "-C", str(wt_root), "commit", "-m", message],
        check=True, capture_output=True, text=True,
    )
    rev = subprocess.run(
        ["git", "-C", str(wt_root), "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True,
    )
    return rev.stdout.strip()


# ---------- main loop ----------

def process_task(task_path: Path, projects: dict, dry_run: bool = False) -> bool:
    try:
        task = json.loads(task_path.read_text(encoding="utf-8"))
    except Exception as e:
        log("ERROR", "task_parse_failed", path=str(task_path), error=str(e))
        return False

    task_id = task.get("id") or task_path.stem
    project_key = task.get("project")
    role = task.get("role", "code-gen-bulk")
    max_tokens = int(task.get("max_tokens", 4000))

    log("INFO", "task_claimed", task_id=task_id, project=project_key, role=role)
    task["claimed_by"] = WORKER_ID
    task["claimed_at"] = datetime.now().isoformat() + "Z"
    task_path.write_text(json.dumps(task, indent=2, ensure_ascii=False), encoding="utf-8")

    try:
        project = resolve_project(project_key, projects)
    except ValueError as e:
        task["error"] = str(e)
        move_task(task_path, FAILED, task)
        log("ERROR", "unknown_project", task_id=task_id, project=project_key)
        return False

    if dry_run:
        log("INFO", "dry_run_skip", task_id=task_id)
        move_task(task_path, DONE, task)
        return True

    wt_root = None
    try:
        # 1. Create worktree
        wt_root = git_worktree_add(project, task_id)
        wt_project = project_subpath(project, wt_root)
        log("INFO", "worktree_created", task_id=task_id, path=str(wt_root))

        # 2. Build prompt with file context
        prompt = build_prompt(task, wt_project)

        # 3. Call LLM
        override_provider = task.get("provider")
        override_model = task.get("model")
        log("INFO", "llm_call_start", task_id=task_id, role=role,
            provider=override_provider, model=override_model)
        llm_resp = run_llm(prompt, role=role, max_tokens=max_tokens,
                           provider=override_provider, model=override_model)
        if llm_resp.get("error"):
            raise RuntimeError(f"LLM error: {llm_resp['error']}")
        log("INFO", "llm_call_done",
            task_id=task_id,
            latency_ms=llm_resp.get("latency_ms"),
            input_tokens=llm_resp.get("input_tokens"),
            output_tokens=llm_resp.get("output_tokens"),
            cost_usd=llm_resp.get("cost_usd_est"),
            provider=llm_resp.get("provider"),
            model=llm_resp.get("model"))

        # 4. Parse output
        try:
            parsed = parse_llm_output(llm_resp["text"])
        except json.JSONDecodeError as e:
            raise RuntimeError(f"LLM returned non-JSON: {e}. Snippet: {llm_resp['text'][:300]}")

        # 5. Apply patch
        changed = apply_patch(parsed, wt_project)
        log("INFO", "patch_applied", task_id=task_id, changed_files=changed)

        # 6. Verify
        ok, failures = verify_success(task, wt_project)
        if not ok:
            raise RuntimeError(f"success criteria failed: {failures}")

        # 7. Commit
        msg = parsed.get("commit_message") or f"swarm({task_id}): {task.get('title','')}"
        msg += f"\n\nTask: {task_id}\nWorker: {WORKER_ID}\n"
        if llm_resp.get("model"):
            msg += f"Model: {llm_resp['provider']}/{llm_resp['model']}\n"
        sha = git_commit_worktree(wt_project, wt_root, msg)
        log("OK", "committed", task_id=task_id, sha=sha)
        task["commit_sha"] = sha
        task["completed_at"] = datetime.now().isoformat() + "Z"
        task["llm"] = {
            "provider": llm_resp.get("provider"),
            "model": llm_resp.get("model"),
            "latency_ms": llm_resp.get("latency_ms"),
            "cost_usd_est": llm_resp.get("cost_usd_est"),
        }
        move_task(task_path, DONE, task)
        log("OK", "task_done", task_id=task_id)
        return True

    except Exception as e:
        tb = traceback.format_exc()
        log("ERROR", "task_failed", task_id=task_id, error=str(e), traceback=tb[-500:])
        task["error"] = str(e)
        task["failed_at"] = datetime.now().isoformat() + "Z"
        move_task(task_path, FAILED, task)
        return False
    finally:
        # Leave worktree for FAILED inspection; remove on success.
        if wt_root and wt_root.exists():
            # Check where we moved to — if DONE, remove worktree.
            if (DONE / task_path.name).exists():
                try:
                    git_worktree_remove(project, wt_root)
                except Exception:
                    pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--poll-interval", type=int, default=30)
    args = ap.parse_args()

    # Self-register PID for the dashboard.
    try:
        (SWARM_HOME / "swarm.pid").write_text(str(os.getpid()), encoding="utf-8")
    except Exception:
        pass

    log("INFO", "swarm_runner_start", worker=WORKER_ID, pid=os.getpid(), once=args.once, dry_run=args.dry_run)
    projects = load_projects()
    log("INFO", "projects_loaded", count=len(projects.get("projects", {})))

    while True:
        task_path = claim_next_task()
        if task_path is None:
            if args.once:
                log("INFO", "no_tasks_exit", reason="once flag")
                break
            time.sleep(args.poll_interval)
            continue

        process_task(task_path, projects, dry_run=args.dry_run)

        if args.once:
            break

    log("INFO", "swarm_runner_exit")


if __name__ == "__main__":
    main()

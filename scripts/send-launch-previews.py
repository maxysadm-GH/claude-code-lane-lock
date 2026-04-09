#!/usr/bin/env python3
"""
Send lane-lock launch post previews to Max via the TRON Telegram bot.

Each message is prefixed with a platform label so Max can quickly scan.
Messages longer than 3800 chars are split into numbered chunks.

Usage:
    python scripts/send-launch-previews.py

Requires: TELEGRAM_BOT_TOKEN env var (already set in Windows user env).
"""
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request


CHAT_ID = "-1003537433827"  # MBACIO command center supergroup
MESSAGE_THREAD_ID = "36"      # Marketing topic (Brenda approval gate)
MAX_CHAR = 3800  # leave headroom for label prefix


def get_token():
    v = os.environ.get("TELEGRAM_BOT_TOKEN")
    if v:
        return v
    try:
        out = subprocess.run(
            ["powershell.exe", "-Command",
             "[Environment]::GetEnvironmentVariable('TELEGRAM_BOT_TOKEN','User')"],
            capture_output=True, text=True, timeout=5,
        )
        return (out.stdout or "").strip()
    except Exception:
        return None


def send(token, text):
    """Send one message via HTTPS. Returns (ok, message_id)."""
    data = urllib.parse.urlencode({
        "chat_id": CHAT_ID,
        "message_thread_id": MESSAGE_THREAD_ID,
        "text": text,
        "disable_web_page_preview": "true",
    }).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=data,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            import json
            body = json.loads(resp.read().decode("utf-8"))
            if body.get("ok"):
                return True, body["result"]["message_id"]
            return False, body.get("description", "unknown error")
    except Exception as e:
        return False, str(e)


def send_chunked(token, label, body):
    """Split body into <=MAX_CHAR chunks, each prefixed with label."""
    body = body.strip()
    if len(body) + len(label) + 4 <= MAX_CHAR:
        ok, mid = send(token, f"{label}\n\n{body}")
        return [(ok, mid)]

    # Split on paragraph boundaries
    parts = []
    current = ""
    for paragraph in body.split("\n\n"):
        if len(current) + len(paragraph) + 2 > MAX_CHAR - len(label) - 20:
            if current:
                parts.append(current.strip())
                current = paragraph + "\n\n"
            else:
                # Single paragraph too long — hard split
                while len(paragraph) > MAX_CHAR - len(label) - 20:
                    parts.append(paragraph[:MAX_CHAR - len(label) - 20])
                    paragraph = paragraph[MAX_CHAR - len(label) - 20:]
                current = paragraph + "\n\n"
        else:
            current += paragraph + "\n\n"
    if current.strip():
        parts.append(current.strip())

    results = []
    for i, part in enumerate(parts, 1):
        header = f"{label} [{i}/{len(parts)}]"
        ok, mid = send(token, f"{header}\n\n{part}")
        results.append((ok, mid))
        time.sleep(0.4)
    return results


POSTS = [
    ("[PREVIEW 1/8 — SHOW HN]", """TITLE:
Show HN: Lane-lock – Block Claude Code from drifting into the wrong repo (anthropics/claude-code#13797)

URL:
https://github.com/maxysadm-GH/claude-code-lane-lock

FIRST COMMENT (posted by OP right after submission):

Author here. Quick context on why I built this:

I was running multiple Claude Code sessions in parallel across different projects. One night, a session I had pinned to project-alpha drifted into project-gamma — ambiguous prompt ("keep working on the dashboard") and the session had no session-level understanding of which repo it belonged to. It read files from project-gamma. It planned for project-gamma. It shipped 10 commits into the wrong repo. Four hours of Opus tokens burned on the wrong project.

I looked for existing solutions. Read 12 swarm frameworks. Went through every open issue on anthropics/claude-code tagged `hook` or `session`. Checked Reddit, HN, r/ClaudeAI. Anthropic closed the "wrong repo" bug (#13797) as NOT_PLANNED — legitimately, third-party plugins are the right layer for this kind of guard. So I built the third-party plugin.

The kill mechanism is one line of hook config and one exit code. UserPromptSubmit fires before any reasoning token is spent. If the prompt references a project that isn't the pinned one, the hook exits 2. Claude Code interprets that as "erase the prompt from context entirely" — no LLM call, no round trip, no "are you sure?" dialog. The drift dies before it exists.

The rest of the plugin is read-warn / write-block tiering. Hard read-blocks cripple real workflows (you often glance at a sibling repo to copy a pattern), so reads get a context warning instead. Writes outside the pin are hard-denied via permissionDecision deny — overrides --dangerously-skip-permissions.

Zero runtime deps. Apache 2.0. Tested on macOS + Linux + Windows via CI matrix. The repo has the full research narrative (12 framework survey), the hero fixture that reproduces the original drift, and docs for every known upstream bug this works around.

Happy to answer questions. Curious especially if anyone else has hit this failure mode in their own Claude Code setups."""),

    ("[PREVIEW 2/8 — X/TWITTER THREAD (10 tweets)]", """1/10 HOOK:
One Claude Code session, pinned to project-alpha.
Ambient prompt: "keep working on the dashboard."
Overnight, it drifted into a different repo.
Shipped 10 commits to the wrong project.
4 hours of Opus tokens burned.

I built the fix. 🧵

2/10:
The failure mode is simple:

Claude Code has no session-level understanding of which repo it belongs to. An ambiguous prompt sends a session pinned to project A straight into project B.

Git worktrees solve this within a repo. They don't solve cross-repo.

3/10:
I surveyed 12 swarm frameworks. ccswarm, claude-flow, claudekit, ccswitch, claude-mem. Every one solves same-repo parallelism or task dispatch. None of them catch cross-repo drift at the session level.

I checked Reddit, HN, r/ClaudeAI. Nobody shipped it.

4/10:
Anthropic closed the "wrong repo" bug as NOT_PLANNED — and that was legitimate. Third-party plugins ARE the right layer for this kind of enforcement.

So I built the third-party plugin.

5/10:
The kill mechanism is a UserPromptSubmit hook with exit code 2.

UserPromptSubmit fires before any reasoning token is spent. If the prompt mentions a sibling project, the hook exits 2. Claude Code erases the prompt from context entirely.

No LLM call. No round trip. The drift dies before it exists.

6/10:
But a hard read-block cripples real workflows. You need to glance at a sibling repo for a pattern sometimes.

So lane-lock tiers:
- Reads → allowed + warning injected into context
- Writes → hard-denied via permissionDecision.deny

Writes override --dangerously-skip-permissions.

7/10:
7 hooks total:
- SessionStart — pin capture + lane marker
- UserPromptSubmit — the kill
- PreToolUse (read) — warn
- PreToolUse (write) — deny
- CwdChanged — re-verify
- SessionEnd — cleanup
- TaskCreated — forward-compat gate for Agent Teams

Zero runtime deps. Apache 2.0.

8/10:
Also detects 5 upstream Claude Code bugs that affect plugin reliability and tells you how to work around each:

#8810 #10367 #11519 #24327 #27343

All documented in docs/KNOWN-ISSUES.md. Run `lane-lock doctor` and it self-tests against them.

9/10:
CI matrix green on Ubuntu + macOS + Windows × Node 20 + 22. Hero fixture reproduces the original drift incident and proves the hook kills it at t=0.

Zero reasoning tokens spent on the wrong project. That's the promise.

10/10 CTA:
github.com/maxysadm-GH/claude-code-lane-lock

Apache 2.0. Install one script, run `lane-lock doctor`, and your Claude Code sessions are pinned.

Built by MBACIO with Claude Opus 4.6 as co-author.

If it saves you a drift, star the repo. 🛡"""),

    ("[PREVIEW 3/8 — REDDIT r/ClaudeCode]", """TITLE: I built a plugin that blocks cross-project drift in Claude Code — the anthropics/claude-code#13797 problem

BODY:

Hey r/ClaudeCode,

I run a handful of projects in parallel, one Claude Code session per repo. A few nights ago I watched one of them drift overnight: session pinned to project-alpha, ambiguous prompt, woke up to 10 commits in a completely different repo. Four hours of Opus tokens burned on the wrong project.

I went looking for existing solutions. Worktrees solve same-repo parallelism. ccswarm, claude-flow, claudekit, ccswitch, claude-mem all do interesting things but none of them catch cross-*repo* drift at the session level. Anthropic closed the "wrong repo" bug (#13797) as NOT_PLANNED — reasonable call, third-party plugins are the right layer for this.

So I built the third-party plugin.

THE KILL MECHANISM: a UserPromptSubmit hook with exit code 2. UserPromptSubmit fires before Claude starts reasoning. If the prompt mentions a sibling project (by name, alias, or absolute path), the hook exits 2 and Claude Code erases the prompt from context entirely. No reasoning, no tokens spent, no damage done.

THE DIFFERENTIATOR: read-warn / write-block tiering. A hard read-block would cripple real workflows — you often need to glance at a sibling repo to copy a pattern. So reads across project boundaries are allowed with a warning injected into context; writes are hard-denied via permissionDecision: "deny" (overrides --dangerously-skip-permissions).

7 hooks, zero runtime deps, Apache 2.0. Works on macOS, Linux, Windows. Hero fixture reproduces the original drift and proves the hook kills it before any reasoning token fires.

Also detects 5 known Claude Code hook bugs and documents workarounds for each (#8810, #10367, #11519, #24327, #27343). Run `lane-lock doctor` and it self-tests against them.

Install:
git clone https://github.com/maxysadm-GH/claude-code-lane-lock ~/projects/claude-code-lane-lock
cd ~/your-project
node ~/projects/claude-code-lane-lock/bin/install.mjs
node ~/projects/claude-code-lane-lock/bin/lane-lock.mjs doctor

Repo: https://github.com/maxysadm-GH/claude-code-lane-lock

Happy to answer questions. Genuinely curious if anyone else has hit this failure mode — I spent a while assuming I was the only one who let Claude Code wander overnight."""),

    ("[PREVIEW 4/8 — REDDIT r/ClaudeAI]", """TITLE: [Plugin] Claude Code lane-lock — pins sessions to project roots, blocks cross-project drift at t=0

BODY:

Hey r/ClaudeAI,

I built a small Claude Code plugin that solves a problem I had with running multiple parallel sessions across different projects.

THE PROBLEM: a session pinned to project A can silently drift into project B overnight when an ambiguous prompt comes in. I hit this directly — one session wrote 10 commits to the wrong repo while I was asleep. Four hours of Opus tokens on the wrong project.

WHAT LANE-LOCK DOES: installs 7 hooks that pin each Claude Code session to its git project root at session start, and blocks any prompt that references a different project *before reasoning begins*. The mechanism is UserPromptSubmit exit code 2 — Claude Code interprets that as "erase the prompt from context entirely." No LLM call, no round trip, no damage.

Reads across project boundaries are allowed with a context warning (so you can still glance at a sibling repo for patterns). Writes are hard-denied via permissionDecision: "deny" — even with --dangerously-skip-permissions.

WHY I'M POSTING HERE: I checked every hook-tagged issue on anthropics/claude-code, every prior art I could find, 12 swarm frameworks. Nobody had shipped this exact layer. Anthropic closed the related bug (#13797) as NOT_PLANNED — third-party plugins are the right place for this kind of guard. So I built the third-party plugin.

Apache 2.0, zero runtime deps, works on Windows/macOS/Linux, CI matrix green across Node 20 + 22.

Repo: https://github.com/maxysadm-GH/claude-code-lane-lock

Star it if it saves you a drift. Genuinely curious if anyone else runs parallel Claude Code sessions across multiple projects — and if you do, have you hit this failure mode?"""),

    ("[PREVIEW 5/8 — LINKEDIN — MBACIO company page]", """We shipped our first open-source contribution to the Claude Code ecosystem today: lane-lock.

The story behind it: one of our developers was running multiple Claude Code sessions in parallel, one per project. One night, a session pinned to one repo drifted into another and shipped ten commits to the wrong place. Four hours of reasoning burned on the wrong project.

That kind of failure isn't solved by git worktrees or manual discipline — it's a session-level identity problem that Claude Code itself doesn't track. We looked for existing solutions across 12 swarm frameworks and found none that addressed cross-repo drift at the session level.

So we built one.

lane-lock is 7 hook scripts, zero runtime dependencies, Apache 2.0 licensed. The core mechanism is a UserPromptSubmit hook that exits with code 2 when a prompt references a different project — which tells Claude Code to erase the prompt from context entirely before any reasoning tokens are spent. The drift dies before it exists.

We added read-warn / write-block tiering because hard read-blocks would cripple real workflows — you often need to glance at a sibling repo. Writes across project boundaries are hard-denied, even with --dangerously-skip-permissions. CI matrix is green on Ubuntu, macOS, and Windows across Node 20 and 22. Hero fixture reproduces the original drift and proves the hook kills it at t=0.

This is the first of several Claude Code ecosystem tools we're shipping. If you run parallel AI coding sessions and want to protect them from ambient drift, it's ready to install.

Repo: https://github.com/maxysadm-GH/claude-code-lane-lock

Built with Claude Opus 4.6 as co-author, under Apache 2.0 with full attribution requirements.

#ClaudeCode #OpenSource #AIEngineering #DeveloperTools #MBACIO"""),

    ("[PREVIEW 6/8 — LINKEDIN — Max personal]", """I spent four hours of Claude Opus tokens on the wrong project overnight.

A Claude Code session I'd pinned to one repo got an ambiguous prompt ("keep working on the dashboard") and drifted into a completely different repo. I woke up to ten commits in a branch I wasn't supposed to touch that night.

Here's the thing — the commits were fine. They actually improved the wrong project's dashboard. But I had a parallel session actively working on that exact project at the same time. Two sessions, one goal, ten wasted hours between them.

I went hunting for a fix. Read twelve swarm frameworks. Went through every open issue on anthropics/claude-code tagged "hook" or "session." Checked Reddit, HN, r/ClaudeAI.

Anthropic closed the "wrong repo" bug as NOT_PLANNED — and honestly, they were right. Third-party plugins are the right layer for this kind of guard. The platform team shouldn't have to write every safety rail users want.

So I built the third-party plugin.

lane-lock is the result: a 7-hook Claude Code plugin that pins each session to its git project root and blocks cross-project drift at t=0 — before any reasoning token is spent. The kill mechanism is UserPromptSubmit exit code 2, which Claude Code interprets as "erase this prompt from context entirely." No LLM call. No round trip. The drift dies before it exists.

Apache 2.0. Zero runtime deps. Green on Windows, macOS, Linux. Full story in the README, including the research pass that proved nobody had shipped this layer.

If you run parallel Claude Code sessions, this is for you. If you don't but you're curious how hook-based guards work in practice, the architecture doc in docs/ is worth a read.

https://github.com/maxysadm-GH/claude-code-lane-lock

Star it if it saves you a drift.

#ClaudeCode #ClaudeAI #Anthropic #OpenSource #DeveloperExperience"""),

    ("[PREVIEW 7/8 — ANTHROPIC ISSUE COMMENTS (4 comments)]", """TARGET: anthropics/claude-code issues #13797, #21397, #27311, #26514
TIMING: Posted AFTER Show HN + Reddit. Spaced 30 minutes apart. Polite, no accusations.

--- COMMENT ON #13797 (the main target — wrong repo bug) ---

Hi folks — for anyone landing on this issue who needs a workaround today:

I shipped a community plugin that addresses this class of drift by installing hooks in every Claude Code session. It pins the session to its git project root at SessionStart, and blocks any prompt that references a different project at UserPromptSubmit with exit code 2 — before any reasoning token is spent.

→ https://github.com/maxysadm-GH/claude-code-lane-lock

Apache 2.0. Zero runtime dependencies. 30 tests green across macOS + Linux + Windows CI matrix. Not affiliated with Anthropic — this is a community plugin.

The README has the full research narrative showing why the existing prior art (git worktrees, claudekit, disler's hooks cookbook, paddo.dev's guardrails) doesn't cover cross-repo drift. Closing this as NOT_PLANNED was the right call — third-party plugins are the right layer for this kind of guard.

Happy to hand this over or make it an official example if the team ever wants.

--- COMMENT ON #21397 (path-scoped permissions) ---

For anyone needing path-scoped permissions today: I shipped a community plugin (lane-lock) that enforces project-root pinning via hooks — hard-deny on Edit/Write/MultiEdit/NotebookEdit/Bash outside the pin, via permissionDecision: "deny" which overrides --dangerously-skip-permissions.

→ https://github.com/maxysadm-GH/claude-code-lane-lock

Apache 2.0, related to #13797. Not a full replacement for native path-scoped permissions but covers the "project root" case in a reliable way.

--- COMMENT ON #27311 (plan file clobbering) ---

Related community plugin that addresses session-scoping for multi-session workflows: https://github.com/maxysadm-GH/claude-code-lane-lock

It writes per-session lockfiles at ~/.claude/lane-lock/sessions/<session_id>.json and uses that as the session's identity across reloads. Not a direct fix for plan-file clobbering, but establishes session identity which is a prerequisite for scoping.

--- COMMENT ON #26514 (ralph-loop session scoping) ---

Community plugin that uses session-scoped state via per-session lockfiles keyed on session_id: https://github.com/maxysadm-GH/claude-code-lane-lock

Same underlying problem — ralph-loop state and multi-session coordination both need session identity. Lane-lock is proof that the pattern works via hooks."""),

    ("[PREVIEW 8/8 — awesome-claude-code PR]", """TARGET: hesreallyhim/awesome-claude-code
BRANCH: add-lane-lock
PR TITLE: Add claude-code-lane-lock (hooks / safety)

PR BODY:

Adds `claude-code-lane-lock` under the Hooks section.

WHAT IT DOES

Pins interactive Claude Code sessions to their git project root and blocks cross-project drift at t=0 (before any reasoning token fires) via UserPromptSubmit exit 2.

- 7 hooks, zero runtime dependencies
- Read-warn / write-block tiering
- CI matrix green on Ubuntu + macOS + Windows × Node 20 + 22
- Apache 2.0 + NOTICE attribution requirement
- Detects 5 upstream Claude Code hook bugs and documents workarounds

WHY ADD IT

Closes the gap that anthropics/claude-code#13797 (closed NOT_PLANNED) leaves behind: session-level identity of which repo a prompt belongs to. Complementary to git worktrees (which solve same-repo parallelism) and to ccswarm/claude-flow style task-dispatch frameworks (which assume a single repo scope).

LISTING ENTRY (to be added to the Hooks section):

- [claude-code-lane-lock](https://github.com/maxysadm-GH/claude-code-lane-lock) — Pin Claude Code sessions to their git project root; block cross-project drift at t=0 via UserPromptSubmit exit 2. 7 hooks, zero runtime deps, Apache 2.0."""),
]

HEADER = """🛡 LANE-LOCK LAUNCH — POST PREVIEWS

9 platforms. Posts saved at docs/launch/POSTS.md in the repo.

Reply with:
  APPROVE ALL         → greenlight every post
  APPROVE 1,3,5       → greenlight specific ones
  CHANGE 2            → I'll ask what to change
  HOLD                → pause everything

Also pending your call:
  - Launch timing (tonight soft / tomorrow AM amplified)
  - Whether I publish via Playwright (need manual login per platform) or you publish
  - Anthropic engagement plan → docs/ANTHROPIC-ENGAGEMENT.md (marketplace submission = the real validation)

Sending all 8 previews now..."""


def main():
    token = get_token()
    if not token:
        sys.stderr.write("ERROR: no TELEGRAM_BOT_TOKEN\n")
        sys.exit(1)

    print(f"sending header to {CHAT_ID}...")
    ok, mid = send(token, HEADER)
    print(f"  header: ok={ok} mid={mid}")
    time.sleep(0.6)

    for label, body in POSTS:
        print(f"sending {label}...")
        results = send_chunked(token, label, body)
        for ok, mid in results:
            print(f"  chunk: ok={ok} mid={mid}")
        time.sleep(0.6)

    print("")
    print(f"all {len(POSTS)} previews sent to chat {CHAT_ID}")


if __name__ == "__main__":
    main()

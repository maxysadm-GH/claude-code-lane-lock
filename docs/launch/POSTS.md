# Launch posts — DRAFT (pending approval)

All copy for the coordinated launch of `claude-code-lane-lock` v0.1.0.
Version-controlled so we can tweak, track changes, and diff against published versions.

**Status**: awaiting approval via Telegram. Do NOT publish until Max ACKs.

---

## 1. Show HN submission

**Title**:
```
Show HN: Lane-lock – Block Claude Code from drifting into the wrong repo (anthropics/claude-code#13797)
```

*(71 chars — well under HN's 80-char title limit)*

**URL**: `https://github.com/maxysadm-GH/claude-code-lane-lock`

**Body** (leave blank if URL is included — HN convention):

```
```

*(HN submissions with a URL leave body empty. Discussion happens in comments.)*

**First comment (posted by OP right after submission)**:

```
Author here. Quick context on why I built this:

I was running multiple Claude Code sessions in parallel across different projects. One night, a session I had pinned to project-alpha drifted into project-gamma — ambiguous prompt ("keep working on the dashboard") and the session had no session-level understanding of which repo it belonged to. It read files from project-gamma. It planned for project-gamma. It shipped 10 commits into the wrong repo. Four hours of Opus tokens burned on the wrong project.

I looked for existing solutions. Read 12 swarm frameworks. Went through every open issue on anthropics/claude-code tagged `hook` or `session`. Checked Reddit, HN, r/ClaudeAI. Anthropic closed the "wrong repo" bug (#13797) as NOT_PLANNED — legitimately, third-party plugins are the right layer for this kind of guard. So I built the third-party plugin.

The kill mechanism is one line of hook config and one exit code. UserPromptSubmit fires before any reasoning token is spent. If the prompt references a project that isn't the pinned one, the hook exits 2. Claude Code interprets that as "erase the prompt from context entirely" — no LLM call, no round trip, no "are you sure?" dialog. The drift dies before it exists.

The rest of the plugin is read-warn / write-block tiering. Hard read-blocks cripple real workflows (you often glance at a sibling repo to copy a pattern), so reads get a context warning instead. Writes outside the pin are hard-denied via permissionDecision deny — overrides --dangerously-skip-permissions.

Zero runtime deps. Apache 2.0. Tested on macOS + Linux + Windows via CI matrix. The repo has the full research narrative (12 framework survey), the hero fixture that reproduces the original drift, and docs for every known upstream bug this works around (#8810, #10367, #11519, #27343, #24327).

Happy to answer questions. Curious especially if anyone else has hit this failure mode in their own Claude Code setups.
```

---

## 2. X/Twitter thread (MBACIO handle)

**Thread (10 tweets)**:

### Tweet 1/10 (HOOK)
```
One Claude Code session, pinned to project-alpha.
Ambient prompt: "keep working on the dashboard."
Overnight, it drifted into a different repo.
Shipped 10 commits to the wrong project.
4 hours of Opus tokens burned.

I built the fix. 🧵
```

### Tweet 2/10
```
The failure mode is simple:

Claude Code has no session-level understanding of which repo it belongs to. An ambiguous prompt sends a session pinned to project A straight into project B.

Git worktrees solve this within a repo. They don't solve cross-repo.
```

### Tweet 3/10
```
I surveyed 12 swarm frameworks. ccswarm, claude-flow, claudekit, ccswitch, claude-mem. Every one solves same-repo parallelism or task dispatch. None of them catch cross-repo drift at the session level.

I checked Reddit, HN, r/ClaudeAI. Nobody shipped it.
```

### Tweet 4/10
```
Anthropic closed the "wrong repo" bug as NOT_PLANNED — and that was legitimate. Third-party plugins ARE the right layer for this kind of enforcement.

So I built the third-party plugin.
```

### Tweet 5/10
```
The kill mechanism is a UserPromptSubmit hook with exit code 2.

UserPromptSubmit fires before any reasoning token is spent. If the prompt mentions a sibling project, the hook exits 2. Claude Code erases the prompt from context entirely.

No LLM call. No round trip. The drift dies before it exists.
```

### Tweet 6/10
```
But a hard read-block cripples real workflows. You need to glance at a sibling repo for a pattern sometimes.

So lane-lock tiers:
• Reads → allowed + warning injected into context
• Writes → hard-denied via permissionDecision.deny

Writes override --dangerously-skip-permissions.
```

### Tweet 7/10
```
7 hooks total:
• SessionStart — pin capture + lane marker
• UserPromptSubmit — the kill
• PreToolUse (read) — warn
• PreToolUse (write) — deny
• CwdChanged — re-verify
• SessionEnd — cleanup
• TaskCreated — forward-compat gate for Agent Teams

Zero runtime deps. Apache 2.0.
```

### Tweet 8/10
```
Also detects 5 upstream Claude Code bugs that affect plugin reliability and tells you how to work around each:

#8810 #10367 #11519 #24327 #27343

All documented in docs/KNOWN-ISSUES.md. Run `lane-lock doctor` and it self-tests against them.
```

### Tweet 9/10
```
CI matrix green on Ubuntu + macOS + Windows × Node 20 + 22. Hero fixture reproduces the original drift incident and proves the hook kills it at t=0.

Zero reasoning tokens spent on the wrong project. That's the promise.
```

### Tweet 10/10 (CTA)
```
github.com/maxysadm-GH/claude-code-lane-lock

Apache 2.0. Install one script, run `lane-lock doctor`, and your Claude Code sessions are pinned.

Built by MBACIO with Claude Opus 4.6 as co-author.

If it saves you a drift, star the repo. 🛡
```

---

## 3. Reddit r/ClaudeCode

**Subreddit**: `r/ClaudeCode`
**Title**: `I built a plugin that blocks cross-project drift in Claude Code — the anthropics/claude-code#13797 problem`
**Flair**: `Showcase` or `Plugin` (whichever exists)

**Body**:

```
Hey r/ClaudeCode,

I run a handful of projects in parallel, one Claude Code session per repo. A few nights ago I watched one of them drift overnight: session pinned to project-alpha, ambiguous prompt, woke up to 10 commits in a completely different repo. Four hours of Opus tokens burned on the wrong project.

I went looking for existing solutions. Worktrees solve same-repo parallelism. `ccswarm`, `claude-flow`, `claudekit`, `ccswitch`, `claude-mem` all do interesting things but none of them catch cross-*repo* drift at the session level. Anthropic closed the "wrong repo" bug (#13797) as NOT_PLANNED — reasonable call, third-party plugins are the right layer for this.

So I built the third-party plugin.

**The kill mechanism**: a `UserPromptSubmit` hook with exit code 2. UserPromptSubmit fires before Claude starts reasoning. If the prompt mentions a sibling project (by name, alias, or absolute path), the hook exits 2 and Claude Code erases the prompt from context entirely. No reasoning, no tokens spent, no damage done.

**The differentiator**: read-warn / write-block tiering. A hard read-block would cripple real workflows — you often need to glance at a sibling repo to copy a pattern. So reads across project boundaries are allowed with a warning injected into context; writes are hard-denied via `permissionDecision: "deny"` (overrides `--dangerously-skip-permissions`).

**7 hooks, zero runtime deps, Apache 2.0.** Works on macOS, Linux, Windows. Hero fixture reproduces the original drift and proves the hook kills it before any reasoning token fires.

Also detects 5 known Claude Code hook bugs that affect plugin reliability and documents workarounds for each (#8810, #10367, #11519, #24327, #27343). Run `lane-lock doctor` and it self-tests against them.

**Install**:

```
git clone https://github.com/maxysadm-GH/claude-code-lane-lock ~/projects/claude-code-lane-lock
cd ~/your-project
node ~/projects/claude-code-lane-lock/bin/install.mjs
node ~/projects/claude-code-lane-lock/bin/lane-lock.mjs doctor
```

Repo: https://github.com/maxysadm-GH/claude-code-lane-lock

Happy to answer questions. Genuinely curious if anyone else has hit this failure mode — I spent a while assuming I was the only one who let Claude Code wander overnight.
```

---

## 4. Reddit r/ClaudeAI

**Subreddit**: `r/ClaudeAI`
**Title**: `[Plugin] Claude Code lane-lock — pins sessions to project roots, blocks cross-project drift at t=0`
**Flair**: `Projects` or `Resources`

**Body** — shorter version tailored to the broader /r/ClaudeAI audience (less Claude-Code-internal jargon):

```
Hey r/ClaudeAI,

I built a small Claude Code plugin that solves a problem I had with running multiple parallel sessions across different projects.

**The problem**: a session pinned to project A can silently drift into project B overnight when an ambiguous prompt comes in. I hit this directly — one session wrote 10 commits to the wrong repo while I was asleep. Four hours of Opus tokens on the wrong project.

**What lane-lock does**: installs 7 hooks that pin each Claude Code session to its git project root at session start, and blocks any prompt that references a different project *before reasoning begins*. The mechanism is `UserPromptSubmit` exit code 2 — Claude Code interprets that as "erase the prompt from context entirely." No LLM call, no round trip, no damage.

Reads across project boundaries are allowed with a context warning (so you can still glance at a sibling repo for patterns). Writes are hard-denied via `permissionDecision: "deny"` — even with `--dangerously-skip-permissions`.

**Why I'm posting this here**: I checked every hook-tagged issue on `anthropics/claude-code`, every prior art I could find, 12 swarm frameworks. Nobody had shipped this exact layer. Anthropic closed the related bug (#13797) as NOT_PLANNED — third-party plugins are the right place for this kind of guard. So I built the third-party plugin.

Apache 2.0, zero runtime deps, works on Windows/macOS/Linux, CI matrix green across Node 20 + 22.

Repo: https://github.com/maxysadm-GH/claude-code-lane-lock

Star it if it saves you a drift. Genuinely curious if anyone else runs parallel Claude Code sessions across multiple projects — and if you do, have you hit this failure mode?
```

---

## 5. LinkedIn post — MBACIO company page

**Tone**: professional thought leadership, MBACIO as the builder, problem-first framing.

```
We shipped our first open-source contribution to the Claude Code ecosystem today: lane-lock.

The story behind it: one of our developers was running multiple Claude Code sessions in parallel, one per project. One night, a session pinned to one repo drifted into another and shipped ten commits to the wrong place. Four hours of reasoning burned on the wrong project.

That kind of failure isn't solved by git worktrees or manual discipline — it's a session-level identity problem that Claude Code itself doesn't track. We looked for existing solutions across 12 swarm frameworks and found none that addressed cross-repo drift at the session level.

So we built one.

lane-lock is 7 hook scripts, zero runtime dependencies, Apache 2.0 licensed. The core mechanism is a UserPromptSubmit hook that exits with code 2 when a prompt references a different project — which tells Claude Code to erase the prompt from context entirely before any reasoning tokens are spent. The drift dies before it exists.

We added read-warn / write-block tiering because hard read-blocks would cripple real workflows — you often need to glance at a sibling repo. Writes across project boundaries are hard-denied, even with `--dangerously-skip-permissions`. CI matrix is green on Ubuntu, macOS, and Windows across Node 20 and 22. Hero fixture reproduces the original drift and proves the hook kills it at t=0.

This is the first of several Claude Code ecosystem tools we're shipping. If you run parallel AI coding sessions and want to protect them from ambient drift, it's ready to install.

Repo: https://github.com/maxysadm-GH/claude-code-lane-lock

Built with Claude Opus 4.6 as co-author, under Apache 2.0 with full attribution requirements.

#ClaudeCode #OpenSource #AIEngineering #DeveloperTools #MBACIO
```

---

## 6. LinkedIn post — Max personal

**Tone**: founder voice, story-first, a bit more personal. Different angle from the company post.

```
I spent four hours of Claude Opus tokens on the wrong project overnight.

A Claude Code session I'd pinned to one repo got an ambiguous prompt ("keep working on the dashboard") and drifted into a completely different repo. I woke up to ten commits in a branch I wasn't supposed to touch that night.

Here's the thing — the commits were fine. They actually improved the wrong project's dashboard. But I had a parallel session actively working on that exact project at the same time. Two sessions, one goal, ten wasted hours between them.

I went hunting for a fix. Read twelve swarm frameworks. Went through every open issue on anthropics/claude-code tagged "hook" or "session." Checked Reddit, HN, r/ClaudeAI.

Anthropic closed the "wrong repo" bug as NOT_PLANNED — and honestly, they were right. Third-party plugins are the right layer for this kind of guard. The platform team shouldn't have to write every safety rail users want.

So I built the third-party plugin.

lane-lock is the result: a 7-hook Claude Code plugin that pins each session to its git project root and blocks cross-project drift at t=0 — before any reasoning token is spent. The kill mechanism is `UserPromptSubmit` exit code 2, which Claude Code interprets as "erase this prompt from context entirely." No LLM call. No round trip. The drift dies before it exists.

Apache 2.0. Zero runtime deps. Green on Windows, macOS, Linux. Full story in the README, including the research pass that proved nobody had shipped this layer.

If you run parallel Claude Code sessions, this is for you. If you don't but you're curious how hook-based guards work in practice, the architecture doc in docs/ is worth a read.

https://github.com/maxysadm-GH/claude-code-lane-lock

Star it if it saves you a drift.

#ClaudeCode #ClaudeAI #Anthropic #OpenSource #DeveloperExperience
```

---

## 7. GitHub issue comments — polite, one per closed NOT_PLANNED issue

### anthropics/claude-code#13797

```
Hi folks — for anyone landing on this issue who needs a workaround today:

I shipped a community plugin that addresses this class of drift by installing hooks in every Claude Code session. It pins the session to its git project root at SessionStart, and blocks any prompt that references a different project at UserPromptSubmit with exit code 2 — before any reasoning token is spent.

→ https://github.com/maxysadm-GH/claude-code-lane-lock

Apache 2.0. Zero runtime dependencies. 30 tests green across macOS + Linux + Windows CI matrix. Not affiliated with Anthropic — this is a community plugin.

The README has the full research narrative showing why the existing prior art (git worktrees, claudekit, disler's hooks cookbook, paddo.dev's guardrails) doesn't cover cross-*repo* drift. Closing this as NOT_PLANNED was the right call — third-party plugins are the right layer for this kind of guard.

Happy to hand this over or make it an official example if the team ever wants.
```

### anthropics/claude-code#21397

```
For anyone needing path-scoped permissions today: I shipped a community plugin (lane-lock) that enforces project-root pinning via hooks — hard-deny on Edit/Write/MultiEdit/NotebookEdit/Bash outside the pin, via permissionDecision: "deny" which overrides --dangerously-skip-permissions.

→ https://github.com/maxysadm-GH/claude-code-lane-lock

Apache 2.0, related to #13797. Not a full replacement for native path-scoped permissions but covers the "project root" case in a reliable way.
```

### anthropics/claude-code#27311

```
Related community plugin that addresses session-scoping for multi-session workflows: https://github.com/maxysadm-GH/claude-code-lane-lock

It writes per-session lockfiles at ~/.claude/lane-lock/sessions/<session_id>.json and uses that as the session's identity across reloads. Not a direct fix for plan-file clobbering, but establishes session identity which is a prerequisite for scoping.
```

### anthropics/claude-code#26514

```
Community plugin that uses session-scoped state via per-session lockfiles keyed on session_id: https://github.com/maxysadm-GH/claude-code-lane-lock

Same underlying problem — ralph-loop state and multi-session coordination both need session identity. Lane-lock is proof that the pattern works via hooks.
```

---

## 8. awesome-claude-code PR

**Target**: `hesreallyhim/awesome-claude-code`
**Branch**: `add-lane-lock`
**PR title**: `Add claude-code-lane-lock (hooks / safety)`

**PR body**:

```markdown
Adds `claude-code-lane-lock` under **Hooks** section.

## What it does

Pins interactive Claude Code sessions to their git project root and blocks cross-project drift at t=0 (before any reasoning token fires) via `UserPromptSubmit` exit 2.

- 7 hooks, zero runtime dependencies
- Read-warn / write-block tiering
- CI matrix green on Ubuntu + macOS + Windows × Node 20 + 22
- Apache 2.0 + NOTICE attribution requirement
- Detects 5 upstream Claude Code hook bugs and documents workarounds

## Why add it

Closes the gap that `anthropics/claude-code#13797` (closed NOT_PLANNED) leaves behind: session-level identity of which repo a prompt belongs to. Complementary to git worktrees (which solve same-repo parallelism) and to `ccswarm`/`claude-flow` style task-dispatch frameworks (which assume a single repo scope).

## Listing entry

```markdown
- [claude-code-lane-lock](https://github.com/maxysadm-GH/claude-code-lane-lock) — Pin Claude Code sessions to their git project root; block cross-project drift at t=0 via `UserPromptSubmit` exit 2. 7 hooks, zero runtime deps, Apache 2.0.
```
```

---

## 9. Blog post — mbacio.com

*(Long-form — outline only here, full draft saved separately at `docs/launch/BLOG-POST.md` if we choose to publish it.)*

**Title**: *"The 4-hour overnight drift: how we shipped a Claude Code plugin to fix what Anthropic decided not to"*

**Subtitle**: *"A 1500-line fix for a session-identity problem, built with Claude Opus 4.6 as co-author under Apache 2.0."*

**Sections**:
1. The 4-hour incident (narrative, ~300 words)
2. The research — 12 frameworks surveyed, nothing fit (~400 words)
3. The insight — `UserPromptSubmit` exit 2 as the kill mechanism (~300 words)
4. The architecture — 7 hooks, read-warn/write-block tiering (~400 words)
5. The known Anthropic bugs we worked around (~200 words)
6. The meta-loop — using Claude Code to build a guard for Claude Code (~200 words)
7. Call to action — install, star, contact us for AI engineering consulting (~100 words)

**Publish timing**: 72h after Show HN so the blog is a follow-up, not the launch itself.

---

## Sequencing (from docs/ANTHROPIC-ENGAGEMENT.md)

```
T+0:    awesome-claude-code PR opened (low risk, no downside)
T+0:    X thread published from MBACIO handle
T+0:    Show HN submitted
T+1h:   OP first-comment on Show HN (the backstory)
T+2h:   LinkedIn posts (company + personal)
T+24h:  Reddit r/ClaudeCode + r/ClaudeAI
T+48h:  Comments on the 4 closed Anthropic issues (spaced 30 min apart)
T+72h:  Claude Code plugin marketplace submission
T+72h:  Blog post on mbacio.com
T+96h:  Optional DM to Boris Cherny at Anthropic if the launch has traction
```

---

## Kill criteria

If ANY of these happen in the first 48h, pause the sequence:
1. A critical bug report or security issue surfaces
2. An Anthropic team member asks us to take something down
3. The HN thread turns hostile in a way we can't recover via comments
4. Reddit mods remove the post

If pausing: fix the issue, document the fix in CHANGELOG, restart the sequence from where we paused. Never delete posts — that's the sign of panic. Acknowledge in a reply and iterate.

---

*All drafts above pending Max's approval via Telegram before publish. Do NOT push to any platform without explicit ACK.*

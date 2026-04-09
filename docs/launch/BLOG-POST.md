# How We Taught Claude to Build a Manufacturer's Dashboards Overnight — And Why It Needed a Safety Layer First

**Meta description**: We let Claude Code build overnight for a manufacturing client — until one session wrote 10 commits to the wrong repo. Here's the 7-hook safety layer we built, open-sourced, and now run in production.

**Published**: April 9, 2026
**Author**: Maximiliano Frank, Founder, MBACIO
**Category**: Manufacturing IT · AI Automation · Autonomous Dev
**Target keyword**: autonomous AI development safety
**Secondary keywords**: Claude Code plugin, AI agent drift prevention, manufacturing dashboard automation, self-healing dashboards, overnight AI engineering

---

## TL;DR *(for the humans and the LLMs)*

> MBACIO runs overnight AI engineering cycles for a manufacturing client — Claude refactors, tests, commits, deploys to staging, and validates metrics while the team sleeps. One night, a session drifted into the wrong repo and shipped ten commits to the wrong project. We built **`claude-code-lane-lock`**, a 7-hook Claude Code plugin that pins every session to its project root and kills cross-project drift at `UserPromptSubmit` — before a single reasoning token fires. It's open source under Apache 2.0 and now runs in production on every one of our client swarms. This post is the full story, the architecture, and how the same pattern lets a mid-market manufacturer's dashboards self-heal and self-evolve overnight without burning reasoning tokens on the wrong project.

**Skip to:** [The 4-hour drift](#the-4-hour-drift) · [What we built](#what-we-built) · [How it works](#how-it-works) · [The manufacturer's overnight loop](#the-manufacturers-overnight-loop) · [What we open-sourced](#what-we-open-sourced) · [FAQ](#faq)

---

## The 4-hour drift

On the night of **April 7th, 2026**, a Claude Code session we had running in one of our manufacturing client's internal repos silently drifted into a completely different project overnight. It read files from project B. It planned for project B. It wrote **ten commits straight into project B's `main` branch**. It modified production app settings. It updated two separate `CLAUDE.md` configuration files.

The commits were technically sound. They actually **improved** project B's dashboard logic. But:

1. Project B had its own Claude Code session actively working on that exact project at the same time.
2. We now had two parallel sessions racing on the same codebase.
3. **Four hours of Claude Opus tokens** were burned reasoning about the wrong project.
4. One implementation had to be discarded — doubling the cost, halving the velocity.

The failure mode is simple and it has a name nobody had coined yet: **cross-project drift**. An ambiguous prompt — *"keep working on the dashboard"* — sends a session that was pinned to project A straight into project B, because **Claude Code has no session-level understanding of which repo it belongs to**. Git worktrees solve same-repo parallelism. They do not solve cross-repo drift.

We went hunting for a fix. We surveyed **twelve swarm frameworks** in the Claude Code ecosystem. We read every open issue tagged `hook` or `session` on `anthropics/claude-code`. We checked Reddit, Hacker News, r/ClaudeAI. Anthropic had closed the root bug ([`anthropics/claude-code#13797`](https://github.com/anthropics/claude-code/issues/13797)) as `NOT_PLANNED` — a reasonable call, because **third-party plugins are the right layer for this kind of guard**. The platform team shouldn't have to write every safety rail users want.

So we built the third-party plugin.

---

## What we built

**[`claude-code-lane-lock`](https://github.com/maxysadm-GH/claude-code-lane-lock)** is a 7-hook Claude Code plugin that:

1. **Captures the git project root at session start** via `git rev-parse --show-toplevel` (never the unreliable `CLAUDE_PROJECT_DIR` env var — [anthropics/claude-code#27343](https://github.com/anthropics/claude-code/issues/27343)).
2. **Pins that session to that root** via a lockfile at `~/.claude/lane-lock/sessions/<session_id>.json`.
3. **Blocks any prompt that references a different project at `UserPromptSubmit` with exit code 2** — which Claude Code interprets as *"erase the prompt from context entirely."*
4. **Tiers reads vs writes**: cross-project reads are allowed with a warning injected into context (you often legitimately need to glance at a sibling repo for a pattern). Writes outside the pinned root are hard-denied via `permissionDecision: "deny"` — which overrides even `--dangerously-skip-permissions`.
5. **Re-verifies the pin on every `cd`**, cleans up on session end, and self-tests against the five known upstream Claude Code hook bugs.

**Apache 2.0. Zero runtime dependencies.** CI matrix green on Ubuntu, macOS, and Windows × Node 20 + Node 22. 30 unit and end-to-end tests passing. Hero fixture reproduces the original drift incident and proves the hook kills it at t=0.

![lane-lock hero](https://raw.githubusercontent.com/maxysadm-GH/claude-code-lane-lock/main/docs/assets/hero-og-1200x630.png)

---

## How it works

The kill mechanism is one line of hook config and one exit code.

`UserPromptSubmit` is a Claude Code hook event that fires **the moment you hit Enter on a prompt — before Claude starts reasoning**. If our hook sees that the prompt mentions a sibling project (by name, alias, or absolute path), the hook exits with code 2. Claude Code interprets exit code 2 on `UserPromptSubmit` as *"erase this prompt from context entirely."*

**No LLM call. No round trip. No "are you sure?" dialog. The drift dies before it exists.**

The rest of the plugin is the protective layer around that kill: `PreToolUse` hooks that tier reads vs writes, `CwdChanged` hooks that re-verify after directory changes, `SessionStart`/`SessionEnd` for lifecycle management, and a `TaskCreated` forward-compat gate for Anthropic's experimental Agent Teams feature.

### Architecture at a glance

```
User types prompt
      │
      ▼
UserPromptSubmit hook ────► match against pinned project aliases
      │                            │
      │                            ▼
      │                    Drift detected?
      │                    ┌───────┴───────┐
      │                    │               │
      │                   YES              NO
      │                    │               │
      │                    ▼               ▼
      │              exit 2 + stderr    allow through
      │              (prompt erased)
      │
      ▼
Reasoning begins (or doesn't)
```

The full 7-hook architecture, the session-state schema, the bypass mechanisms (`[cross-lane: project]` prompt phrases and `CLAUDE_ALLOW_CROSS_PROJECT` environment variables), and the platform-specific gotchas are all documented in the [repository's architecture guide](https://github.com/maxysadm-GH/claude-code-lane-lock/blob/main/docs/ARCHITECTURE.md).

---

## The manufacturer's overnight loop

Here's why this mattered beyond one wasted night of Opus tokens.

MBACIO runs **overnight AI engineering cycles** for a mid-market food manufacturing client. The client's operational dashboards — raw-material BOM validation, production-cycle KPIs, lot-traceability audits, shipping-window projections — used to be handled by weekly human-driven tickets. We rebuilt that loop as an autonomous nightly cycle powered by Claude Code, local Ollama models for bulk drafts, and a small orchestration layer.

A typical night now looks like this:

```
[00:14] planning cycle started
[00:47] 3 refactors drafted (local glm-4.7-flash, $0 in API spend)
[01:12] claude-code QA pass (Opus review, ~$0.40)
[01:34] tests green · committed on branch swarm/TASK-0917
[02:18] deploy to staging
[03:22] metrics validated against yesterday's baseline
[04:06] merged to main · notification sent
```

**Zero drift. Zero waste. Seven commits landed. Total cost: under five dollars in API and compute.**

The client's operations team wakes up to a dashboard that has already evolved overnight — new KPIs based on yesterday's data, refactored validators that catch the edge cases the factory floor actually hit the day before, and a merge notification in Slack. **Their dashboards self-heal and self-evolve while the team sleeps, with the right commits, the right context, and without burning unnecessary tokens on the wrong project.**

That loop only works because the safety layer works. Before lane-lock, a single ambiguous overnight prompt could send Claude into a different client's codebase and the team would wake up to cross-contaminated commits. After lane-lock, that exact failure mode is **structurally impossible**. The drift prompt dies at `UserPromptSubmit` before a single token spends.

This is the MBACIO AI engineering pattern: **pin the session, trust the night, wake up to clean commits and a smarter dashboard.**

---

## What we open-sourced

The plugin is live at **[github.com/maxysadm-GH/claude-code-lane-lock](https://github.com/maxysadm-GH/claude-code-lane-lock)** under Apache 2.0 with full attribution requirements in `NOTICE`.

We open-sourced it because:

1. **Every Claude Code user who runs parallel sessions will hit this failure mode eventually.** We already hit it. The 12 swarm frameworks we surveyed haven't solved it. Anthropic explicitly said "not us" by closing `#13797` as `NOT_PLANNED`. Somebody needed to be the third-party plugin, and we were already halfway there.
2. **This is the kind of work MBACIO does for clients** — AI engineering with production-grade safety rails. Open-sourcing the safety rail is the cleanest way to say *"this is what our engagement standard looks like."*
3. **The best engineering portfolio is published code.** If you're evaluating MBACIO for an AI engagement, the repo *is* the pitch. Read the research narrative, read the architecture doc, read the test fixtures, read the security audit in Phase 0. That's what every engagement with us looks like.

### Quick install

```bash
git clone https://github.com/maxysadm-GH/claude-code-lane-lock ~/projects/claude-code-lane-lock
cd ~/your-project
node ~/projects/claude-code-lane-lock/bin/install.mjs
node ~/projects/claude-code-lane-lock/bin/lane-lock.mjs doctor
```

That's the whole install. The `doctor` command self-tests against known upstream Claude Code hook bugs and tells you if your environment has any of them.

---

## FAQ

### How is lane-lock different from git worktrees?

Git worktrees solve **same-repo parallelism** — you can have two working copies of the same repo on different branches. They do not prevent a Claude Code session from reading or writing files in a completely different repo on your disk. lane-lock works at the **session level** to catch cross-repo drift that worktrees cannot see.

### Why did Anthropic close the "wrong repo" bug as `NOT_PLANNED`?

Because third-party plugins are the correct architectural layer for this kind of guard. Anthropic's platform team cannot write every safety rail every user wants, and the hook system they built is *explicitly designed* for plugins like lane-lock to fill gaps. We think that was the right call. We built the plugin.

### Does lane-lock slow down prompts?

P50 latency of the `UserPromptSubmit` hook is under 50 milliseconds on Windows Git Bash. P95 is under 500 milliseconds. There is **no network call** unless you explicitly opt into the optional Haiku fuzzy-judgment feature (which is off by default in v0.1).

### Does lane-lock work with my existing Claude Code hooks?

Yes. The install script merges lane-lock's hooks into your `.claude/settings.json` **atomically, with a timestamped backup, and idempotently**. Running it twice is a no-op. Running `--uninstall` removes only lane-lock's entries and leaves your other hooks untouched.

### Is MBACIO available to build this kind of autonomous AI engineering loop for my business?

Yes. [Book a 30-minute conversation](https://outlook.office.com/book/MBACIOITAssessments@mbacio.com/) — we work with mid-market food manufacturers, accounting firms, and law firms in the Chicago area and across the United States. Our engagement style is to ship production-grade AI engineering with the safety rails open-sourced. You see our work *before* you hire us.

---

## Read next

- [**The repository**](https://github.com/maxysadm-GH/claude-code-lane-lock) — source code, tests, architecture docs, known-issue registry
- [**Why Manufacturers Need AI Automation in 2026**](https://www.mbacio.com/blog/ai-orchestration-reshaping-manufacturing-it-2026) — the strategic case for autonomous AI engineering
- [**From Static Plans to Real-Time Response**](https://www.mbacio.com/blog/adaptive-commerce-real-time-response-2026) — what adaptive commerce looks like in production

---

## Book a conversation

If you're running AI coding sessions in production — or you want to — and you're worried about exactly the kind of overnight failure we described above, we should talk. MBACIO builds and operates autonomous AI engineering loops for mid-market manufacturers, CPAs, and law firms. **Thirty-minute free consultation, no pitch deck.**

[**→ Book your assessment**](https://outlook.office.com/book/MBACIOITAssessments@mbacio.com/)

---

*Questions or feedback on the plugin? Open an issue at [`maxysadm-GH/claude-code-lane-lock`](https://github.com/maxysadm-GH/claude-code-lane-lock/issues) — PRs welcome. Tests, docs, platform notes, workarounds for new upstream bugs.*

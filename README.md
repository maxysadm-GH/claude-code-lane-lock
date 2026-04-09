<div align="center">

# 🛡 claude-code-lane-lock

**Pin Claude Code sessions to their project root. Block cross-project drift at t=0 — before reasoning tokens spend.**

[![CI](https://github.com/maxysadm-GH/claude-code-lane-lock/actions/workflows/ci.yml/badge.svg)](https://github.com/maxysadm-GH/claude-code-lane-lock/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node ≥20.11](https://img.shields.io/badge/node-%E2%89%A520.11-brightgreen.svg)](https://nodejs.org/)
[![Claude Code ≥v2.1.89](https://img.shields.io/badge/claude--code-%E2%89%A5v2.1.89-blueviolet.svg)](https://github.com/anthropics/claude-code)
[![Zero runtime deps](https://img.shields.io/badge/runtime--deps-0-success.svg)](package.json)

</div>

---

## The 4-hour overnight incident

On the night of April 7th 2026, a Claude Code session I had running in `project-alpha` silently drifted into a different repo. It read files from `inventory-demo/`. It planned for `inventory-demo/`. It wrote ten commits straight into `Project Gamma/main`. It modified the Azure Easy Auth excludedPaths on a production app. It updated both projects' `CLAUDE.md` files.

The commits were technically fine — they actually improved the Project Gamma inventory dashboard. But I woke up to a foreign branch history in a repo I wasn't supposed to be touching that night. **Four hours of Opus tokens, spent on the wrong project.**

The failure mode is simple: an ambiguous prompt (`keep working on the dashboard`) sends a session that was pinned to project A straight into project B, because Claude Code has no session-level understanding of which repo it belongs to. Git worktrees solve this for branches inside one repo. They don't solve it across repos.

I looked. I read 12 swarm frameworks. I went through every open issue on [`anthropics/claude-code`](https://github.com/anthropics/claude-code) tagged `hook` or `session`. I checked Reddit. I checked HN. Anthropic closed the "wrong repo" bug ([#13797](https://github.com/anthropics/claude-code/issues/13797)) as `NOT_PLANNED`.

**Nobody had shipped the fix.** So I shipped it.

---

## What it does

`claude-code-lane-lock` is a Claude Code plugin that installs seven hooks. The kill mechanism sits inside `UserPromptSubmit`:

```
  $ # Inside a Claude Code session pinned to project-alpha, you type:
  >  Now switch gears and fix the Project Gamma inventory dashboard raw-material BOM.

  ╔════════════════════════════════════════════════════════════════════╗
  ║  🛡  lane-lock: drift prompt BLOCKED before reasoning started.     ║
  ╠════════════════════════════════════════════════════════════════════╣
  ║                                                                    ║
  ║    Pinned project: project-alpha                                         ║
  ║    Pin root:       ~/Projects/project-alpha             ║
  ║                                                                    ║
  ║    Reason: alias                                                   ║
  ║    Matched project names: project-gamma                                      ║
  ║                                                                    ║
  ║    Bypass: add [cross-lane: project-gamma] to the prompt, or set             ║
  ║    CLAUDE_ALLOW_CROSS_PROJECT=project-gamma in the environment, or start     ║
  ║    a new Claude Code session from the target project directory.   ║
  ║                                                                    ║
  ╚════════════════════════════════════════════════════════════════════╝
  (prompt erased from context, exit 2, zero reasoning tokens spent)
```

That's it. The prompt never reaches the reasoning engine. The 4 hours of wasted Opus cycles can't happen because there is nothing to reason about.

---

## Quick start

Install into this project only (recommended first):

```bash
git clone https://github.com/maxysadm-GH/claude-code-lane-lock ~/Projects/claude-code-lane-lock
cd ~/your-project
node ~/Projects/claude-code-lane-lock/bin/install.mjs
```

Or install user-wide:

```bash
node ~/Projects/claude-code-lane-lock/bin/install.mjs --global
```

Verify:

```bash
node ~/Projects/claude-code-lane-lock/bin/lane-lock.mjs status
node ~/Projects/claude-code-lane-lock/bin/lane-lock.mjs doctor
node ~/Projects/claude-code-lane-lock/bin/lane-lock.mjs simulate "fix the other project"
```

Uninstall cleanly:

```bash
node ~/Projects/claude-code-lane-lock/bin/install.mjs --uninstall
```

The install script writes a timestamped backup before any change, is idempotent, and only removes its own entries on uninstall — your existing hooks are preserved.

---

## How it compares

|                                | lane-lock | git worktrees | Manual `CLAUDE.md` discipline | Docker sandbox per project |
|--------------------------------|-----------|---------------|-------------------------------|----------------------------|
| Stops cross-*repo* drift       | ✅        | ❌            | ⚠️ (trust-based)              | ✅                         |
| Stops cross-*branch* drift     | n/a       | ✅            | ❌                            | ✅                         |
| Fires **before reasoning**     | ✅ `UserPromptSubmit` exit 2 | n/a | ❌ | n/a |
| Overrides `--dangerously-skip-permissions` | ✅ | n/a | ❌ | ✅ |
| Setup effort                   | one install script | `git worktree add` | rewrite CLAUDE.md | containerize every project |
| Runtime cost                   | $0        | $0            | $0                            | 💰 per-container           |
| Catches ambiguous prompts      | ✅ (+ optional Haiku) | ❌ | ❌ | ❌ |
| Blocks writes via `permissionDecision: deny` | ✅ | n/a | ❌ | ✅ |
| Works today, no waiting        | ✅        | ✅            | ✅                            | ⚠️ (real build work)       |

---

## The seven hooks

| # | Hook | When it fires | What it does |
|---|------|---------------|--------------|
| 1 | `SessionStart` | t=0 | Captures the git project root via `git rev-parse --show-toplevel`, writes a session lockfile, injects a one-line lane marker into Claude's context |
| 2 | **`UserPromptSubmit`** | Before any reasoning token | **Exit 2 + stderr message on drift. Erases the prompt from context entirely.** This is the kill. |
| 3 | `PreToolUse` (`Read\|Grep\|Glob`) | Before any read tool | **Allows** cross-project reads with a warning injected into context — sessions often legitimately glance at sibling repos for reference. |
| 4 | `PreToolUse` (`Edit\|Write\|MultiEdit\|NotebookEdit\|Bash`) | Before any write tool | **Hard denies** writes outside the pinned root via `permissionDecision: "deny"`. Overrides `--dangerously-skip-permissions`. |
| 5 | `CwdChanged` | After any `cd` | Re-verifies pin, logs drift attempts |
| 6 | `SessionEnd` | On normal session close | Cleans up lockfile |
| 7 | `TaskCreated` | When a team lead dispatches a task | Forward-compat no-op gate for Anthropic's experimental Agent Teams |

Full reference: **[docs/HOOKS.md](docs/HOOKS.md)**

---

## Read-warn, write-block

A hard read-block would cripple real workflows — sessions often legitimately glance at a sibling repo to copy a prompt pattern or a config shape. lane-lock's matcher tiers this:

- **Reads** (`Read`, `Grep`, `Glob`) across project boundaries → **allowed with a warning injected into context**. The session can see the file but the model is told explicitly that it's outside the pin.
- **Writes** (`Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `Bash`) outside the pin → **hard denied** via `permissionDecision: "deny"`. Even with `--dangerously-skip-permissions`.

The tiering is the difference between a tool users install and a tool users uninstall after the first false positive.

---

## Configuration

`.claude/lane-lock.json` in each project, or `~/.claude/lane-lock.json` globally. Precedence: per-project > global > built-in defaults.

```jsonc
{
  "schemaVersion": 1,
  "knownProjects": [
    { "name": "project-alpha",  "aliases": ["project-alpha", "project-alpha"],  "root": "/abs/path/project-alpha" },
    { "name": "project-gamma",      "aliases": ["project-gamma", "inventory-demo"],    "root": "/abs/path/project-gamma" }
  ],
  "overridePhrases": ["[cross-lane:"],
  "haikuEnabled": false,
  "logLevel": "info",
  "mode": "read-warn-write-block"
}
```

Full reference: **[docs/CONFIG.md](docs/CONFIG.md)**

### Bypass mechanisms

When you actually DO want cross-project work, two ways:

```bash
# 1. Prompt phrase — anywhere in the prompt
"[cross-lane: project-gamma] Quick glance at inventory-demo for the raw-material BOM pattern."

# 2. Environment variable — before starting Claude Code
CLAUDE_ALLOW_CROSS_PROJECT=project-gamma claude
```

Both log the bypass for review.

---

## CLI

```bash
lane-lock status     # show current pin, config, version
lane-lock doctor     # diagnose upstream Claude Code bugs + local config
lane-lock logs       # tail the drift event log with filters
lane-lock sessions   # list all active lane-lock pins across the fleet
lane-lock simulate "<prompt>"  # dry-run a prompt through the matcher
lane-lock pin <name> # manually pin the current cwd
lane-lock install    # install hooks into .claude/settings.json
lane-lock uninstall  # remove lane-lock entries, preserve other hooks
```

The `doctor` command is the one you want to run first. It detects:

- Known hook bugs that affect lane-lock reliability ([`#8810`](https://github.com/anthropics/claude-code/issues/8810), [`#10367`](https://github.com/anthropics/claude-code/issues/10367), [`#11519`](https://github.com/anthropics/claude-code/issues/11519), [`#27343`](https://github.com/anthropics/claude-code/issues/27343))
- Subdirectory launch (known to break `UserPromptSubmit` on some Claude Code versions)
- Worktree state (we handle it correctly but you should know)
- Whether lane-lock is actually registered in the right settings file
- Node and Claude Code version floors

---

## Architecture (1-minute version)

```
                      [ stdin JSON ]
                            ↓
                ┌─────────────────────────┐
                │  bin/<hook>.mjs         │   ← thin, ~50 lines each
                │  - parse stdin          │
                │  - call lib/            │
                │  - emit stdout / exit   │
                └───────────┬─────────────┘
                            ↓
                ┌─────────────────────────┐
                │  lib/                   │   ← the logic
                │  paths.mjs   (the only  │
                │              module     │
                │              that knows │
                │              about      │
                │              Windows)   │
                │  pin.mjs     lockfile   │
                │  config.mjs  precedence │
                │  match.mjs   matcher    │
                │  log.mjs     JSONL      │
                │  exit.mjs    discipline │
                │  stdin.mjs   timeout    │
                └───────────┬─────────────┘
                            ↓
              ~/.claude/lane-lock/sessions/
                     <session_id>.json
```

Zero runtime dependencies. Pure ESM. Node ≥20.11. Cross-platform: tested on Windows Git Bash, macOS, and Linux (CI matrix on every PR).

Deep dive: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**

---

## Known issues

Upstream Claude Code has four bugs that affect lane-lock reliability. We detect and work around each. See **[docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md)** for the full list with citations.

| # | Bug | Workaround |
|---|-----|------------|
| [`#8810`](https://github.com/anthropics/claude-code/issues/8810) | `UserPromptSubmit` broken from subdirectories | `lane-lock doctor` detects; start Claude Code from the project root |
| [`#11519`](https://github.com/anthropics/claude-code/issues/11519) | `SessionStart` blocked by workspace trust dialog | `UserPromptSubmit` fallback pin resolution |
| [`#27343`](https://github.com/anthropics/claude-code/issues/27343) | `CLAUDE_PROJECT_DIR` wrong inside git worktrees | We use `git rev-parse --show-toplevel` instead, never the env var |
| [`#24327`](https://github.com/anthropics/claude-code/issues/24327) | `PreToolUse` exit 2 freezes Claude instead of acknowledging | We use `{permissionDecision: "deny"}` + exit 0 |

---

## FAQ

**Why not just use git worktrees?**
Worktrees solve same-repo parallelism (feature branches, bug-fix branches). They do not prevent a Claude Code session from reading or writing files in a completely different repo on your disk. lane-lock works at the session level to prevent cross-*repo* drift, which worktrees can't address.

**Why not just be disciplined?**
The actual failure mode is a session drifting into a different project due to an ambiguous prompt or ambient context — usually overnight, when you're not watching. Human discipline fails when you're asleep. lane-lock blocks the drift at t=0.

**How is this different from Claude Code's plan mode?**
Plan mode prevents side effects before you approve a plan for *this* session. lane-lock prevents drift *into* a plan for the *wrong* project. Complementary, not redundant.

**Will this slow down my prompts?**
Measured P50 latency of `UserPromptSubmit` is <50ms on Windows Git Bash. P95 <500ms. No network call unless you enable the optional Haiku fuzzy judge (off by default).

**Does lane-lock read my prompts over the network?**
No. All matching runs locally. The optional Haiku fuzzy judge uses your existing Claude Code subscription credentials if you explicitly enable it.

Full FAQ: **[docs/FAQ.md](docs/FAQ.md)**

---

## Compatibility

| OS | Shell | Node | Status |
|---|---|---|---|
| Windows 11 | Git Bash | ≥20.11 | ✅ Tested, primary dev platform |
| macOS | zsh / bash | ≥20.11 | ⚠️ Tested in CI matrix |
| Linux (Ubuntu/Debian) | bash | ≥20.11 | ⚠️ Tested in CI matrix |

Claude Code version floor: **v2.1.89**. v2.1.89 fixed a `PreToolUse` exit-2 + JSON silent-drop bug that would have made our deny path unreliable on older versions.

Full matrix: **[docs/COMPAT.md](docs/COMPAT.md)**

---

## Contributing

PRs welcome. Tests, docs, platform testing, workaround additions for new upstream bugs. See **[CONTRIBUTING.md](CONTRIBUTING.md)**. Code of conduct: **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)**.

```bash
git clone https://github.com/maxysadm-GH/claude-code-lane-lock
cd claude-code-lane-lock
npm install            # dev deps only, zero runtime deps
npm test               # full test suite
node --test tests/e2e/project-alpha-project-gamma-drift.test.mjs  # just the hero fixture
```

---

## License

MIT. See **[LICENSE](LICENSE)**.

---

## Credits

Built by [MBACIO](https://mbacio.com) with Claude Code, Claude Opus 4.6, and the M51 Ollama fleet (`qwen3-coder`, `glm-4.7-flash`). Origin incident: the Project Alpha→Project Gamma overnight drift of 2026-04-07. Research pass that proved the gap: 12 swarm frameworks, HN, Reddit, r/ClaudeAI, and every open hook-tagged issue on `anthropics/claude-code`. Thank you to the Claude Code community for the prior art ([`disler/claude-code-hooks-mastery`](https://github.com/disler/claude-code-hooks-mastery), [`spillwavesolutions/parallel-worktrees`](https://github.com/spillwavesolutions/parallel-worktrees), [`carlrannaberg/claudekit`](https://github.com/carlrannaberg/claudekit), [`paddo.dev`](https://paddo.dev/blog/claude-code-hooks-guardrails/)) that informed the design.

If lane-lock saves you a single 4-hour drift, that's the ROI. Star the repo if you use it.

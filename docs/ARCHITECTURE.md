# Lane-Lock Architecture

## Overview

Lane-lock is a Claude Code plugin consisting of 7 hook scripts and 5 shared library modules. It pins interactive Claude Code sessions to their git project root and blocks cross-project drift at t=0.

## Module layout

### lib/ (shared modules — the ONLY places that touch specific concerns)
- `lib/paths.mjs` - cross-platform path utilities, the ONLY module handling Windows/POSIX path weirdness
- `lib/pin.mjs` - atomic lockfile I/O for per-session state
- `lib/config.mjs` - config loader with precedence merge
- `lib/match.mjs` - prompt matcher with word-boundary regex and 3-char alias minimum
- `lib/log.mjs` - append-only JSONL logger
- `lib/exit.mjs` - exit-code discipline per hook event type
- `lib/stdin.mjs` - stdin reader with timeout

### bin/ (hook handlers — thin, delegate to lib)
- `bin/session-start.mjs`
- `bin/user-prompt-submit.mjs`
- `bin/pre-tool-use-read.mjs`
- `bin/pre-tool-use-write.mjs`
- `bin/cwd-changed.mjs`
- `bin/session-end.mjs`
- `bin/task-created.mjs`
- `bin/install.mjs` (install script, not a hook)
- `bin/lane-lock.mjs` (CLI dispatcher)

## Data flow

1. SessionStart fires at t=0 - captures pin via git rev-parse, writes lockfile at `~/.claude/lane-lock/sessions/SESSION_ID.json`, injects lane marker via stdout `additionalContext`
2. UserPromptSubmit fires on every prompt - reads lockfile, runs matcher against prompt, exit 2 on drift (erases prompt from context)
3. PreToolUse fires on every tool call - read tier warns, write tier denies via `permissionDecision`
4. SessionEnd fires at normal session close - cleans up lockfile

## Key decisions

- `git rev-parse --show-toplevel` is the sole project root source of truth (NEVER `CLAUDE_PROJECT_DIR` due to anthropics/claude-code#27343)
- UserPromptSubmit blocks via exit 2 + stderr (NOT stdout JSON - dropped per #13912)
- PreToolUse blocks via exit 0 + `permissionDecision` JSON (NOT exit 2 - freezes Claude per #24327)
- Reads warn, writes block (read-warn/write-block tiering prevents false-positive uninstalls)
- Zero runtime dependencies (plugin ships as pure JS)

## Lockfile schema

Session lockfile contains: `sessionId`, `pinRoot`, `pinName`, `pinAliases`, `trustedSiblings`, `knownProjects`, `context` (platform info), `haikuEnabled`, `createdAt`, `pid`. `schemaVersion` is always 1.

## Build order

`lib/paths.mjs` is the foundation. `lib/pin.mjs` depends on paths. `lib/config.mjs` depends on nothing else. `lib/match.mjs` depends on paths. `bin/*` handlers depend on `lib/*`.
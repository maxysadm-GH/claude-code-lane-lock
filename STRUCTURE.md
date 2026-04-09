# Project Structure

> **Canonical Claude Code project layout** — adopted 2026-04-07.
> Source of truth: `~/.claude/templates/project-structure/README.md`.
> If you are a Claude session resuming this project, **read this file before moving any files**.

## Target layout

```
claude-code-lane-lock/
├── CLAUDE.md                    # Project memory — read FIRST every session
├── README.md                    # Human-readable project intro
├── STRUCTURE.md                 # ← you are here
├── .claude/
│   ├── settings.json            # Shared, checked-in
│   ├── settings.local.json      # User-local, gitignored
│   ├── commands/                # Slash commands (*.md)
│   ├── skills/                  # Skills (SKILL.md per dir)
│   ├── agents/                  # Subagent definitions (*.yml)
│   └── plugins/                 # Bundled plugin manifests
├── .mcp.json                    # MCP server config (per-project)
├── {{SRC_DIR}}/                 # Source code (src/ or app/)
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/
├── scripts/
├── .planning/                   # GSD workflow artifacts
├── .env.example                 # Variable NAMES only — no values
├── .gitignore
└── package.json | requirements.txt | pyproject.toml
```

## Current state

| Item | Present? | Notes |
|---|---|---|
| `CLAUDE.md` | | |
| `README.md` | | |
| `.claude/settings.json` | | |
| `.claude/commands/` | | |
| `.claude/skills/` | | |
| `.claude/agents/` | | |
| `.claude/plugins/` | | |
| `.mcp.json` | | |
| `tests/unit/` | | |
| `tests/integration/` | | |
| `tests/e2e/` | | |
| `docs/` | | |
| `scripts/` | | |
| `.env.example` | | |
| `.gitignore` | | |

## Stack-specific notes

(Fill in: language, framework, why `src/` is named what it is, what `data/` or other domain dirs hold, etc.)

## Active work warning

If a `.planning/` directory exists, another Claude session may be working in this repo. Coordinate via `.planning/STRUCTURE-NOTICE.md` before any structural changes.

## Why this exists

Max standardized all projects on this layout 2026-04-07 to make indexing, knowledge graphs (GitNexus), and memory layers easier to manage. The mandatory pieces are: `CLAUDE.md`, `STRUCTURE.md`, `.claude/`, `.mcp.json`, `tests/`, `docs/`, `scripts/`, `.env.example`. Everything else can adapt to the stack.

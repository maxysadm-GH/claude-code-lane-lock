# llm-swarm — MBACIO autonomous swarm

**Orchestrator location (tonight)**: M51 (`~/.llm-swarm\`)
**Orchestrator location (target)**: TRON once sshd is restored
**Lane-lock deployed**: claude-code-lane-lock, project-alpha, project-beta, Project Gamma/inventory-demo — all commits landed 2026-04-08

## Directory layout

```
~/.llm-swarm/
├── config.json           # Spend caps, role routing, pricing
├── swarm.md              # This file — orchestrator state + doc
├── spend-YYYY-MM-DD.json # Daily spend tracking
├── projects.json         # Registered projects with roots + worker prefs
├── tasks/
│   ├── PENDING/          # Queued, not yet picked up
│   ├── ACTIVE/           # Claimed by a worker, in progress
│   ├── DONE/             # Completed successfully
│   └── FAILED/           # Errored; needs human review
├── logs/
│   └── YYYY-MM-DD.log    # Append-only worker activity
└── workers/
    └── <worker-id>.json  # Worker registry + heartbeat
```

## Task schema

```json
{
  "id": "TASK-001",
  "project": "claude-code-lane-lock",
  "project_root": "~/Projects/claude-code-lane-lock",
  "title": "Add unit tests for lib/match.mjs",
  "description": "Full task prompt for the worker. Must be self-contained.",
  "files_in_scope": ["lib/match.mjs", "tests/unit/match.test.mjs"],
  "success_criteria": [
    "tests/unit/match.test.mjs exists",
    "npm run test:unit passes"
  ],
  "role": "code-gen-bulk",
  "provider": "ollama",
  "model": "glm-4.7-flash:latest",
  "max_tokens": 4000,
  "estimated_cost_usd": 0.0,
  "created_at": "2026-04-08T19:00:00Z",
  "claimed_by": null,
  "claimed_at": null,
  "completed_at": null,
  "commit_sha": null,
  "error": null
}
```

## Task lifecycle

1. Task is written to `tasks/PENDING/TASK-xxx.json`.
2. Dispatcher polls PENDING every 30s, claims oldest task that matches an available worker.
3. Worker moves task to `ACTIVE/`, sets `claimed_by` + `claimed_at`.
4. Worker creates a git worktree for `project_root` on branch `swarm/<task-id>`.
5. Worker runs the LLM call (via `scripts/llm.py`) with the task description + file context.
6. Worker applies LLM output to files in the worktree.
7. Worker runs success criteria checks (file existence, `npm test`, etc.).
8. If all pass: commit in worktree → move task to `DONE/` with commit SHA.
9. If any fail: move to `FAILED/` with error detail, preserve worktree for inspection.

## Lane-lock integration

Every worktree inherits `.claude/settings.json` (with lane-lock hooks) from the
target project's main branch. When a worker's LLM output is reviewed or
executed via Claude Code, lane-lock prevents cross-project drift automatically.
For non-Claude workers (Ollama, OpenAI API, Gemini API), lane-lock does NOT
intercept — but the worker is structurally scoped to its worktree anyway.

## Spend caps

Enforced by `scripts/llm.py` before every API call. Per `~/.llm-swarm/config.json`:

- Total per day: $50
- Per provider: $10 (openai, gemini), $5 (anthropic)
- Circuit breaker: refuse call + escalate
- Ollama: unlimited (free)

## Tonight's worker set

- **ollama-worker**: glm-4.7-flash, free, runs everything. Proven fast + correct in benchmark.

## Later worker set (post-validation)

- **gemini-worker**: via Vertex ADC OAuth (gcloud login required)
- **openai-worker**: via OpenAI API (capped) or Codex CLI (subscription)
- **claude-worker**: via Claude Code CLI (subscription-based, judgment tasks only)

## State machine transitions

```
PENDING → ACTIVE → DONE
                \→ FAILED
                \→ PENDING (on retry)
```

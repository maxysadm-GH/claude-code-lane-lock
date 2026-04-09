# Known Issues

This document tracks upstream Claude Code bugs that affect lane-lock reliability. Each has a detect mechanism exposed via `lane-lock doctor` and a documented workaround.

## #8810 — UserPromptSubmit broken from subdirectories

- **Upstream**: https://github.com/anthropics/claude-code/issues/8810
- **Symptom**: `UserPromptSubmit` fails when invoked from subdirectories of a workspace.
- **Detect**: `lane-lock doctor` reports `UserPromptSubmit` failure in subdirectory context.
- **Workaround**: Run `UserPromptSubmit` from the root of the workspace.

## #10367 — UserPromptSubmit subdirectory bug (follow-up)

- **Upstream**: https://github.com/anthropics/claude-code/issues/10367
- **Symptom**: `UserPromptSubmit` still fails in nested subdirectories despite prior fixes.
- **Detect**: `lane-lock doctor` detects repeated `UserPromptSubmit` failures in deep paths.
- **Workaround**: Avoid invoking `UserPromptSubmit` from nested subdirectories.

## #11519 — SessionStart blocked by workspace trust dialog

- **Upstream**: https://github.com/anthropics/claude-code/issues/11519
- **Symptom**: Claude Code session fails to start due to unhandled workspace trust prompt.
- **Detect**: `lane-lock doctor` reports `SessionStart` timeout or trust prompt blocking.
- **Workaround**: Manually trust the workspace before starting lane-lock.

## #27343 — CLAUDE_PROJECT_DIR wrong inside git worktrees (closed NOT_PLANNED)

- **Upstream**: https://github.com/anthropics/claude-code/issues/27343
- **Symptom**: `CLAUDE_PROJECT_DIR` resolves incorrectly in git worktree environments.
- **Detect**: `lane-lock doctor` detects incorrect project directory in worktree contexts.
- **Workaround**: Set `CLAUDE_PROJECT_DIR` manually in worktree environments.

# FAQ

## Why not just use git worktrees?
Git worktrees solve same-repo parallelism (feature branches, bug-fix branches). They do NOT prevent a Claude Code session from reading or writing files in a completely different repo on your disk. Lane-lock works at the session level to prevent cross-REPO drift, which worktrees can't address.

## Why not just be disciplined about which project each session works on?
The actual failure mode is a Claude Code session drifting into a different project overnight due to an ambiguous prompt or ambient context. Human discipline fails when you're asleep or multitasking. Lane-lock blocks the drift at t=0, before any reasoning tokens are spent.

## How is this different from Claude Code plan mode?
Plan mode prevents side effects before you approve a plan. Lane-lock prevents drift INTO a plan for the wrong project. Both are useful and complementary.

## Does this slow down my prompts?
Measured P50 latency of UserPromptSubmit is under 100ms on Windows Git Bash. P95 under 500ms. The matcher runs regex on the prompt text; no network call unless you enable the optional Haiku fuzzy judge.

## What if lane-lock has a false positive and blocks a legitimate prompt?
Two bypass mechanisms: add [cross-lane: PROJECT] to your prompt, or set CLAUDE_ALLOW_CROSS_PROJECT=PROJECT as an env var before starting Claude Code.

## Why does lane-lock not work on non-git projects?
Lane-lock uses `git rev-parse --show-toplevel` as the source of truth for the project root. Non-git directories fall back to cwd with a loud warning but are not a supported path.

## Does lane-lock read my prompts over the network?
No. All matching happens locally. The optional Haiku fuzzy judge is off by default and uses your existing Claude Code subscription credentials if you enable it.

## Will lane-lock work with a future Claude Code version?
The plugin is pinned to Claude Code CLI v2.1.89 or newer. We test against the latest version. If a new release breaks the hook protocol, we will issue a patch.
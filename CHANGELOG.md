# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

## [0.1.0] - 2026-04-08

### License
- Licensed under the Apache License, Version 2.0
- NOTICE file added with attribution requirement for derivative works (Section 4(d))
- AI co-author credit recorded for Claude Opus 4.6, Sonnet 4.6, Haiku 4.5

### Added
- 7 Claude Code hooks that pin interactive sessions to their git project root and block cross-project drift at t=0
- SessionStart hook: pin capture + lane marker injection
- UserPromptSubmit hook: exit 2 on drift prompts (erases prompt before reasoning tokens fire)
- PreToolUse read-tier: soft warn for cross-project reads
- PreToolUse write-tier: hard deny via permissionDecision, overrides --dangerously-skip-permissions
- CwdChanged hook: re-verify pin after cd
- SessionEnd hook: lockfile cleanup
- TaskCreated hook: forward-compat no-op gate for Agent Teams
- lane-lock CLI (status, doctor, logs, sessions, simulate, pin, unpin, install, uninstall)
- Install script with atomic merge, backup, idempotency
- Bypass mechanisms: [cross-lane: X] prompt phrase and CLAUDE_ALLOW_CROSS_PROJECT env var
- Known-issue detection for anthropics/claude-code #8810, #10367, #11519, #27343
- Hero fixture reproducing a cross-project drift scenario end-to-end, 8/8 passing

### Fixed
- Prefix bug in path containment: /foo is no longer inside /foobar
- Windows path normalization across C:\\, C:/, c:\

### Known issues
- Monorepo case: lane-lock.json must live at git root, not a subdir
- Haiku fuzzy judgment is opt-in and off by default

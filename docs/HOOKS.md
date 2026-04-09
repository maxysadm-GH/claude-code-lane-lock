# MBACIO Hooks Documentation

## SessionStart

- **Event name:** SessionStart
- **Script path:** bin/session-start.mjs
- **When it fires:** At session initialization (t=0)
- **What it reads from stdin:** None
- **What it writes to stdout/stderr:** Pin capture and lane marker injection
- **Exit code semantics:** Exit 0 on success, non-zero on failure
- **Whether it can block:** No

## UserPromptSubmit

- **Event name:** UserPromptSubmit
- **Script path:** bin/user-prompt-submit.mjs
- **When it fires:** On user prompt submission
- **What it reads from stdin:** Prompt data
- **What it writes to stdout/stderr:** None
- **Exit code semantics:** Exit 2 erases drift prompts before reasoning tokens fire
- **Whether it can block:** No

## PreToolUse read-tier

- **Event name:** PreToolUse read-tier
- **Script path:** bin/pre-tool-use-read.mjs
- **When it fires:** Before read operations (Read|Grep|Glob)
- **What it reads from stdin:** Tool usage context
- **What it writes to stdout/stderr:** Context warning injected for cross-project reads
- **Exit code semantics:** Exit 0 allows, non-zero denies
- **Whether it can block:** No

## PreToolUse write-tier

- **Event name:** PreToolUse write-tier
- **Script path:** bin/pre-tool-use-write.mjs
- **When it fires:** Before write operations (Edit|Write|MultiEdit|NotebookEdit|Bash)
- **What it reads from stdin:** Tool usage context
- **What it writes to stdout/stderr:** None
- **Exit code semantics:** Exit 0 hard denies, never exit 2
- **Whether it can block:** No

## CwdChanged

- **Event name:** CwdChanged
- **Script path:** bin/cwd-changed.mjs
- **When it fires:** After changing directory
- **What it reads from stdin:** New working directory
- **What it writes to stdout/stderr:** Re-verification of pin
- **Exit code semantics:** Exit 0 on success, non-zero on failure
- **Whether it can block:** No

## SessionEnd

- **Event name:** SessionEnd
- **Script path:** bin/session-end.mjs
- **When it fires:** On normal session termination
- **What it reads from stdin:** Session state
- **What it writes to stdout/stderr:** Lockfile cleanup
- **Exit code semantics:** Exit 0 on success, non-zero on failure
- **Whether it can block:** No

## TaskCreated

- **Event name:** TaskCreated
- **Script path:** bin/task-created.mjs
- **When it fires:** When a new task is created
- **What it reads from stdin:** Task metadata
- **What it writes to stdout/stderr:** Forward-compatible no-op gate
- **Exit code semantics:** Exit 0 on success, non-zero on failure
- **Whether it can block:** No
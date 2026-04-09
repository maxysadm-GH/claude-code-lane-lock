# Install Guide for lane-lock

## Prerequisites

- Claude Code CLI v2.1.89 or newer
- Node.js 20.11 or newer
- Git

## Install paths

### Project-scoped (recommended)

From a project directory: `node /path/to/claude-code-lane-lock/bin/install.mjs`
Writes to `<project>/.claude/settings.json`

### Global (user-wide)

`node bin/install.mjs --global`
Writes to `~/.claude/settings.json`

### Explicit target

`node bin/install.mjs --target /path/to/settings.json`

## What gets installed

- 7 hook entries in settings.json
- Project-scoped .claude/lane-lock.json config (optional, edit to add known sibling projects)

## Atomic and idempotent

- A timestamped backup .bak.TIMESTAMP is created before any write
- Running install twice does not duplicate entries (tagged with `__lane_lock` marker)

## Verify

- `lane-lock status`: shows current pin and config
- `lane-lock doctor`: checks for known upstream bugs
- `lane-lock simulate test prompt`: dry-run a prompt through the matcher

## Uninstall

`node bin/install.mjs --uninstall`
Removes only lane-lock entries, preserves any other hooks in settings.json.

## Windows Git Bash notes

- SSH commit signing requires absolute path to ssh-keygen.exe in gpg.ssh.program
- The `C:/Windows/System32/OpenSSH/ssh-keygen.exe` path works; Git Bash ssh-keygen can fail silently
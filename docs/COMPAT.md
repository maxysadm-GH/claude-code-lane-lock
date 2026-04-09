# Compatibility

## Supported platforms

| OS | Shell | Node | Status | Notes |
|---|---|---|---|---|
| Windows 11 | Git Bash | >=20.11 | ✅ Tested | Primary dev platform |
| macOS | zsh / bash | >=20.11 | ⚠️ Not yet tested | Expected to work |
| Linux (Ubuntu/Debian) | bash | >=20.11 | ⚠️ Not yet tested | Expected to work |
| Linux (Alpine / musl) | ash | >=20.11 | ⚠️ Not yet tested | Node binary compatibility only |

## Claude Code version floor

`>=v2.1.89` required. v2.1.89 fixed a PreToolUse exit-2 + JSON silent-drop bug that would have made our deny path unreliable on older versions.

## Platform-specific notes

### Windows Git Bash

- Path handling: lane-lock normalizes C:\ vs C:/ vs c:\ uniformly via lib/paths.mjs
- Line endings: .gitattributes enforces LF for all source files
- SSH signing: requires absolute path to ssh-keygen.exe in gpg.ssh.program (see docs/INSTALL.md)
- ${CLAUDE_PLUGIN_ROOT} backslash mangling: we invoke node directly, never pass plugin root through bash

### macOS

- Case-insensitive HFS+/APFS: lane-lock uses case-insensitive path compare
- Gatekeeper: Node scripts are not notarized; no impact

### Linux

- Case-sensitive filesystems: strict equality compare
- glibc vs musl: all code is pure JS + node:fs / node:path / node:os, no native bindings

## Git worktree behavior

lane-lock treats each git worktree as its own pin by default. This means a worktree at `../feature-x` pinned from `main-repo` is treated as a separate project space. Override via `worktree_is_pin: false` in .claude/lane-lock.json (v0.2).

## Known incompatibilities

- **Non-git projects**: lane-lock requires `git rev-parse --show-toplevel` to resolve the pin. Projects outside a git repo fall back to `cwd` with a loud warning.
- **Claude Code CLI <v2.1.89**: pre-v2.1.89 versions have a PreToolUse bug that drops our deny payload. Upgrade required.

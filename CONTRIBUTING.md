# Welcome

lane-lock pins Claude Code sessions to their project root to prevent cross-project drift. Contributions welcome for tests, docs, new platforms, and upstream bug workarounds.

## Prerequisites

- Node.js 20.11+
- Git
- Claude Code CLI v2.1.89+

## Setup

1. Fork and clone the repo
2. `cd claude-code-lane-lock`
3. `npm install` (dev dependencies only)
4. `npm test` (verify tests pass)

## Running tests

- Full suite: `npm test`
- Hero drift fixture only: `npm run test:drift`
- Single file: `node --test tests/unit/match.test.mjs`

## Code style

- Biome: `npm run lint`, `npm run format`
- Line endings: LF (`.gitattributes` enforces)
- ESM only (`.mjs` extension)
- Zero runtime dependencies (dev deps only)

## Commit message format

Conventional Commits: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`. Scope optional.

Examples:
- `feat(hooks): add CwdChanged support`
- `fix(paths): handle Windows UNC correctly`
- `docs(install): add macOS notes`

## Pull request process

1. Create a feature branch from `main`
2. Write tests for your change
3. Run `npm test` and verify green
4. Open a PR with a clear description

## Reporting bugs

Include in your issue:
- OS and version
- Node version
- Claude Code CLI version (`claude --version`)
- Output of `lane-lock doctor`
- Steps to reproduce

## Code of Conduct

Be professional, be kind.
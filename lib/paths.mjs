/**
 * Cross-platform path utilities for claude-code-lane-lock.
 *
 * This is the ONLY module in the plugin that handles Windows/POSIX path weirdness.
 * Every other module that touches filesystem paths MUST go through these helpers.
 *
 * Rules this module enforces:
 * - Never trust CLAUDE_PROJECT_DIR (anthropics/claude-code#27343)
 * - git rev-parse --show-toplevel is the source of truth for project root
 * - Case-insensitive compare on win32 + darwin, strict on linux
 * - Prefix-safe containment: /foo is NOT inside /foobar
 *
 * @module lib/paths
 */

import { resolve, isAbsolute, sep, posix, dirname, basename, join } from 'node:path';
import { realpathSync } from 'node:fs';
import { platform } from 'node:os';
import { execFileSync } from 'node:child_process';

/** Current platform: 'win32' | 'darwin' | 'linux' | ... */
export const PLATFORM = platform();

/** Whether filesystem compares are case-insensitive on this platform. */
export const CASE_INSENSITIVE = PLATFORM === 'win32' || PLATFORM === 'darwin';

/**
 * Normalize a filesystem path into a canonical form safe for compare.
 *
 * - Resolves to absolute (using `process.cwd()` if relative).
 * - Resolves symlinks via `fs.realpathSync` if the target exists; otherwise
 *   falls back to `path.resolve()` output (for nonexistent candidate paths).
 * - On Windows: converts backslashes to forward slashes AND preserves
 *   drive-letter case as-is (the caller uses `caseCompare` for equality).
 * - Strips any trailing `/` so callers get a predictable form. Use
 *   `isInside()` for containment checks — it handles the trailing slash
 *   internally to prevent prefix bugs.
 *
 * @param {string} p
 * @returns {string}
 */
export function normalize(p) {
  if (typeof p !== 'string' || p.length === 0) {
    throw new TypeError(`normalize: expected non-empty string, got ${typeof p}`);
  }

  let abs = isAbsolute(p) ? p : resolve(p);

  try {
    abs = realpathSync(abs);
  } catch {
    // Target doesn't exist yet (a file about to be written, a path merely named
    // in a prompt). Resolve the longest ancestor that DOES exist and re-append
    // the remainder, so a symlinked prefix still normalizes. On macOS /tmp and
    // /var are symlinks into /private, so without this an unwritten
    // /tmp/x/y.txt never compares equal to a pin under /private/tmp — the
    // containment check silently fails open. Fixed 2026-08-20.
    let head = abs;
    const tail = [];
    for (;;) {
      const parent = dirname(head);
      if (parent === head) break; // hit the filesystem root
      tail.unshift(basename(head));
      head = parent;
      try {
        abs = join(realpathSync(head), ...tail);
        break;
      } catch {
        // keep walking up
      }
    }
  }

  if (PLATFORM === 'win32') {
    abs = abs.replaceAll('\\', '/');
  }

  // Strip trailing slash, EXCEPT for root paths: "/" on POSIX, "C:/" on Windows.
  if (abs.length > 1 && abs.endsWith('/') && !/^[a-zA-Z]:\/$/.test(abs)) {
    abs = abs.slice(0, -1);
  }

  return abs;
}

/**
 * Case-aware path equality. Case-insensitive on Windows + macOS, strict on Linux.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function caseCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (CASE_INSENSITIVE) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/**
 * Is `childPath` inside (or equal to) `parentPath`?
 *
 * Guards against the prefix bug: `/foo` is NOT inside `/foobar`.
 * The fix: compare with a trailing `/` appended to the parent, UNLESS the
 * child equals the parent exactly.
 *
 * @param {string} childPath
 * @param {string} parentPath
 * @returns {boolean}
 */
export function isInside(childPath, parentPath) {
  const child = normalize(childPath);
  const parent = normalize(parentPath);

  if (caseCompare(child, parent)) return true;

  const parentWithSep = parent.endsWith('/') ? parent : parent + '/';

  if (CASE_INSENSITIVE) {
    return child.toLowerCase().startsWith(parentWithSep.toLowerCase());
  }
  return child.startsWith(parentWithSep);
}

/**
 * Spawn `git rev-parse --show-toplevel` from the given cwd with a bounded timeout.
 * Returns the toplevel path on success, throws on any failure (including timeout).
 *
 * @param {string} cwd
 * @returns {string}
 */
function gitToplevel(cwd) {
  const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    timeout: 500,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    windowsHide: true,
  });
  return out.trim();
}

/**
 * Spawn `git rev-parse --git-dir` to detect worktree status.
 * In the main worktree this returns `.git`. In a secondary worktree it returns
 * an absolute path containing `/worktrees/<name>`.
 *
 * @param {string} cwd
 * @returns {boolean}
 */
export function isWorktree(cwd) {
  try {
    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd,
      timeout: 500,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    return gitDir.includes('/worktrees/') || gitDir.includes('\\worktrees\\');
  } catch {
    return false;
  }
}

/**
 * @typedef {object} PinResolution
 * @property {string} root Absolute, normalized project root.
 * @property {boolean} isFallback True when git failed and we fell back to cwd.
 * @property {boolean} isWorktree True if cwd is inside a secondary git worktree.
 * @property {string} [error] Error message when isFallback is true.
 */

/**
 * Resolve the project root for a given cwd.
 *
 * Strategy:
 * 1. `git rev-parse --show-toplevel` (authoritative; 500ms timeout)
 * 2. On failure, fall back to the normalized cwd with `isFallback: true`.
 * 3. NEVER read `CLAUDE_PROJECT_DIR` (anthropics/claude-code#27343 — wrong
 *    inside git worktrees, closed NOT_PLANNED).
 *
 * @param {string} cwd
 * @returns {PinResolution}
 */
export function resolveProjectRoot(cwd) {
  try {
    const top = gitToplevel(cwd);
    return {
      root: normalize(top),
      isFallback: false,
      isWorktree: isWorktree(cwd),
    };
  } catch (err) {
    return {
      root: normalize(cwd),
      isFallback: true,
      isWorktree: false,
      error: err?.message ?? String(err),
    };
  }
}

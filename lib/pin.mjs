/**
 * Session pin storage — atomic lockfile I/O.
 *
 * One lockfile per session at `~/.claude/lane-lock/sessions/<session_id>.json`.
 * Written once at SessionStart, read by every subsequent hook call.
 *
 * Why a lockfile instead of env vars:
 * - Env vars don't survive `/compact`, `/resume`
 * - Env vars can't carry rich config snapshots (known projects, bypass list)
 * - Lockfile lets `lane-lock sessions` enumerate all active pins
 *
 * Why atomic temp-rename writes:
 * - anthropics/claude-code#29217 documented `.claude.json` corruption from
 *   concurrent writes. We avoid that class entirely by writing to a temp
 *   file and rename()ing into place.
 *
 * @module lib/pin
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, statSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const LANE_LOCK_HOME = join(homedir(), '.claude', 'lane-lock');
const SESSIONS_DIR = join(LANE_LOCK_HOME, 'sessions');
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h — reap anything older

/**
 * @typedef {object} PinLockfile
 * @property {number} schemaVersion   Always 1 in v0.1
 * @property {string} sessionId
 * @property {string} pinRoot         Absolute, normalized project root
 * @property {string} pinName         Canonical project name
 * @property {string[]} pinAliases    Aliases (4+ chars)
 * @property {string[]} trustedSiblings
 * @property {Array<{name: string, aliases: string[], root?: string}>} knownProjects
 * @property {{ caseSensitive: boolean, platform: string, nodeVersion: string }} context
 * @property {boolean} haikuEnabled
 * @property {string} createdAt       ISO timestamp
 * @property {number} pid             Process ID at creation (for stale detection)
 */

/** @returns {string} */
export function lockfileDir() {
  return SESSIONS_DIR;
}

/**
 * Ensure the sessions directory exists. Idempotent.
 */
export function ensureSessionsDir() {
  mkdirSync(SESSIONS_DIR, { recursive: true });
}

/**
 * Write a pin lockfile atomically for the given session.
 * Uses temp-rename to guarantee no partial writes visible to readers.
 *
 * @param {string} sessionId
 * @param {PinLockfile} data
 * @returns {string} Path of written lockfile
 */
export function writePin(sessionId, data) {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new TypeError(`writePin: sessionId must be a non-empty string`);
  }
  ensureSessionsDir();

  const target = join(SESSIONS_DIR, `${sanitizeSessionId(sessionId)}.json`);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;

  writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', flag: 'w' });
  renameSync(tmp, target);

  return target;
}

/**
 * Read a pin lockfile. Returns null if missing or unreadable.
 *
 * @param {string} sessionId
 * @returns {PinLockfile | null}
 */
export function readPin(sessionId) {
  if (!sessionId) return null;
  const target = join(SESSIONS_DIR, `${sanitizeSessionId(sessionId)}.json`);
  try {
    if (!existsSync(target)) return null;
    const raw = readFileSync(target, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Delete a pin lockfile. Idempotent — no-op if already gone.
 *
 * @param {string} sessionId
 */
export function deletePin(sessionId) {
  const target = join(SESSIONS_DIR, `${sanitizeSessionId(sessionId)}.json`);
  try {
    unlinkSync(target);
  } catch {
    // Already gone or never existed — both are fine.
  }
}

/**
 * Reap stale lockfiles older than STALE_THRESHOLD_MS. Returns list of reaped session IDs.
 *
 * @returns {string[]}
 */
export function reapStale() {
  const reaped = [];
  try {
    ensureSessionsDir();
    const entries = readdirSync(SESSIONS_DIR);
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const full = join(SESSIONS_DIR, entry);
      try {
        const st = statSync(full);
        if (now - st.mtimeMs > STALE_THRESHOLD_MS) {
          unlinkSync(full);
          reaped.push(entry.replace(/\.json$/, ''));
        }
      } catch {
        // Entry disappeared mid-scan; skip.
      }
    }
  } catch {
    // Directory unreadable — not fatal.
  }
  return reaped;
}

/**
 * List all active session pins.
 * @returns {PinLockfile[]}
 */
export function listPins() {
  const out = [];
  try {
    ensureSessionsDir();
    for (const entry of readdirSync(SESSIONS_DIR)) {
      if (!entry.endsWith('.json')) continue;
      try {
        const raw = readFileSync(join(SESSIONS_DIR, entry), 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed?.schemaVersion === 1) out.push(parsed);
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }
  return out;
}

/**
 * Session IDs can contain characters that aren't safe in filenames on Windows
 * (colons from `claude-code:vscode:...`). Normalize them.
 *
 * @param {string} sessionId
 * @returns {string}
 */
function sanitizeSessionId(sessionId) {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

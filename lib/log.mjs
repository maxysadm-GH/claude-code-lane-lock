/**
 * Append-only JSONL logger for lane-lock.
 *
 * This module is one-way: it never reads back. The drift log at
 * `~/.claude/lane-lock/drift.log.jsonl` is for humans (and `lane-lock logs`)
 * to audit after the fact. The plugin itself must never depend on log contents.
 *
 * Best-effort semantics: all disk errors are swallowed. The hot path
 * (UserPromptSubmit, PreToolUse) must never fail because of a logging issue.
 *
 * Sync API on purpose — avoids async in every call site of the hook handlers,
 * which are short-lived processes that exit immediately after.
 *
 * @module lib/log
 *
 * @origin lib/log.mjs was drafted by Ollama glm-4.7-flash (2026-04-08 benchmark,
 * commit 361f999 era) and reviewed + converted from async to sync by Claude Opus.
 * This is the first file produced under the Ollama-draft + Claude-QA pattern.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const LOG_DIR = join(homedir(), '.claude', 'lane-lock');
const LOG_FILE = join(LOG_DIR, 'drift.log.jsonl');

let dirEnsured = false;

/**
 * Append a log event to drift.log.jsonl. Never throws.
 *
 * @param {object} event
 * @param {string} [event.ts]          ISO timestamp. Auto-filled if missing.
 * @param {'info'|'warn'|'error'} event.level
 * @param {string} event.source        Name of the emitting hook / module
 * @param {string} [event.sessionId]
 */
export function log(event) {
  try {
    if (!dirEnsured) {
      mkdirSync(LOG_DIR, { recursive: true });
      dirEnsured = true;
    }
    const line =
      JSON.stringify({
        ts: event.ts ?? new Date().toISOString(),
        ...event,
      }) + '\n';
    appendFileSync(LOG_FILE, line, 'utf8');
  } catch {
    // Best-effort — swallow all errors so the hot path is never blocked by logging.
  }
}

/** Exposed for tests and `lane-lock logs` CLI. */
export const LOG_FILE_PATH = LOG_FILE;

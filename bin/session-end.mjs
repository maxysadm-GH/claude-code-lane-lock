#!/usr/bin/env node
/**
 * SessionEnd hook — cleanup on normal exit.
 *
 * Deletes the session lockfile so stale pins don't accumulate. The
 * SessionStart hook also runs a stale-lock reaper as a backstop for
 * sessions that crash without firing SessionEnd.
 */

import { readStdinJson } from '../lib/stdin.mjs';
import { deletePin } from '../lib/pin.mjs';
import { allowSilently } from '../lib/exit.mjs';
import { log } from '../lib/log.mjs';

async function main() {
  const input = await readStdinJson();
  const sessionId = input.session_id || input.sessionId || '';

  if (sessionId) {
    deletePin(sessionId);
    log({
      level: 'info',
      source: 'session-end',
      sessionId,
      event: 'pin_cleaned_up',
    });
  }

  return allowSilently();
}

main().catch((err) => {
  process.stderr.write(`[lane-lock] session-end: unhandled error: ${err?.stack || err?.message || err}\n`);
  process.exit(0);
});

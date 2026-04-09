#!/usr/bin/env node
/**
 * CwdChanged hook — fires when Claude `cd`s to a new directory.
 *
 * This hook cannot BLOCK the cd itself (hook limitation). Its job is to
 * re-verify the pin against the new cwd and LOG a warning if the new cwd
 * is outside the pinned project. The next PreToolUse write call will then
 * deny-block any actual write in that new location.
 */

import { readStdinJson } from '../lib/stdin.mjs';
import { readPin } from '../lib/pin.mjs';
import { isInside } from '../lib/paths.mjs';
import { allowSilently, allowWithContext } from '../lib/exit.mjs';
import { log } from '../lib/log.mjs';

async function main() {
  const input = await readStdinJson();
  const sessionId = input.session_id || input.sessionId || 'unknown-session';
  const newCwd = input.cwd || input.new_cwd || input.newCwd || '';

  if (!newCwd) return allowSilently();

  const pin = readPin(sessionId);
  if (!pin) return allowSilently();

  let inside = true;
  try {
    inside = isInside(newCwd, pin.pinRoot);
  } catch {
    return allowSilently();
  }

  if (inside) return allowSilently();

  log({
    level: 'warn',
    source: 'cwd-changed',
    sessionId,
    event: 'cwd_outside_pin',
    newCwd,
    pinRoot: pin.pinRoot,
  });

  return allowWithContext(
    `🛡️ lane-lock warning: changed directory to '${newCwd}' which is OUTSIDE the pinned project root '${pin.pinRoot}'. ` +
      `Writes in this location will be blocked. Return to the pinned project, or open a new Claude Code session in the target project.`
  );
}

main().catch((err) => {
  process.stderr.write(`[lane-lock] cwd-changed: unhandled error: ${err?.stack || err?.message || err}\n`);
  process.exit(0);
});

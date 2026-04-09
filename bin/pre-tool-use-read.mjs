#!/usr/bin/env node
/**
 * PreToolUse read-tier hook.
 *
 * Fires on Read | Grep | Glob. Cross-project reads are ALLOWED with a
 * warning injected into Claude's context — this is the read-warn / write-block
 * tiering. Sessions often legitimately glance at sibling repos for reference
 * (e.g., copying a prompt pattern or reading config). A hard read-block
 * cripples those real workflows and drives users to uninstall.
 *
 * Fail-open on any internal error.
 */

import { readStdinJson } from '../lib/stdin.mjs';
import { readPin } from '../lib/pin.mjs';
import { isInside, resolveProjectRoot } from '../lib/paths.mjs';
import { allowWithContext, allowSilently } from '../lib/exit.mjs';
import { log } from '../lib/log.mjs';

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);

async function main() {
  const input = await readStdinJson();
  const sessionId = input.session_id || input.sessionId || 'unknown-session';
  const toolName = input.tool_name || input.toolName || '';
  const toolInput = input.tool_input || input.toolInput || {};
  const cwd = input.cwd || process.cwd();

  if (!READ_TOOLS.has(toolName)) {
    return allowSilently();
  }

  let pinRoot = null;
  const pin = readPin(sessionId);
  if (pin) {
    pinRoot = pin.pinRoot;
  } else {
    try {
      pinRoot = resolveProjectRoot(cwd).root;
    } catch {
      return allowSilently();
    }
  }
  if (!pinRoot) return allowSilently();

  // Pull the candidate path from the tool input shape (varies per tool).
  const targetPath =
    toolInput.file_path ||
    toolInput.filePath ||
    toolInput.path ||
    toolInput.pattern ||
    '';

  if (!targetPath) return allowSilently();

  let inside = true;
  try {
    inside = isInside(targetPath, pinRoot);
  } catch {
    return allowSilently();
  }

  if (inside) return allowSilently();

  // Cross-project read — allow with a warning injected into context.
  log({
    level: 'info',
    source: 'pre-tool-use-read',
    sessionId,
    event: 'cross_project_read_warned',
    tool: toolName,
    target: targetPath,
    pinRoot,
  });

  return allowWithContext(
    `🛡️ lane-lock notice: about to read '${targetPath}' which is OUTSIDE the pinned project root '${pinRoot}'. ` +
      `Reads across projects are allowed but tracked. If this is drift into another project, stop now and open a new Claude Code session in the target project. ` +
      `Writes to this path will be blocked — reads only.`
  );
}

main().catch((err) => {
  process.stderr.write(`[lane-lock] pre-tool-use-read: unhandled error: ${err?.stack || err?.message || err}\n`);
  process.exit(0);
});

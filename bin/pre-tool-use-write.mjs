#!/usr/bin/env node
/**
 * PreToolUse write-tier hook.
 *
 * Fires on Edit | Write | MultiEdit | NotebookEdit | Bash tool calls.
 *
 * Blocks any write that targets a file outside the session's pinned project
 * root. Uses `permissionDecision: "deny"` + exit 0 — NOT exit 2 — per
 * Anthropic issue #24327. This decision overrides --dangerously-skip-permissions.
 *
 * For Bash: we check the command's effective cwd (input.cwd, falling back
 * to the session cwd) AND scan for explicit writes to absolute paths outside
 * the pin via shell keyword detection (>, tee, rm, etc.).
 *
 * Fail-open: if any module in the chain throws, we exit 0 (allow). The goal
 * is to never strand the user due to a hook bug — the LLM has other
 * guardrails (lane marker, UserPromptSubmit) upstream.
 */

import { readStdinJson } from '../lib/stdin.mjs';
import { readPin } from '../lib/pin.mjs';
import { isInside, resolveProjectRoot } from '../lib/paths.mjs';
import { preToolUseDeny, allowSilently } from '../lib/exit.mjs';
import { log } from '../lib/log.mjs';

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// Simple heuristic to detect bash commands that write.
const BASH_WRITE_PATTERN =
  /(^|\s|;|&&|\|\|)\s*(?:rm|mv|cp|mkdir|touch|dd|install|tee|sed\s+-i|chmod|chown|git\s+(?:commit|reset|checkout|rebase|clean|push|merge|pull|rm|add)|npm\s+install|pip\s+install|cargo\s+install|go\s+install)\b|[>]{1,2}\s*[\/\w]/i;

async function main() {
  const input = await readStdinJson();
  const sessionId = input.session_id || input.sessionId || 'unknown-session';
  const toolName = input.tool_name || input.toolName || '';
  const toolInput = input.tool_input || input.toolInput || {};
  const cwd = input.cwd || process.cwd();

  // Only guard write-class tools; fall through for everything else.
  if (toolName !== 'Bash' && !WRITE_TOOLS.has(toolName)) {
    return allowSilently();
  }

  // Find the pin. If missing, do a best-effort resolve so write-tier still protects.
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

  // File-path-based writes (Edit/Write/MultiEdit/NotebookEdit).
  if (WRITE_TOOLS.has(toolName)) {
    const targetPath =
      toolInput.file_path || toolInput.filePath || toolInput.path || toolInput.notebook_path;
    if (!targetPath) return allowSilently();

    let inside = false;
    try {
      inside = isInside(targetPath, pinRoot);
    } catch {
      return allowSilently();
    }

    if (!inside) {
      log({
        level: 'warn',
        source: 'pre-tool-use-write',
        sessionId,
        event: 'write_outside_pin_blocked',
        tool: toolName,
        target: targetPath,
        pinRoot,
      });
      return preToolUseDeny(
        `lane-lock: write to '${targetPath}' is outside pinned project root '${pinRoot}'.`,
        `This session is pinned. To write here, open a new Claude Code session in the target project, or set CLAUDE_ALLOW_CROSS_PROJECT in the environment and restart the session.`
      );
    }
    return allowSilently();
  }

  // Bash command inspection.
  if (toolName === 'Bash') {
    const command = String(toolInput.command || '');
    const bashCwd = toolInput.cwd || cwd;

    // If the bash cwd itself is outside the pin, any write is suspect.
    let bashInside = true;
    try {
      bashInside = isInside(bashCwd, pinRoot);
    } catch {
      bashInside = true; // Fail open on bad path.
    }

    if (!bashInside && BASH_WRITE_PATTERN.test(command)) {
      log({
        level: 'warn',
        source: 'pre-tool-use-write',
        sessionId,
        event: 'bash_write_outside_pin_blocked',
        command: command.slice(0, 300),
        bashCwd,
        pinRoot,
      });
      return preToolUseDeny(
        `lane-lock: bash write-class command in '${bashCwd}' (outside pin '${pinRoot}').`,
        `Run this command from within the pinned project, or use a new Claude Code session pinned to the target project.`
      );
    }
    return allowSilently();
  }

  return allowSilently();
}

main().catch((err) => {
  process.stderr.write(`[lane-lock] pre-tool-use-write: unhandled error: ${err?.stack || err?.message || err}\n`);
  process.exit(0); // Fail open.
});

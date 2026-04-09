#!/usr/bin/env node
/**
 * UserPromptSubmit hook — THE KILL PATH.
 *
 * This is the only hook that can erase a drift prompt from Claude's context
 * before a single reasoning token fires. Exit code 2 on UserPromptSubmit has
 * the documented effect of "blocks prompt processing and erases the prompt."
 *
 * Responsibilities:
 * 1. Read stdin JSON payload from Claude Code.
 * 2. Load the session pin lockfile.
 * 3. Check for bypass phrase / env var first.
 * 4. Run the matcher against the prompt.
 * 5. If matcher says block → exit 2 with explanatory stderr message.
 * 6. If matcher says warn → allow with warning injected into context.
 * 7. Else allow silently.
 *
 * Fallback behavior:
 * - If no pin file exists (workspace trust bug #11519 or missed SessionStart),
 *   resolve pin on the fly and WARN via stderr but allow through. Fail-open
 *   on UserPromptSubmit is the right default — we never want to strand the
 *   user on a first prompt.
 *
 * Exit codes:
 *   0 = allow prompt through
 *   2 = BLOCK prompt + erase from context (+ stderr message)
 *
 * @see docs/HOOKS.md for full protocol
 */

import { readPin, writePin } from '../lib/pin.mjs';
import { resolveProjectRoot } from '../lib/paths.mjs';
import { loadConfig, inferPinNameFromRoot } from '../lib/config.mjs';
import { match } from '../lib/match.mjs';

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function fail(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function allowSilently() {
  process.exit(0);
}

function allowWithWarning(message) {
  // A warning to stderr is visible in Claude's tool output.
  process.stderr.write(`[lane-lock] ${message}\n`);
  process.exit(0);
}

async function main() {
  let input;
  try {
    const raw = await readStdin();
    input = raw ? JSON.parse(raw) : {};
  } catch (err) {
    // Don't fail closed on malformed input — log and allow.
    process.stderr.write(`[lane-lock] UserPromptSubmit: stdin parse error: ${err.message}\n`);
    return allowSilently();
  }

  const sessionId = input.session_id || input.sessionId || 'unknown-session';
  const prompt = input.prompt || '';
  const cwd = input.cwd || process.cwd();

  // Fast exit on empty prompts.
  if (!prompt.trim()) return allowSilently();

  // Env var bypass — check before anything else, allows scripted overrides.
  const envBypass = process.env.CLAUDE_ALLOW_CROSS_PROJECT;
  if (envBypass && envBypass.length > 0) {
    return allowWithWarning(
      `Cross-lane bypass via CLAUDE_ALLOW_CROSS_PROJECT=${envBypass} — prompt allowed with warning.`
    );
  }

  // Load pin lockfile.
  let pin = readPin(sessionId);

  // Fallback: no pin found — resolve on the fly and WARN but don't block.
  if (!pin) {
    const resolution = resolveProjectRoot(cwd);
    const config = loadConfig(resolution.root);
    const { name, aliases } = inferPinNameFromRoot(resolution.root, config);

    pin = {
      schemaVersion: 1,
      sessionId,
      pinRoot: resolution.root,
      pinName: name,
      pinAliases: aliases,
      trustedSiblings: config.trustedSiblings || [],
      knownProjects: config.knownProjects || [],
      context: {
        caseSensitive: process.platform === 'linux',
        platform: process.platform,
        nodeVersion: process.version,
      },
      haikuEnabled: !!config.haikuEnabled,
      createdAt: new Date().toISOString(),
      pid: process.pid,
    };

    // Best-effort write so later hooks have it.
    try {
      writePin(sessionId, pin);
    } catch {
      /* ignore */
    }

    process.stderr.write(
      `[lane-lock] WARNING: no pin lockfile for session ${sessionId}. ` +
        `Recovered pin from cwd: '${name}' at ${resolution.root}. ` +
        `If you see this repeatedly, your SessionStart hook may not be firing ` +
        `(see docs/KNOWN-ISSUES.md for anthropics/claude-code#11519).\n`
    );
  }

  const matchInput = {
    root: pin.pinRoot,
    name: pin.pinName,
    aliases: pin.pinAliases,
    trustedSiblings: pin.trustedSiblings,
  };

  const result = match(prompt, matchInput, pin.knownProjects);

  if (result.decision === 'block') {
    // THE KILL. Exit 2 + stderr message.
    const lines = [
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '🛡️  lane-lock: drift prompt BLOCKED before reasoning started.',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      `  Pinned project: ${pin.pinName}`,
      `  Pin root:       ${pin.pinRoot}`,
      '',
      `  Reason: ${result.reason}`,
    ];
    if (result.matchedTokens.length > 0) {
      lines.push(`  Matched project names: ${result.matchedTokens.join(', ')}`);
    }
    if (result.matchedPaths.length > 0) {
      lines.push('  Matched cross-project paths:');
      for (const p of result.matchedPaths) lines.push(`    - ${p}`);
    }
    lines.push('');
    lines.push(`  ${result.message}`);
    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    fail(lines.join('\n'), 2);
  }

  if (result.decision === 'warn') {
    return allowWithWarning(result.message);
  }

  return allowSilently();
}

main().catch((err) => {
  // Fail-open: never strand the user on a hook bug.
  process.stderr.write(`[lane-lock] UserPromptSubmit: unhandled error: ${err.stack || err.message}\n`);
  process.exit(0);
});

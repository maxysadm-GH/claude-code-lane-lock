#!/usr/bin/env node
/**
 * SessionStart hook — t=0 pin capture.
 *
 * Responsibilities:
 * 1. Read stdin JSON payload from Claude Code.
 * 2. Resolve the project root via `git rev-parse --show-toplevel`.
 * 3. Load lane-lock config (project aliases, known siblings, Haiku toggle).
 * 4. Write a session lockfile to `~/.claude/lane-lock/sessions/<session_id>.json`.
 * 5. Reap stale lockfiles older than 24h.
 * 6. Emit a one-line lane marker to stdout — becomes part of Claude's context.
 *
 * Exit codes:
 *   0 = always. SessionStart cannot block; it can only inject context.
 *
 * @see docs/HOOKS.md for full protocol
 */

import { readFileSync } from 'node:fs';
import { resolveProjectRoot } from '../lib/paths.mjs';
import { writePin, reapStale } from '../lib/pin.mjs';
import { loadConfig, inferPinNameFromRoot } from '../lib/config.mjs';

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function main() {
  let input;
  try {
    const raw = await readStdin();
    input = raw ? JSON.parse(raw) : {};
  } catch (err) {
    process.stderr.write(`[lane-lock] SessionStart: stdin parse error: ${err.message}\n`);
    process.exit(0); // Fail open.
  }

  const sessionId = input.session_id || input.sessionId || 'unknown-session';
  const cwd = input.cwd || process.cwd();

  // Reap stale locks first so `lane-lock sessions` doesn't show ghosts.
  reapStale();

  // Resolve project root. This is the ONLY place we call git.
  const resolution = resolveProjectRoot(cwd);

  // Load config — scoped to the resolved root first, then global fallback.
  const config = loadConfig(resolution.root);

  // Determine the pin's canonical name + aliases.
  const { name, aliases } = inferPinNameFromRoot(resolution.root, config);

  const lockfile = {
    schemaVersion: 1,
    sessionId,
    pinRoot: resolution.root,
    pinName: name,
    pinAliases: aliases,
    trustedSiblings: config.trustedSiblings || [],
      codeRoots: config.codeRoots || [],
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

  try {
    writePin(sessionId, lockfile);
  } catch (err) {
    process.stderr.write(`[lane-lock] SessionStart: failed to write pin: ${err.message}\n`);
    // Continue — lane marker still useful even without pin file.
  }

  // Build the lane marker. This is the one-line message that gets injected
  // into Claude's context. Keep it punchy and unmistakable.
  const fallbackNote = resolution.isFallback
    ? ' ⚠️  git rev-parse failed — using cwd fallback'
    : '';
  const worktreeNote = resolution.isWorktree ? ' (git worktree)' : '';
  const marker =
    `🛡️  lane-lock: this session is PINNED to project '${name}' at ${resolution.root}${worktreeNote}.${fallbackNote} ` +
    `Do not read, plan for, or modify files outside this root. ` +
    `If the user prompt references a different project, STOP and ask. ` +
    `Bypass: [cross-lane: <project>] in prompt OR CLAUDE_ALLOW_CROSS_PROJECT=<project> env var.`;

  // SessionStart hook contract: write to stdout is injected into context.
  emit({
    continue: true,
    additionalContext: marker,
  });

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[lane-lock] SessionStart: unhandled error: ${err.stack || err.message}\n`);
  process.exit(0); // Fail open — never block session startup.
});

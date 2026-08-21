/**
 * Hero fixture — reproduces a cross-project drift scenario in a
 * self-contained way and proves the UserPromptSubmit hook kills the drift
 * at t=0 (exit 2).
 *
 * This is the single most important test in the repo. If this passes, the
 * core value prop works. If this fails, we have no plugin.
 *
 * The scenario:
 * - A Claude Code session is pinned to `project-alpha`
 * - The user (or ambient context) sends a prompt that references
 *   `project-gamma` or its alias `inventory-demo`
 * - Without lane-lock: the session would drift, waste reasoning cycles,
 *   and commit to the wrong repo
 * - With lane-lock: UserPromptSubmit sees the sibling alias in the prompt,
 *   exits 2, and the prompt is erased from context — before any reasoning
 *   token fires
 *
 * Run: node --test tests/e2e/cross-project-drift.test.mjs
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const SESSION_START = join(REPO_ROOT, 'bin', 'session-start.mjs');
const USER_PROMPT_SUBMIT = join(REPO_ROOT, 'bin', 'user-prompt-submit.mjs');

/** Tracks temp dirs + lockfiles to clean up in after(). */
const cleanup = [];

/**
 * Invoke a hook script as Claude Code would: spawn node, pipe JSON to stdin,
 * capture stdout + stderr + exit code.
 */
const TEST_LOG_DIR = mkdtempSync(join(tmpdir(), 'lane-lock-log-'));

function invokeHook(scriptPath, payload, extraEnv = {}) {
  const result = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['pipe', 'pipe', 'pipe'],
    // Never append fixture events to the developer's real drift log.
    env: { ...process.env, LANE_LOCK_LOG_DIR: TEST_LOG_DIR, ...extraEnv },
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    signal: result.signal,
  };
}

/**
 * Build two fake sibling project directories with init'd git repos, one
 * for project-alpha and one for project-gamma (inventory-demo). Returns
 * their resolved paths.
 */
function buildFixtureWorld() {
  const base = mkdtempSync(join(tmpdir(), 'lane-lock-fixture-'));
  cleanup.push(base);

  const alpha = join(base, 'project-alpha');
  const gamma = join(base, 'project-gamma');

  for (const dir of [alpha, gamma]) {
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
    writeFileSync(join(dir, 'README.md'), '# fixture\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  }

  // Write a project-scoped lane-lock.json in project-alpha that declares
  // project-gamma as a known sibling project.
  mkdirSync(join(alpha, '.claude'), { recursive: true });
  writeFileSync(
    join(alpha, '.claude', 'lane-lock.json'),
    JSON.stringify(
      {
        knownProjects: [
          {
            name: 'project-alpha',
            aliases: ['project-alpha', 'alpha'],
            root: alpha,
          },
          {
            name: 'project-gamma',
            aliases: ['project-gamma', 'gamma', 'inventory-demo', 'inv-demo'],
            root: gamma,
          },
        ],
      },
      null,
      2
    )
  );

  return { alpha, gamma };
}

describe('Cross-project drift — the hero fixture', () => {
  let world;
  const sessionId = `fixture-cross-project-${Date.now()}`;

  before(() => {
    world = buildFixtureWorld();
  });

  after(() => {
    // Clean up fixture dirs.
    for (const dir of cleanup) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    // Clean up any session lockfile we wrote.
    try {
      const lockPath = join(
        homedir(),
        '.claude',
        'lane-lock',
        'sessions',
        `${sessionId}.json`
      );
      if (existsSync(lockPath)) rmSync(lockPath, { force: true });
    } catch {
      /* ignore */
    }
  });

  test('SessionStart: pins the project-alpha project and writes a lockfile', () => {
    const result = invokeHook(SESSION_START, {
      session_id: sessionId,
      cwd: world.alpha,
      source: 'startup',
    });

    assert.equal(result.exitCode, 0, `SessionStart must exit 0, got ${result.exitCode}. stderr: ${result.stderr}`);
    assert.match(result.stdout, /lane-lock/, 'stdout must contain lane-lock marker');
    assert.match(result.stdout, /project-alpha/, 'lane marker must identify the pinned project');
    assert.match(result.stdout, /additionalContext/, 'stdout must include additionalContext for Claude');

    // Lockfile should exist on disk.
    const lockPath = join(
      homedir(),
      '.claude',
      'lane-lock',
      'sessions',
      `${sessionId}.json`
    );
    assert.ok(existsSync(lockPath), `lockfile must exist at ${lockPath}`);
  });

  test('UserPromptSubmit: ALLOWS a normal project-alpha-scoped prompt', () => {
    const result = invokeHook(USER_PROMPT_SUBMIT, {
      session_id: sessionId,
      cwd: world.alpha,
      prompt: 'Add a new route for user profile in the project-alpha app.',
    });

    assert.equal(result.exitCode, 0, `normal prompt must exit 0, got ${result.exitCode}. stderr: ${result.stderr}`);
  });

  // Contract 2026-08-21: the prompt gate INFORMS by default and only erases
  // under an explicit opt-in. Destroying user input on a prose heuristic had an
  // unbounded false-positive surface; enforcement lives in PreToolUse, which
  // judges real file targets. See tests/e2e/never-erase-real-prompts.test.mjs.
  test('UserPromptSubmit: default mode WARNS on drift + names the lane (exit 0)', () => {
    const result = invokeHook(USER_PROMPT_SUBMIT, {
      session_id: sessionId,
      cwd: world.alpha,
      prompt: `Now switch gears and fix ${world.gamma}/src/bom.ts for the project-gamma inventory demo.`,
    });

    assert.equal(result.exitCode, 0, `default must not erase. stderr: ${result.stderr}`);
    assert.match(`${result.stdout}${result.stderr}`, /project-alpha/i, 'must name the pinned lane');
  });

  test('UserPromptSubmit: opt-in block mode erases a drift prompt (exit 2)', () => {
    const result = invokeHook(
      USER_PROMPT_SUBMIT,
      {
        session_id: sessionId,
        cwd: world.alpha,
        prompt: `Now switch gears and fix ${world.gamma}/src/bom.ts for the project-gamma inventory demo.`,
      },
      { LANE_LOCK_PROMPT_GATE: 'block' }
    );

    assert.equal(
      result.exitCode,
      2,
      `drift prompt MUST exit 2 to erase from context. got ${result.exitCode}. stderr: ${result.stderr}`
    );
    assert.match(result.stderr, /lane-lock/, 'stderr must identify lane-lock');
    assert.match(result.stderr, /BLOCKED/, 'stderr must say BLOCKED');
    assert.match(result.stderr, /project-alpha/i, 'stderr must show the pinned project');
    assert.match(result.stderr, /project-gamma|inventory-demo/i, 'stderr must show the drift target');
  });

  // Contract change 2026-08-20: a bare alias mention is weak evidence and must
  // NOT erase the prompt. Project names collide with vendors and everyday nouns
  // (ShipperHQ, mbacio, docs, reports), and blocking on them cost real prompts.
  test('UserPromptSubmit: WARNS but allows a bare project-gamma mention (exit 0)', () => {
    const result = invokeHook(USER_PROMPT_SUBMIT, {
      session_id: sessionId,
      cwd: world.alpha,
      prompt: 'Now switch gears and fix the project-gamma inventory demo raw-material BOM validation.',
    });

    assert.equal(
      result.exitCode,
      0,
      `bare alias mention must NOT erase the prompt. got ${result.exitCode}. stderr: ${result.stderr}`
    );
    assert.match(result.stderr, /lane-lock/, 'stderr must identify lane-lock');
    assert.match(result.stderr, /project-gamma/i, 'warning must name the mentioned project');
  });

  test('UserPromptSubmit: WARNS on a relative inventory-demo path (exit 0)', () => {
    // Relative paths carry no container evidence, so this is alias-only.
    const result = invokeHook(USER_PROMPT_SUBMIT, {
      session_id: sessionId,
      cwd: world.alpha,
      prompt: 'open inventory-demo/src/Dashboard.tsx and add a new column',
    });

    assert.equal(
      result.exitCode,
      0,
      `alias-only drift must warn, not erase. got ${result.exitCode}. stderr: ${result.stderr}`
    );
    assert.match(result.stderr, /inventory-demo|project-gamma/i);
  });

  test('UserPromptSubmit: absolute path outside the pin erases only in block mode (exit 2)', () => {
    const result = invokeHook(
      USER_PROMPT_SUBMIT,
      {
        session_id: sessionId,
        cwd: world.alpha,
        prompt: `Update the file at ${world.gamma}/README.md with new content.`,
      },
      { LANE_LOCK_PROMPT_GATE: 'block' }
    );

    assert.equal(
      result.exitCode,
      2,
      `absolute-path drift must exit 2. got ${result.exitCode}. stderr: ${result.stderr}`
    );
    assert.match(result.stderr, /path/i, 'stderr must mention path-based drift');
  });

  test('UserPromptSubmit: ALLOWS a drift prompt with the bypass phrase', () => {
    const result = invokeHook(USER_PROMPT_SUBMIT, {
      session_id: sessionId,
      cwd: world.alpha,
      prompt: '[cross-lane: project-gamma] Quick glance at inventory-demo for the pattern I need.',
    });

    assert.equal(
      result.exitCode,
      0,
      `bypass phrase must allow through with exit 0. got ${result.exitCode}. stderr: ${result.stderr}`
    );
    assert.match(result.stderr, /bypass/i, 'stderr must log the bypass');
  });

  test('UserPromptSubmit: ALLOWS a drift prompt when CLAUDE_ALLOW_CROSS_PROJECT env var is set', () => {
    const result = spawnSync(
      process.execPath,
      [USER_PROMPT_SUBMIT],
      {
        input: JSON.stringify({
          session_id: sessionId,
          cwd: world.alpha,
          prompt: 'Look at the project-gamma code for the raw-material validation pattern.',
        }),
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, LANE_LOCK_LOG_DIR: TEST_LOG_DIR, CLAUDE_ALLOW_CROSS_PROJECT: 'project-gamma' },
      }
    );

    assert.equal(
      result.status,
      0,
      `env bypass must allow through. got ${result.status}. stderr: ${result.stderr}`
    );
    assert.match(result.stderr, /bypass/i, 'stderr must log the bypass');
  });

  test('UserPromptSubmit: does NOT false-positive on substring collisions', () => {
    // "app" is a substring of "project-alpha" but shouldn't trigger
    // as a cross-project reference to some other project.
    // "mapping" contains "app" — must NOT match sibling aliases.
    const result = invokeHook(USER_PROMPT_SUBMIT, {
      session_id: sessionId,
      cwd: world.alpha,
      prompt: 'Refactor the route mapping and snapshot the api response shape.',
    });

    assert.equal(
      result.exitCode,
      0,
      `substring-only matches must NOT block. got ${result.exitCode}. stderr: ${result.stderr}`
    );
  });
});

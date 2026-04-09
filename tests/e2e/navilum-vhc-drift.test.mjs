/**
 * THE HERO FIXTURE — reproduces the 2026-04-07 Project Alpha→Project Gamma drift incident
 * and proves the UserPromptSubmit hook kills the drift at t=0 (exit 2).
 *
 * This is the single most important test in the repo. If this passes, the
 * core value prop works. If this fails, we have no plugin.
 *
 * The scenario:
 * - A Claude Code session is pinned to `project-alpha`
 * - The user (or ambient context) sends a prompt that references the Project Gamma
 *   inventory dashboard project
 * - Without lane-lock: the session would drift, waste 4 hours, and commit
 *   to the wrong repo
 * - With lane-lock: UserPromptSubmit sees "project-gamma" / "inventory-demo" in the
 *   prompt, exits 2, and the prompt is erased from context — before any
 *   reasoning token fires
 *
 * Run: node --test tests/e2e/project-alpha-project-gamma-drift.test.mjs
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
function invokeHook(scriptPath, payload) {
  const result = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['pipe', 'pipe', 'pipe'],
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
 * for Project Alpha and one for Project Gamma inventory-demo. Returns their resolved paths.
 */
function buildFixtureWorld() {
  const base = mkdtempSync(join(tmpdir(), 'lane-lock-fixture-'));
  cleanup.push(base);

  const project-alpha = join(base, 'project-alpha');
  const project-gamma = join(base, 'inventory-demo');

  for (const dir of [project-alpha, project-gamma]) {
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
    writeFileSync(join(dir, 'README.md'), '# fixture\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  }

  // Write a project-scoped lane-lock.json in the project-alpha fixture that
  // declares Project Gamma as a known sibling project.
  mkdirSync(join(project-alpha, '.claude'), { recursive: true });
  writeFileSync(
    join(project-alpha, '.claude', 'lane-lock.json'),
    JSON.stringify(
      {
        knownProjects: [
          {
            name: 'project-alpha',
            aliases: ['project-alpha', 'project-alpha'],
            root: project-alpha,
          },
          {
            name: 'project-gamma',
            aliases: ['project-gamma', 'inventory-demo', 'inventory-demo', 'vosges'],
            root: project-gamma,
          },
        ],
      },
      null,
      2
    )
  );

  return { project-alpha, project-gamma };
}

describe('Project Alpha→Project Gamma drift — the hero fixture', () => {
  let world;
  const sessionId = `fixture-nav-project-gamma-${Date.now()}`;

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
      cwd: world.project-alpha,
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
      cwd: world.project-alpha,
      prompt: 'Add a new route for patient summary in the project-alpha app.',
    });

    assert.equal(result.exitCode, 0, `normal prompt must exit 0, got ${result.exitCode}. stderr: ${result.stderr}`);
  });

  test('UserPromptSubmit: BLOCKS a drift prompt mentioning Project Gamma dashboard (exit 2)', () => {
    const result = invokeHook(USER_PROMPT_SUBMIT, {
      session_id: sessionId,
      cwd: world.project-alpha,
      prompt: 'Now switch gears and fix the Project Gamma inventory dashboard raw-material BOM validation.',
    });

    assert.equal(
      result.exitCode,
      2,
      `drift prompt MUST exit 2 to erase from context. got ${result.exitCode}. stderr: ${result.stderr}`
    );
    assert.match(result.stderr, /lane-lock/, 'stderr must identify lane-lock');
    assert.match(result.stderr, /BLOCKED/, 'stderr must say BLOCKED');
    assert.match(result.stderr, /project-alpha/i, 'stderr must show the pinned project');
    assert.match(result.stderr, /project-gamma|inventory-demo|inventory-demo/i, 'stderr must show the drift target');
  });

  test('UserPromptSubmit: BLOCKS a drift prompt referencing inventory-demo alias (exit 2)', () => {
    const result = invokeHook(USER_PROMPT_SUBMIT, {
      session_id: sessionId,
      cwd: world.project-alpha,
      prompt: 'open inventory-demo/src/Dashboard.tsx and add a new column',
    });

    assert.equal(
      result.exitCode,
      2,
      `alias drift must exit 2. got ${result.exitCode}. stderr: ${result.stderr}`
    );
  });

  test('UserPromptSubmit: BLOCKS a prompt with an absolute path outside the pin (exit 2)', () => {
    const result = invokeHook(USER_PROMPT_SUBMIT, {
      session_id: sessionId,
      cwd: world.project-alpha,
      prompt: `Update the file at ${world.project-gamma}/README.md with new content.`,
    });

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
      cwd: world.project-alpha,
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
          cwd: world.project-alpha,
          prompt: 'Look at the Project Gamma dashboard code for the raw-material validation pattern.',
        }),
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDE_ALLOW_CROSS_PROJECT: 'project-gamma' },
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
    // "mapping" contains "app" — must NOT match "project-gamma-app" even if that alias existed.
    const result = invokeHook(USER_PROMPT_SUBMIT, {
      session_id: sessionId,
      cwd: world.project-alpha,
      prompt: 'Refactor the route mapping and snapshot the api response shape.',
    });

    assert.equal(
      result.exitCode,
      0,
      `substring-only matches must NOT block. got ${result.exitCode}. stderr: ${result.stderr}`
    );
  });
});

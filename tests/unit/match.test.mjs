import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { match } from '../../lib/match.mjs';

const pin = {
  root: '/fake/project-a',
  name: 'project-a',
  aliases: ['project-a', 'proja'],
};

const knownProjects = [
  { name: 'project-a', aliases: ['project-a', 'proja'], root: '/fake/project-a' },
  { name: 'project-b', aliases: ['project-b', 'projb'], root: '/fake/project-b' },
  { name: 'project-c', aliases: ['project-c', 'provc'], root: '/fake/project-c' },
];

describe('match()', () => {
  test('empty prompt returns decision=allow, reason=none', () => {
    const result = match('', pin, knownProjects);
    assert.strictEqual(result.decision, 'allow');
    assert.strictEqual(result.reason, 'none');
    assert.deepStrictEqual(result.matchedTokens, []);
  });

  test('prompt with known sibling alias returns decision=block, reason=alias', () => {
    const result = match('project-b is broken', pin, knownProjects);
    assert.strictEqual(result.decision, 'block');
    assert.strictEqual(result.reason, 'alias');
    assert.deepStrictEqual(result.matchedTokens, ['project-b']);
  });

  test('prompt with pin own alias returns decision=allow', () => {
    const result = match('project-a is broken', pin, knownProjects);
    assert.strictEqual(result.decision, 'allow');
    assert.strictEqual(result.reason, 'none');
  });

  test('prompt with absolute path outside pin returns decision=block, reason=path', () => {
    // Use a path whose segments do NOT match any known alias, otherwise
    // alias detection fires first (alias match has precedence over path match).
    const result = match('see /fake/unrelated-dir/fix.js', pin, knownProjects);
    assert.strictEqual(result.decision, 'block');
    assert.strictEqual(result.reason, 'path');
    assert.ok(result.matchedPaths.some((p) => p.includes('unrelated-dir')));
  });

  test('prompt with bypass phrase returns decision=warn, reason=bypass', () => {
    const result = match('[cross-lane: project-b] fix this', pin, knownProjects);
    assert.strictEqual(result.decision, 'warn');
    assert.strictEqual(result.reason, 'bypass');
    assert.strictEqual(result.bypassTarget, 'project-b');
  });

  test('does NOT false-positive on substring collisions', () => {
    const result = match('api is broken', pin, knownProjects);
    assert.strictEqual(result.decision, 'allow');
    assert.strictEqual(result.reason, 'none');
  });

  test('enforces 3-character minimum alias length', () => {
    const shortAliasPin = {
      root: '/fake/project-a',
      name: 'project-a',
      aliases: ['project-a', 'a'],
    };
    const result = match('a is broken', pin, knownProjects);
    assert.strictEqual(result.decision, 'allow');
    assert.strictEqual(result.reason, 'none');
  });
});

// Auto-generated alias lists give every hyphenated project its first token as
// an alias, so a shared prefix ends up claimed by several projects at once.
// Such a token names a convention, not a lane, and must never block.
const sharedPrefixProjects = [
  { name: 'acme-web', aliases: ['acme-web', 'acme'], root: '/fake/acme-web' },
  { name: 'acme-api', aliases: ['acme-api', 'acme'], root: '/fake/acme-api' },
  { name: 'acme-cli', aliases: ['acme-cli', 'acme'], root: '/fake/acme-cli' },
];

describe('match() — ambiguous aliases', () => {
  test('an alias claimed by 2+ projects does not block', () => {
    const result = match('the acme deploy is broken', pin, sharedPrefixProjects);
    assert.strictEqual(result.decision, 'allow');
    assert.strictEqual(result.reason, 'none');
    assert.deepStrictEqual(result.matchedTokens, []);
  });

  test('an unambiguous alias on the same project still blocks', () => {
    const result = match('acme-api is broken', pin, sharedPrefixProjects);
    assert.strictEqual(result.decision, 'block');
    assert.strictEqual(result.reason, 'alias');
    assert.deepStrictEqual(result.matchedTokens, ['acme-api']);
  });
});

describe('match() — sibling worktrees', () => {
  // An Orca workspace pins to .../workspaces/<repo>/<BRANCH>, while the repo's
  // other worktrees live elsewhere. They are one repository, so paths into a
  // sibling worktree are in-lane.
  const worktreePin = {
    root: '/fake/workspaces/project-a/FEATURE',
    name: 'feature',
    aliases: ['feature', 'project-a', 'proja'],
    siblingRoots: ['/fake/project-a', '/fake/project-a-main'],
  };

  test('path inside a sibling worktree is allowed', () => {
    const result = match('fix /fake/project-a-main/src/index.js', worktreePin, knownProjects);
    assert.strictEqual(result.decision, 'allow');
    assert.strictEqual(result.reason, 'none');
    assert.deepStrictEqual(result.matchedPaths, []);
  });

  test('path outside every sibling worktree still blocks', () => {
    const result = match('fix /fake/unrelated-dir/index.js', worktreePin, knownProjects);
    assert.strictEqual(result.decision, 'block');
    assert.strictEqual(result.reason, 'path');
  });

  test('own repo name folded into pin aliases does not block', () => {
    const result = match('project-a needs a rebuild', worktreePin, knownProjects);
    assert.strictEqual(result.decision, 'allow');
    assert.strictEqual(result.reason, 'none');
  });

  test('missing siblingRoots (pre-upgrade lockfile) behaves as before', () => {
    const legacyPin = { root: '/fake/project-a', name: 'project-a', aliases: ['project-a'] };
    const result = match('fix /fake/unrelated-dir/index.js', legacyPin, knownProjects);
    assert.strictEqual(result.decision, 'block');
    assert.strictEqual(result.reason, 'path');
  });
});
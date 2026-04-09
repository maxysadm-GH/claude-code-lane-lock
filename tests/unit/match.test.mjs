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
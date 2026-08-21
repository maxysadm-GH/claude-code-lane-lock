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

  test('prompt with known sibling alias warns (uncorroborated), reason=alias', () => {
    const result = match('project-b is broken', pin, knownProjects);
    assert.strictEqual(result.decision, 'warn');
    assert.strictEqual(result.reason, 'alias');
    assert.deepStrictEqual(result.matchedTokens, ['project-b']);
  });

  // Regression: 2026-08-20. A prompt describing Azure App Service infrastructure
  // ("durable POSIX disk at /home/site/cc-data") was blocked and erased before
  // reasoning, because Rule 3 treated EVERY absolute path outside the pin as
  // cross-project drift. Server, system and container paths are not projects.
  test('non-project absolute paths do NOT block (server/system paths)', () => {
    for (const p of [
      '/home/site/cc-data',
      '/home/site/wwwroot',
      '/var/log/syslog',
      '/etc/nginx/nginx.conf',
      '/tmp/build-output.txt',
      '/usr/local/bin/node',
      '/opt/homebrew/bin/orca',
    ]) {
      const result = match(`Durable POSIX disk at ${p} holds the ledgers.`, pin, knownProjects);
      assert.strictEqual(result.decision, 'allow', `${p} should not block`);
      assert.deepStrictEqual(result.matchedPaths, [], `${p} should not be matched`);
    }
  });

  test('sibling path inside a project container still blocks', () => {
    // /fake is the parent of every knownProject root, so it is a project
    // container: an unknown dir inside it is still drift evidence.
    const result = match('see /fake/unrelated-dir/fix.js', pin, knownProjects);
    assert.strictEqual(result.decision, 'block');
    assert.strictEqual(result.reason, 'path');
  });

  test('sibling container is derived from pin root even with no knownProjects', () => {
    const blocked = match('open /fake/project-z/x.js', pin, []);
    assert.strictEqual(blocked.decision, 'block');
    assert.strictEqual(blocked.reason, 'path');
    const allowed = match('open /home/site/cc-data', pin, []);
    assert.strictEqual(allowed.decision, 'allow');
  });


  test('codeRoots make real cross-project paths block again', () => {
    // Regression guard: this portfolio's knownProjects roots were generated on
    // Windows (C:/Users/.../Projects/...) and match nothing on macOS, so the
    // container list must be able to come from config instead.
    const macPin = {
      root: '/Users/max/orca/workspaces/VHC/prog-cc-sales-board',
      name: 'prog-cc-sales-board',
      aliases: ['prog-cc-sales-board'],
      codeRoots: ['/Users/max/Projects', '/Users/max/orca/workspaces'],
    };
    const winProjects = [
      { name: 'teams-agents', aliases: ['teams-agents'], root: 'C:/Users/maxys/Projects/vhc-teams-agents' },
    ];
    // With no usable knownProjects, the PATH rule alone must still catch it.
    const byPath = match('edit /Users/max/Projects/some-other-repo/core/x.py', macPin, []);
    assert.strictEqual(byPath.decision, 'block');
    assert.strictEqual(byPath.reason, 'path');

    // And it still blocks when the alias rule fires first.
    const blocked = match('edit /Users/max/Projects/vhc-teams-agents/core/x.py', macPin, winProjects);
    assert.strictEqual(blocked.decision, 'block');

    const allowed = match('durable disk at /home/site/cc-data', macPin, winProjects);
    assert.strictEqual(allowed.decision, 'allow');
  });


  // Regression 2026-08-20 #2: naming a thing is not intending to work in its
  // repo. "ShipperHQ" is a shipping vendor discussed constantly in VHC work AND
  // a repo name (ShipperHQ-BOX) — a bare mention erased the prompt at exit 2.
  // Un-corroborated alias mentions must WARN, never block.
  test('bare alias mention warns instead of blocking', () => {
    const result = match('audit the ShipperHQ rate rules for the sales board', pin, [
      { name: 'ShipperHQ-BOX', aliases: ['ShipperHQ'], root: '/fake/ShipperHQ-BOX' },
    ]);
    assert.strictEqual(result.decision, 'warn');
    assert.strictEqual(result.reason, 'alias');
    assert.deepStrictEqual(result.matchedTokens, ['ShipperHQ']);
  });

  test('alias mention corroborated by a path inside that project still blocks', () => {
    const result = match(
      'open /fake/project-b/src/app.js and fix project-b',
      pin,
      knownProjects
    );
    assert.strictEqual(result.decision, 'block');
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
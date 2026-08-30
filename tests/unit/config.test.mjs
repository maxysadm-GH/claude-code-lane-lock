import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { inferPinNameFromRoot } from '../../lib/config.mjs';

const config = {
  knownProjects: [
    { name: 'project-a', aliases: ['project-a', 'proja'], root: '/fake/project-a' },
    { name: 'project-b', aliases: ['project-b', 'projb'], root: '/fake/project-b' },
  ],
};

describe('inferPinNameFromRoot()', () => {
  test('uses the configured name and aliases when the root matches', () => {
    const { name, aliases } = inferPinNameFromRoot('/fake/project-a', config);
    assert.strictEqual(name, 'project-a');
    assert.ok(aliases.includes('project-a'));
    assert.ok(aliases.includes('proja'));
  });

  test('falls back to the basename for an unregistered root', () => {
    const { name, aliases } = inferPinNameFromRoot('/fake/project-z', config);
    assert.strictEqual(name, 'project-z');
    assert.deepStrictEqual(aliases, ['project-z']);
  });

  test('folds a sibling worktree registration into the pin aliases', () => {
    // Orca shape: pinned to .../workspaces/project-a/HERMES, while the registry
    // knows the repo by its main checkout. Both are the same repository.
    const { name, aliases } = inferPinNameFromRoot(
      '/fake/workspaces/project-a/HERMES',
      config,
      ['/fake/project-a']
    );
    assert.strictEqual(name, 'hermes');
    assert.ok(aliases.includes('hermes'), 'keeps its own basename');
    assert.ok(aliases.includes('project-a'), 'adopts the sibling worktree project name');
    assert.ok(aliases.includes('proja'), 'adopts the sibling worktree aliases');
    assert.ok(!aliases.includes('project-b'), 'does not adopt unrelated projects');
  });

  test('sibling roots that are not registered contribute their basename only', () => {
    const { aliases } = inferPinNameFromRoot('/fake/workspaces/thing/BRANCHY', config, [
      '/fake/thing-main',
    ]);
    assert.ok(aliases.includes('branchy'));
    assert.ok(aliases.includes('thing-main'));
  });

  test('drops aliases below the 3-character minimum', () => {
    const { aliases } = inferPinNameFromRoot('/fake/ab', config);
    assert.deepStrictEqual(aliases, []);
  });
});

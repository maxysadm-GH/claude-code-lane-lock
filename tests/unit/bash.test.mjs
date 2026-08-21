import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isBashWrite, commandTargetsPin } from '../../lib/bash.mjs';

const PIN = '/Users/max/orca/workspaces/VHC/prog-cc-sales-board';

describe('isBashWrite()', () => {
  // Regression 2026-08-20: the trailing `[>]{1,2}\s*[/\w]` alternative matched
  // the `/` in `2>/dev/null`, so read-only greps were classified as writes and
  // blocked whenever the shell cwd sat outside the pin.
  test('stderr redirection is not a write', () => {
    for (const c of [
      'grep -rn foo app/*.py 2>/dev/null | head -30',
      'wc -l /a /b 2>/dev/null | sort -rn',
      'find . -type f 2>/dev/null',
      'cat x.md 2>&1',
      'ls -la &>/dev/null',
    ]) {
      assert.equal(isBashWrite(c), false, `should be read-only: ${c}`);
    }
  });

  test('real writes are still detected', () => {
    for (const c of [
      'echo hi > out.txt',
      'rm -rf build',
      'git add .',
      'sed -i "" s/a/b/ f.txt',
      'npm install lodash',
      'grep foo x 2>/dev/null > results.txt',
    ]) {
      assert.equal(isBashWrite(c), true, `should be a write: ${c}`);
    }
  });
});

describe('commandTargetsPin()', () => {
  test('leading cd into the pin counts as in-lane', () => {
    assert.equal(commandTargetsPin(`cd ${PIN}\npwd`, PIN), true);
    assert.equal(commandTargetsPin(`cd ${PIN} && pwd`, PIN), true);
  });

  test('absolute paths under the pin count as in-lane', () => {
    assert.equal(commandTargetsPin(`wc -l ${PIN}/app/static/x.js`, PIN), true);
  });

  test('a path outside the pin does not count', () => {
    assert.equal(commandTargetsPin('wc -l /Users/max/Projects/other/x.js', PIN), false);
    assert.equal(commandTargetsPin(`wc -l ${PIN}/a.js /Users/max/Projects/other/b.js`, PIN), false);
  });

  test('no absolute paths and no cd is not a claim of in-lane', () => {
    assert.equal(commandTargetsPin('rm -rf build', PIN), false);
  });
});

import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { normalize, caseCompare, isInside } from '../../lib/paths.mjs';

describe('normalize', () => {
  test('strips trailing slash on non-root paths', () => {
    assert.strictEqual(normalize('/foo/bar/'), '/foo/bar');
  });

  test('preserves root paths (platform-appropriate)', () => {
    // On POSIX '/' is the root; on Windows, '/' resolves to the current drive
    // root like 'C:/'. Test that the result ends with ':/' on Windows or
    // equals '/' on POSIX — both are valid "root preserved" forms.
    const rootResult = normalize('/');
    if (process.platform === 'win32') {
      assert.match(rootResult, /^[A-Za-z]:\/$/);
    } else {
      assert.strictEqual(rootResult, '/');
    }
    // Windows-style drive root should always be preserved verbatim.
    if (process.platform === 'win32') {
      // Use a realistic existing drive letter
      assert.strictEqual(normalize('C:/'), 'C:/');
    }
  });
});

describe('caseCompare', () => {
  test('returns true for identical strings', () => {
    assert.strictEqual(caseCompare('foo', 'foo'), true);
  });

  test('returns true for different-case strings on win32 and darwin', () => {
    // Mock platform as win32 for testing
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    assert.strictEqual(caseCompare('Foo', 'foo'), true);
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });
});

describe('isInside', () => {
  test('returns true for child inside parent', () => {
    assert.strictEqual(isInside('/foo/bar', '/foo'), true);
  });

  test('returns false for prefix bug guard', () => {
    assert.strictEqual(isInside('/foobar', '/foo'), false);
  });

  test('returns true for equal paths', () => {
    assert.strictEqual(isInside('/foo', '/foo'), true);
  });

  test('handles parent with trailing slash', () => {
    assert.strictEqual(isInside('/foo/bar', '/foo/'), true);
  });
});
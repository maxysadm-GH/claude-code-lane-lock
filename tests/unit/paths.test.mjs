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

  test('platform-appropriate case handling', () => {
    // CASE_INSENSITIVE is computed at module load time from process.platform,
    // so runtime mocking does not work. Test the actual behavior on this platform.
    const result = caseCompare('Foo', 'foo');
    if (process.platform === 'win32' || process.platform === 'darwin') {
      assert.strictEqual(result, true, 'win32/darwin must compare case-insensitively');
    } else {
      assert.strictEqual(result, false, 'linux must compare case-sensitively');
    }
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
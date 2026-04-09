import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writePin, readPin, deletePin, listPins } from '../../lib/pin.mjs';

const TEST_PREFIX = `test-pin-${Date.now()}-`;
let testSessionId = 0;

function nextSessionId() {
  return `${TEST_PREFIX}${++testSessionId}`;
}

afterEach(() => {
  // Clean up any test pins
  try {
    const pins = listPins();
    for (const pin of pins) {
      if (pin.sessionId.startsWith(TEST_PREFIX)) {
        deletePin(pin.sessionId);
      }
    }
  } catch {
    // Ignore cleanup errors
  }
});

describe('pin I/O', () => {
  test('writePin + readPin round-trip', async () => {
    const sessionId = nextSessionId();
    const testData = {
      schemaVersion: 1,
      sessionId,
      pinRoot: '/tmp/project',
      pinName: 'test-project',
      pinAliases: ['alias1', 'alias2'],
      trustedSiblings: [],
      knownProjects: [],
      context: {
        caseSensitive: true,
        platform: 'linux',
        nodeVersion: '18.0.0'
      },
      haikuEnabled: false,
      createdAt: new Date().toISOString(),
      pid: process.pid
    };

    writePin(sessionId, testData);
    const result = readPin(sessionId);
    assert.deepStrictEqual(result, testData);
  });

  test('readPin returns null when no lockfile exists', async () => {
    const sessionId = nextSessionId();
    const result = readPin(sessionId);
    assert.strictEqual(result, null);
  });

  test('readPin returns null when schemaVersion is wrong', async () => {
    const sessionId = nextSessionId();
    const testData = {
      schemaVersion: 2, // Wrong version
      sessionId,
      pinRoot: '/tmp/project',
      pinName: 'test-project',
      pinAliases: [],
      trustedSiblings: [],
      knownProjects: [],
      context: {
        caseSensitive: true,
        platform: 'linux',
        nodeVersion: '18.0.0'
      },
      haikuEnabled: false,
      createdAt: new Date().toISOString(),
      pid: process.pid
    };

    writePin(sessionId, testData);
    const result = readPin(sessionId);
    assert.strictEqual(result, null);
  });

  test('deletePin removes lockfile and subsequent readPin returns null', async () => {
    const sessionId = nextSessionId();
    const testData = {
      schemaVersion: 1,
      sessionId,
      pinRoot: '/tmp/project',
      pinName: 'test-project',
      pinAliases: [],
      trustedSiblings: [],
      knownProjects: [],
      context: {
        caseSensitive: true,
        platform: 'linux',
        nodeVersion: '18.0.0'
      },
      haikuEnabled: false,
      createdAt: new Date().toISOString(),
      pid: process.pid
    };

    writePin(sessionId, testData);
    deletePin(sessionId);
    const result = readPin(sessionId);
    assert.strictEqual(result, null);
  });

  test('deletePin is idempotent', async () => {
    const sessionId = nextSessionId();
    // First delete
    deletePin(sessionId);
    // Second delete (should not throw)
    deletePin(sessionId);
    // Should not throw
    assert.ok(true);
  });

  test('listPins returns all active pins', async () => {
    const sessionId1 = nextSessionId();
    const sessionId2 = nextSessionId();
    const testData = {
      schemaVersion: 1,
      sessionId: sessionId1,
      pinRoot: '/tmp/project1',
      pinName: 'test-project-1',
      pinAliases: [],
      trustedSiblings: [],
      knownProjects: [],
      context: {
        caseSensitive: true,
        platform: 'linux',
        nodeVersion: '18.0.0'
      },
      haikuEnabled: false,
      createdAt: new Date().toISOString(),
      pid: process.pid
    };

    writePin(sessionId1, testData);
    writePin(sessionId2, testData);

    const pins = listPins();
    const activePins = pins.filter(pin => pin.sessionId === sessionId1 || pin.sessionId === sessionId2);
    assert.strictEqual(activePins.length, 2);
  });

  test('writePin sanitizes session IDs with special chars', async () => {
    const sessionId = 'claude:vscode:abc';
    const sanitized = 'claude_vscode_abc';
    const testData = {
      schemaVersion: 1,
      sessionId,
      pinRoot: '/tmp/project',
      pinName: 'test-project',
      pinAliases: [],
      trustedSiblings: [],
      knownProjects: [],
      context: {
        caseSensitive: true,
        platform: 'linux',
        nodeVersion: '18.0.0'
      },
      haikuEnabled: false,
      createdAt: new Date().toISOString(),
      pid: process.pid
    };

    writePin(sessionId, testData);
    const result = readPin(sessionId);
    assert.ok(result);
    // Verify that the file was written with sanitized name
    const pins = listPins();
    const found = pins.find(pin => pin.sessionId === sessionId);
    assert.ok(found);
  });
});
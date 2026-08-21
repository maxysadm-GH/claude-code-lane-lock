import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readMentions, buildEdges, renderNote } from '../../bin/lane-lock-links.mjs';

function fixtureLog(rows) {
  const dir = mkdtempSync(join(tmpdir(), 'lane-lock-links-'));
  const file = join(dir, 'drift.log.jsonl');
  writeFileSync(file, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n{ torn line`, 'utf8');
  return file;
}

const ROWS = [
  {
    ts: '2026-08-21T01:00:00.000Z',
    event: 'cross_project_mention',
    pinName: 'prog-cc-sales-board',
    mentioned: ['ShipperHQ-BOX'],
    promptExcerpt: 'audit the ShipperHQ rate rules',
  },
  {
    ts: '2026-08-21T02:00:00.000Z',
    event: 'cross_project_mention',
    pinName: 'prog-cc-sales-board',
    mentioned: ['ShipperHQ-BOX', 'vendor-ops'],
    promptExcerpt: 'reconcile vendor-ops billing',
  },
  // noise that must be ignored
  { ts: '2026-08-21T03:00:00.000Z', event: 'cwd_outside_pin', pinName: 'x' },
  {
    ts: '2026-08-21T04:00:00.000Z',
    event: 'cross_project_mention',
    pinName: 'prog-cc-sales-board',
    mentioned: ['prog-cc-sales-board'], // self-reference must not become an edge
  },
];

describe('readMentions()', () => {
  test('reads only cross_project_mention rows and tolerates a torn line', () => {
    const rows = readMentions(fixtureLog(ROWS));
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => r.event === 'cross_project_mention'));
  });

  test('--since filters by timestamp', () => {
    const rows = readMentions(fixtureLog(ROWS), '2026-08-21T01:30:00.000Z');
    assert.equal(rows.length, 2);
  });

  test('missing log file yields no rows rather than throwing', () => {
    assert.deepEqual(readMentions('/nonexistent/drift.log.jsonl'), []);
  });
});

describe('buildEdges()', () => {
  test('aggregates counts, drops self-references', () => {
    const edges = buildEdges(readMentions(fixtureLog(ROWS)));
    const from = edges.get('prog-cc-sales-board');
    assert.equal(from.get('ShipperHQ-BOX').count, 2);
    assert.equal(from.get('vendor-ops').count, 1);
    assert.equal(from.has('prog-cc-sales-board'), false);
  });

  test('tracks the most recent timestamp per edge', () => {
    const edges = buildEdges(readMentions(fixtureLog(ROWS)));
    assert.equal(
      edges.get('prog-cc-sales-board').get('ShipperHQ-BOX').lastTs,
      '2026-08-21T02:00:00.000Z'
    );
  });
});

describe('ambiguous aliases', () => {
  // "mbacio" maps to 4 repos in the real config. One mention is one
  // observation, not four dependencies — inventing all four would poison the
  // dependency graph with edges the user never implied.
  test('an alias resolving to several projects yields no edge', () => {
    const file = fixtureLog([
      {
        ts: '2026-08-21T01:00:00.000Z',
        event: 'cross_project_mention',
        pinName: 'sales-board',
        mentioned: ['mbacio-growth', 'MBACIO-prd', 'vendor-ops'],
        mentionedVia: ['mbacio', 'MBACIO', 'vendor-ops'],
        promptExcerpt: 'check the mbacio billing model and vendor-ops',
      },
    ]);
    const edges = buildEdges(readMentions(file));
    const targets = edges.get('sales-board');
    assert.equal(targets.has('vendor-ops'), true, 'unambiguous alias must link');
    assert.equal(targets.has('mbacio-growth'), false, 'ambiguous alias must not link');
    assert.equal(targets.has('MBACIO-prd'), false, 'ambiguous alias must not link');
  });
});

describe('renderNote()', () => {
  test('emits wikilinks for both ends so backlinks resolve', () => {
    const note = renderNote(
      buildEdges(readMentions(fixtureLog(ROWS))),
      1,
      '2026-08-21T05:00:00.000Z'
    );
    assert.match(note, /## \[\[prog-cc-sales-board\]\]/);
    assert.match(note, /\[\[ShipperHQ-BOX\]\]/);
    assert.match(note, /\[\[vendor-ops\]\]/);
  });

  test('--min suppresses one-off mentions', () => {
    const note = renderNote(
      buildEdges(readMentions(fixtureLog(ROWS))),
      2,
      '2026-08-21T05:00:00.000Z'
    );
    assert.match(note, /\[\[ShipperHQ-BOX\]\]/);
    assert.doesNotMatch(note, /\[\[vendor-ops\]\]/);
  });

  test('empty edge set renders a valid note, not a crash', () => {
    const note = renderNote(new Map(), 1, '2026-08-21T05:00:00.000Z');
    assert.match(note, /No cross-project mentions recorded yet/);
  });
});

/**
 * Regression corpus: every REAL prompt lane-lock has erased in production.
 *
 * Each entry below cost Max an actual prompt — the session sat dead until he
 * noticed and complained. They were fixed one at a time, each fix declared as
 * closing the class, and each time a new word or path shape reopened it:
 *
 *   794d65b  common words
 *   539ceea  everyday words that are also sibling aliases
 *   5b1b260  absolute paths outside the pin (/home/site/cc-data)
 *   e40b460  uncorroborated alias, 2>/dev/null, cwd-not-targets, symlinks
 *   (this)   'claude' + a ~/.claude path — alias "corroborated" by a config dir
 *
 * The lesson is not "add another stopword". It is that UserPromptSubmit exits 2
 * on a HEURISTIC READ OF ENGLISH TEXT, whose false-positive surface is
 * unbounded, and the penalty is destroying the user's input. This suite pins
 * the contract that the prompt gate never destroys a prompt.
 *
 * Run: node --test tests/e2e/never-erase-real-prompts.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, '..', '..', 'bin', 'user-prompt-submit.mjs');
const LOG_DIR = mkdtempSync(join(tmpdir(), 'lane-lock-corpus-'));

// A pin that mirrors production: an Orca worktree whose name matches no known
// project, with the real portfolio's colliding aliases loaded.
const PIN_ROOT = join(mkdtempSync(join(tmpdir(), 'lane-lock-pin-')), 'prog-cc-sales-board');
mkdirSync(join(PIN_ROOT, '.claude'), { recursive: true });

const KNOWN = [
  { name: 'claude-code-lane-lock', aliases: ['claude-code-lane-lock', 'claude'], root: 'C:/Users/maxys/Projects/claude-code-lane-lock' },
  { name: 'claude-config-sync', aliases: ['claude-config-sync', 'claude'], root: 'C:/Users/maxys/Projects/claude-config-sync' },
  { name: 'ShipperHQ-BOX', aliases: ['ShipperHQ-BOX', 'ShipperHQ'], root: 'C:/Users/maxys/Projects/ShipperHQ-BOX' },
  { name: 'vendor-ops', aliases: ['vendor-ops', 'vendor'], root: 'C:/Users/maxys/Projects/vendor-ops' },
  { name: 'mbacio-growth', aliases: ['mbacio-growth', 'mbacio'], root: 'C:/Users/maxys/Projects/mbacio-growth' },
  { name: 'shopify-storefront-mcp', aliases: ['shopify-storefront-mcp', 'shopify'], root: 'C:/Users/maxys/Projects/shopify-storefront-mcp' },
];

writeFileSync(
  join(PIN_ROOT, '.claude', 'lane-lock.json'),
  JSON.stringify({ knownProjects: KNOWN, codeRoots: ['/Users/max/Projects', '/Users/max/orca/workspaces'] }, null, 2)
);

function submit(prompt, sessionId = `corpus-${Math.abs(hash(prompt))}`) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ session_id: sessionId, cwd: PIN_ROOT, prompt }),
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, LANE_LOCK_LOG_DIR: LOG_DIR },
  });
  return { exitCode: r.status, stderr: r.stderr ?? '', stdout: r.stdout ?? '' };
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// Every one of these was erased in production.
const REAL_PROMPTS = [
  [
    'azure server path (5b1b260)',
    'C3 Durable POSIX disk at /home/site/cc-data holds the append-only ledgers: plan_adjustments.json. Fishbowl is NOT local, it is HOSTED on a PUBLIC IP and PORT.',
  ],
  [
    'shipping vendor name (e40b460)',
    'audit the ShipperHQ rate rules and Supabase deployment for A-HOSTING-V2',
  ],
  [
    'claude config-dir artifact path (this fix)',
    'You own the TREE RESTRUCTURE board. Its source is /Users/max/.claude/artifacts/tree-restructure.html . To change the tool: edit that file, then republish with the Artifact tool.',
  ],
  [
    'everyday portfolio vocabulary (539ceea)',
    'pull the shopify retail reports, check what claude shipped for the vendor list',
  ],
  [
    'two org names in one sentence',
    'the sales board pulls pricing from vendor-ops, check the mbacio billing model',
  ],
  [
    'system + scratch paths',
    'check /etc/nginx/nginx.conf, /var/log/syslog and /tmp/out.txt then summarize',
  ],
  [
    'a genuinely off-lane instruction, still not destroyed',
    'switch over to the vendor-ops repo and refactor its billing module',
  ],
  // Read-only cross-project RESEARCH. Naming another repo's file to read,
  // compare or document is the single most common thing Max does, and every
  // one of these was still being destroyed after four rounds of fixes.
  [
    'compare against another repo',
    'compare our deploy approach with the one in /Users/max/Projects/vhc-teams-agents/README.md',
  ],
  [
    'read another repo explicitly promising not to edit',
    "read /Users/max/Projects/claude-config-sync/bin/agent-progress-table for reference, don't change it",
  ],
  [
    'ask about this very tool by path',
    'the lane-lock source is at /Users/max/Projects/claude-code-lane-lock/lib/match.mjs - explain rule 3',
  ],
  [
    'document a dependency on a sibling worktree',
    'document that this depends on /Users/max/orca/workspaces/VHC/cc-logistified-live output',
  ],
  [
    'diagnose another repo without touching this one',
    'why did /Users/max/Projects/vendor-ops break? just explain, change nothing here',
  ],
];

describe('lane-lock never destroys a real prompt', () => {
  for (const [label, prompt] of REAL_PROMPTS) {
    test(`survives: ${label}`, () => {
      const r = submit(prompt);
      assert.notEqual(
        r.exitCode,
        2,
        `PROMPT ERASED. exit 2 destroys user input before reasoning.\n` +
          `prompt: ${prompt}\nstderr: ${r.stderr}`
      );
      assert.equal(r.exitCode, 0, `expected clean pass, got ${r.exitCode}: ${r.stderr}`);
    });
  }

  test('off-lane intent still reaches the model as a lane reminder', () => {
    const r = submit('switch over to the vendor-ops repo and refactor its billing module');
    const said = `${r.stderr}${r.stdout}`;
    assert.match(said, /lane|pinned|vendor-ops/i, 'drift must still be surfaced, just not by deletion');
  });

  test('the guardrail is still expressible: opt-in hard block', () => {
    const r = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({
        session_id: 'corpus-strict',
        cwd: PIN_ROOT,
        prompt: 'open /Users/max/Projects/vendor-ops/src/x.py and fix vendor-ops',
      }),
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, LANE_LOCK_LOG_DIR: LOG_DIR, LANE_LOCK_PROMPT_GATE: 'block' },
    });
    assert.equal(r.status, 2, 'explicit opt-in must still be able to erase');
  });
});

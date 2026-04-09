#!/usr/bin/env node
/**
 * lane-lock install / uninstall script.
 *
 * Atomically merges lane-lock's hooks into a Claude Code settings.json,
 * writes a timestamped backup first, validates the JSON round-trip,
 * and is fully idempotent + reversible.
 *
 * Usage:
 *   node bin/install.mjs [options]
 *
 * Options:
 *   --global               Install to ~/.claude/settings.json (user-wide)
 *   --project <path>       Install to <path>/.claude/settings.json (project-scoped, default: cwd)
 *   --target <file>        Install to a specific settings file (for testing)
 *   --dry-run              Show the merged settings without writing
 *   --uninstall            Remove lane-lock entries and restore backup
 *   --plugin-root <path>   Override CLAUDE_PLUGIN_ROOT (default: repo root detected from script path)
 *
 * Tagged entries:
 *   Every hook entry written by this script has `"__lane_lock": "v0.1.0"` so
 *   uninstall can identify and remove only our entries without touching the
 *   user's other hooks.
 *
 * Safety rules (per PITFALLS §5 — Anthropic #29217 settings corruption):
 *   1. Write to <target>.lane-lock.tmp, then rename (atomic on POSIX+Windows)
 *   2. Save a backup to <target>.bak.<ts> BEFORE any change
 *   3. Validate parsed JSON round-trip before writing
 *   4. Never touch fields we don't own
 *   5. Uninstall removes our tagged entries ONLY, keeps all others
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  copyFileSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const PLUGIN_VERSION = '0.1.0';

// ----- Hook set we want to register -----

function buildHookSet(pluginRoot) {
  const nodePath = process.execPath;
  const mkHook = (script, timeout = 5) => ({
    type: 'command',
    command: `"${nodePath}" "${pluginRoot.replaceAll('\\', '/')}/bin/${script}"`,
    timeout,
    __lane_lock: PLUGIN_VERSION,
  });

  return {
    SessionStart: [
      {
        hooks: [mkHook('session-start.mjs', 10)],
        __lane_lock: PLUGIN_VERSION,
      },
    ],
    UserPromptSubmit: [
      {
        hooks: [mkHook('user-prompt-submit.mjs', 5)],
        __lane_lock: PLUGIN_VERSION,
      },
    ],
    PreToolUse: [
      {
        matcher: 'Read|Grep|Glob',
        hooks: [mkHook('pre-tool-use-read.mjs', 5)],
        __lane_lock: PLUGIN_VERSION,
      },
      {
        matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash',
        hooks: [mkHook('pre-tool-use-write.mjs', 5)],
        __lane_lock: PLUGIN_VERSION,
      },
    ],
    CwdChanged: [
      {
        hooks: [mkHook('cwd-changed.mjs', 5)],
        __lane_lock: PLUGIN_VERSION,
      },
    ],
    SessionEnd: [
      {
        hooks: [mkHook('session-end.mjs', 5)],
        __lane_lock: PLUGIN_VERSION,
      },
    ],
    TaskCreated: [
      {
        hooks: [mkHook('task-created.mjs', 5)],
        __lane_lock: PLUGIN_VERSION,
      },
    ],
  };
}

// ----- Atomic file helpers -----

function loadSettings(path) {
  if (!existsSync(path)) {
    return { existed: false, settings: {}, raw: '' };
  }
  const raw = readFileSync(path, 'utf8');
  if (!raw.trim()) return { existed: true, settings: {}, raw };
  try {
    return { existed: true, settings: JSON.parse(raw), raw };
  } catch (err) {
    throw new Error(
      `Refusing to touch ${path}: file exists but is not valid JSON (${err.message}). ` +
        `Fix it manually first, or pass --target to a different file.`
    );
  }
}

function backupSettings(path) {
  if (!existsSync(path)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = `${path}.bak.${ts}`;
  copyFileSync(path, bak);
  return bak;
}

function atomicWrite(path, obj) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const body = JSON.stringify(obj, null, 2) + '\n';
  // Round-trip sanity check — parse our own output before writing.
  JSON.parse(body);
  const tmp = `${path}.lane-lock.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, body, { encoding: 'utf8', flag: 'w' });
  renameSync(tmp, path);
}

// ----- Merge / unmerge logic -----

function isLaneLockEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return entry.__lane_lock === PLUGIN_VERSION || entry.__lane_lock === true ||
    (typeof entry.__lane_lock === 'string' && entry.__lane_lock.startsWith('0.'));
}

function isLaneLockHook(hook) {
  return hook && typeof hook === 'object' &&
    (hook.__lane_lock === PLUGIN_VERSION || typeof hook.__lane_lock === 'string');
}

function mergeHooks(existingSettings, laneLockHooks) {
  const result = JSON.parse(JSON.stringify(existingSettings));
  if (!result.hooks) result.hooks = {};

  for (const eventName of Object.keys(laneLockHooks)) {
    const existingArr = Array.isArray(result.hooks[eventName]) ? result.hooks[eventName] : [];
    // Strip any prior lane-lock entries at the top level for this event.
    const withoutLaneLock = existingArr.filter((e) => !isLaneLockEntry(e));

    // Also, in case a non-tagged entry has a lane-lock hook inside it, strip that hook.
    for (const entry of withoutLaneLock) {
      if (entry && Array.isArray(entry.hooks)) {
        entry.hooks = entry.hooks.filter((h) => !isLaneLockHook(h));
      }
    }

    result.hooks[eventName] = [...withoutLaneLock, ...laneLockHooks[eventName]];
  }

  return result;
}

function removeLaneLockHooks(settings) {
  const result = JSON.parse(JSON.stringify(settings));
  if (!result.hooks) return result;

  for (const eventName of Object.keys(result.hooks)) {
    const arr = result.hooks[eventName];
    if (!Array.isArray(arr)) continue;
    const cleaned = arr.filter((e) => !isLaneLockEntry(e));
    for (const entry of cleaned) {
      if (entry && Array.isArray(entry.hooks)) {
        entry.hooks = entry.hooks.filter((h) => !isLaneLockHook(h));
      }
    }
    // Prune events that became empty.
    result.hooks[eventName] = cleaned.filter((e) =>
      !e || !Array.isArray(e.hooks) ? true : e.hooks.length > 0
    );
    if (result.hooks[eventName].length === 0) {
      delete result.hooks[eventName];
    }
  }
  if (Object.keys(result.hooks).length === 0) delete result.hooks;
  return result;
}

// ----- CLI -----

function parseArgs(argv) {
  const opts = { global: false, dryRun: false, uninstall: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--global') opts.global = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--uninstall') opts.uninstall = true;
    else if (a === '--project') opts.project = argv[++i];
    else if (a === '--target') opts.target = argv[++i];
    else if (a === '--plugin-root') opts.pluginRoot = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('--')) {
      process.stderr.write(`Unknown option: ${a}\n`);
      process.exit(2);
    }
  }
  return opts;
}

function showHelp() {
  process.stdout.write(
    `lane-lock install v${PLUGIN_VERSION}\n\n` +
      `Usage: node bin/install.mjs [options]\n\n` +
      `  --global               Install to ~/.claude/settings.json\n` +
      `  --project <path>       Install to <path>/.claude/settings.json\n` +
      `  --target <file>        Install to a specific settings file (for testing)\n` +
      `  --plugin-root <path>   Override plugin root (default: parent of this script)\n` +
      `  --dry-run              Print merged settings without writing\n` +
      `  --uninstall            Remove lane-lock entries + restore backup\n` +
      `  -h, --help             Show this help\n`
  );
}

function resolveTarget(opts) {
  if (opts.target) return resolve(opts.target);
  if (opts.global) return join(homedir(), '.claude', 'settings.json');
  const projectRoot = opts.project ? resolve(opts.project) : process.cwd();
  return join(projectRoot, '.claude', 'settings.json');
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) return showHelp();

  const target = resolveTarget(opts);
  const pluginRoot = opts.pluginRoot ? resolve(opts.pluginRoot) : REPO_ROOT;

  if (opts.uninstall) {
    if (!existsSync(target)) {
      process.stdout.write(`No settings file at ${target} — nothing to uninstall.\n`);
      return;
    }
    const { settings } = loadSettings(target);
    const cleaned = removeLaneLockHooks(settings);
    if (opts.dryRun) {
      process.stdout.write(JSON.stringify(cleaned, null, 2) + '\n');
      return;
    }
    const bak = backupSettings(target);
    atomicWrite(target, cleaned);
    process.stdout.write(`✓ Uninstalled lane-lock from ${target}\n`);
    if (bak) process.stdout.write(`  Backup: ${bak}\n`);
    return;
  }

  const { settings } = loadSettings(target);
  const laneLockHooks = buildHookSet(pluginRoot);
  const merged = mergeHooks(settings, laneLockHooks);

  if (opts.dryRun) {
    process.stdout.write(JSON.stringify(merged, null, 2) + '\n');
    return;
  }

  const bak = backupSettings(target);
  atomicWrite(target, merged);

  process.stdout.write(`✓ Installed lane-lock v${PLUGIN_VERSION} into ${target}\n`);
  process.stdout.write(`  Plugin root: ${pluginRoot}\n`);
  process.stdout.write(`  Hook events: SessionStart, UserPromptSubmit, PreToolUse(Read|Grep|Glob), PreToolUse(Edit|Write|Bash|...), CwdChanged, SessionEnd, TaskCreated\n`);
  if (bak) process.stdout.write(`  Backup: ${bak}\n`);
  process.stdout.write(`  To verify:  node bin/install.mjs --target "${target}" --dry-run\n`);
  process.stdout.write(`  To remove:  node bin/install.mjs --target "${target}" --uninstall\n`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`install: ${err.message}\n`);
  process.exit(1);
}

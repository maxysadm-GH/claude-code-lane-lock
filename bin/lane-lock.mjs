#!/usr/bin/env node
/**
 * lane-lock CLI dispatcher.
 *
 * Subcommands:
 *   install      — install hooks into settings.json (delegates to install.mjs)
 *   uninstall    — remove hooks
 *   status       — show current session pins, config, version
 *   sessions     — list all active session pins across the fleet
 *   doctor       — diagnose known Anthropic hook bugs + environment
 *   logs         — tail drift.log.jsonl with optional filters
 *   simulate     — dry-run a prompt through user-prompt-submit without Claude Code
 *   pin          — manually pin the current session to a specific project
 *   unpin        — remove a session pin
 *   version      — print version
 *   help         — show this help
 *
 * Usage:
 *   lane-lock <subcommand> [options]
 *
 * @origin bin/lane-lock.mjs — Claude Opus 4.6, 2026-04-08 Phase 6 swarm
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir, hostname, platform as osPlatform } from 'node:os';
import { fileURLToPath } from 'node:url';

import { resolveProjectRoot, normalize, caseCompare } from '../lib/paths.mjs';
import { listPins, readPin, writePin, deletePin, lockfileDir, reapStale } from '../lib/pin.mjs';
import { loadConfig, inferPinNameFromRoot } from '../lib/config.mjs';
import { match } from '../lib/match.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const VERSION = '0.1.0';

const LOG_FILE = join(homedir(), '.claude', 'lane-lock', 'drift.log.jsonl');

// ----- Subcommands -----

function cmdVersion() {
  process.stdout.write(`lane-lock v${VERSION}\n`);
}

function cmdHelp() {
  process.stdout.write(`lane-lock v${VERSION} — pin Claude Code sessions to their project root

Usage: lane-lock <subcommand> [options]

Subcommands:
  install [--global|--project <path>|--target <file>] [--dry-run]
  uninstall [--global|--project <path>|--target <file>]
  status                    Show pin, config, version for the current session
  sessions                  List all active lane-lock session pins
  doctor                    Diagnose known hook bugs + environment
  logs [--tail N] [--grep <pattern>] [--level warn|error]
  simulate "<prompt>" [--from <project>]
                            Dry-run a prompt through user-prompt-submit
  pin <project>             Manually pin current cwd as <project>
  unpin [<sessionId>]       Remove a session pin (default: current cwd)
  version
  help

Bypass:
  Prompt phrase: [cross-lane: <project>]
  Env var:       CLAUDE_ALLOW_CROSS_PROJECT=<project>

Config file (precedence: project > global > defaults):
  ~/.claude/lane-lock.json
  <project>/.claude/lane-lock.json

Docs: https://github.com/maxysadm-GH/claude-code-lane-lock
`);
}

function cmdStatus() {
  const cwd = process.cwd();
  const resolution = resolveProjectRoot(cwd);
  const config = loadConfig(resolution.root);
  const { name, aliases } = inferPinNameFromRoot(resolution.root, config);

  process.stdout.write(`lane-lock v${VERSION}\n\n`);
  process.stdout.write(`Host:            ${hostname()} (${osPlatform()})\n`);
  process.stdout.write(`CWD:             ${cwd}\n`);
  process.stdout.write(`Pin root:        ${resolution.root}${resolution.isFallback ? '  ⚠️  fallback (git not found)' : ''}\n`);
  process.stdout.write(`Pin name:        ${name}\n`);
  process.stdout.write(`Aliases:         ${aliases.join(', ') || '(none)'}\n`);
  process.stdout.write(`Worktree:        ${resolution.isWorktree ? 'yes' : 'no'}\n`);
  process.stdout.write(`Haiku enabled:   ${config.haikuEnabled ? 'yes' : 'no (default)'}\n`);
  process.stdout.write(`Known projects:  ${(config.knownProjects || []).map((p) => p.name).join(', ') || '(none in config)'}\n`);
  process.stdout.write(`Lockfile dir:    ${lockfileDir()}\n`);

  const pins = listPins();
  const mine = pins.filter((p) => p.pinRoot === resolution.root);
  process.stdout.write(`Active sessions on this pin: ${mine.length}\n`);
  for (const p of mine) {
    process.stdout.write(`  - ${p.sessionId.slice(0, 20)}  (${p.createdAt})\n`);
  }

  const cfgGlobal = join(homedir(), '.claude', 'lane-lock.json');
  const cfgProject = join(resolution.root, '.claude', 'lane-lock.json');
  process.stdout.write(`\nConfig files:\n`);
  process.stdout.write(`  global:  ${existsSync(cfgGlobal) ? '✓' : '-'} ${cfgGlobal}\n`);
  process.stdout.write(`  project: ${existsSync(cfgProject) ? '✓' : '-'} ${cfgProject}\n`);
}

function cmdSessions() {
  const reaped = reapStale();
  const pins = listPins();
  process.stdout.write(`lane-lock sessions (${pins.length} active, ${reaped.length} reaped stale)\n\n`);
  if (pins.length === 0) {
    process.stdout.write(`  (none)\n`);
    return;
  }
  for (const p of pins) {
    const age = Math.floor((Date.now() - new Date(p.createdAt).getTime()) / 60000);
    process.stdout.write(`  ${p.sessionId.slice(0, 16).padEnd(16)}  ${p.pinName.padEnd(20)}  ${age}m ago  ${p.pinRoot}\n`);
  }
}

function cmdDoctor() {
  process.stdout.write(`lane-lock doctor — diagnostics\n\n`);

  let warnings = 0;

  // 1. Version check
  const nodeMajor = parseInt(process.version.slice(1).split('.')[0], 10);
  if (nodeMajor < 20) {
    process.stdout.write(`  ❌ Node.js ${process.version} — requires >=20.11 (found ${process.version})\n`);
    warnings++;
  } else {
    process.stdout.write(`  ✓  Node.js ${process.version}\n`);
  }

  // 2. CWD vs git-toplevel (detects anthropics/claude-code#8810 subdirectory bug surface)
  const cwd = process.cwd();
  const resolution = resolveProjectRoot(cwd);
  if (resolution.isFallback) {
    process.stdout.write(`  ⚠️  git rev-parse failed in cwd — using cwd fallback. Hooks fall back to cwd, which is less reliable.\n`);
    warnings++;
  } else if (!caseCompare(normalize(cwd), normalize(resolution.root))) {
    process.stdout.write(`  ⚠️  You are in a subdirectory (${cwd}) of the project root (${resolution.root}).\n`);
    process.stdout.write(`       UserPromptSubmit hook has a known bug (anthropics/claude-code#8810, #10367) when Claude Code is started from a subdirectory.\n`);
    process.stdout.write(`       Workaround: start Claude Code from the project root, or accept that the pin will still resolve via git rev-parse at runtime.\n`);
    warnings++;
  } else {
    process.stdout.write(`  ✓  cwd is the project root (no subdirectory bug surface)\n`);
  }

  // 3. Worktree detection (anthropics/claude-code#27343)
  if (resolution.isWorktree) {
    process.stdout.write(`  ⚠️  Running inside a git worktree. CLAUDE_PROJECT_DIR is unreliable here (anthropics/claude-code#27343). lane-lock uses git rev-parse as the source of truth, which is correct.\n`);
  } else {
    process.stdout.write(`  ✓  Not in a worktree (or main worktree is the pin)\n`);
  }

  // 4. Claude Code settings.json hook registration
  const settingsCandidates = [
    join(resolution.root, '.claude', 'settings.json'),
    join(homedir(), '.claude', 'settings.json'),
  ];
  for (const s of settingsCandidates) {
    if (!existsSync(s)) {
      process.stdout.write(`  -  ${s} not present\n`);
      continue;
    }
    try {
      const settings = JSON.parse(readFileSync(s, 'utf8'));
      const hooks = settings?.hooks || {};
      const laneLockEntries = Object.values(hooks)
        .flat()
        .filter((e) => e && e.__lane_lock);
      if (laneLockEntries.length > 0) {
        process.stdout.write(`  ✓  ${s} — ${laneLockEntries.length} lane-lock hook entries registered\n`);
      } else {
        process.stdout.write(`  ⚠️  ${s} exists but has no lane-lock hooks. Run: lane-lock install --target "${s}"\n`);
        warnings++;
      }
    } catch (err) {
      process.stdout.write(`  ❌ ${s} — failed to parse: ${err.message}\n`);
      warnings++;
    }
  }

  // 5. Log file
  if (existsSync(LOG_FILE)) {
    const st = statSync(LOG_FILE);
    process.stdout.write(`  ✓  drift.log.jsonl — ${st.size} bytes, last modified ${st.mtime.toISOString()}\n`);
  } else {
    process.stdout.write(`  -  drift.log.jsonl not yet created (will be on first hook event)\n`);
  }

  // 6. Session lockfile dir
  const lfDir = lockfileDir();
  if (existsSync(lfDir)) {
    const n = readdirSync(lfDir).filter((f) => f.endsWith('.json')).length;
    process.stdout.write(`  ✓  session dir — ${n} active pin(s) at ${lfDir}\n`);
  } else {
    process.stdout.write(`  -  session dir not yet created: ${lfDir}\n`);
  }

  process.stdout.write(`\n`);
  if (warnings === 0) {
    process.stdout.write(`✓ All checks passed.\n`);
  } else {
    process.stdout.write(`⚠  ${warnings} warning(s). Review and remediate above.\n`);
  }
}

function cmdLogs(args) {
  const tail = parseInt(args.tail || '20', 10);
  const grep = args.grep;
  const level = args.level;

  if (!existsSync(LOG_FILE)) {
    process.stdout.write(`No log file yet at ${LOG_FILE}\n`);
    return;
  }
  const raw = readFileSync(LOG_FILE, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  let filtered = lines;
  if (level) filtered = filtered.filter((l) => l.includes(`"level":"${level}"`));
  if (grep) {
    const re = new RegExp(grep, 'i');
    filtered = filtered.filter((l) => re.test(l));
  }
  const slice = filtered.slice(-tail);
  for (const l of slice) {
    try {
      const o = JSON.parse(l);
      const levelTag = (o.level || 'info').toUpperCase().padEnd(5);
      process.stdout.write(`${o.ts}  ${levelTag}  ${o.source?.padEnd(22)}  ${o.event || ''}  ${o.target || ''}\n`);
    } catch {
      process.stdout.write(l + '\n');
    }
  }
}

function cmdSimulate(args) {
  const prompt = args._[0];
  if (!prompt) {
    process.stderr.write(`simulate: missing prompt arg\n`);
    process.exit(2);
  }
  const fromProject = args.from;
  const cwd = fromProject || process.cwd();
  const resolution = resolveProjectRoot(cwd);
  const config = loadConfig(resolution.root);
  const { name, aliases } = inferPinNameFromRoot(resolution.root, config);
  const pin = {
    root: resolution.root,
    name,
    aliases,
    trustedSiblings: config.trustedSiblings || [],
      codeRoots: config.codeRoots || [],
      promptGate: config.promptGate || 'warn',
  };
  const result = match(prompt, pin, config.knownProjects || []);
  process.stdout.write(`pin:       ${name} (${resolution.root})\n`);
  process.stdout.write(`decision:  ${result.decision}\n`);
  process.stdout.write(`reason:    ${result.reason}\n`);
  if (result.matchedTokens?.length) process.stdout.write(`tokens:    ${result.matchedTokens.join(', ')}\n`);
  if (result.matchedPaths?.length) process.stdout.write(`paths:     ${result.matchedPaths.join(', ')}\n`);
  process.stdout.write(`message:   ${result.message}\n`);
  if (result.decision === 'block') process.exit(2);
}

function cmdPin(args) {
  const projectName = args._[0];
  if (!projectName) {
    process.stderr.write(`pin: missing project name\n`);
    process.exit(2);
  }
  const cwd = process.cwd();
  const resolution = resolveProjectRoot(cwd);
  const config = loadConfig(resolution.root);
  const sessionId = `manual-${Date.now()}`;
  writePin(sessionId, {
    schemaVersion: 1,
    sessionId,
    pinRoot: resolution.root,
    pinName: projectName,
    pinAliases: [projectName],
    trustedSiblings: [],
    knownProjects: config.knownProjects || [],
    context: { caseSensitive: process.platform === 'linux', platform: process.platform, nodeVersion: process.version },
    haikuEnabled: false,
    createdAt: new Date().toISOString(),
    pid: process.pid,
  });
  process.stdout.write(`✓ manually pinned ${projectName} at ${resolution.root} (session ${sessionId})\n`);
}

function cmdUnpin(args) {
  const id = args._[0];
  if (id) {
    deletePin(id);
    process.stdout.write(`✓ removed pin for session ${id}\n`);
    return;
  }
  // Delete all manual pins
  const pins = listPins().filter((p) => p.sessionId.startsWith('manual-'));
  for (const p of pins) deletePin(p.sessionId);
  process.stdout.write(`✓ removed ${pins.length} manual pin(s)\n`);
}

function cmdInstall(rawArgs) {
  const installScript = join(REPO_ROOT, 'bin', 'install.mjs');
  const r = spawnSync(process.execPath, [installScript, ...rawArgs], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

function cmdUninstall(rawArgs) {
  const installScript = join(REPO_ROOT, 'bin', 'install.mjs');
  const r = spawnSync(process.execPath, [installScript, '--uninstall', ...rawArgs], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

// ----- Arg parser (tiny, no deps) -----

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

// ----- Dispatcher -----

function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  switch (sub) {
    case 'version':
    case '--version':
    case '-v':
      return cmdVersion();
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      return cmdHelp();
    case 'status':
      return cmdStatus();
    case 'sessions':
      return cmdSessions();
    case 'doctor':
      return cmdDoctor();
    case 'logs':
      return cmdLogs(args);
    case 'simulate':
      return cmdSimulate(args);
    case 'pin':
      return cmdPin(args);
    case 'unpin':
      return cmdUnpin(args);
    case 'install':
      return cmdInstall(rest);
    case 'uninstall':
      return cmdUninstall(rest);
    default:
      process.stderr.write(`unknown subcommand: ${sub}\n`);
      cmdHelp();
      process.exit(2);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`lane-lock: ${err?.stack || err?.message || err}\n`);
  process.exit(1);
}

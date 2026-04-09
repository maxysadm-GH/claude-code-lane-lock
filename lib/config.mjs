/**
 * Config loader — precedence merge across per-project + global + defaults.
 *
 * Precedence (highest wins):
 *   1. <pinRoot>/.claude/lane-lock.json  (project-scoped)
 *   2. ~/.claude/lane-lock.json          (global user)
 *   3. Built-in defaults below
 *
 * Config is read ONCE per SessionStart and snapshotted into the session
 * lockfile. Hooks on the hot path (UserPromptSubmit, PreToolUse) read from
 * the lockfile — NOT from these config files — so there is no per-prompt
 * disk I/O.
 *
 * @module lib/config
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

// 3 is the floor: enough to catch real short project names like "project-gamma", "web",
// "api"-specific acronyms. Users with ambiguous 3-char aliases should document
// their mitigation — `lane-lock doctor` will warn at load time.
// Below 3 would false-positive on too many English words ("of", "to", "in").
const MIN_ALIAS_LENGTH = 3;

/**
 * @typedef {object} LaneLockConfig
 * @property {Array<{name: string, aliases: string[], root?: string}>} knownProjects
 * @property {string[]} trustedSiblings
 * @property {string[]} overridePhrases
 * @property {boolean} haikuEnabled
 * @property {string} logLevel
 * @property {'read-warn-write-block' | 'strict'} mode
 */

const DEFAULTS = Object.freeze({
  knownProjects: [],
  trustedSiblings: [],
  overridePhrases: [],
  haikuEnabled: false,
  logLevel: 'info',
  mode: 'read-warn-write-block',
});

/**
 * Load config from project + global + defaults, merged by precedence.
 *
 * @param {string} pinRoot Absolute project root path
 * @returns {LaneLockConfig}
 */
export function loadConfig(pinRoot) {
  const global = tryLoad(join(homedir(), '.claude', 'lane-lock.json'));
  const project = pinRoot ? tryLoad(join(pinRoot, '.claude', 'lane-lock.json')) : null;

  const merged = {
    ...DEFAULTS,
    ...(global || {}),
    ...(project || {}),
  };

  // Validate + sanitize aliases (4-char minimum).
  merged.knownProjects = (merged.knownProjects || [])
    .filter((p) => p && typeof p.name === 'string')
    .map((p) => ({
      name: p.name,
      root: p.root,
      aliases: (p.aliases || [p.name]).filter(
        (a) => typeof a === 'string' && a.length >= MIN_ALIAS_LENGTH
      ),
    }))
    .filter((p) => p.aliases.length > 0);

  return merged;
}

/**
 * Try to read and parse a JSON file. Returns null on any failure.
 * @param {string} path
 */
function tryLoad(path) {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Infer the canonical project name + alias list for a given root.
 *
 * Strategy:
 * 1. If config has a knownProjects entry whose `root` matches pinRoot,
 *    use its name + aliases directly.
 * 2. Otherwise, derive the name from the basename of the root (with the
 *    basename itself as the only alias, filtered to 4+ chars).
 *
 * The returned pinName is the "canonical" form — the alias list always
 * includes the canonical name and any configured aliases.
 *
 * @param {string} pinRoot
 * @param {LaneLockConfig} config
 * @returns {{ name: string, aliases: string[] }}
 */
export function inferPinNameFromRoot(pinRoot, config) {
  // Prefer explicit config match.
  const matched = (config.knownProjects || []).find(
    (p) => p.root && normalizeForCompare(p.root) === normalizeForCompare(pinRoot)
  );
  if (matched) {
    const aliases = Array.from(new Set([matched.name, ...matched.aliases])).filter(
      (a) => a && a.length >= MIN_ALIAS_LENGTH
    );
    return { name: matched.name, aliases };
  }

  // Fallback: basename.
  const name = basename(pinRoot).toLowerCase();
  const aliases = name.length >= MIN_ALIAS_LENGTH ? [name] : [];
  return { name, aliases };
}

function normalizeForCompare(p) {
  let out = p.replaceAll('\\', '/');
  if (out.endsWith('/') && out.length > 1) out = out.slice(0, -1);
  return out.toLowerCase();
}

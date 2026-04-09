/**
 * Prompt matching — the regex engine that decides drift.
 *
 * This is the hot path. UserPromptSubmit runs on every prompt, so match()
 * must be <5ms P50 with no I/O.
 *
 * Matching rules (tuned against PITFALLS §3.1, §3.2):
 *
 * 1. **Word-boundary regex**: aliases match only on \b boundaries. Prevents
 *    "app" from matching "snapshot" or "mapping".
 *
 * 2. **Minimum alias length**: aliases shorter than 4 characters are refused
 *    at config-load time (not here — caller's responsibility). Common short
 *    words like "cli" or "api" would drown the matcher in false positives.
 *
 * 3. **Case-insensitive**: project names are user-facing; case is noise.
 *
 * 4. **Bypass phrase detection**: [cross-lane: <project>] anywhere in the
 *    prompt → allow through with a warning payload.
 *
 * 5. **Absolute-path extraction**: if the prompt mentions an absolute path
 *    outside the pinned root, that's drift even if no project name is mentioned.
 *
 * @module lib/match
 */

import { isInside } from './paths.mjs';

/**
 * @typedef {object} Pin
 * @property {string} root              Absolute pinned project root
 * @property {string} name              Canonical project name
 * @property {string[]} aliases         All aliases (including name) — 4+ chars
 * @property {string[]} [trustedSiblings] Aliases that are allowed to be mentioned (read-warn, not block)
 */

/**
 * @typedef {object} KnownProject
 * @property {string} name
 * @property {string[]} aliases
 * @property {string} [root]
 */

/**
 * @typedef {object} MatchResult
 * @property {'allow' | 'warn' | 'block'} decision
 * @property {'none' | 'bypass' | 'alias' | 'path' | 'unknown'} reason
 * @property {string[]} matchedTokens   Aliases that triggered the match
 * @property {string[]} matchedPaths    Absolute paths in the prompt that are outside the pin
 * @property {string} [bypassTarget]    When reason=bypass, the target project
 * @property {string} message           Human-readable explanation
 */

const BYPASS_REGEX = /\[cross-lane:\s*([a-z0-9_\-.]{2,40})\s*\]/i;

// Absolute paths: match POSIX (/foo/bar), Windows (C:\foo or C:/foo), and UNC (\\server\share).
// Conservative: must look path-shaped, not a URL or sentence fragment.
const ABS_PATH_REGEX =
  /(?:^|[\s"'`(])((?:[a-zA-Z]:[/\\]|\/|\\\\)[^\s"'`<>)]+)(?=[\s"'`)]|$)/g;

/**
 * Decide if a prompt should allow/warn/block relative to the session's pin.
 *
 * @param {string} prompt                Raw user prompt text
 * @param {Pin} pin                      The session's pinned project
 * @param {KnownProject[]} knownProjects All other projects the user has (from config)
 * @returns {MatchResult}
 */
export function match(prompt, pin, knownProjects = []) {
  if (typeof prompt !== 'string') {
    return {
      decision: 'allow',
      reason: 'none',
      matchedTokens: [],
      matchedPaths: [],
      message: 'Non-string prompt; allowing.',
    };
  }

  // Rule 1: bypass phrase — always wins, even if aliases match.
  const bypass = prompt.match(BYPASS_REGEX);
  if (bypass) {
    return {
      decision: 'warn',
      reason: 'bypass',
      matchedTokens: [],
      matchedPaths: [],
      bypassTarget: bypass[1].toLowerCase(),
      message: `Cross-lane bypass requested for '${bypass[1]}'. Allowing with warning.`,
    };
  }

  // Rule 2: alias mention detection. Look at OTHER projects' aliases. If the
  // prompt mentions a different project by name, that's drift intent.
  const pinAliasSet = new Set(pin.aliases.map((a) => a.toLowerCase()));
  const matchedTokens = [];
  const matchedProjects = new Set();

  for (const project of knownProjects) {
    if (project.name === pin.name) continue;
    for (const alias of project.aliases) {
      if (typeof alias !== 'string' || alias.length < 3) continue;
      if (pinAliasSet.has(alias.toLowerCase())) continue; // shared alias — ambiguous, skip

      // Word-boundary, case-insensitive regex. Escape the alias for regex.
      const pattern = new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i');
      if (pattern.test(prompt)) {
        matchedTokens.push(alias);
        matchedProjects.add(project.name);
      }
    }
  }

  // Rule 3: absolute path extraction. Any path mentioned in the prompt that
  // is NOT inside the pinned root is drift evidence.
  const matchedPaths = [];
  for (const m of prompt.matchAll(ABS_PATH_REGEX)) {
    const candidate = m[1];
    // Ignore paths that look like URLs or common noise.
    if (candidate.startsWith('//') && !candidate.startsWith('\\\\')) {
      // Likely a URL path fragment — skip.
      continue;
    }
    try {
      if (!isInside(candidate, pin.root)) {
        matchedPaths.push(candidate);
      }
    } catch {
      // Bad path shape; skip.
    }
  }

  // Decide.
  if (matchedTokens.length > 0) {
    const projects = Array.from(matchedProjects).join(', ');
    return {
      decision: 'block',
      reason: 'alias',
      matchedTokens,
      matchedPaths,
      message:
        `Prompt mentions other project(s): ${projects} — but this session is pinned to '${pin.name}'. ` +
        `Bypass: add [cross-lane: ${matchedProjects.values().next().value}] to the prompt, ` +
        `or set CLAUDE_ALLOW_CROSS_PROJECT=${matchedProjects.values().next().value} in the environment, ` +
        `or start a new Claude Code session from the target project directory.`,
    };
  }

  if (matchedPaths.length > 0) {
    return {
      decision: 'block',
      reason: 'path',
      matchedTokens,
      matchedPaths,
      message:
        `Prompt references path(s) outside the pinned project '${pin.name}':\n` +
        matchedPaths.map((p) => `  - ${p}`).join('\n') +
        `\nBypass: add [cross-lane: <project>] to the prompt, or open a new Claude Code session in the target directory.`,
    };
  }

  return {
    decision: 'allow',
    reason: 'none',
    matchedTokens: [],
    matchedPaths: [],
    message: `No drift detected. Prompt is consistent with pin '${pin.name}'.`,
  };
}

/**
 * Escape a string for use inside a RegExp.
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

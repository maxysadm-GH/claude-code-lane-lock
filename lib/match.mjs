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

import { dirname } from 'node:path';
import { isInside, normalize } from './paths.mjs';

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

// Common English / dev words that get tokenized out of branch and lane names
// (e.g. a branch "…-selflove-alias-r2" makes "alias" an alias). These are never
// a distinct project a user would "drift" to, so they must not trigger a block.
const ALIAS_STOPWORDS = new Set([
  'alias','aliases','sales','plan','plans','board','boards','spike','spikes',
  'review','reviews','audit','audits','deploy','staging','prod','production',
  'demo','demos','sync','main','build','builds','test','tests','docs','task',
  'tasks','goal','goals','next','node','live','runs','data','fixes','self','love',
  'core','base','loop','loops','round','rounds','wave','waves','lane','lanes',
  'repo','repos','tool','tools','site','page','pages','edit','edits','spec','specs',
  'pilot','draft','drafts','patch','patches','hook','hooks','gate','gates',
  // everyday words that are also sibling-project aliases in this portfolio
  'shopify','reports','report','ship','ships','shipping','shipped','claude',
  'ecom','ecommerce','easy','vendor','vendors','channel','channels','forecast',
  'inventory','finance','revenue','retail','order','orders','skus','sku',
]);

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
      if (typeof alias !== 'string' || alias.length < 4) continue;
      const aliasLc = alias.toLowerCase();
      if (ALIAS_STOPWORDS.has(aliasLc)) continue; // common word — never a drift signal
      if (pinAliasSet.has(aliasLc)) continue; // shared alias — ambiguous, skip

      // Word-boundary, case-insensitive regex. Escape the alias for regex.
      const pattern = new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i');
      if (pattern.test(prompt)) {
        matchedTokens.push(alias);
        matchedProjects.add(project.name);
      }
    }
  }

  // Rule 3: absolute path extraction. A path is drift evidence only when it
  // points at ANOTHER PROJECT — i.e. it lives inside a directory that actually
  // holds projects (see projectContainers). "Outside the pin" is NOT the same
  // as "another project": prompts legitimately name server paths
  // (/home/site/cc-data on Azure App Service), system paths (/etc, /var, /usr)
  // and scratch paths (/tmp). Blocking those erased real prompts before any
  // reasoning ran — regression fixed 2026-08-20.
  const containers = projectContainers(pin, knownProjects);
  const matchedPaths = [];
  for (const m of prompt.matchAll(ABS_PATH_REGEX)) {
    const candidate = m[1];
    // Ignore paths that look like URLs or common noise.
    if (candidate.startsWith('//') && !candidate.startsWith('\\\\')) {
      // Likely a URL path fragment — skip.
      continue;
    }
    try {
      if (isInside(candidate, pin.root)) continue; // inside the lane — fine
      if ((pin.trustedSiblings || []).some((sib) => isInside(candidate, sib))) continue;
      if (containers.some((dir) => isInside(candidate, dir))) {
        matchedPaths.push(candidate);
      }
    } catch {
      // Bad path shape; skip.
    }
  }

  // Decide.
  //
  // An alias mention on its own is WEAK evidence: project names collide with
  // vendors, products and everyday nouns a prompt legitimately discusses
  // ("audit the ShipperHQ rate rules" named the shipping vendor, not the repo,
  // and was erased at exit 2 — regression fixed 2026-08-20). Maintaining a
  // stopword list against that is unwinnable, so an uncorroborated alias only
  // warns. The path rule below is the strong signal; when a path inside the
  // named project is ALSO present, intent is unambiguous and we block.
  if (matchedTokens.length > 0) {
    const projects = Array.from(matchedProjects).join(', ');
    const corroborated = matchedPaths.length > 0;
    if (!corroborated) {
      return {
        decision: 'warn',
        reason: 'alias',
        matchedTokens,
        matchedPaths,
        message:
          `Prompt mentions other project(s): ${projects}, but names no path inside them. ` +
          `Staying in lane '${pin.name}'. If you meant to work there, open a session in that project ` +
          `or add [cross-lane: ${matchedProjects.values().next().value}].`,
      };
    }
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
 * Directories that actually contain projects. A path only counts as
 * cross-project drift when it sits inside one of these.
 *
 * Sources, in order:
 *   1. the parent of the pinned root (catches sibling worktrees/repos even
 *      when knownProjects is empty),
 *   1b. every dir in config `codeRoots` — required when knownProjects roots
 *      were generated on another machine (e.g. stale Windows C:/ paths) and
 *      therefore contain nothing on this platform,
 *   2. the parent of every configured knownProject root,
 *   3. every knownProject root itself (for a project nested deeper).
 *
 * Anything else — /home/site/... on an Azure App Service, /var, /etc, /tmp,
 * /usr, a remote box's filesystem — is not a project and must never block.
 *
 * @param {Pin} pin
 * @param {KnownProject[]} knownProjects
 * @returns {string[]} absolute container directories
 */
function projectContainers(pin, knownProjects = []) {
  const out = new Set();
  const addParent = (root) => {
    if (typeof root !== 'string' || !root) return;
    const parent = dirname(normalize(root));
    // Guard: '/' as a container would make every absolute path drift.
    if (parent && parent !== '/' && parent !== '.' && !/^[a-zA-Z]:[/\\]?$/.test(parent)) {
      out.add(parent);
    }
  };

  addParent(pin.root);
  for (const dir of pin.codeRoots || []) {
    if (typeof dir === 'string' && dir.length > 1) out.add(normalize(dir));
  }
  for (const project of knownProjects) {
    if (!project || typeof project.root !== 'string' || !project.root) continue;
    addParent(project.root);
    out.add(normalize(project.root));
  }
  return Array.from(out);
}

/**
 * Escape a string for use inside a RegExp.
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

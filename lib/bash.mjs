/**
 * Bash command classification for the write gate.
 *
 * Extracted from bin/pre-tool-use-write.mjs on 2026-08-20 so the two rules
 * below are unit-testable. Both existed as inline heuristics and both were
 * wrong in ways that blocked legitimate, in-lane work.
 *
 * @module lib/bash
 */

import { isInside } from './paths.mjs';

// Redirections that do NOT write to the workspace: stderr silencing, fd
// duplication, and /dev/null sinks. These must be stripped BEFORE the
// write-detection regex runs, otherwise `grep -rn foo 2>/dev/null` is
// classified as a write and blocked — which is what happened to read-only
// grep/find/wc commands in the drift log.
const BENIGN_REDIRECT = /(?:\d*>{1,2}\s*&\s*\d+|&>{1,2}\s*\/dev\/null|\d*>{1,2}\s*\/dev\/null)/g;

// Commands and redirections that mutate the filesystem.
const BASH_WRITE_PATTERN =
  /(^|\s|;|&&|\|\|)\s*(?:rm|mv|cp|mkdir|touch|dd|install|tee|sed\s+-i|chmod|chown|git\s+(?:commit|reset|checkout|rebase|clean|push|merge|pull|rm|add)|npm\s+install|pip\s+install|cargo\s+install|go\s+install)\b|[>]{1,2}\s*[/\w]/i;

// Absolute paths appearing as command arguments.
const ABS_ARG = /(?:^|[\s"'`=(])((?:[a-zA-Z]:[/\\]|\/)[^\s"'`<>)|;&]+)/g;

// A leading `cd <dir>` that sets the command's effective working directory.
const LEADING_CD = /(?:^|[;&|]\s*)cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/;

/**
 * Does this command write to the filesystem?
 * @param {string} command
 * @returns {boolean}
 */
export function isBashWrite(command) {
  if (typeof command !== 'string' || !command) return false;
  return BASH_WRITE_PATTERN.test(command.replace(BENIGN_REDIRECT, ' '));
}

/**
 * Does this command actually operate inside the pinned project?
 *
 * The old gate judged only the shell's cwd. That blocked commands whose targets
 * were plainly inside the lane — a leading `cd <pin>`, or an absolute path
 * under the pin — merely because the shell sat in /private/tmp/cc-reports.
 *
 * @param {string} command
 * @param {string} pinRoot
 * @returns {boolean} true when the command cd's into the pin, or every absolute
 *                    path it names lives inside the pin
 */
export function commandTargetsPin(command, pinRoot) {
  if (typeof command !== 'string' || !command || !pinRoot) return false;

  const cd = command.match(LEADING_CD);
  if (cd) {
    const dir = cd[1] || cd[2] || cd[3];
    try {
      if (dir && isInside(dir, pinRoot)) return true;
    } catch {
      /* unparseable cd target — fall through */
    }
  }

  const paths = [];
  for (const m of command.matchAll(ABS_ARG)) paths.push(m[1]);
  if (paths.length === 0) return false;

  return paths.every((p) => {
    try {
      return isInside(p, pinRoot);
    } catch {
      return false;
    }
  });
}

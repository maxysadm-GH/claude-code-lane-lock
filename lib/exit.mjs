/**
 * Exit-code discipline helpers for hook handlers.
 *
 * CRITICAL correctness rules enforced by this module:
 *
 * | Hook event            | Block mechanism                                  | Exit code |
 * |-----------------------|--------------------------------------------------|-----------|
 * | UserPromptSubmit      | stderr message + exit 2                          | 2         |
 * | PreToolUse             | stdout JSON {permissionDecision: "deny"} + exit 0| 0         |
 * | SessionStart/Context  | stdout JSON {additionalContext} + exit 0         | 0         |
 * | Any "allow" case      | exit 0 silently                                  | 0         |
 *
 * Why PreToolUse uses exit 0 + stdout JSON instead of exit 2:
 * Anthropic issue #24327 — exit 2 on PreToolUse causes Claude to freeze
 * instead of acknowledge the block. The structured `permissionDecision: deny`
 * via stdout + exit 0 is the reliable path and overrides
 * --dangerously-skip-permissions.
 *
 * Why UserPromptSubmit uses exit 2 + stderr instead of stdout JSON:
 * Anthropic issue #13912 — stdout on UserPromptSubmit is silently dropped.
 * Only exit 2 + stderr reliably erases the prompt from context before
 * any reasoning token fires. This is THE kill mechanism of the plugin.
 *
 * Every exported function calls process.exit and never returns.
 *
 * @module lib/exit
 */

/**
 * Block a drift prompt. Erases from Claude's context, prevents reasoning.
 * @param {string} message Human-readable stderr explanation
 * @returns {never}
 */
export function userPromptSubmitBlock(message) {
  process.stderr.write(String(message).endsWith('\n') ? String(message) : String(message) + '\n');
  process.exit(2);
}

/**
 * Deny a tool call (Edit/Write/Bash/etc.) via permissionDecision.
 * Overrides --dangerously-skip-permissions.
 * @param {string} reason
 * @param {string} [suggestion]
 * @returns {never}
 */
export function preToolUseDeny(reason, suggestion) {
  const decisionReason = suggestion ? `${reason}\n${suggestion}` : String(reason);
  const payload = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: decisionReason,
    },
  };
  process.stdout.write(JSON.stringify(payload) + '\n');
  process.exit(0);
}

/**
 * Allow the current operation AND inject context into Claude's window.
 * Used by SessionStart (lane marker) and read-tier PreToolUse (cross-project warning).
 * @param {string} message Context text to inject
 * @returns {never}
 */
export function allowWithContext(message) {
  const payload = {
    continue: true,
    additionalContext: String(message),
  };
  process.stdout.write(JSON.stringify(payload) + '\n');
  process.exit(0);
}

/**
 * Silent allow — no output, just exit 0. Used when nothing to say.
 * @returns {never}
 */
export function allowSilently() {
  process.exit(0);
}

/**
 * Log to stderr (visible in Claude's tool-output), then allow. Used for
 * advisory warnings (e.g., bypass phrase detected, stale pin recovered).
 * @param {string} message
 * @returns {never}
 */
export function allowWithWarning(message) {
  process.stderr.write(`[lane-lock] ${message}\n`);
  process.exit(0);
}

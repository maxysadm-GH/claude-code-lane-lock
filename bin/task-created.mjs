#!/usr/bin/env node
/**
 * TaskCreated hook — forward-compat no-op gate for Anthropic Agent Teams.
 *
 * When Agent Teams exits experimental, this is the hook where the team lead
 * could dispatch a cross-project task. Currently a no-op — we log the event
 * but allow through. Future versions will check the task's target root
 * against the lead's pin and deny cross-project tasks.
 */

import { readStdinJson } from '../lib/stdin.mjs';
import { allowSilently } from '../lib/exit.mjs';
import { log } from '../lib/log.mjs';

async function main() {
  const input = await readStdinJson();
  log({
    level: 'info',
    source: 'task-created',
    sessionId: input.session_id || input.sessionId || 'unknown',
    event: 'agent_teams_task_passthrough',
    taskId: input.task_id || input.taskId,
  });
  return allowSilently();
}

main().catch(() => process.exit(0));

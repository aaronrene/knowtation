#!/usr/bin/env node
/**
 * Operator / pre-flight gate for hosted MCP changes.
 * Runs fast in-repo guards, then prints production verification steps.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function run(label, command, args) {
  console.log(`\n→ ${label}`);
  const r = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

run('Hosted MCP schema guard (hub/gateway/mcp-hosted*.mjs)', 'npm', ['run', 'check:mcp-hosted-schema']);
run('Hosted MCP tools/list regression', 'node', ['--test', 'test/mcp-hosted-tools-list.test.mjs']);
run('Hosted MCP prompts/list + getPrompt regression', 'node', ['--test', 'test/mcp-hosted-prompts.test.mjs']);
run('Hosted MCP resources R1–R3 regression', 'node', [
  '--test',
  'test/mcp-hosted-resources-r1.test.mjs',
  'test/mcp-hosted-resources-r3.test.mjs',
]);

console.log(`
--- Mandatory production gate (after EC2 deploy) ---
1. On server: git pull in /opt/knowtation (or your deploy root), then:
   pm2 restart knowtation-gateway --update-env
2. In Cursor (knowtation-hosted): OAuth green; confirm tool count matches role
   (admin: seventeen tools — see test/mcp-hosted-tools-list.test.mjs TOOLS_ADMIN; includes capture, transcribe, tag_suggest, cluster, backlinks, extract_tasks, relate).
   Confirm prompts/list: twelve prompts for viewer, thirteen for editor/admin (see test/mcp-hosted-prompts.test.mjs PROMPTS_VIEWER / PROMPTS_ALL).
3. Read resource vault-info: userId, vaultId, role match the signed-in workspace.
4. If MCP log shows red / "Server not initialized" briefly after restart: Logout → Connect
   or retry once initialize completes (see docs/NEXT-SESSION-HOSTED-MCP.md).

Full handoff: docs/NEXT-SESSION-HOSTED-MCP.md
Expansion playbook: docs/HOSTED-MCP-TOOL-EXPANSION.md
`);

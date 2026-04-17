/**
 * Regression guard: hosted MCP tools/list must succeed for every role.
 * A single bad Zod → JSON Schema export (e.g. z.record(z.unknown())) fails the entire list.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHostedMcpServer } from '../hub/gateway/mcp-hosted-server.mjs';

const CANISTER_URL = 'http://canister.test:4322';
const BRIDGE_URL = 'http://bridge.test:4321';

/** Golden sets: update when adding/removing tools in mcp-hosted-server.mjs */
const TOOLS_VIEWER = ['enrich', 'get_note', 'list_notes', 'search', 'summarize'];
const TOOLS_EDITOR = ['enrich', 'get_note', 'list_notes', 'search', 'summarize', 'vault_sync', 'write'];
const TOOLS_ADMIN = ['enrich', 'export', 'get_note', 'import', 'index', 'list_notes', 'search', 'summarize', 'vault_sync', 'write'];

function sortNames(names) {
  return [...names].sort();
}

async function listToolNamesForRole(role) {
  const mcpServer = createHostedMcpServer({
    userId: 'u-test',
    vaultId: 'v-test',
    role,
    token: 'tok-test',
    canisterUrl: CANISTER_URL,
    bridgeUrl: BRIDGE_URL,
  });
  const client = new Client({ name: 'tools-list-test', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    assert.ok(Array.isArray(tools), 'tools/list must return an array');
    assert.ok(tools.length > 0, `${role}: at least one tool must be listed`);
    for (const t of tools) {
      assert.ok(t.name, 'each tool has a name');
      assert.ok(
        t.inputSchema != null && typeof t.inputSchema === 'object',
        `tool ${t.name} must have inputSchema object (tools/list serialization)`
      );
    }
    return tools.map((t) => t.name);
  } finally {
    try {
      await client.close();
    } catch (_) {}
  }
}

describe('hosted MCP tools/list (JSON Schema export)', () => {
  it('viewer role lists expected tools without throw', async () => {
    const names = sortNames(await listToolNamesForRole('viewer'));
    assert.deepEqual(names, TOOLS_VIEWER);
  });

  it('editor role lists expected tools without throw', async () => {
    const names = sortNames(await listToolNamesForRole('editor'));
    assert.deepEqual(names, TOOLS_EDITOR);
  });

  it('admin role lists expected tools without throw', async () => {
    const names = sortNames(await listToolNamesForRole('admin'));
    assert.deepEqual(names, TOOLS_ADMIN);
  });
});

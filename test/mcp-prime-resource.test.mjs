/**
 * MCP bootstrap resource knowtation://prime (self-hosted) and knowtation://hosted/prime (hosted).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureVault = path.join(__dirname, 'fixtures', 'vault-fs');
process.env.KNOWTATION_VAULT_PATH = fixtureVault;

const { createKnowtationMcpServer } = await import('../mcp/create-server.mjs');
const { createHostedMcpServer } = await import('../hub/gateway/mcp-hosted-server.mjs');

const CANISTER_URL = 'http://canister.prime.test:4322';
const BRIDGE_URL = 'http://bridge.prime.test:4321';

describe('MCP prime resource', () => {
  it('self-hosted readResource knowtation://prime returns schema and token_layers', async () => {
    process.env.KNOWTATION_VAULT_PATH = fixtureVault;
    const mcpServer = createKnowtationMcpServer();
    const client = new Client({ name: 'prime-local', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const read = await client.readResource({ uri: 'knowtation://prime' });
      assert.equal(read.contents.length, 1);
      assert.equal(read.contents[0].mimeType, 'application/json');
      const j = JSON.parse(read.contents[0].text);
      assert.equal(j.schema, 'knowtation.prime/v1');
      assert.equal(j.surface, 'self-hosted');
      assert.equal(j.prime_uri, 'knowtation://prime');
      assert.ok(j.config && typeof j.config === 'object');
      assert.ok(Array.isArray(j.suggested_next_resources));
      assert.ok(j.token_layers?.vault_retrieval);
      assert.ok(j.token_layers?.terminal_tooling);
    } finally {
      await client.close();
    }
  });

  it('hosted readResource knowtation://hosted/prime lists prompts for role', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
    });
    const mcpServer = createHostedMcpServer({
      userId: 'actor-1',
      canisterUserId: 'can-1',
      vaultId: 'v1',
      role: 'viewer',
      token: 'tok',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    });
    const client = new Client({ name: 'prime-hosted', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const read = await client.readResource({ uri: 'knowtation://hosted/prime' });
      const j = JSON.parse(read.contents[0].text);
      assert.equal(j.schema, 'knowtation.prime/v1');
      assert.equal(j.surface, 'hosted');
      assert.equal(j.session.vaultId, 'v1');
      assert.equal(j.session.role, 'viewer');
      assert.ok(Array.isArray(j.mcp_prompts_registered_for_role));
      assert.ok(j.mcp_prompts_registered_for_role.includes('temporal-summary'));
      assert.ok(!j.mcp_prompts_registered_for_role.includes('write-from-capture'));
    } finally {
      await client.close();
      globalThis.fetch = origFetch;
    }
  });

  it('hosted prime includes write-from-capture for editor', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
    });
    const mcpServer = createHostedMcpServer({
      userId: 'a',
      canisterUserId: 'c',
      vaultId: 'v',
      role: 'editor',
      token: 't',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    });
    const client = new Client({ name: 'prime-ed', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const read = await client.readResource({ uri: 'knowtation://hosted/prime' });
      const j = JSON.parse(read.contents[0].text);
      assert.ok(j.mcp_prompts_registered_for_role.includes('write-from-capture'));
    } finally {
      await client.close();
      globalThis.fetch = origFetch;
    }
  });
});

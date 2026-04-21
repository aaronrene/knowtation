/**
 * Hosted MCP: mutable liveAuth so JWT refresh on each /mcp request updates upstream Bearer.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHostedMcpServer } from '../hub/gateway/mcp-hosted-server.mjs';

function headerAuth(init) {
  const h = init?.headers;
  if (!h) return '';
  return typeof h.get === 'function' ? h.get('Authorization') : h.Authorization;
}

describe('hosted MCP liveAuth', () => {
  it('list_notes uses current liveAuth.token after mutation (JWT refresh simulation)', async () => {
    const liveAuth = { token: 'first-token', vaultId: 'v1' };
    const calls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ notes: [], total: 0 }),
        text: async () => '{"notes":[],"total":0}',
      };
    };

    const mcpServer = createHostedMcpServer({
      userId: 'u1',
      vaultId: 'v1',
      role: 'viewer',
      token: 'initial-unused-when-liveAuth-set',
      canisterUrl: 'http://canister.liveauth.test:9901',
      bridgeUrl: 'http://bridge.liveauth.test:9902',
      liveAuth,
    });
    const client = new Client({ name: 'live-auth-test', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      await client.callTool({ name: 'list_notes', arguments: {} });
      assert.equal(headerAuth(calls[calls.length - 1].init), 'Bearer first-token');

      liveAuth.token = 'second-token';
      await client.callTool({ name: 'list_notes', arguments: {} });
      assert.equal(headerAuth(calls[calls.length - 1].init), 'Bearer second-token');
    } finally {
      globalThis.fetch = origFetch;
      try {
        await client.close();
      } catch (_) {}
    }
  });
});

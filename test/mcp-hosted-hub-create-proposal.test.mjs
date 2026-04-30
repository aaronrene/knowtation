/**
 * Hosted MCP hub_create_proposal: POST gateway /api/v1/proposals with JWT + X-Vault-Id (mocked fetch).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHostedMcpServer } from '../hub/gateway/mcp-hosted-server.mjs';

const CANISTER_URL = 'http://canister.test:4322';
const BRIDGE_URL = 'http://bridge.test:4321';
const GATEWAY_BASE = 'http://gateway.test:5555';

describe('hosted MCP hub_create_proposal', () => {
  it('POSTs JSON to gateway /api/v1/proposals with Bearer and X-Vault-Id', async () => {
    const calls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url) === `${GATEWAY_BASE}/api/v1/proposals` && init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              proposal_id: 'prop-test-1',
              path: 'inbox/x.md',
              status: 'proposed',
            });
          },
        };
      }
      return origFetch(url, init);
    };
    try {
      const mcpServer = createHostedMcpServer({
        userId: 'u1',
        vaultId: 'vault-a',
        role: 'editor',
        token: 'jwt-abc',
        canisterUrl: CANISTER_URL,
        bridgeUrl: BRIDGE_URL,
        gatewayApiBaseUrl: GATEWAY_BASE,
      });
      const client = new Client({ name: 'hub-proposal-test', version: '0.0.1' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await mcpServer.connect(serverTransport);
      await client.connect(clientTransport);
      try {
        const out = await client.callTool({
          name: 'hub_create_proposal',
          arguments: { path: 'inbox/x.md', body: 'hello', intent: 'test' },
        });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, `${GATEWAY_BASE}/api/v1/proposals`);
        assert.equal(calls[0].init.method, 'POST');
        const h = calls[0].init.headers;
        const auth =
          typeof h.get === 'function' ? h.get('authorization') : h['authorization'] || h['Authorization'];
        const vault =
          typeof h.get === 'function' ? h.get('x-vault-id') : h['x-vault-id'] || h['X-Vault-Id'];
        assert.match(String(auth || ''), /Bearer\s+jwt-abc/i);
        assert.equal(String(vault || ''), 'vault-a');
        const posted = JSON.parse(calls[0].init.body);
        assert.equal(posted.path, 'inbox/x.md');
        assert.equal(posted.body, 'hello');
        assert.equal(posted.intent, 'test');
        assert.deepEqual(posted.frontmatter, {});
        const text = out.content?.[0]?.type === 'text' ? out.content[0].text : '';
        const data = JSON.parse(text);
        assert.equal(data.proposal_id, 'prop-test-1');
        assert.equal(data.path, 'inbox/x.md');
        assert.ok(!out.isError);
      } finally {
        try {
          await client.close();
        } catch (_) {}
      }
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns structured MCP error when Hub responds 400 with JSON', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 400,
      async text() {
        return JSON.stringify({ error: 'path invalid', code: 'BAD_REQUEST', detail: 'no dots' });
      },
    });
    try {
      const mcpServer = createHostedMcpServer({
        userId: 'u1',
        vaultId: 'default',
        role: 'editor',
        token: 'jwt',
        canisterUrl: CANISTER_URL,
        bridgeUrl: BRIDGE_URL,
        gatewayApiBaseUrl: GATEWAY_BASE,
      });
      const client = new Client({ name: 'hub-proposal-err', version: '0.0.1' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await mcpServer.connect(serverTransport);
      await client.connect(clientTransport);
      try {
        const out = await client.callTool({
          name: 'hub_create_proposal',
          arguments: { path: 'bad/../x.md', body: '' },
        });
        assert.equal(out.isError, true);
        const text = out.content?.[0]?.type === 'text' ? out.content[0].text : '';
        const data = JSON.parse(text);
        assert.equal(data.error, 'path invalid');
        assert.equal(data.code, 'BAD_REQUEST');
        assert.equal(data.http_status, 400);
        assert.equal(data.detail, 'no dots');
      } finally {
        try {
          await client.close();
        } catch (_) {}
      }
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('is registered for evaluator when gatewayApiBaseUrl is set', async () => {
    const mcpServer = createHostedMcpServer({
      userId: 'u1',
      vaultId: 'default',
      role: 'evaluator',
      token: 'jwt',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
      gatewayApiBaseUrl: GATEWAY_BASE,
    });
    const client = new Client({ name: 'evaluator-tools', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      assert.ok(names.includes('hub_create_proposal'));
    } finally {
      try {
        await client.close();
      } catch (_) {}
    }
  });

  it('is not registered for viewer even with gatewayApiBaseUrl', async () => {
    const mcpServer = createHostedMcpServer({
      userId: 'u1',
      vaultId: 'default',
      role: 'viewer',
      token: 'jwt',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
      gatewayApiBaseUrl: GATEWAY_BASE,
    });
    const client = new Client({ name: 'viewer-tools', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      assert.ok(!names.includes('hub_create_proposal'));
    } finally {
      try {
        await client.close();
      } catch (_) {}
    }
  });
});

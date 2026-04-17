/**
 * Hosted MCP export — GET canister /api/v1/export (parity with hub/bridge/server.mjs backup fetch).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHostedMcpServer } from '../hub/gateway/mcp-hosted-server.mjs';

const BRIDGE_URL = 'http://bridge.test:4321';
const CANISTER_URL = 'http://canister.test:4322';

function makeCtx(overrides = {}) {
  return {
    userId: 'u-export',
    vaultId: 'v-export',
    role: 'admin',
    token: 'tok-export',
    canisterUrl: CANISTER_URL,
    bridgeUrl: BRIDGE_URL,
    canisterAuthSecret: 'gw-secret',
    ...overrides,
  };
}

function installFetchMock(handler) {
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(url, init, calls);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = origFetch;
    },
  };
}

describe('hosted MCP export — canister request shape', () => {
  let mock;
  let client;

  beforeEach(() => {
    const notes = [{ path: 'a.md', frontmatter: '{}', body: 'x' }];
    mock = installFetchMock(() => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ notes })).buffer,
      json: async () => ({ notes }),
      text: async () => JSON.stringify({ notes }),
    }));
  });

  afterEach(async () => {
    mock.restore();
    try {
      await client?.close();
    } catch (_) {}
  });

  it('sends GET to {canisterUrl}/api/v1/export', async () => {
    const mcpServer = createHostedMcpServer(makeCtx());
    client = new Client({ name: 'export-test', version: '0.0.1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(st);
    await client.connect(ct);
    await client.callTool({ name: 'export', arguments: {} });

    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, `${CANISTER_URL}/api/v1/export`);
    assert.equal(mock.calls[0].init.method, 'GET');
  });

  it('sends Authorization, X-Vault-Id, X-User-Id, X-Gateway-Auth', async () => {
    const mcpServer = createHostedMcpServer(makeCtx());
    client = new Client({ name: 'export-test', version: '0.0.1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(st);
    await client.connect(ct);
    await client.callTool({ name: 'export', arguments: {} });

    const h = mock.calls[0].init.headers;
    assert.equal(h['Authorization'], 'Bearer tok-export');
    assert.equal(h['X-Vault-Id'], 'v-export');
    assert.equal(h['X-User-Id'], 'u-export');
    assert.equal(h['X-Gateway-Auth'], 'gw-secret');
  });

  it('returns parsed notes JSON as tool content', async () => {
    const mcpServer = createHostedMcpServer(makeCtx());
    client = new Client({ name: 'export-test', version: '0.0.1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(st);
    await client.connect(ct);
    const result = await client.callTool({ name: 'export', arguments: {} });

    assert.ok(result.content?.length);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.notes.length, 1);
    assert.equal(parsed.notes[0].path, 'a.md');
  });

  it('returns EXPORT_TOO_LARGE when body exceeds cap', async () => {
    mock.restore();
    const huge = 'x'.repeat(5 * 1024 * 1024);
    mock = installFetchMock(() => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ notes: [{ body: huge }] })).buffer,
      json: async () => ({ notes: [{ body: huge }] }),
      text: async () => JSON.stringify({ notes: [{ body: huge }] }),
    }));

    const mcpServer = createHostedMcpServer(makeCtx());
    client = new Client({ name: 'export-test', version: '0.0.1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(st);
    await client.connect(ct);
    const result = await client.callTool({ name: 'export', arguments: {} });

    assert.equal(result.isError, true);
    const err = JSON.parse(result.content[0].text);
    assert.equal(err.code, 'EXPORT_TOO_LARGE');
    assert.ok(String(err.error).includes('MCP-only'));
  });

  it('returns isError on upstream HTTP failure', async () => {
    mock.restore();
    mock = installFetchMock(() => ({
      ok: false,
      status: 403,
      arrayBuffer: async () => new TextEncoder().encode('{"error":"Gateway authentication required"}').buffer,
      text: async () => '{"error":"Gateway authentication required"}',
    }));

    const mcpServer = createHostedMcpServer(makeCtx());
    client = new Client({ name: 'export-test', version: '0.0.1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(st);
    await client.connect(ct);
    const result = await client.callTool({ name: 'export', arguments: {} });

    assert.equal(result.isError, true);
    const err = JSON.parse(result.content[0].text);
    assert.equal(err.code, 'UPSTREAM_ERROR');
  });

  it('viewer role does not register export', async () => {
    mock.restore();
    mock = installFetchMock(() => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode('{}').buffer,
      json: async () => ({}),
      text: async () => '{}',
    }));
    const mcpServer = createHostedMcpServer(makeCtx({ role: 'viewer' }));
    const c = new Client({ name: 'export-viewer', version: '0.0.1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(st);
    await c.connect(ct);
    try {
      const { tools } = await c.listTools();
      assert.ok(!tools.some((t) => t.name === 'export'));
    } finally {
      await c.close();
      mock.restore();
    }
  });
});

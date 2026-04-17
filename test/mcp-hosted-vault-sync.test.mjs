/**
 * Hosted MCP vault_sync — POST JSON to bridge /api/v1/vault/sync (parity with Hub proxy).
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
    userId: 'u-sync',
    vaultId: 'v-sync',
    role: 'editor',
    token: 'tok-vault-sync',
    canisterUrl: CANISTER_URL,
    bridgeUrl: BRIDGE_URL,
    ...overrides,
  };
}

function installFetchMock(response = { ok: true, message: 'Synced', notesCount: 0, proposalsCount: 0 }) {
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => response,
      text: async () => JSON.stringify(response),
    };
  };
  return {
    calls,
    restore() {
      globalThis.fetch = origFetch;
    },
  };
}

async function connectEditor(mock) {
  const mcpServer = createHostedMcpServer(makeCtx());
  const client = new Client({ name: 'vault-sync-test', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, mcpServer, clientTransport, serverTransport };
}

describe('hosted MCP vault_sync — bridge request shape', () => {
  let mock;
  let client;

  beforeEach(() => {
    mock = installFetchMock();
  });

  afterEach(async () => {
    mock.restore();
    try {
      await client?.close();
    } catch (_) {}
  });

  it('sends POST to {bridgeUrl}/api/v1/vault/sync', async () => {
    ({ client } = await connectEditor(mock));
    await client.callTool({ name: 'vault_sync', arguments: {} });

    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, `${BRIDGE_URL}/api/v1/vault/sync`);
    assert.equal(mock.calls[0].init.method, 'POST');
  });

  it('sends Authorization: Bearer and X-Vault-Id', async () => {
    ({ client } = await connectEditor(mock));
    await client.callTool({ name: 'vault_sync', arguments: {} });

    const h = mock.calls[0].init.headers;
    assert.equal(h['Authorization'], 'Bearer tok-vault-sync');
    assert.equal(h['X-Vault-Id'], 'v-sync');
  });

  it('sends Content-Type: application/json', async () => {
    ({ client } = await connectEditor(mock));
    await client.callTool({ name: 'vault_sync', arguments: {} });

    assert.equal(mock.calls[0].init.headers['Content-Type'], 'application/json');
  });

  it('sends empty JSON object when repo omitted', async () => {
    ({ client } = await connectEditor(mock));
    await client.callTool({ name: 'vault_sync', arguments: {} });

    const body = JSON.parse(mock.calls[0].init.body);
    assert.deepEqual(body, {});
  });

  it('sends { repo } when repo provided', async () => {
    ({ client } = await connectEditor(mock));
    await client.callTool({ name: 'vault_sync', arguments: { repo: 'acme/notes' } });

    const body = JSON.parse(mock.calls[0].init.body);
    assert.deepEqual(body, { repo: 'acme/notes' });
  });

  it('trims repo and omits body.repo when repo is whitespace-only', async () => {
    ({ client } = await connectEditor(mock));
    await client.callTool({ name: 'vault_sync', arguments: { repo: '  \t  ' } });

    const body = JSON.parse(mock.calls[0].init.body);
    assert.deepEqual(body, {});
  });

  it('returns upstream JSON as tool content', async () => {
    mock.restore();
    mock = installFetchMock({ ok: true, message: 'Synced', notesCount: 3, proposalsCount: 1 });
    ({ client } = await connectEditor(mock));
    const result = await client.callTool({ name: 'vault_sync', arguments: {} });

    assert.ok(result.content?.length);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.notesCount, 3);
    assert.equal(parsed.proposalsCount, 1);
  });

  it('returns isError on upstream failure', async () => {
    mock.restore();
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'GitHub not connected', code: 'GITHUB_NOT_CONNECTED' }),
      text: async () => '{"error":"GitHub not connected"}',
    });
    mock = { calls: [], restore: () => { globalThis.fetch = origFetch; } };

    ({ client } = await connectEditor(mock));
    const result = await client.callTool({ name: 'vault_sync', arguments: {} });

    assert.equal(result.isError, true);
  });

  it('admin role also registers vault_sync', async () => {
    mock.restore();
    mock = installFetchMock();
    const mcpServer = createHostedMcpServer(makeCtx({ role: 'admin' }));
    const c = new Client({ name: 'vault-sync-admin', version: '0.0.1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(st);
    await c.connect(ct);
    try {
      const { tools } = await c.listTools();
      assert.ok(tools.some((t) => t.name === 'vault_sync'));
      await c.callTool({ name: 'vault_sync', arguments: { repo: 'o/r' } });
      assert.equal(mock.calls[0].url, `${BRIDGE_URL}/api/v1/vault/sync`);
    } finally {
      await c.close();
      mock.restore();
    }
  });
});

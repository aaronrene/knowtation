/**
 * Hosted MCP transcribe tool: POST multipart to bridge /api/v1/import with source_type audio or video.
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
    userId: 'u-1',
    vaultId: 'v-1',
    role: 'editor',
    token: 'tok-test',
    canisterUrl: CANISTER_URL,
    bridgeUrl: BRIDGE_URL,
    ...overrides,
  };
}

function installFetchMock(json = { imported: [{ path: 'inbox/x.md' }], count: 1 }) {
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(json),
      json: async () => json,
    };
  };
  return {
    calls,
    restore() {
      globalThis.fetch = origFetch;
    },
  };
}

async function connectPair(ctx) {
  const mcpServer = createHostedMcpServer(ctx ?? makeCtx());
  const client = new Client({ name: 'transcribe-test', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, mcpServer };
}

describe('hosted MCP transcribe — bridge multipart', () => {
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

  it('sends POST to {bridgeUrl}/api/v1/import with Authorization, X-Vault-Id, and source_type audio', async () => {
    ({ client } = await connectPair());
    const payload = Buffer.from('fake-audio', 'utf8').toString('base64');
    await client.callTool({
      name: 'transcribe',
      arguments: { source_type: 'audio', file_base64: payload, filename: 'clip.m4a' },
    });

    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, `${BRIDGE_URL}/api/v1/import`);
    assert.equal(mock.calls[0].init.method, 'POST');
    const h = mock.calls[0].init.headers;
    assert.equal(h['Authorization'], 'Bearer tok-test');
    assert.equal(h['X-Vault-Id'], 'v-1');
    const body = mock.calls[0].init.body;
    assert.ok(body instanceof FormData);
    assert.equal(body.get('source_type'), 'audio');
    assert.ok(body.get('file'));
  });

  it('FormData uses source_type video when requested', async () => {
    ({ client } = await connectPair(makeCtx({ role: 'admin' })));
    const payload = Buffer.from('x', 'utf8').toString('base64');
    await client.callTool({
      name: 'transcribe',
      arguments: { source_type: 'video', file_base64: payload, filename: 'clip.mp4', project: 'demo' },
    });
    const body = mock.calls[0].init.body;
    assert.equal(body.get('source_type'), 'video');
    assert.equal(body.get('project'), 'demo');
  });

  it('transcribe tool is not registered for viewer', async () => {
    ({ client } = await connectPair(makeCtx({ role: 'viewer' })));
    const res = await client.callTool({
      name: 'transcribe',
      arguments: {
        source_type: 'audio',
        file_base64: Buffer.from('x').toString('base64'),
        filename: 'a.m4a',
      },
    });
    assert.ok(res.isError);
  });
});

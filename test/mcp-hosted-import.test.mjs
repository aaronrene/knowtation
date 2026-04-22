/**
 * Hosted MCP import tool: POST multipart to bridge /api/v1/import with JWT + X-Vault-Id.
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
    role: 'admin',
    token: 'tok-test',
    canisterUrl: CANISTER_URL,
    bridgeUrl: BRIDGE_URL,
    ...overrides,
  };
}

function installFetchMock(json = { imported: [{ path: 'x.md' }], count: 1 }) {
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
  const client = new Client({ name: 'import-test', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, mcpServer };
}

describe('hosted MCP import — bridge multipart', () => {
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

  it('sends POST to {bridgeUrl}/api/v1/import with Authorization and X-Vault-Id', async () => {
    ({ client } = await connectPair());
    const payload = Buffer.from('# hi\n', 'utf8').toString('base64');
    await client.callTool({
      name: 'import',
      arguments: { source_type: 'markdown', file_base64: payload, filename: 'note.md' },
    });

    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, `${BRIDGE_URL}/api/v1/import`);
    assert.equal(mock.calls[0].init.method, 'POST');
    const h = mock.calls[0].init.headers;
    assert.equal(h['Authorization'], 'Bearer tok-test');
    assert.equal(h['X-Vault-Id'], 'v-1');
    assert.ok(!h['Content-Type'], 'fetch must set multipart boundary (no manual application/json)');
  });

  it('does not send X-Gateway-Auth (bridge import, not direct canister)', async () => {
    ({ client } = await connectPair(
      makeCtx({ canisterAuthSecret: 'secret-for-canister-only' })
    ));
    const payload = Buffer.from('x', 'utf8').toString('base64');
    await client.callTool({
      name: 'import',
      arguments: { source_type: 'markdown', file_base64: payload, filename: 'a.md' },
    });
    const h = mock.calls[0].init.headers;
    assert.equal(h['X-Gateway-Auth'], undefined);
  });

  it('FormData includes source_type, file, optional project and tags', async () => {
    ({ client } = await connectPair());
    const payload = Buffer.from('body', 'utf8').toString('base64');
    await client.callTool({
      name: 'import',
      arguments: {
        source_type: 'markdown',
        file_base64: payload,
        filename: 'z.md',
        project: 'demo-proj',
        tags: ['a', 'b'],
      },
    });
    const body = mock.calls[0].init.body;
    assert.ok(body instanceof FormData);
    assert.equal(body.get('source_type'), 'markdown');
    assert.equal(body.get('project'), 'demo-proj');
    assert.equal(body.get('tags'), 'a,b');
    assert.ok(body.get('file'), 'file field set');
  });

  it('accepts source_type docx (multipart parity with Hub)', async () => {
    ({ client } = await connectPair());
    const payload = Buffer.from('PK\x03\x04', 'utf8').toString('base64');
    await client.callTool({
      name: 'import',
      arguments: { source_type: 'docx', file_base64: payload, filename: 'x.docx' },
    });
    const body = mock.calls[0].init.body;
    assert.ok(body instanceof FormData);
    assert.equal(body.get('source_type'), 'docx');
  });

  it('rejects base64 that decodes to an empty file', async () => {
    ({ client } = await connectPair());
    const res = await client.callTool({
      name: 'import',
      arguments: { source_type: 'markdown', file_base64: '%%%', filename: 'x.md' },
    });
    assert.ok(res.isError);
    const text = res.content[0].text;
    assert.ok(/empty/i.test(text), text);
  });

  it('import tool is not registered for viewer', async () => {
    ({ client } = await connectPair(makeCtx({ role: 'viewer' })));
    const res = await client.callTool({
      name: 'import',
      arguments: { source_type: 'markdown', file_base64: Buffer.from('x').toString('base64'), filename: 'x.md' },
    });
    assert.ok(res.isError);
  });
});

describe('hosted MCP import_url — bridge JSON', () => {
  let mock;
  let client;

  beforeEach(() => {
    mock = installFetchMock({ imported: [{ path: 'inbox/imports/url/abc.md' }], count: 1 });
  });

  afterEach(async () => {
    mock.restore();
    try {
      await client?.close();
    } catch (_) {}
  });

  it('POST {bridgeUrl}/api/v1/import-url with JSON body and auth headers', async () => {
    ({ client } = await connectPair());
    await client.callTool({
      name: 'import_url',
      arguments: { url: 'https://example.com/a', mode: 'bookmark', project: 'p1', tags: 't1,t2' },
    });
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, `${BRIDGE_URL}/api/v1/import-url`);
    assert.equal(mock.calls[0].init.method, 'POST');
    const h = mock.calls[0].init.headers;
    assert.equal(h['Authorization'], 'Bearer tok-test');
    assert.equal(h['X-Vault-Id'], 'v-1');
    assert.equal(h['Content-Type'], 'application/json');
    const body = JSON.parse(mock.calls[0].init.body);
    assert.equal(body.url, 'https://example.com/a');
    assert.equal(body.mode, 'bookmark');
    assert.equal(body.project, 'p1');
    assert.equal(body.tags, 't1,t2');
  });

  it('import_url rejects non-https URL without calling bridge', async () => {
    ({ client } = await connectPair());
    const res = await client.callTool({
      name: 'import_url',
      arguments: { url: 'http://example.com/x' },
    });
    assert.ok(res.isError);
    assert.equal(mock.calls.length, 0);
  });

  it('import_url is not registered for viewer', async () => {
    ({ client } = await connectPair(makeCtx({ role: 'viewer' })));
    const res = await client.callTool({
      name: 'import_url',
      arguments: { url: 'https://example.com/' },
    });
    assert.ok(res.isError);
  });
});

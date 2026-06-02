/**
 * Hosted MCP get_metadata_facets tests.
 *
 * Phase 1D mirrors hosted get_note access: same canister read path, same auth
 * headers, viewer-level ACL, and a body-free MetadataFacets v0 response.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHostedMcpServer } from '../hub/gateway/mcp-hosted-server.mjs';

const CANISTER_URL = 'http://canister.test:4322';
const BRIDGE_URL = 'http://bridge.test:4321';

function makeCtx(overrides = {}) {
  return {
    userId: 'google:actor',
    canisterUserId: 'google:owner',
    vaultId: 'vault-facets',
    role: 'viewer',
    token: 'tok-facets',
    canisterUrl: CANISTER_URL,
    bridgeUrl: BRIDGE_URL,
    canisterAuthSecret: 'gw-secret-facets',
    ...overrides,
  };
}

function headerGet(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()];
}

function installFetchMock(handler) {
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = origFetch;
    },
  };
}

async function connectPair(ctx = makeCtx()) {
  const mcpServer = createHostedMcpServer(ctx);
  const client = new Client({ name: 'hosted-metadata-facets', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return { client };
}

function parseToolResult(result) {
  const text = result.content?.[0]?.text;
  assert.equal(typeof text, 'string');
  return JSON.parse(text);
}

describe('hosted MCP get_metadata_facets', () => {
  let mock;
  let client;

  afterEach(async () => {
    try {
      await client?.close();
    } catch (_) {}
    mock?.restore?.();
  });

  it('lists get_metadata_facets as a read tool for every hosted role', async () => {
    mock = installFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
    }));

    for (const role of ['viewer', 'editor', 'evaluator', 'admin']) {
      ({ client } = await connectPair(makeCtx({ role })));
      const { tools } = await client.listTools();
      assert.ok(tools.some((tool) => tool.name === 'get_metadata_facets'), `${role} can list get_metadata_facets`);
      await client.close();
      client = undefined;
    }
  });

  it('uses the same canister GET path and auth headers as get_note', async () => {
    mock = installFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({
        path: 'inbox/hello world.md',
        frontmatter: '{"project":"Hosted Project","tags":["Alpha","Beta"],"api_key":"must-not-leak"}',
        body: 'Body must not leak.',
      }),
      text: async () => '{}',
    }));
    ({ client } = await connectPair());

    await client.callTool({
      name: 'get_metadata_facets',
      arguments: { path: 'inbox/hello world.md' },
    });

    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, `${CANISTER_URL}/api/v1/notes/${encodeURIComponent('inbox/hello world.md')}`);
    assert.equal(mock.calls[0].init.method, 'GET');
    const headers = mock.calls[0].init.headers;
    assert.equal(headerGet(headers, 'Authorization'), 'Bearer tok-facets');
    assert.equal(headerGet(headers, 'X-Vault-Id'), 'vault-facets');
    assert.equal(headerGet(headers, 'X-User-Id'), 'google:owner');
    assert.equal(headerGet(headers, 'X-Gateway-Auth'), 'gw-secret-facets');
  });

  it('rejects unsafe requested paths before upstream fetch', async () => {
    mock = installFetchMock(() => {
      throw new Error('upstream fetch must not run for unsafe requested paths');
    });
    ({ client } = await connectPair());

    for (const unsafePath of ['../secret.md', '\\Users\\owner\\secret.md']) {
      const result = await client.callTool({
        name: 'get_metadata_facets',
        arguments: { path: unsafePath },
      });
      const data = parseToolResult(result);

      assert.equal(result.isError, true);
      assert.equal(data.code, 'UPSTREAM_ERROR');
      assert.match(data.error, /Invalid path/);
    }
    assert.equal(mock.calls.length, 0);
  });

  it('returns MetadataFacets JSON without body, snippets, full frontmatter, or absolute paths', async () => {
    mock = installFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({
        path: 'inbox/hello.md',
        frontmatter:
          '{"project":"Hosted Project","tags":["Alpha","Beta"],"date":"2026-05-24","updated":"2026-05-25","causal_chain_id":"Launch Rollout","entity":["Alice B"],"episode_id":"Episode 1","api_key":"must-not-leak","label":"do not include"}',
        body: 'Body must not leak.',
      }),
      text: async () => '{}',
    }));
    ({ client } = await connectPair());

    const result = await client.callTool({
      name: 'get_metadata_facets',
      arguments: { path: 'inbox/hello.md' },
    });
    const data = parseToolResult(result);
    const serialized = JSON.stringify(data);

    assert.equal(result.isError, undefined);
    assert.deepEqual(data, {
      schema: 'knowtation.metadata_facets/v0',
      path: 'inbox/hello.md',
      facets: {
        project: 'hosted-project',
        tags: ['alpha', 'beta'],
        date: '2026-05-24',
        updated: '2026-05-25',
        causal_chain_id: 'launch-rollout',
        entity: ['alice-b'],
        episode_id: 'episode-1',
      },
      inferred: {
        folder: 'inbox',
        source_type: null,
      },
      truncated: false,
    });
    assert.equal(Object.hasOwn(data, 'body'), false);
    assert.equal(Object.hasOwn(data, 'frontmatter'), false);
    assert.equal(Object.hasOwn(data, 'snippet'), false);
    assert.equal(Object.hasOwn(data, 'summary'), false);
    assert.equal(Object.hasOwn(data, 'labels'), false);
    assert.equal(Object.hasOwn(data, 'metadata_facets'), false);
    assert.equal(serialized.includes('Body must not leak'), false);
    assert.equal(serialized.includes('must-not-leak'), false);
    assert.equal(serialized.includes('do not include'), false);
    assert.equal(serialized.includes('/Users/'), false);
  });

  it('uses requested safe path instead of unsafe upstream path in output', async () => {
    mock = installFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({
        path: '/Users/owner/private/secret.md',
        frontmatter: '{"tags":["Safe"]}',
        body: 'private note body must not leak',
      }),
      text: async () => '{}',
    }));
    ({ client } = await connectPair());

    const result = await client.callTool({
      name: 'get_metadata_facets',
      arguments: { path: 'safe.md' },
    });
    const data = parseToolResult(result);
    const serialized = JSON.stringify(data);

    assert.equal(result.isError, undefined);
    assert.equal(data.path, 'safe.md');
    assert.deepEqual(data.facets.tags, ['safe']);
    assert.equal(serialized.includes('/Users/owner'), false);
    assert.equal(serialized.includes('private note body'), false);
  });

  it('returns UPSTREAM_ERROR without changing missing-note behavior', async () => {
    mock = installFetchMock(() => ({
      ok: false,
      status: 404,
      json: async () => ({ error: 'not found' }),
      text: async () => '{"error":"not found"}',
    }));
    ({ client } = await connectPair());

    const result = await client.callTool({
      name: 'get_metadata_facets',
      arguments: { path: 'missing.md' },
    });
    const data = parseToolResult(result);

    assert.equal(result.isError, true);
    assert.equal(data.code, 'UPSTREAM_ERROR');
    assert.match(data.error, /Upstream 404/);
  });

  it('returns UPSTREAM_ERROR without changing forbidden-note behavior', async () => {
    mock = installFetchMock(() => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'forbidden' }),
      text: async () => '{"error":"forbidden"}',
    }));
    ({ client } = await connectPair());

    const result = await client.callTool({
      name: 'get_metadata_facets',
      arguments: { path: 'private.md' },
    });
    const data = parseToolResult(result);

    assert.equal(result.isError, true);
    assert.equal(data.code, 'UPSTREAM_ERROR');
    assert.match(data.error, /Upstream 403/);
    assert.equal(JSON.stringify(data).includes('private note body'), false);
  });
});

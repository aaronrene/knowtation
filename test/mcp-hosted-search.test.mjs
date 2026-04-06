/**
 * Tests for the hosted MCP search tool (Phase E).
 *
 * Verifies:
 *  1. Search uses POST (not GET) to the bridge
 *  2. Tool arg → bridge body mapping (snake_case → camelCase where needed)
 *  3. Parity fields: fields, snippet_chars, count_only, match, since/until,
 *     order, chain, entity, episode, content_scope
 *  4. Minimal call sends only `query` in body
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
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

/**
 * Mock globalThis.fetch, record calls to the bridge search endpoint,
 * and return a canned response.
 */
function installFetchMock(response = { results: [], query: 'q' }) {
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

async function connectPair(ctx) {
  const mcpServer = createHostedMcpServer(ctx ?? makeCtx());
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, mcpServer, clientTransport, serverTransport };
}

describe('hosted MCP search — transport and parity', () => {
  let mock;
  let client;
  let mcpServer;

  beforeEach(async () => {
    mock = installFetchMock();
  });

  afterEach(async () => {
    mock.restore();
    try { await client?.close(); } catch (_) {}
  });

  it('sends POST to {bridgeUrl}/api/v1/search', async () => {
    ({ client, mcpServer } = await connectPair());
    await client.callTool({ name: 'search', arguments: { query: 'hello' } });

    assert.equal(mock.calls.length, 1, 'exactly one fetch call');
    const { url, init } = mock.calls[0];
    assert.equal(url, `${BRIDGE_URL}/api/v1/search`);
    assert.equal(init.method, 'POST');
  });

  it('does NOT use query-string params (no ? in URL)', async () => {
    ({ client, mcpServer } = await connectPair());
    await client.callTool({ name: 'search', arguments: { query: 'test' } });

    assert.ok(!mock.calls[0].url.includes('?'), 'URL must not contain query params');
  });

  it('sends Content-Type: application/json', async () => {
    ({ client, mcpServer } = await connectPair());
    await client.callTool({ name: 'search', arguments: { query: 'ct' } });

    assert.equal(mock.calls[0].init.headers['Content-Type'], 'application/json');
  });

  it('forwards auth token as Bearer header', async () => {
    ({ client, mcpServer } = await connectPair());
    await client.callTool({ name: 'search', arguments: { query: 'auth' } });

    assert.equal(mock.calls[0].init.headers['Authorization'], 'Bearer tok-test');
  });

  it('forwards X-Vault-Id header', async () => {
    ({ client, mcpServer } = await connectPair());
    await client.callTool({ name: 'search', arguments: { query: 'vaultcheck' } });

    assert.equal(mock.calls[0].init.headers['X-Vault-Id'], 'v-1');
  });

  it('minimal call sends only query in body', async () => {
    ({ client, mcpServer } = await connectPair());
    await client.callTool({ name: 'search', arguments: { query: 'minimal' } });

    const body = JSON.parse(mock.calls[0].init.body);
    assert.deepEqual(body, { query: 'minimal' });
  });

  it('maps snippet_chars → snippetChars in body', async () => {
    ({ client, mcpServer } = await connectPair());
    await client.callTool({
      name: 'search',
      arguments: { query: 'snip', snippet_chars: 150 },
    });

    const body = JSON.parse(mock.calls[0].init.body);
    assert.equal(body.snippetChars, 150);
    assert.equal(body.snippet_chars, undefined, 'snake_case key must not appear');
  });

  it('maps count_only → count_only in body (bridge reads both forms)', async () => {
    ({ client, mcpServer } = await connectPair());
    await client.callTool({
      name: 'search',
      arguments: { query: 'cnt', count_only: true },
    });

    const body = JSON.parse(mock.calls[0].init.body);
    assert.equal(body.count_only, true);
  });

  it('passes fields through to body', async () => {
    ({ client, mcpServer } = await connectPair());
    await client.callTool({
      name: 'search',
      arguments: { query: 'f', fields: 'path' },
    });

    const body = JSON.parse(mock.calls[0].init.body);
    assert.equal(body.fields, 'path');
  });

  it('passes match through to body', async () => {
    ({ client, mcpServer } = await connectPair());
    await client.callTool({
      name: 'search',
      arguments: { query: 'm', mode: 'keyword', match: 'all_terms' },
    });

    const body = JSON.parse(mock.calls[0].init.body);
    assert.equal(body.match, 'all_terms');
  });

  it('passes all filter fields (since, until, order, chain, entity, episode, content_scope)', async () => {
    ({ client, mcpServer } = await connectPair());
    await client.callTool({
      name: 'search',
      arguments: {
        query: 'filters',
        since: '2025-01-01',
        until: '2025-12-31',
        order: 'date-asc',
        chain: 'c1',
        entity: 'e1',
        episode: 'ep1',
        content_scope: 'notes',
      },
    });

    const body = JSON.parse(mock.calls[0].init.body);
    assert.equal(body.since, '2025-01-01');
    assert.equal(body.until, '2025-12-31');
    assert.equal(body.order, 'date-asc');
    assert.equal(body.chain, 'c1');
    assert.equal(body.entity, 'e1');
    assert.equal(body.episode, 'ep1');
    assert.equal(body.content_scope, 'notes');
  });

  it('passes folder, project, tag, mode, limit', async () => {
    ({ client, mcpServer } = await connectPair());
    await client.callTool({
      name: 'search',
      arguments: {
        query: 'old-params',
        mode: 'keyword',
        limit: 5,
        folder: 'inbox',
        project: 'proj-1',
        tag: 'urgent',
      },
    });

    const body = JSON.parse(mock.calls[0].init.body);
    assert.equal(body.mode, 'keyword');
    assert.equal(body.limit, 5);
    assert.equal(body.folder, 'inbox');
    assert.equal(body.project, 'proj-1');
    assert.equal(body.tag, 'urgent');
  });

  it('full parity call maps every arg correctly', async () => {
    ({ client, mcpServer } = await connectPair());
    await client.callTool({
      name: 'search',
      arguments: {
        query: 'full',
        mode: 'keyword',
        match: 'all_terms',
        limit: 3,
        fields: 'full',
        snippet_chars: 200,
        count_only: false,
        folder: 'notes',
        project: 'alpha',
        tag: 'beta',
        since: '2024-06-01',
        until: '2024-12-31',
        order: 'date',
        chain: 'ch',
        entity: 'en',
        episode: 'ep',
        content_scope: 'approval_logs',
      },
    });

    const body = JSON.parse(mock.calls[0].init.body);
    assert.deepEqual(body, {
      query: 'full',
      mode: 'keyword',
      match: 'all_terms',
      limit: 3,
      fields: 'full',
      snippetChars: 200,
      count_only: false,
      folder: 'notes',
      project: 'alpha',
      tag: 'beta',
      since: '2024-06-01',
      until: '2024-12-31',
      order: 'date',
      chain: 'ch',
      entity: 'en',
      episode: 'ep',
      content_scope: 'approval_logs',
    });
  });

  it('returns upstream response as JSON text content', async () => {
    mock.restore();
    mock = installFetchMock({ results: [{ path: 'a.md' }], query: 'q' });
    ({ client, mcpServer } = await connectPair());
    const result = await client.callTool({ name: 'search', arguments: { query: 'q' } });

    assert.ok(result.content?.length > 0);
    const parsed = JSON.parse(result.content[0].text);
    assert.deepEqual(parsed.results, [{ path: 'a.md' }]);
  });

  it('returns isError: true on upstream failure', async () => {
    mock.restore();
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 502,
      json: async () => ({ error: 'bad' }),
      text: async () => 'bad gateway',
    });
    mock = { calls: [], restore: () => { globalThis.fetch = origFetch; } };

    ({ client, mcpServer } = await connectPair());
    const result = await client.callTool({ name: 'search', arguments: { query: 'fail' } });

    assert.equal(result.isError, true);
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(parsed.error);
  });
});

describe('hosted MCP search — tool listing parity', () => {
  let mock;
  let client;

  before(async () => {
    mock = installFetchMock();
  });

  after(() => {
    mock.restore();
  });

  it('search tool schema lists all parity fields', async () => {
    // Use viewer role to avoid SDK listTools issue with tools missing inputSchema (e.g. index)
    ({ client } = await connectPair(makeCtx({ role: 'viewer' })));
    const { tools } = await client.listTools();
    const search = tools.find((t) => t.name === 'search');
    assert.ok(search, 'search tool must be registered');

    const props = search.inputSchema?.properties ?? {};
    const requiredFields = [
      'query', 'mode', 'match', 'limit', 'fields', 'snippet_chars',
      'count_only', 'folder', 'project', 'tag', 'since', 'until',
      'order', 'chain', 'entity', 'episode', 'content_scope',
    ];
    for (const f of requiredFields) {
      assert.ok(props[f], `schema must include ${f}`);
    }
  });
});

/**
 * Hosted MCP `tag_suggest` — canister note read + bridge POST /api/v1/search + optional get_note per hit for tags.
 */

import { describe, it, afterEach } from 'node:test';
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
    role: 'viewer',
    token: 'tok-test',
    canisterUrl: CANISTER_URL,
    bridgeUrl: BRIDGE_URL,
    ...overrides,
  };
}

function installTagSuggestFetchMock({ searchResponse, neighborFrontmatter = '{"tags":"alpha, beta-tag"}' } = {}) {
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.includes(`${CANISTER_URL}/api/v1/notes/`) && !u.includes('/batch')) {
      const pathMatch = u.match(/\/notes\/(.+)$/);
      const rawPath = pathMatch ? decodeURIComponent(pathMatch[1]) : '';
      if (rawPath === 'src.md') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            path: 'src.md',
            body: 'topic gamma',
            frontmatter: '{"title":"Source","tags":"existing-one"}',
          }),
          text: async () => '{}',
        };
      }
      if (rawPath === 'neighbor.md') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            path: 'neighbor.md',
            body: 'x',
            frontmatter: neighborFrontmatter,
          }),
          text: async () => '{}',
        };
      }
    }
    if (u === `${BRIDGE_URL}/api/v1/search`) {
      return {
        ok: true,
        status: 200,
        json: async () => searchResponse,
        text: async () => JSON.stringify(searchResponse),
      };
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => 'not found',
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
  const client = new Client({ name: 'tag-suggest-test', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, mcpServer };
}

describe('hosted MCP tag_suggest', () => {
  let mock = { restore() {} };
  let client;

  afterEach(async () => {
    mock.restore();
    try {
      await client?.close();
    } catch (_) {}
  });

  it('loads source from canister then POSTs semantic search with default neighbor limit and snippetChars 200', async () => {
    mock = installTagSuggestFetchMock({
      searchResponse: {
        results: [{ path: 'neighbor.md', score: 0.5, tags: ['alpha'], snippet: 's' }],
        query: 'q',
        mode: 'semantic',
      },
    });
    ({ client } = await connectPair());

    await client.callTool({
      name: 'tag_suggest',
      arguments: { path: 'src.md' },
    });

    const searchCalls = mock.calls.filter((c) => c.url === `${BRIDGE_URL}/api/v1/search`);
    assert.equal(searchCalls.length, 1);
    assert.equal(searchCalls[0].init.method, 'POST');
    const hdrs = searchCalls[0].init.headers;
    const xUser =
      hdrs && typeof hdrs.get === 'function'
        ? hdrs.get('X-User-Id')
        : hdrs && (hdrs['X-User-Id'] || hdrs['x-user-id']);
    assert.equal(xUser, 'u-1');
    const body = JSON.parse(searchCalls[0].init.body);
    assert.equal(body.mode, 'semantic');
    assert.equal(body.snippetChars, 200);
    assert.equal(body.limit, 40);
    assert.ok(body.query.includes('Source'));
    assert.ok(body.query.includes('topic gamma'));
  });

  it('passes neighbor_limit through to bridge search when set', async () => {
    mock = installTagSuggestFetchMock({
      searchResponse: {
        results: [{ path: 'neighbor.md', score: 0.5, tags: ['alpha'], snippet: 's' }],
        query: 'q',
        mode: 'semantic',
      },
    });
    ({ client } = await connectPair());

    await client.callTool({
      name: 'tag_suggest',
      arguments: { path: 'src.md', neighbor_limit: 22 },
    });

    const searchCalls = mock.calls.filter((c) => c.url === `${BRIDGE_URL}/api/v1/search`);
    const body = JSON.parse(searchCalls[0].init.body);
    assert.equal(body.limit, 22);
  });

  it('aggregates tags from search hits, excludes source path and existing tags', async () => {
    mock = installTagSuggestFetchMock({
      searchResponse: {
        results: [
          { path: 'src.md', score: 0.99, tags: ['existing-one'], snippet: 'x' },
          { path: 'neighbor.md', score: 0.5, tags: ['alpha', 'beta-tag'], snippet: 'y' },
        ],
        query: 'q',
        mode: 'semantic',
      },
    });
    ({ client } = await connectPair());

    const result = await client.callTool({
      name: 'tag_suggest',
      arguments: { path: 'src.md' },
    });

    assert.ok(!result.isError);
    const out = JSON.parse(result.content[0].text);
    assert.deepEqual(out.existing_tags, ['existing-one']);
    assert.ok(out.suggested_tags.includes('alpha'));
    assert.ok(out.suggested_tags.includes('beta-tag'));
  });

  it('falls back to canister get_note when hit has empty tags', async () => {
    mock = installTagSuggestFetchMock({
      searchResponse: {
        results: [{ path: 'neighbor.md', score: 0.5, tags: [], snippet: 's' }],
        query: 'q',
        mode: 'semantic',
      },
    });
    ({ client } = await connectPair());

    const result = await client.callTool({
      name: 'tag_suggest',
      arguments: { path: 'src.md' },
    });

    assert.ok(!result.isError);
    const out = JSON.parse(result.content[0].text);
    assert.ok(out.suggested_tags.includes('alpha'));
    assert.ok(out.suggested_tags.includes('beta-tag'));
    const neighborGets = mock.calls.filter(
      (c) => c.url === `${CANISTER_URL}/api/v1/notes/neighbor.md` || c.url.includes('/notes/neighbor.md')
    );
    assert.ok(neighborGets.length >= 1);
  });

  it('supports body-only input with empty existing_tags', async () => {
    mock = installTagSuggestFetchMock({
      searchResponse: {
        results: [{ path: 'neighbor.md', score: 0.5, tags: ['alpha'], snippet: 's' }],
        query: 'q',
        mode: 'semantic',
      },
    });
    ({ client } = await connectPair());

    const result = await client.callTool({
      name: 'tag_suggest',
      arguments: { body: 'free text for neighbors' },
    });

    assert.ok(!result.isError);
    const out = JSON.parse(result.content[0].text);
    assert.deepEqual(out.existing_tags, []);
    assert.deepEqual(out.suggested_tags, ['alpha']);
  });

  it('returns INVALID when neither path nor body', async () => {
    mock = installTagSuggestFetchMock({ searchResponse: { results: [], query: '', mode: 'semantic' } });
    ({ client } = await connectPair());

    const result = await client.callTool({
      name: 'tag_suggest',
      arguments: {},
    });

    assert.equal(result.isError, true);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.code, 'INVALID');
  });

  it('returns isError on upstream failure', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 502,
      json: async () => ({}),
      text: async () => 'bad',
    });
    mock = { restore: () => { globalThis.fetch = origFetch; } };
    ({ client } = await connectPair());

    const result = await client.callTool({
      name: 'tag_suggest',
      arguments: { path: 'src.md' },
    });

    assert.equal(result.isError, true);
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(parsed.error);
  });
});

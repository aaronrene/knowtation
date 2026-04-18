/**
 * Hosted MCP `relate` — canister source read + bridge semantic search + title hydration.
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

function installRelateFetchMock({ searchResponse }) {
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.includes(`${CANISTER_URL}/api/v1/notes/`) && !u.includes('/batch')) {
      const pathMatch = u.match(/\/notes\/(.+)$/);
      const rawPath = pathMatch ? decodeURIComponent(pathMatch[1]) : '';
      if (rawPath === 'ghost.md') {
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
          text: async () => 'not found',
        };
      }
      if (rawPath === 'src.md') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            path: 'src.md',
            body: 'alpha beta unique',
            // Canister shape: frontmatter is JSON text, not an object
            frontmatter: '{"title":"Source T","project":"p"}',
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
            body: '# Heading from body\n\nBody text.',
            frontmatter: '{}',
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
  const client = new Client({ name: 'relate-test', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, mcpServer };
}

describe('hosted MCP relate', () => {
  let mock;
  let client;

  afterEach(async () => {
    mock?.restore();
    try {
      await client?.close();
    } catch (_) {}
  });

  it('loads source from canister then POSTs semantic search with snippetChars and limit', async () => {
    mock = installRelateFetchMock({
      searchResponse: {
        results: [
          { path: 'src.md', score: 0.99, snippet: 'self' },
          { path: 'neighbor.md', score: 0.5, snippet: '  hello  world  ' },
        ],
        query: 'ignored',
        mode: 'semantic',
      },
    });
    ({ client } = await connectPair());

    await client.callTool({
      name: 'relate',
      arguments: { path: 'src.md', limit: 3 },
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
    assert.equal(body.limit, 36);
    assert.ok(body.query.includes('Source T'));
    assert.ok(body.query.includes('alpha beta unique'));
    assert.equal(body.project, undefined);
  });

  it('filters out the source path and maps snippets; hydrates titles from canister', async () => {
    mock = installRelateFetchMock({
      searchResponse: {
        results: [
          { path: 'src.md', score: 1, snippet: 'x' },
          { path: 'neighbor.md', score: 0.8, snippet: '  a  b  ' },
        ],
        query: 'q',
        mode: 'semantic',
      },
    });
    ({ client } = await connectPair());

    const result = await client.callTool({
      name: 'relate',
      arguments: { path: 'src.md', limit: 5 },
    });

    assert.ok(!result.isError);
    const out = JSON.parse(result.content[0].text);
    assert.equal(out.path, 'src.md');
    assert.equal(out.related.length, 1);
    assert.equal(out.related[0].path, 'neighbor.md');
    assert.equal(out.related[0].title, 'Heading from body');
    assert.equal(out.related[0].snippet, 'a b');
    assert.equal(typeof out.related[0].score, 'number');
  });

  it('passes normalized project slug to bridge search body', async () => {
    mock = installRelateFetchMock({
      searchResponse: { results: [], query: '', mode: 'semantic' },
    });
    ({ client } = await connectPair());

    await client.callTool({
      name: 'relate',
      arguments: { path: 'src.md', project: 'My Project!' },
    });

    const searchCall = mock.calls.find((c) => c.url === `${BRIDGE_URL}/api/v1/search`);
    const body = JSON.parse(searchCall.init.body);
    assert.equal(body.project, 'my-project');
  });

  it('omits neighbors that 404 on canister (stale vector paths)', async () => {
    mock = installRelateFetchMock({
      searchResponse: {
        results: [
          { path: 'src.md', score: 0.9, snippet: 'x' },
          { path: 'ghost.md', score: 0.85, snippet: 'gone' },
          { path: 'neighbor.md', score: 0.5, snippet: '  a  b  ' },
        ],
        query: 'q',
        mode: 'semantic',
      },
    });
    ({ client } = await connectPair());

    const result = await client.callTool({
      name: 'relate',
      arguments: { path: 'src.md', limit: 5 },
    });

    assert.ok(!result.isError);
    const out = JSON.parse(result.content[0].text);
    assert.equal(out.related.length, 1);
    assert.equal(out.related[0].path, 'neighbor.md');
  });

  it('uses vec_distance when bridge returns score 0', async () => {
    mock = installRelateFetchMock({
      searchResponse: {
        results: [
          { path: 'src.md', score: 0, vec_distance: 4, snippet: 'x' },
          { path: 'neighbor.md', score: 0, vec_distance: 1, snippet: 'y' },
        ],
        query: 'q',
        mode: 'semantic',
      },
    });
    ({ client } = await connectPair());

    const result = await client.callTool({
      name: 'relate',
      arguments: { path: 'src.md', limit: 2 },
    });

    const out = JSON.parse(result.content[0].text);
    assert.equal(out.related.length, 1);
    assert.ok(out.related[0].score > 0);
    assert.ok(Math.abs(out.related[0].score - 1 / 2) < 1e-9, '1/(1+1) for vec_distance 1');
  });

  it('omits neighbors when canister GET returns 404 (stale search hit)', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes(`${CANISTER_URL}/api/v1/notes/`) && u.includes('src.md')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ path: 'src.md', body: 'body', frontmatter: '{}' }),
          text: async () => '{}',
        };
      }
      if (u.includes(`${CANISTER_URL}/api/v1/notes/`)) {
        return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
      }
      if (u === `${BRIDGE_URL}/api/v1/search`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              { path: 'src.md', score: 0.9, snippet: '' },
              { path: 'projects/x/MY-NEIGHBOR.md', score: 0.5, snippet: 's' },
            ],
            query: 'q',
            mode: 'semantic',
          }),
        };
      }
      return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
    };
    mock = { restore: () => { globalThis.fetch = origFetch; } };
    ({ client } = await connectPair());

    const result = await client.callTool({
      name: 'relate',
      arguments: { path: 'src.md', limit: 2 },
    });

    const out = JSON.parse(result.content[0].text);
    assert.equal(out.related.length, 0);
  });

  it('returns isError on upstream failure', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 502,
      json: async () => ({}),
      text: async () => 'bad',
    });
    mock = { calls: [], restore: () => { globalThis.fetch = origFetch; } };
    ({ client } = await connectPair());

    const result = await client.callTool({
      name: 'relate',
      arguments: { path: 'missing.md' },
    });

    assert.equal(result.isError, true);
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(parsed.error);
  });
});

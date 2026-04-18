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
            body: 'n',
            frontmatter: '{"title":"Neighbor Title"}',
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
    const body = JSON.parse(searchCalls[0].init.body);
    assert.equal(body.mode, 'semantic');
    assert.equal(body.snippetChars, 200);
    assert.equal(body.limit, 18);
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
    assert.equal(out.related[0].title, 'Neighbor Title');
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

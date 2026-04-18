/**
 * Hosted MCP `cluster` — canister list + bodies + bridge POST /api/v1/embed + k-means.
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
    userId: 'u-1',
    vaultId: 'v-1',
    role: 'viewer',
    token: 'tok-test',
    canisterUrl: CANISTER_URL,
    bridgeUrl: BRIDGE_URL,
    ...overrides,
  };
}

function installClusterFetchMock({ shortList = false } = {}) {
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method, body: init?.body });
    if (u.includes(`${CANISTER_URL}/api/v1/notes?`)) {
      const notes = shortList
        ? [
            {
              path: 'a.md',
              frontmatter: '{"title":"Alpha"}',
              body: 'hello world one',
            },
          ]
        : [
            {
              path: 'a.md',
              frontmatter: '{"title":"Alpha"}',
              body: 'hello world one',
            },
            {
              path: 'b.md',
              frontmatter: '{"title":"Beta"}',
              body: 'hello world two',
            },
            {
              path: 'c.md',
              frontmatter: '{}',
              body: 'hello world three',
            },
          ];
      return {
        ok: true,
        status: 200,
        json: async () => ({ notes, total: notes.length }),
        text: async () => '{}',
      };
    }
    if (u.includes(`${BRIDGE_URL}/api/v1/embed`)) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const n = Array.isArray(body.texts) ? body.texts.length : 0;
      const vectors = Array.from({ length: n }, (_, i) => {
        const v = [0, 0, 0];
        v[i % 3] = 1;
        return v;
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ vectors, embedding_input_tokens: 3, texts_count: n }),
        text: async () => '{}',
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
  const client = new Client({ name: 'cluster-test', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, mcpServer };
}

describe('hosted MCP cluster', () => {
  let mock = { restore() {} };

  afterEach(() => {
    mock.restore();
  });

  it('POSTs texts to bridge /api/v1/embed and returns clusters', async () => {
    mock = installClusterFetchMock();
    const { client } = await connectPair();

    const result = await client.callTool({
      name: 'cluster',
      arguments: { n_clusters: 3 },
    });

    assert.ok(!result.isError);
    const out = JSON.parse(result.content[0].text);
    assert.equal(out.notes_sampled, 3);
    assert.equal(out.max_notes, 200);
    assert.equal(out.clusters.length, 3);
    const allPaths = out.clusters.flatMap((c) => c.paths);
    assert.ok(allPaths.includes('a.md'));
    assert.ok(allPaths.includes('b.md'));
    assert.ok(allPaths.includes('c.md'));
    assert.equal(out.cluster_truncated, false);
    assert.ok(mock.calls.some((c) => c.url.includes('/api/v1/embed')));
    const embedCall = mock.calls.find((c) => c.url.includes('/api/v1/embed'));
    const payload = JSON.parse(String(embedCall.body));
    assert.equal(payload.texts.length, 3);
  });

  it('returns note when too few notes for k', async () => {
    mock = installClusterFetchMock({ shortList: true });
    const { client } = await connectPair();

    const result = await client.callTool({
      name: 'cluster',
      arguments: { n_clusters: 5 },
    });

    assert.ok(!result.isError);
    const out = JSON.parse(result.content[0].text);
    assert.deepEqual(out.clusters, []);
    assert.ok(out.note.includes('Not enough notes'));
    assert.equal(out.notes_sampled, 1);
  });
});

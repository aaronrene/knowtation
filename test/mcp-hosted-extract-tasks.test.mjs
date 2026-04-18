/**
 * Hosted MCP `extract_tasks` — canister list + bodies + checkbox scan.
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

function installExtractTasksFetchMock({ emptyListBody = false } = {}) {
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push({ url: u });
    if (u.includes(`${CANISTER_URL}/api/v1/notes?`)) {
      const bodyField = emptyListBody ? '' : '- [ ] One task\n';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          notes: [
            {
              path: 'inbox/a.md',
              frontmatter: '{"date":"2026-04-01","tags":["alpha"]}',
              body: bodyField,
            },
            {
              path: 'other/b.md',
              frontmatter: '{}',
              body: '- [x] Done thing\n',
            },
          ],
          total: 2,
        }),
        text: async () => '{}',
      };
    }
    if (u.includes(`${CANISTER_URL}/api/v1/notes/inbox%2Fa.md`) || u.includes('/notes/inbox/a.md')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          path: 'inbox/a.md',
          frontmatter: '{"date":"2026-04-01","tags":["alpha"]}',
          body: '- [ ] One task\n',
        }),
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
  const client = new Client({ name: 'extract-tasks-test', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, mcpServer };
}

describe('hosted MCP extract_tasks', () => {
  let mock = { restore() {} };

  afterEach(() => {
    mock.restore();
  });

  it('returns open checkbox tasks from list row bodies', async () => {
    mock = installExtractTasksFetchMock();
    const { client } = await connectPair();

    const result = await client.callTool({
      name: 'extract_tasks',
      arguments: { status: 'open' },
    });

    assert.ok(!result.isError);
    const out = JSON.parse(result.content[0].text);
    assert.equal(out.tasks.length, 1);
    assert.equal(out.tasks[0].text, 'One task');
    assert.equal(out.tasks[0].path, 'inbox/a.md');
    assert.equal(out.tasks[0].status, 'open');
    assert.equal(out.extract_tasks_truncated, false);
    assert.equal(out.extract_tasks_notes_scanned, 2);
  });

  it('filters by folder client-side', async () => {
    mock = installExtractTasksFetchMock();
    const { client } = await connectPair();

    const result = await client.callTool({
      name: 'extract_tasks',
      arguments: { folder: 'inbox' },
    });

    assert.ok(!result.isError);
    const out = JSON.parse(result.content[0].text);
    assert.equal(out.tasks.length, 1);
    assert.equal(out.tasks[0].path, 'inbox/a.md');
  });

  it('fetches note when list body is empty', async () => {
    mock = installExtractTasksFetchMock({ emptyListBody: true });
    const { client } = await connectPair();

    const result = await client.callTool({
      name: 'extract_tasks',
      arguments: {},
    });

    assert.ok(!result.isError);
    const out = JSON.parse(result.content[0].text);
    assert.ok(out.tasks.some((t) => t.text === 'One task'));
    assert.ok(mock.calls.some((c) => c.url.includes('/notes/inbox')));
  });
});

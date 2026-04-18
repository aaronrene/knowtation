/**
 * Hosted MCP `backlinks` — canister list + per-note GET + wikilink scan.
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

function installBacklinksFetchMock() {
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push({ url: u });
    if (u === `${CANISTER_URL}/api/v1/notes/target.md`) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ path: 'target.md', body: 'target body', frontmatter: '{}' }),
        text: async () => '{}',
      };
    }
    if (u.includes(`${CANISTER_URL}/api/v1/notes?`)) {
      const offset = u.includes('offset=1') ? 1 : 0;
      if (offset === 0) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            notes: [
              { path: 'target.md', frontmatter: '{}' },
              { path: 'linker.md', frontmatter: '{}' },
            ],
            total: 2,
          }),
          text: async () => '{}',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ notes: [], total: 2 }),
        text: async () => '{}',
      };
    }
    if (u.includes(`${CANISTER_URL}/api/v1/notes/`) && u.includes('linker.md')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          path: 'linker.md',
          body: 'See [[target]] here.',
          frontmatter: '{"title":"Linker"}',
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
  const client = new Client({ name: 'backlinks-test', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, mcpServer };
}

describe('hosted MCP backlinks', () => {
  let mock = { restore() {} };

  afterEach(() => {
    mock.restore();
  });

  it('returns backlinks when another note wikilinks to target basename', async () => {
    mock = installBacklinksFetchMock();
    const { client } = await connectPair();

    const result = await client.callTool({
      name: 'backlinks',
      arguments: { path: 'target.md' },
    });

    assert.ok(!result.isError);
    const out = JSON.parse(result.content[0].text);
    assert.equal(out.path, 'target.md');
    assert.equal(out.backlinks.length, 1);
    assert.equal(out.backlinks[0].path, 'linker.md');
    assert.ok(out.backlinks[0].context.includes('[[target]]'));
    assert.equal(out.backlinks_truncated, false);
    assert.ok(typeof out.backlinks_notes_scanned === 'number');
  });

  it('returns isError when target note missing', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/notes/missing.md') && !u.includes('?')) {
        return { ok: false, status: 404, json: async () => ({}), text: async () => 'nf' };
      }
      return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
    };
    mock = { restore: () => { globalThis.fetch = origFetch; } };
    const { client } = await connectPair();

    const result = await client.callTool({
      name: 'backlinks',
      arguments: { path: 'missing.md' },
    });

    assert.equal(result.isError, true);
  });
});

/**
 * Hosted MCP prompts/list + getPrompt: JSON Schema export (Zod args) and upstream fetch wiring.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHostedMcpServer } from '../hub/gateway/mcp-hosted-server.mjs';

const CANISTER_URL = 'http://canister.test:4322';
const BRIDGE_URL = 'http://bridge.test:4321';

/** Golden prompt IDs for viewer (excludes write-from-capture → editor minimum). */
const PROMPTS_VIEWER = [
  'causal-chain',
  'content-plan',
  'daily-brief',
  'extract-entities',
  'knowledge-gap',
  'meeting-notes',
  'project-summary',
  'search-and-synthesize',
  'temporal-summary',
];

/** All hosted prompts when role meets editor for write-from-capture. */
const PROMPTS_ALL = [...PROMPTS_VIEWER, 'write-from-capture'];

function sortNames(names) {
  return [...names].sort((a, b) => a.localeCompare(b));
}

async function listPromptNamesForRole(role) {
  const mcpServer = createHostedMcpServer({
    userId: 'u-test',
    vaultId: 'v-test',
    role,
    token: 'tok-test',
    canisterUrl: CANISTER_URL,
    bridgeUrl: BRIDGE_URL,
  });
  const client = new Client({ name: 'prompts-list-test', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { prompts } = await client.listPrompts();
    assert.ok(Array.isArray(prompts), 'prompts/list must return an array');
    assert.ok(prompts.length > 0, `${role}: at least one prompt must be listed`);
    for (const p of prompts) {
      assert.ok(p.name, 'each prompt has a name');
      assert.ok(
        p.arguments != null && typeof p.arguments === 'object',
        `prompt ${p.name} must have arguments object (prompts/list serialization)`
      );
    }
    return prompts.map((p) => p.name);
  } finally {
    try {
      await client.close();
    } catch (_) {}
  }
}

function installFetchMock(listNotesBody) {
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    if (u.includes(`${CANISTER_URL}/api/v1/notes?`)) {
      return {
        ok: true,
        status: 200,
        json: async () => listNotesBody,
        text: async () => JSON.stringify(listNotesBody),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
    };
  };
  return {
    calls,
    restore() {
      globalThis.fetch = origFetch;
    },
  };
}

describe('hosted MCP prompts/list (JSON Schema export)', () => {
  it('viewer role lists nine prompts (no write-from-capture)', async () => {
    const names = sortNames(await listPromptNamesForRole('viewer'));
    assert.deepEqual(names, sortNames(PROMPTS_VIEWER));
  });

  it('editor role lists ten prompts including write-from-capture', async () => {
    const names = sortNames(await listPromptNamesForRole('editor'));
    assert.deepEqual(names, sortNames(PROMPTS_ALL));
  });

  it('admin role lists same ten prompts as editor', async () => {
    const names = sortNames(await listPromptNamesForRole('admin'));
    assert.deepEqual(names, sortNames(PROMPTS_ALL));
  });
});

describe('hosted MCP getPrompt — daily-brief', () => {
  it('calls canister GET /api/v1/notes with since and limit', async () => {
    const mock = installFetchMock({
      notes: [{ path: 'inbox/a.md', frontmatter: { title: 'A', date: '2026-04-01' }, body: 'Hello world' }],
      total: 1,
    });
    const mcpServer = createHostedMcpServer({
      userId: 'u-test',
      vaultId: 'v-test',
      role: 'viewer',
      token: 'tok-test',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    });
    const client = new Client({ name: 'get-prompt-test', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const res = await client.getPrompt({
        name: 'daily-brief',
        arguments: { date: '2026-04-10' },
      });
      assert.ok(res.messages && res.messages.length >= 2, 'prompt returns messages');
      const listCalls = mock.calls.filter((c) => c.url.startsWith(`${CANISTER_URL}/api/v1/notes?`));
      assert.equal(listCalls.length, 1, 'one list_notes style fetch');
      assert.ok(listCalls[0].url.includes('since=2026-04-10'), 'since query param');
      assert.ok(listCalls[0].url.includes('limit=80'), 'limit query param');
      const m = listCalls[0].init?.method;
      assert.ok(m === undefined || m === 'GET', 'canister list uses GET');
      assert.equal(listCalls[0].init?.headers?.['X-Vault-Id'], 'v-test');
      assert.equal(listCalls[0].init?.headers?.['Authorization'], 'Bearer tok-test');
    } finally {
      mock.restore();
      try {
        await client.close();
      } catch (_) {}
    }
  });
});

describe('hosted MCP getPrompt — knowledge-gap', () => {
  it('POSTs bridge /api/v1/search with semantic limit 15', async () => {
    const calls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      if (u === `${BRIDGE_URL}/api/v1/search`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: [{ path: 'inbox/q.md', snippet: 'snippet text' }] }),
          text: async () => '{}',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '{}',
      };
    };

    const mcpServer = createHostedMcpServer({
      userId: 'u-test',
      vaultId: 'v-test',
      role: 'viewer',
      token: 'tok-test',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    });
    const client = new Client({ name: 'kg-prompt-test', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const res = await client.getPrompt({
        name: 'knowledge-gap',
        arguments: { query: 'pricing strategy' },
      });
      assert.ok(res.messages && res.messages.length >= 1);
      const searchCalls = calls.filter((c) => c.url === `${BRIDGE_URL}/api/v1/search`);
      assert.equal(searchCalls.length, 1);
      assert.equal(searchCalls[0].init?.method, 'POST');
      const body = JSON.parse(searchCalls[0].init?.body || '{}');
      assert.equal(body.query, 'pricing strategy');
      assert.equal(body.mode, 'semantic');
      assert.equal(body.limit, 15);
      assert.equal(body.fields, 'path+snippet');
      assert.equal(body.snippetChars, 200);
    } finally {
      globalThis.fetch = origFetch;
      try {
        await client.close();
      } catch (_) {}
    }
  });
});

describe('hosted MCP getPrompt — causal-chain', () => {
  it('search includes chain filter then GET note per path', async () => {
    const calls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      if (u === `${BRIDGE_URL}/api/v1/search`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: [{ path: 'notes/a.md' }] }),
          text: async () => '{}',
        };
      }
      if (u === `${CANISTER_URL}/api/v1/notes/notes%2Fa.md`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            path: 'notes/a.md',
            body: 'body',
            frontmatter: { date: '2026-01-02', causal_chain_id: 'my-chain' },
          }),
          text: async () => '{}',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '{}',
      };
    };

    const mcpServer = createHostedMcpServer({
      userId: 'u-test',
      vaultId: 'v-test',
      role: 'viewer',
      token: 'tok-test',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    });
    const client = new Client({ name: 'cc-prompt-test', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const res = await client.getPrompt({
        name: 'causal-chain',
        arguments: { chain_id: 'My-Chain' },
      });
      assert.ok(res.messages && res.messages.length >= 1);
      const searchCalls = calls.filter((c) => c.url === `${BRIDGE_URL}/api/v1/search`);
      assert.equal(searchCalls.length, 1);
      const body = JSON.parse(searchCalls[0].init?.body || '{}');
      assert.equal(body.chain, 'my-chain');
      assert.equal(body.mode, 'semantic');
      const getCalls = calls.filter((c) => c.url.includes(`${CANISTER_URL}/api/v1/notes/`) && !c.url.includes('?'));
      assert.ok(getCalls.length >= 1, 'at least one canister GET note');
    } finally {
      globalThis.fetch = origFetch;
      try {
        await client.close();
      } catch (_) {}
    }
  });
});

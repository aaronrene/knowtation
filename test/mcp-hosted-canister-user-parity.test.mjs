/**
 * Hosted MCP must send the same canister X-User-Id as the Hub gateway (effective workspace user).
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHostedMcpServer } from '../hub/gateway/mcp-hosted-server.mjs';

const CANISTER_URL = 'http://canister.test:4322';
const BRIDGE_URL = 'http://bridge.test:4321';

function headerGet(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()];
}

describe('hosted MCP canister user parity', () => {
  let origFetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('list_notes uses canisterUserId for X-User-Id when set', async () => {
    /** @type {Record<string, string> | import('node:fetch').Headers | undefined} */
    let sawHeaders;
    origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.startsWith(`${CANISTER_URL}/api/v1/notes`)) {
        sawHeaders = init?.headers;
        return {
          ok: true,
          status: 200,
          json: async () => ({ notes: [], total: 0 }),
          text: async () => '{"notes":[],"total":0}',
        };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    };

    const mcpServer = createHostedMcpServer({
      userId: 'google:actor',
      canisterUserId: 'google:owner',
      vaultId: 'default',
      role: 'viewer',
      token: 'tok',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    });
    const client = new Client({ name: 'parity-test', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      await client.callTool({ name: 'list_notes', arguments: {} });
      assert.equal(headerGet(sawHeaders, 'X-User-Id'), 'google:owner');
    } finally {
      await client.close();
    }
  });

  it('list_notes falls back to userId when canisterUserId omitted', async () => {
    let sawHeaders;
    origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.startsWith(`${CANISTER_URL}/api/v1/notes`)) {
        sawHeaders = init?.headers;
        return {
          ok: true,
          status: 200,
          json: async () => ({ notes: [], total: 0 }),
          text: async () => '{"notes":[],"total":0}',
        };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    };

    const mcpServer = createHostedMcpServer({
      userId: 'google:only',
      vaultId: 'default',
      role: 'viewer',
      token: 'tok',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    });
    const client = new Client({ name: 'parity-test-2', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      await client.callTool({ name: 'list_notes', arguments: {} });
      assert.equal(headerGet(sawHeaders, 'X-User-Id'), 'google:only');
    } finally {
      await client.close();
    }
  });

  it('get_note uses canisterUserId for X-User-Id when set', async () => {
    let sawHeaders;
    origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes(`${CANISTER_URL}/api/v1/notes/`) && u.endsWith('only.md')) {
        sawHeaders = init?.headers;
        return {
          ok: true,
          status: 200,
          json: async () => ({ path: 'only.md', body: 'b', frontmatter: '{}' }),
          text: async () => '{}',
        };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    };

    const mcpServer = createHostedMcpServer({
      userId: 'google:actor',
      canisterUserId: 'google:owner',
      vaultId: 'default',
      role: 'viewer',
      token: 'tok',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    });
    const client = new Client({ name: 'parity-get-note', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      await client.callTool({ name: 'get_note', arguments: { path: 'only.md' } });
      assert.equal(headerGet(sawHeaders, 'X-User-Id'), 'google:owner');
    } finally {
      await client.close();
    }
  });

  it('write uses canisterUserId for X-User-Id when set', async () => {
    let sawHeaders;
    origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u === `${CANISTER_URL}/api/v1/notes` && String(init?.method || 'GET').toUpperCase() === 'POST') {
        sawHeaders = init?.headers;
        return {
          ok: true,
          status: 200,
          json: async () => ({ path: 'new.md', ok: true }),
          text: async () => '{}',
        };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    };

    const mcpServer = createHostedMcpServer({
      userId: 'google:actor',
      canisterUserId: 'google:owner',
      vaultId: 'default',
      role: 'editor',
      token: 'tok',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    });
    const client = new Client({ name: 'parity-write', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      await client.callTool({
        name: 'write',
        arguments: { path: 'new.md', body: '# hello' },
      });
      assert.equal(headerGet(sawHeaders, 'X-User-Id'), 'google:owner');
    } finally {
      await client.close();
    }
  });

  it('capture uses canisterUserId for X-User-Id when set', async () => {
    let sawHeaders;
    let postBody;
    origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u === `${CANISTER_URL}/api/v1/notes` && String(init?.method || 'GET').toUpperCase() === 'POST') {
        sawHeaders = init?.headers;
        postBody = init?.body != null ? JSON.parse(String(init.body)) : null;
        return {
          ok: true,
          status: 200,
          json: async () => ({ path: postBody?.path ?? 'inbox/x.md', written: true }),
          text: async () => '{}',
        };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    };

    const mcpServer = createHostedMcpServer({
      userId: 'google:actor',
      canisterUserId: 'google:owner',
      vaultId: 'default',
      role: 'editor',
      token: 'tok',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    });
    const client = new Client({ name: 'parity-capture', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      await client.callTool({
        name: 'capture',
        arguments: { text: 'Hello capture parity' },
      });
      assert.equal(headerGet(sawHeaders, 'X-User-Id'), 'google:owner');
      assert.ok(postBody && typeof postBody.path === 'string');
      assert.ok(postBody.path.startsWith('inbox/'));
      assert.equal(postBody.body, 'Hello capture parity');
      assert.equal(postBody.frontmatter?.source, 'mcp-capture');
      assert.equal(postBody.frontmatter?.inbox, true);
    } finally {
      await client.close();
    }
  });

  it('export uses canisterUserId for X-User-Id when set', async () => {
    let sawHeaders;
    origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.endsWith('/api/v1/export')) {
        sawHeaders = init?.headers;
        const enc = new TextEncoder();
        const bytes = enc.encode('{"notes":[]}');
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => buf,
          headers: { get: () => 'application/json' },
        };
      }
      return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), text: async () => '' };
    };

    const mcpServer = createHostedMcpServer({
      userId: 'google:actor',
      canisterUserId: 'google:owner',
      vaultId: 'default',
      role: 'admin',
      token: 'tok',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    });
    const client = new Client({ name: 'parity-export', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      await client.callTool({ name: 'export', arguments: {} });
      assert.equal(headerGet(sawHeaders, 'X-User-Id'), 'google:owner');
    } finally {
      await client.close();
    }
  });

  it('vault-info resource exposes actor userId and canisterUserId', async () => {
    origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.startsWith(`${CANISTER_URL}/api/v1/notes`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ notes: [], total: 0 }),
          text: async () => '{"notes":[],"total":0}',
        };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    };

    const mcpServer = createHostedMcpServer({
      userId: 'google:actor',
      canisterUserId: 'google:owner',
      vaultId: 'default',
      role: 'viewer',
      token: 'tok',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
      scope: { projects: ['launch'] },
    });
    const client = new Client({ name: 'parity-resource', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const { resources } = await client.listResources();
      const vault = resources.find((r) => r.uri === 'knowtation://hosted/vault-info');
      assert.ok(vault, 'vault-info resource listed');
      const read = await client.readResource({ uri: 'knowtation://hosted/vault-info' });
      const text = read.contents[0].text;
      const j = JSON.parse(text);
      assert.equal(j.userId, 'google:actor');
      assert.equal(j.canisterUserId, 'google:owner');
      assert.equal(j.vaultId, 'default');
      assert.deepEqual(j.scope, { projects: ['launch'] });
    } finally {
      await client.close();
    }
  });
});

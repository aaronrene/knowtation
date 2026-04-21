/**
 * R3+ hosted MCP: templates-index, template/{+name}, vault/.../image/{index}, memory/topic/{slug}.
 */

import dns from 'node:dns/promises';
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHostedMcpServer } from '../hub/gateway/mcp-hosted-server.mjs';

const CANISTER_URL = 'http://canister.test:4322';
const BRIDGE_URL = 'http://bridge.test:4321';

/**
 * @param {{
 *   getNoteResponses?: Record<string, unknown>,
 *   listNotesResponse?: { notes?: unknown[], total?: number },
 *   memoryResponse?: { events?: unknown[], count?: number },
 * }} opts
 */
function installFetchMock(opts = {}) {
  const calls = [];
  const getNoteResponses = opts.getNoteResponses || {};
  const listNotesResponse = opts.listNotesResponse ?? { notes: [], total: 0 };
  const memoryResponse = opts.memoryResponse ?? { events: [], count: 0 };
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.includes(`${BRIDGE_URL}/api/v1/memory`)) {
      return {
        ok: true,
        status: 200,
        json: async () => memoryResponse,
        text: async () => JSON.stringify(memoryResponse),
      };
    }
    if (u.includes('/api/v1/notes?')) {
      return {
        ok: true,
        status: 200,
        json: async () => listNotesResponse,
        text: async () => JSON.stringify(listNotesResponse),
      };
    }
    const notePrefix = `${CANISTER_URL}/api/v1/notes/`;
    if (u.startsWith(notePrefix)) {
      const path = decodeURIComponent(u.slice(notePrefix.length));
      const body = getNoteResponses[path];
      if (body !== undefined) {
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        };
      }
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

async function connect(ctx) {
  const mcpServer = createHostedMcpServer(ctx);
  const client = new Client({ name: 'r3-resource-test', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, mcpServer, clientTransport, serverTransport };
}

describe('hosted MCP R3 — template resources', () => {
  let mock;
  let client;

  afterEach(async () => {
    mock?.restore();
    try {
      await client?.close();
    } catch (_) {}
  });

  it('templates-index lists template paths from folder=templates', async () => {
    mock = installFetchMock({
      listNotesResponse: {
        notes: [
          { path: 'templates/capture.md', frontmatter: {}, body: 'x' },
          { path: 'templates/other/x.md', frontmatter: {}, body: 'y' },
        ],
        total: 2,
      },
    });
    ({ client } = await connect({
      userId: 'u1',
      vaultId: 'v1',
      role: 'viewer',
      token: 't',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    }));

    const read = await client.readResource({ uri: 'knowtation://hosted/templates-index' });
    assert.equal(read.contents[0].mimeType, 'application/json');
    const j = JSON.parse(read.contents[0].text);
    assert.deepEqual(j.templates, ['templates/capture.md', 'templates/other/x.md']);
    const folderCalls = mock.calls.filter((c) => String(c.url).includes('folder=templates'));
    assert.equal(folderCalls.length, 1);
  });

  it('readResource template file uses GET note templates/name.md', async () => {
    mock = installFetchMock({
      getNoteResponses: {
        'templates/capture.md': {
          path: 'templates/capture.md',
          frontmatter: { title: 'Cap' },
          body: 'Template body',
        },
      },
      listNotesResponse: { notes: [], total: 0 },
    });
    ({ client } = await connect({
      userId: 'u1',
      vaultId: 'v1',
      role: 'viewer',
      token: 't',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    }));

    const read = await client.readResource({ uri: 'knowtation://hosted/template/capture' });
    assert.equal(read.contents[0].mimeType, 'text/markdown');
    assert.match(read.contents[0].text, /Template body/);
    const noteCalls = mock.calls.filter((c) => c.url.includes('/api/v1/notes/templates%2Fcapture.md'));
    assert.equal(noteCalls.length, 1);
    assert.equal(noteCalls[0].init.method, 'GET');
  });
});

describe('hosted MCP R3 — memory topic resource', () => {
  let mock;
  let client;

  afterEach(async () => {
    mock?.restore();
    try {
      await client?.close();
    } catch (_) {}
  });

  it('readResource filters events by topic slug via extractTopicFromEvent', async () => {
    mock = installFetchMock({
      memoryResponse: {
        events: [
          { type: 'search', ts: '2026-01-01', data: { topic: 'alpha', q: 'x' } },
          { type: 'search', ts: '2026-01-02', data: { topic: 'beta', q: 'y' } },
        ],
        count: 2,
      },
    });
    ({ client } = await connect({
      userId: 'u1',
      vaultId: 'v1',
      role: 'viewer',
      token: 't',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    }));

    const read = await client.readResource({ uri: 'knowtation://hosted/memory/topic/alpha' });
    const j = JSON.parse(read.contents[0].text);
    assert.equal(j.count, 1);
    assert.equal(j.events[0].data.topic, 'alpha');

    const memCalls = mock.calls.filter((c) => String(c.url).startsWith(`${BRIDGE_URL}/api/v1/memory`));
    assert.ok(memCalls.length >= 1);
    const h = memCalls[0].init.headers;
    const hdr = (k) => (typeof h.get === 'function' ? h.get(k) : h[k]);
    assert.equal(hdr('Authorization'), 'Bearer t');
  });
});

describe('hosted MCP R3 — note image resource', () => {
  let mock;
  let client;

  afterEach(async () => {
    mock?.restore();
    try {
      await client?.close();
    } catch (_) {}
  });

  it('readResource rejects out-of-range image index (no outbound image fetch)', async () => {
    mock = installFetchMock({
      getNoteResponses: {
        'inbox/p.md': {
          path: 'inbox/p.md',
          frontmatter: {},
          body: '![a](https://example.com/one.png)',
        },
      },
      listNotesResponse: { notes: [], total: 0 },
    });
    ({ client } = await connect({
      userId: 'u1',
      vaultId: 'v1',
      role: 'viewer',
      token: 't',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    }));

    await assert.rejects(
      () => client.readResource({ uri: 'knowtation://hosted/vault/inbox/p.md/image/3' }),
      /out of range|McpError|invalid/i
    );
    const httpsCalls = mock.calls.filter((c) => String(c.url).startsWith('https://'));
    assert.equal(httpsCalls.length, 0, 'should not fetch remote image URL when index is invalid');
  });

  it('readResource …/note.md/image/0 returns image/* not folder JSON (greedy vault/{+path} fallback)', async () => {
    /** Avoid real DNS in CI/sandbox; fetchImageAsBase64 resolves hostname before fetch. */
    const origLookup = dns.lookup;
    dns.lookup = async () => ({ address: '8.8.8.8', family: 4 });
    const pngBuf = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const inner = installFetchMock({
      getNoteResponses: {
        'inbox/deep/smoke.md': {
          path: 'inbox/deep/smoke.md',
          frontmatter: {},
          body: '![](https://example.org/prove.png)',
        },
      },
      listNotesResponse: { notes: [], total: 0 },
    });
    mock = { calls: inner.calls, restore: inner.restore };
    const chainFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u === 'https://example.org/prove.png') {
        return {
          ok: true,
          status: 200,
          headers: {
            get: (name) => {
              const n = String(name).toLowerCase();
              if (n === 'content-type') return 'image/png';
              if (n === 'content-length') return String(pngBuf.length);
              return null;
            },
          },
          arrayBuffer: async () => pngBuf.buffer.slice(pngBuf.byteOffset, pngBuf.byteOffset + pngBuf.byteLength),
        };
      }
      return chainFetch(url, init);
    };
    ({ client } = await connect({
      userId: 'u1',
      vaultId: 'v1',
      role: 'viewer',
      token: 't',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    }));
    try {
      const read = await client.readResource({
        uri: 'knowtation://hosted/vault/inbox/deep/smoke.md/image/0',
      });
      assert.notEqual(read.contents[0].mimeType, 'application/json', 'must not be folder listing JSON');
      assert.match(String(read.contents[0].mimeType), /^image\//);
      assert.ok(read.contents[0].blob);
    } finally {
      globalThis.fetch = chainFetch;
      dns.lookup = origLookup;
    }
  });

  it('resources/list merges image URIs from notes (cap 50)', async () => {
    mock = installFetchMock({
      listNotesResponse: {
        notes: [{ path: 'n.md', frontmatter: {}, body: '![](https://example.com/x.png)' }],
        total: 1,
      },
    });
    ({ client } = await connect({
      userId: 'u1',
      vaultId: 'v1',
      role: 'viewer',
      token: 't',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    }));

    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    assert.ok(uris.some((u) => u === 'knowtation://hosted/vault/n.md/image/0'), `got: ${uris.join(',')}`);
  });
});

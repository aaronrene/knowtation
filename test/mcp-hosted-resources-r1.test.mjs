/**
 * R1 + R2 hosted MCP: `knowtation://hosted/vault/{+path}` — note reads (get_note) and folder JSON (list_notes).
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHostedMcpServer } from '../hub/gateway/mcp-hosted-server.mjs';

const CANISTER_URL = 'http://canister.test:4322';
const BRIDGE_URL = 'http://bridge.test:4321';

/**
 * @param {unknown} getNoteResponse - JSON for GET /api/v1/notes/:path
 * @param {{ notes?: unknown[], total?: number }} [listNotesResponse] - JSON for GET /api/v1/notes?…
 */
function installNoteFetchMock(getNoteResponse, listNotesResponse = { notes: [], total: 0 }) {
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.includes('/api/v1/notes?')) {
      return {
        ok: true,
        status: 200,
        json: async () => listNotesResponse,
        text: async () => JSON.stringify(listNotesResponse),
      };
    }
    if (u.startsWith(`${CANISTER_URL}/api/v1/notes/`)) {
      return {
        ok: true,
        status: 200,
        json: async () => getNoteResponse,
        text: async () => JSON.stringify(getNoteResponse),
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

async function connect(ctx) {
  const mcpServer = createHostedMcpServer(ctx);
  const client = new Client({ name: 'r1-resource-test', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, mcpServer, clientTransport, serverTransport };
}

describe('hosted MCP R1 — vault note resource template', () => {
  let mock;
  let client;

  afterEach(async () => {
    mock?.restore();
    try {
      await client?.close();
    } catch (_) {}
  });

  it('readResource uses GET canister /notes/:path with same headers intent as get_note', async () => {
    mock = installNoteFetchMock({
      path: 'inbox/hello.md',
      frontmatter: { title: 'Hello' },
      body: 'Body line',
    });
    ({ client } = await connect({
      userId: 'u-actor',
      canisterUserId: 'u-canister',
      vaultId: 'v-1',
      role: 'viewer',
      token: 'tok',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    }));

    const uri = 'knowtation://hosted/vault/inbox/hello.md';
    const read = await client.readResource({ uri });
    assert.equal(read.contents.length, 1);
    assert.equal(read.contents[0].mimeType, 'text/markdown');
    assert.match(read.contents[0].text, /title:\s*Hello/);
    assert.match(read.contents[0].text, /Body line/);

    const noteCalls = mock.calls.filter((c) => c.url.includes('/api/v1/notes/'));
    assert.equal(noteCalls.length, 1);
    assert.equal(noteCalls[0].url, `${CANISTER_URL}/api/v1/notes/inbox%2Fhello.md`);
    assert.equal(noteCalls[0].init.method, 'GET');
    const h = noteCalls[0].init.headers;
    const hdr = (k) => (typeof h.get === 'function' ? h.get(k) : h[k]);
    assert.equal(hdr('X-User-Id'), 'u-canister');
    assert.equal(hdr('X-Vault-Id'), 'v-1');
    assert.equal(hdr('Authorization'), 'Bearer tok');
  });

  it('lists resource template for hosted vault path pattern', async () => {
    mock = installNoteFetchMock({ path: 'x.md', frontmatter: {}, body: '' });
    ({ client } = await connect({
      userId: 'u1',
      vaultId: 'v1',
      role: 'viewer',
      token: 't',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    }));

    const listed = await client.listResourceTemplates();
    const names = (listed.resourceTemplates || []).map((t) => t.name || t.uriTemplate);
    assert.ok(
      names.some((n) => String(n).includes('hosted-vault-note') || String(n).includes('hosted/vault')),
      `expected hosted vault note template, got: ${JSON.stringify(names)}`
    );
  });

  it('vault-info static resource still listed', async () => {
    mock = installNoteFetchMock({ path: 'x.md', frontmatter: {}, body: '' });
    ({ client } = await connect({
      userId: 'u1',
      vaultId: 'v1',
      role: 'viewer',
      token: 't',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    }));
    const { resources } = await client.listResources();
    const vault = resources.find((r) => r.uri === 'knowtation://hosted/vault-info');
    assert.ok(vault, 'vault-info still present');
  });

  it('resources/list merges template list so Cursor-style clients see note URIs (cap 50)', async () => {
    const listNotesResponse = {
      notes: [
        { path: 'inbox/a.md', frontmatter: { title: 'A' }, body: 'alpha' },
        { path: 'projects/p/b.md', frontmatter: {}, body: '# B\nbody' },
      ],
      total: 2,
    };
    mock = installNoteFetchMock({ path: 'x.md', frontmatter: {}, body: '' }, listNotesResponse);
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
    assert.ok(uris.includes('knowtation://hosted/vault-info'));
    assert.ok(uris.includes('knowtation://hosted/vault/inbox/a.md'));
    assert.ok(uris.includes('knowtation://hosted/vault/projects/p/b.md'));

    const listCalls = mock.calls.filter((c) => {
      const u = String(c.url);
      return (
        u.includes('/api/v1/notes?') &&
        u.includes('limit=50') &&
        u.includes('offset=0') &&
        !u.includes('folder=')
      );
    });
    assert.ok(listCalls.length >= 1, 'vault note + R3 image list both use first-page canister list');
    assert.match(listCalls[0].url, /limit=50/);
  });

  it('rejects path traversal', async () => {
    mock = installNoteFetchMock({});
    ({ client } = await connect({
      userId: 'u1',
      vaultId: 'v1',
      role: 'viewer',
      token: 't',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    }));

    await assert.rejects(
      () => client.readResource({ uri: 'knowtation://hosted/vault/../secret.md' }),
      /Invalid path|McpError|invalid/i
    );
  });

  it('readResource for non-.md path uses GET /api/v1/notes?folder=… (R2 folder listing)', async () => {
    mock = installNoteFetchMock(
      {},
      {
        notes: [{ path: 'inbox/a.md', frontmatter: {}, body: '' }],
        total: 50,
      },
    );
    ({ client } = await connect({
      userId: 'u1',
      vaultId: 'v1',
      role: 'viewer',
      token: 't',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    }));

    const read = await client.readResource({ uri: 'knowtation://hosted/vault/inbox' });
    assert.equal(read.contents.length, 1);
    assert.equal(read.contents[0].mimeType, 'application/json');
    const j = JSON.parse(read.contents[0].text);
    assert.equal(j.folder, '/inbox');
    assert.equal(j.total, 50);
    assert.equal(j.notes.length, 1);
    assert.equal(j.truncated, false, '50 notes fits in one page of 100');

    const listCalls = mock.calls.filter((c) => String(c.url).includes('/api/v1/notes?'));
    assert.ok(listCalls.length >= 1);
    const hit = listCalls.find((c) => c.url.includes('folder=inbox') && c.url.includes('limit=100'));
    assert.ok(hit, `expected folder=inbox in list URL, got: ${listCalls.map((c) => c.url).join(' | ')}`);
  });
});

describe('hosted MCP R2 — vault-listing static resource', () => {
  let mock;
  let client;

  afterEach(async () => {
    mock?.restore();
    try {
      await client?.close();
    } catch (_) {}
  });

  it('readResource uses GET /api/v1/notes?limit=100&offset=0', async () => {
    mock = installNoteFetchMock({}, { notes: [{ path: 'a.md', frontmatter: {}, body: '' }], total: 99 });
    ({ client } = await connect({
      userId: 'u1',
      vaultId: 'v1',
      role: 'viewer',
      token: 't',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    }));

    const read = await client.readResource({ uri: 'knowtation://hosted/vault-listing' });
    assert.equal(read.contents[0].mimeType, 'application/json');
    const j = JSON.parse(read.contents[0].text);
    assert.equal(j.total, 99);

    const listCalls = mock.calls.filter((c) => String(c.url).includes('/api/v1/notes?'));
    assert.ok(listCalls.some((c) => c.url.includes('limit=100') && c.url.includes('offset=0')));
  });

  it('listResources includes knowtation://hosted/vault-listing', async () => {
    mock = installNoteFetchMock({}, { notes: [], total: 0 });
    ({ client } = await connect({
      userId: 'u1',
      vaultId: 'v1',
      role: 'viewer',
      token: 't',
      canisterUrl: CANISTER_URL,
      bridgeUrl: BRIDGE_URL,
    }));
    const { resources } = await client.listResources();
    const row = resources.find((r) => r.uri === 'knowtation://hosted/vault-listing');
    assert.ok(row, 'vault-listing listed');
  });
});

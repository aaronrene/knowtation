/**
 * Hosted MCP get_note_outline tests.
 *
 * Phase 1D must mirror hosted get_note access: same canister read path, same
 * auth headers, viewer-level ACL, and a body-free NoteOutline response.
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
    userId: 'google:actor',
    canisterUserId: 'google:owner',
    vaultId: 'vault-outline',
    role: 'viewer',
    token: 'tok-outline',
    canisterUrl: CANISTER_URL,
    bridgeUrl: BRIDGE_URL,
    canisterAuthSecret: 'gw-secret-outline',
    ...overrides,
  };
}

function headerGet(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()];
}

function installFetchMock(handler) {
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = origFetch;
    },
  };
}

async function connectPair(ctx = makeCtx()) {
  const mcpServer = createHostedMcpServer(ctx);
  const client = new Client({ name: 'hosted-note-outline', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return { client };
}

function parseToolResult(result) {
  const text = result.content?.[0]?.text;
  assert.equal(typeof text, 'string');
  return JSON.parse(text);
}

describe('hosted MCP get_note_outline', () => {
  let mock;
  let client;

  afterEach(async () => {
    try {
      await client?.close();
    } catch (_) {}
    mock?.restore?.();
  });

  it('viewer role lists get_note_outline as a read tool', async () => {
    mock = installFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
    }));
    ({ client } = await connectPair());

    const { tools } = await client.listTools();
    assert.ok(tools.some((tool) => tool.name === 'get_note_outline'));
  });

  it('uses the same canister GET path and auth headers as get_note', async () => {
    mock = installFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({
        path: 'inbox/hello world.md',
        frontmatter: '{"title":"Hosted Title","api_key":"must-not-leak"}',
        body: '# Intro\n\nBody must not leak.\n\n## Next',
      }),
      text: async () => '{}',
    }));
    ({ client } = await connectPair());

    await client.callTool({
      name: 'get_note_outline',
      arguments: { path: 'inbox/hello world.md' },
    });

    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, `${CANISTER_URL}/api/v1/notes/${encodeURIComponent('inbox/hello world.md')}`);
    assert.equal(mock.calls[0].init.method, 'GET');
    const headers = mock.calls[0].init.headers;
    assert.equal(headerGet(headers, 'Authorization'), 'Bearer tok-outline');
    assert.equal(headerGet(headers, 'X-Vault-Id'), 'vault-outline');
    assert.equal(headerGet(headers, 'X-User-Id'), 'google:owner');
    assert.equal(headerGet(headers, 'X-Gateway-Auth'), 'gw-secret-outline');
  });

  it('returns NoteOutline JSON without body, snippets, full frontmatter, or absolute paths', async () => {
    mock = installFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({
        path: 'inbox/hello.md',
        frontmatter: '{"title":"Hosted Title","api_key":"must-not-leak"}',
        body: '# Intro\n\nBody must not leak.\n\n## Next',
      }),
      text: async () => '{}',
    }));
    ({ client } = await connectPair());

    const result = await client.callTool({
      name: 'get_note_outline',
      arguments: { path: 'inbox/hello.md' },
    });
    const data = parseToolResult(result);
    const serialized = JSON.stringify(data);

    assert.equal(result.isError, undefined);
    assert.equal(data.schema, 'knowtation.note_outline/v1');
    assert.equal(data.path, 'inbox/hello.md');
    assert.equal(data.title, 'Hosted Title');
    assert.deepEqual(data.headings, [
      { level: 1, text: 'Intro', id: 'h1-intro-0001' },
      { level: 2, text: 'Next', id: 'h2-next-0002' },
    ]);
    assert.equal(data.truncated, false);
    assert.equal(Object.hasOwn(data, 'body'), false);
    assert.equal(Object.hasOwn(data, 'frontmatter'), false);
    assert.equal(Object.hasOwn(data, 'snippet'), false);
    assert.equal(serialized.includes('Body must not leak'), false);
    assert.equal(serialized.includes('must-not-leak'), false);
    assert.equal(serialized.includes('/Users/'), false);
  });

  it('returns UPSTREAM_ERROR without changing missing-note behavior', async () => {
    mock = installFetchMock(() => ({
      ok: false,
      status: 404,
      json: async () => ({ error: 'not found' }),
      text: async () => '{"error":"not found"}',
    }));
    ({ client } = await connectPair());

    const result = await client.callTool({
      name: 'get_note_outline',
      arguments: { path: 'missing.md' },
    });
    const data = parseToolResult(result);

    assert.equal(result.isError, true);
    assert.equal(data.code, 'UPSTREAM_ERROR');
    assert.match(data.error, /Upstream 404/);
  });

  it('returns UPSTREAM_ERROR without changing forbidden-note behavior', async () => {
    mock = installFetchMock(() => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'forbidden' }),
      text: async () => '{"error":"forbidden"}',
    }));
    ({ client } = await connectPair());

    const result = await client.callTool({
      name: 'get_note_outline',
      arguments: { path: 'private.md' },
    });
    const data = parseToolResult(result);

    assert.equal(result.isError, true);
    assert.equal(data.code, 'UPSTREAM_ERROR');
    assert.match(data.error, /Upstream 403/);
    assert.equal(JSON.stringify(data).includes('private note body'), false);
  });

  it('does not expose outline-specific resource URIs', async () => {
    mock = installFetchMock((url) => {
      if (url.includes('/api/v1/notes?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ notes: [{ path: 'inbox/a.md', frontmatter: {}, body: '# A' }], total: 1 }),
          text: async () => '{"notes":[],"total":0}',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '{}',
      };
    });
    ({ client } = await connectPair());

    const [{ resources }, { resourceTemplates }] = await Promise.all([
      client.listResources(),
      client.listResourceTemplates(),
    ]);
    const resourceText = JSON.stringify({ resources, resourceTemplates });

    assert.equal(resourceText.includes('outline'), false);
    assert.equal(resourceText.includes('get_note_outline'), false);
  });

  it('ignores unsafe upstream paths and does not leak absolute path or body in errors', async () => {
    mock = installFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({
        path: '/Users/aaron/private/secret.md',
        frontmatter: '{"title":"Safe Title"}',
        body: '# Safe Heading\n\nprivate note body must not leak',
      }),
      text: async () => '{}',
    }));
    ({ client } = await connectPair());

    const result = await client.callTool({
      name: 'get_note_outline',
      arguments: { path: 'safe.md' },
    });
    const data = parseToolResult(result);
    const serialized = JSON.stringify(data);

    assert.equal(result.isError, undefined);
    assert.equal(data.path, 'safe.md');
    assert.deepEqual(data.headings, [
      { level: 1, text: 'Safe Heading', id: 'h1-safe-heading-0001' },
    ]);
    assert.equal(serialized.includes('/Users/aaron'), false);
    assert.equal(serialized.includes('private note body'), false);
  });
});

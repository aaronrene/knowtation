/**
 * Gateway POST /api/v1/notes/copy — fetch to canister + bridge mocked.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

const SECRET = 'x'.repeat(32);

function bearer(role = 'editor') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'google:u1', role })).toString('base64url');
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function installFetchMock(fetchCalls) {
  globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url: String(url), opts });
    const u = String(url);
    const method = (opts && opts.method) || 'GET';
    if (u.includes('mock-bridge.test/api/v1/hosted-context')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            allowed_vault_ids: ['default', 'business'],
            effective_canister_user_id: 'google:u1',
            role: 'editor',
            scope: null,
          };
        },
      };
    }
    if (u.includes('mock-canister.test/api/v1/notes/') && method === 'GET' && u.includes('inbox') && u.includes('note.md')) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            path: 'inbox/note.md',
            body: 'Hello',
            frontmatter: { title: 'T' },
          });
        },
      };
    }
    if (u === 'https://mock-canister.test/api/v1/notes' && method === 'POST') {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ path: 'inbox/note.md', written: true });
        },
      };
    }
    if (u.includes('mock-canister.test/api/v1/notes/') && method === 'DELETE' && u.includes('inbox') && u.includes('note.md')) {
      return { ok: true, status: 200, async text() { return JSON.stringify({ deleted: true }); } };
    }
    if (u.includes('mock-bridge.test/api/v1/index') && method === 'POST') {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ ok: true, embedding_input_tokens: 0 });
        },
      };
    }
    return { ok: false, status: 500, async text() { return 'unexpected ' + u; } };
  };
}

describe('gateway POST /api/v1/notes/copy', () => {
  /** @type {import('http').Server} */
  let server;
  /** @type {string} */
  let base;
  /** @type {Array<{ url: string, opts: RequestInit | undefined }>} */
  let fetchCalls;
  /** @type {typeof fetch} */
  let origFetch;

  before(async () => {
    // Keep native fetch for the test client's HTTP calls; gateway uses globalThis.fetch to reach canister/bridge.
    origFetch = globalThis.fetch.bind(globalThis);
    process.env.NETLIFY = '1';
    process.env.CANISTER_URL = 'https://mock-canister.test';
    process.env.SESSION_SECRET = SECRET;
    process.env.BRIDGE_URL = 'https://mock-bridge.test';
    delete process.env.BILLING_ENFORCE;
    delete process.env.KNOWTATION_AIR_ENDPOINT;

    fetchCalls = [];
    installFetchMock(fetchCalls);

    const { app } = await import('../hub/gateway/server.mjs');
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    base = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    globalThis.fetch = origFetch;
  });

  it('copies between vaults and deletes source when delete_source is true', async () => {
    fetchCalls.length = 0;
    const res = await origFetch(base + '/api/v1/notes/copy', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + bearer('editor'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from_vault_id: 'default',
        to_vault_id: 'business',
        path: 'inbox/note.md',
        delete_source: true,
      }),
    });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.ok, true);
    assert.equal(j.moved, true);
    const methods = fetchCalls.map((c) => (c.opts && c.opts.method) || 'GET');
    assert.ok(methods.includes('GET'));
    assert.ok(methods.includes('POST'));
    assert.ok(methods.includes('DELETE'));
    const indexPosts = fetchCalls.filter(
      (c) => String(c.url).includes('/api/v1/index') && c.opts && c.opts.method === 'POST',
    );
    assert.equal(indexPosts.length, 2);
  });
});

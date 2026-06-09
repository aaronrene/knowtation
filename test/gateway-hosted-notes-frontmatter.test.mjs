/**
 * Hosted gateway note frontmatter normalization.
 *
 * These tests exercise the real gateway proxy with mocked canister and bridge
 * responses so direct reads, list rows, facets, and hosted search stay aligned.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const SECRET = 'gateway-hosted-notes-frontmatter-secret-32';
const GATEWAY_AUTH_SECRET = 'gateway-hosted-notes-frontmatter-gw-secret';
const PROPOSAL_PATH =
  'projects/born-free/scripts/proposals/2026-06-06-quantum-computing-online-test-script.md';
const PROPOSAL_TAGS = [
  'script-proposal',
  'born-free',
  'quantum-ai',
  'human-review',
  'freshness-gate',
  'ready-for-videofactory-handoff',
];
const PROPOSAL_FRONTMATTER = {
  title: 'Quantum Computing Online Test Script',
  project: 'born-free',
  status: 'approved',
  tags: PROPOSAL_TAGS,
  handoff_target: 'videofactory',
  handoff_status: 'ready',
};

function bearer(role = 'editor') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'google:actor', role })).toString('base64url');
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function responseJson(status, payload) {
  const text = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json', etag: 'mock-etag' }),
    text: async () => text,
    json: async () => payload,
  };
}

function installFetchMock(calls) {
  const notes = new Map([
    [
      'inbox/object-frontmatter.md',
      {
        path: 'inbox/object-frontmatter.md',
        frontmatter: {
          title: 'Object Frontmatter',
          project: 'object-project',
          status: 'draft',
          tags: ['object-tag'],
        },
        body: 'Object-shaped hosted note body.',
      },
    ],
    [
      'inbox/string-frontmatter.md',
      {
        path: 'inbox/string-frontmatter.md',
        frontmatter: JSON.stringify({
          title: 'String Frontmatter',
          project: 'string-project',
          status: 'draft',
          tags: ['string-tag'],
        }),
        body: 'String-shaped hosted note body.',
      },
    ],
    [
      PROPOSAL_PATH,
      {
        path: PROPOSAL_PATH,
        frontmatter: JSON.stringify(PROPOSAL_FRONTMATTER),
        body: '# Quantum Computing Online Test Script\n\nCanonical approved script proposal.',
      },
    ],
  ]);

  globalThis.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const u = new URL(String(url));
    calls.push({ url: String(url), method, headers: opts.headers });

    if (u.origin === 'https://mock-bridge.test' && u.pathname === '/api/v1/hosted-context') {
      return responseJson(200, {
        actor_sub: 'google:actor',
        effective_canister_user_id: 'google:owner',
        allowed_vault_ids: ['default'],
        role: 'editor',
        scope: null,
      });
    }

    if (u.origin === 'https://mock-bridge.test' && u.pathname === '/api/v1/search') {
      return responseJson(200, {
        results: [
          {
            path: PROPOSAL_PATH,
            project: PROPOSAL_FRONTMATTER.project,
            tags: PROPOSAL_TAGS,
            score: 1,
          },
        ],
        query: 'ready-for-videofactory-handoff',
        mode: 'keyword',
      });
    }

    if (u.origin === 'https://mock-canister.test' && u.pathname === '/api/v1/notes' && method === 'GET') {
      return responseJson(200, { notes: [...notes.values()], total: notes.size });
    }

    if (u.origin === 'https://mock-canister.test' && u.pathname.startsWith('/api/v1/notes/') && method === 'GET') {
      const encoded = u.pathname.slice('/api/v1/notes/'.length);
      const notePath = decodeURIComponent(encoded);
      const note = notes.get(notePath);
      if (!note) return responseJson(404, { error: 'Not found', code: 'NOT_FOUND' });
      return responseJson(200, note);
    }

    return responseJson(500, { error: `unexpected ${method} ${u.href}` });
  };
}

describe('hosted gateway note frontmatter normalization', () => {
  /** @type {import('http').Server} */
  let server;
  /** @type {string} */
  let base;
  /** @type {typeof fetch} */
  let origFetch;
  /** @type {Array<{ url: string, method: string, headers?: HeadersInit }>} */
  let calls;

  before(async () => {
    origFetch = globalThis.fetch.bind(globalThis);
    process.env.NETLIFY = '1';
    process.env.CANISTER_URL = 'https://mock-canister.test';
    process.env.BRIDGE_URL = 'https://mock-bridge.test';
    process.env.SESSION_SECRET = SECRET;
    process.env.CANISTER_AUTH_SECRET = GATEWAY_AUTH_SECRET;
    process.env.BILLING_ENFORCE = 'false';
    delete process.env.KNOWTATION_AIR_ENDPOINT;

    calls = [];
    installFetchMock(calls);

    const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
    const { app } = await import(`${gwEntry}?hostednotesfrontmatter=${Date.now()}-${Math.random()}`);
    server = http.createServer(app);
    await new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
    });
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    base = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(() => resolve()));
    globalThis.fetch = origFetch;
  });

  it('direct GET returns frontmatter object when upstream stores an object', async () => {
    const res = await origFetch(`${base}/api/v1/notes/${encodeURIComponent('inbox/object-frontmatter.md')}`, {
      headers: { Authorization: `Bearer ${bearer()}` },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body.frontmatter, {
      title: 'Object Frontmatter',
      project: 'object-project',
      status: 'draft',
      tags: ['object-tag'],
    });
  });

  it('direct GET parses hosted JSON-string frontmatter into an object', async () => {
    const res = await origFetch(`${base}/api/v1/notes/${encodeURIComponent('inbox/string-frontmatter.md')}`, {
      headers: { Authorization: `Bearer ${bearer()}` },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(typeof body.frontmatter, 'object');
    assert.equal(body.frontmatter.title, 'String Frontmatter');
    assert.equal(body.frontmatter.project, 'string-project');
    assert.deepEqual(body.frontmatter.tags, ['string-tag']);
  });

  it('direct GET exposes approved proposal tags and workflow fields', async () => {
    const res = await origFetch(`${base}/api/v1/notes/${encodeURIComponent(PROPOSAL_PATH)}`, {
      headers: { Authorization: `Bearer ${bearer()}` },
    });
    const body = await res.json();
    const serialized = JSON.stringify(body);

    assert.equal(res.status, 200);
    assert.equal(body.path, PROPOSAL_PATH);
    assert.equal(body.body.includes('Canonical approved script proposal.'), true);
    assert.equal(body.frontmatter.title, PROPOSAL_FRONTMATTER.title);
    assert.equal(body.frontmatter.project, 'born-free');
    assert.equal(body.frontmatter.status, 'approved');
    assert.equal(body.frontmatter.handoff_target, 'videofactory');
    assert.equal(body.frontmatter.handoff_status, 'ready');
    assert.deepEqual(body.frontmatter.tags, PROPOSAL_TAGS);
    assert.equal(serialized.includes(GATEWAY_AUTH_SECRET), false);
  });

  it('list, facets, search, and direct GET agree on proposal note tags', async () => {
    const auth = { Authorization: `Bearer ${bearer()}` };
    const directRes = await origFetch(`${base}/api/v1/notes/${encodeURIComponent(PROPOSAL_PATH)}`, {
      headers: auth,
    });
    const listRes = await origFetch(`${base}/api/v1/notes?limit=10&offset=0`, { headers: auth });
    const facetsRes = await origFetch(`${base}/api/v1/notes/facets`, { headers: auth });
    const searchRes = await origFetch(`${base}/api/v1/search`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'keyword', query: 'ready-for-videofactory-handoff' }),
    });

    const direct = await directRes.json();
    const list = await listRes.json();
    const facets = await facetsRes.json();
    const search = await searchRes.json();
    const listed = list.notes.find((n) => n.path === PROPOSAL_PATH);
    const searched = search.results.find((n) => n.path === PROPOSAL_PATH);

    assert.equal(directRes.status, 200);
    assert.equal(listRes.status, 200);
    assert.equal(facetsRes.status, 200);
    assert.equal(searchRes.status, 200);
    assert.ok(listed);
    assert.ok(searched);
    assert.deepEqual(direct.frontmatter.tags, PROPOSAL_TAGS);
    assert.deepEqual(listed.frontmatter.tags, PROPOSAL_TAGS);
    assert.deepEqual(searched.tags, PROPOSAL_TAGS);
    assert.ok(facets.tags.includes('ready-for-videofactory-handoff'));
  });
});

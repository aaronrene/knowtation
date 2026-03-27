/**
 * Gateway hosted bulk metadata (canister orchestration) — fetch mocked.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { createMetadataBulkHandlers } from '../hub/gateway/metadata-bulk-canister.mjs';

const SECRET = 'gateway-metadata-bulk-test-secret';
const CANISTER = 'https://mock-canister.test';

/** HS256 JWT for tests (matches `jsonwebtoken` verify in gateway handler). */
function bearerToken(role = 'editor') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'google:test-user', role })).toString('base64url');
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

describe('gateway metadata-bulk-canister', () => {
  /** @type {typeof fetch | undefined} */
  let origFetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('deleteByProject deletes notes matching effective slug and discards proposals', async () => {
    const notesPayload = {
      notes: [
        { path: 'inbox/a.md', frontmatter: '{}', body: 'A' },
        { path: 'projects/foo/x.md', frontmatter: '{}', body: 'X' },
      ],
    };
    const proposalsPayload = {
      proposals: [
        {
          proposal_id: 'p1',
          path: 'projects/foo/x.md',
          status: 'proposed',
          vault_id: 'default',
        },
      ],
    };

    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      const method = (opts && opts.method) || 'GET';
      if (u === `${CANISTER}/api/v1/notes` && method === 'GET') {
        return { ok: true, status: 200, async text() { return JSON.stringify(notesPayload); } };
      }
      if (u === `${CANISTER}/api/v1/notes/projects%2Ffoo%2Fx.md` && method === 'DELETE') {
        return { ok: true, status: 200, async text() { return '{"deleted":true}'; } };
      }
      if (u === `${CANISTER}/api/v1/proposals` && method === 'GET') {
        return { ok: true, status: 200, async text() { return JSON.stringify(proposalsPayload); } };
      }
      if (u === `${CANISTER}/api/v1/proposals/p1/discard` && method === 'POST') {
        return { ok: true, status: 200, async text() { return '{}'; } };
      }
      return { ok: false, status: 404, async text() { return 'unexpected ' + u; } };
    };

    const handlers = createMetadataBulkHandlers({
      CANISTER_URL: CANISTER,
      BRIDGE_URL: '',
      SESSION_SECRET: SECRET,
      getUserId: () => 'google:test-user',
      getHostedAccessContext: async () => null,
    });

    /** @type {any} */
    const res = {
      statusCode: 200,
      payload: null,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(o) {
        this.payload = o;
        return this;
      },
    };

    await handlers.deleteByProject(
      {
        headers: { authorization: 'Bearer ' + bearerToken('editor') },
        body: { project: 'foo' },
      },
      res,
    );

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.payload.deleted, 1);
    assert.deepStrictEqual(res.payload.paths, ['projects/foo/x.md']);
    assert.strictEqual(res.payload.proposals_discarded, 1);
  });

  it('renameProject posts merged body for each matching note', async () => {
    const notesPayload = {
      notes: [
        { path: 'inbox/o.md', frontmatter: JSON.stringify({ project: 'oldslug', title: 'T' }), body: 'B' },
        { path: 'inbox/other.md', frontmatter: JSON.stringify({ project: 'x' }), body: 'O' },
      ],
    };
    /** @type {unknown[]} */
    const posts = [];

    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      const method = (opts && opts.method) || 'GET';
      if (u === `${CANISTER}/api/v1/notes` && method === 'GET') {
        return { ok: true, status: 200, async text() { return JSON.stringify(notesPayload); } };
      }
      if (u === `${CANISTER}/api/v1/notes` && method === 'POST') {
        posts.push(JSON.parse(String(opts.body)));
        return { ok: true, status: 200, async text() { return '{"written":true}'; } };
      }
      return { ok: false, status: 404, async text() { return ''; } };
    };

    const handlers = createMetadataBulkHandlers({
      CANISTER_URL: CANISTER,
      BRIDGE_URL: '',
      SESSION_SECRET: SECRET,
      getUserId: () => 'google:test-user',
      getHostedAccessContext: async () => null,
    });

    /** @type {any} */
    const res = {
      statusCode: 200,
      payload: null,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(o) {
        this.payload = o;
        return this;
      },
    };

    await handlers.renameProject(
      {
        headers: { authorization: 'Bearer ' + bearerToken('editor'), 'x-vault-id': 'default' },
        body: { from: 'oldslug', to: 'newslug' },
      },
      res,
    );

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.payload.updated, 1);
    assert.deepStrictEqual(res.payload.paths, ['inbox/o.md']);
    assert.strictEqual(posts.length, 1);
    const p = /** @type {Record<string, unknown>} */ (posts[0]);
    assert.strictEqual(p.path, 'inbox/o.md');
    assert.strictEqual(p.body, 'B');
    assert.strictEqual(/** @type {any} */ (p.frontmatter).project, 'newslug');
    assert.strictEqual(/** @type {any} */ (p.frontmatter).title, 'T');
  });

  it('deleteByProject returns 403 for viewer role', async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, async text() { return '{"notes":[]}'; } });

    const handlers = createMetadataBulkHandlers({
      CANISTER_URL: CANISTER,
      BRIDGE_URL: '',
      SESSION_SECRET: SECRET,
      getUserId: () => 'google:test-user',
      getHostedAccessContext: async () => null,
    });

    /** @type {any} */
    const res = {
      statusCode: 200,
      payload: null,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(o) {
        this.payload = o;
        return this;
      },
    };

    await handlers.deleteByProject(
      {
        headers: { authorization: 'Bearer ' + bearerToken('viewer') },
        body: { project: 'x' },
      },
      res,
    );

    assert.strictEqual(res.statusCode, 403);
  });
});

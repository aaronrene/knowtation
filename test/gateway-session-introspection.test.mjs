/**
 * C7 Session Introspection — GET /api/v1/auth/session
 *
 * Tests all 7 tiers: unit, integration, e2e, stress, data-integrity, performance, security.
 *
 * Designed for Scooling (cross-origin, Bearer-only) and the Hub UI alike.
 * The endpoint reads the verified JWT payload only — no extra DB call, no data elevation.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SECRET = 'c7-session-introspection-test-secret-32chars';
const SERVER_SRC = fs.readFileSync(
  path.join(ROOT, 'hub', 'gateway', 'server.mjs'),
  'utf8',
);

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeJwt(payload, secret = SECRET) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

function validPayload(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: 'google:123456789',
    provider: 'google',
    id: '123456789',
    name: 'Test User',
    role: 'member',
    type: 'session',
    iat: now - 60,
    exp: now - 60 + 3 * 60 * 60,
    ...overrides,
  };
}

function adminPayload(overrides = {}) {
  return validPayload({
    role: 'admin',
    sub: 'github:admin1',
    provider: 'github',
    id: 'admin1',
    ...overrides,
  });
}

function startServer(app) {
  const srv = http.createServer(app);
  return new Promise((resolve, reject) => {
    srv.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      resolve({
        url: `http://127.0.0.1:${srv.address().port}`,
        close: () => new Promise((r) => srv.close(() => r())),
      });
    });
  });
}

async function createGateway() {
  process.env.NETLIFY = '1';
  process.env.SESSION_SECRET = SECRET;
  process.env.BILLING_ENFORCE = 'false';
  process.env.CANISTER_URL = '';
  process.env.BRIDGE_URL = '';
  const entry = pathToFileURL(path.join(ROOT, 'hub', 'gateway', 'server.mjs')).href;
  const { app } = await import(`${entry}?c7test=${Date.now()}-${Math.random()}`);
  return startServer(app);
}

async function get(url, headers = {}) {
  const res = await fetch(url, { headers });
  const body = await res.json();
  return { status: res.status, body, headers: res.headers };
}

// ─── 1. UNIT — structural wiring (no server needed) ──────────────────────────

describe('C7 unit: structural wiring in server.mjs', () => {
  it('declares GET /api/v1/auth/session route', () => {
    assert.ok(
      SERVER_SRC.includes("'/api/v1/auth/session'"),
      'route must be mounted',
    );
  });

  it('declares decodeVerifiedToken helper that returns full payload (not just sub)', () => {
    assert.ok(SERVER_SRC.includes('decodeVerifiedToken'), 'helper must exist');
    assert.ok(
      /function decodeVerifiedToken/.test(SERVER_SRC),
      'must be a declared function',
    );
    // Must NOT just return sub — must return the full payload object
    const fn = SERVER_SRC.slice(
      SERVER_SRC.indexOf('function decodeVerifiedToken'),
      SERVER_SRC.indexOf('function decodeVerifiedToken') + 200,
    );
    assert.ok(!fn.includes('.sub'), 'must return full payload, not just sub');
  });

  it('declares scopesForRole that includes vault scopes and admin', () => {
    assert.ok(SERVER_SRC.includes('scopesForRole'), 'scopesForRole must exist');
    assert.ok(SERVER_SRC.includes('vault:read'), 'must include vault:read scope');
    assert.ok(SERVER_SRC.includes('vault:write'), 'must include vault:write scope');
    assert.ok(SERVER_SRC.includes("'admin'"), 'must differentiate admin role');
  });

  it('mounts OPTIONS /api/v1/auth/session for CORS preflight', () => {
    const idx = SERVER_SRC.indexOf("'/api/v1/auth/session'");
    assert.ok(idx > 0, 'route must be present');
    // Look for options() handler near the route declaration
    const window = SERVER_SRC.slice(Math.max(0, idx - 350), idx + 50);
    assert.ok(
      window.includes('options') || window.includes('OPTIONS'),
      'OPTIONS preflight must be handled',
    );
  });

  it('response shape includes all required C7 contract fields', () => {
    const idx = SERVER_SRC.indexOf("app.get('/api/v1/auth/session'");
    assert.ok(idx > 0, 'route handler must exist');
    const block = SERVER_SRC.slice(idx, idx + 1400);
    for (const field of ['type', 'sub', 'provider', 'id', 'name', 'role', 'iat', 'exp', 'scopes']) {
      assert.ok(block.includes(field), `response must include field '${field}'`);
    }
  });

  it('rejects missing or non-Bearer Authorization without reaching verifyToken', () => {
    const idx = SERVER_SRC.indexOf("app.get('/api/v1/auth/session'");
    const block = SERVER_SRC.slice(idx, idx + 400);
    assert.ok(block.includes("startsWith('Bearer ')"), 'must check Bearer prefix');
    assert.ok(block.includes('401'), 'must return 401 on missing auth');
  });
});

// ─── HTTP tests — shared gateway server ──────────────────────────────────────

describe('C7 integration, e2e, stress, data-integrity, performance, security', () => {
  let gw;

  before(async () => {
    gw = await createGateway();
  });

  after(async () => {
    await gw.close();
  });

  // ─── 2. INTEGRATION ──────────────────────────────────────────────────────

  it('integration: 401 with no Authorization header', async () => {
    const { status, body } = await get(`${gw.url}/api/v1/auth/session`);
    assert.equal(status, 401);
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  it('integration: 401 with non-Bearer scheme (Basic)', async () => {
    const { status } = await get(`${gw.url}/api/v1/auth/session`, {
      Authorization: 'Basic abc123',
    });
    assert.equal(status, 401);
  });

  it('integration: 401 with empty Bearer value', async () => {
    const { status } = await get(`${gw.url}/api/v1/auth/session`, {
      Authorization: 'Bearer ',
    });
    assert.equal(status, 401);
  });

  it('integration: 200 with valid member JWT — correct shape and scopes', async () => {
    const token = makeJwt(validPayload());
    const { status, body } = await get(`${gw.url}/api/v1/auth/session`, {
      Authorization: `Bearer ${token}`,
    });
    assert.equal(status, 200);
    assert.equal(body.type, 'session');
    assert.equal(body.sub, 'google:123456789');
    assert.equal(body.provider, 'google');
    assert.equal(body.id, '123456789');
    assert.equal(body.name, 'Test User');
    assert.equal(body.role, 'member');
    assert.ok(Array.isArray(body.scopes), 'scopes must be an array');
    assert.ok(body.scopes.includes('vault:read'), 'member must have vault:read');
    assert.ok(body.scopes.includes('vault:write'), 'member must have vault:write');
    assert.ok(!body.scopes.includes('admin'), 'member must not have admin scope');
    assert.strictEqual(typeof body.iat, 'number', 'iat must be a number');
    assert.strictEqual(typeof body.exp, 'number', 'exp must be a number');
  });

  it('integration: 200 with valid admin JWT — includes admin scope', async () => {
    const token = makeJwt(adminPayload());
    const { status, body } = await get(`${gw.url}/api/v1/auth/session`, {
      Authorization: `Bearer ${token}`,
    });
    assert.equal(status, 200);
    assert.equal(body.role, 'admin');
    assert.ok(body.scopes.includes('admin'), 'admin must have admin scope');
    assert.ok(body.scopes.includes('vault:read'), 'admin must retain vault:read');
  });

  it('integration: 200 for github provider — sub, provider, id correct', async () => {
    const token = makeJwt(validPayload({ sub: 'github:9876', provider: 'github', id: '9876' }));
    const { status, body } = await get(`${gw.url}/api/v1/auth/session`, {
      Authorization: `Bearer ${token}`,
    });
    assert.equal(status, 200);
    assert.equal(body.sub, 'github:9876');
    assert.equal(body.provider, 'github');
    assert.equal(body.id, '9876');
  });

  it('integration: response Content-Type is application/json', async () => {
    const token = makeJwt(validPayload());
    const res = await fetch(`${gw.url}/api/v1/auth/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.ok(
      res.headers.get('content-type')?.includes('application/json'),
      'must return JSON content-type',
    );
  });

  // ─── 3. END-TO-END ───────────────────────────────────────────────────────

  it('e2e: refresh-path token (no display name) is accepted, safe defaults applied', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = makeJwt({
      sub: 'google:refresh-user',
      provider: 'google',
      id: 'refresh-user',
      name: '',
      role: 'member',
      type: 'session',
      iat: now - 60,
      exp: now - 60 + 3 * 60 * 60,
    });
    const { status, body } = await get(`${gw.url}/api/v1/auth/session`, {
      Authorization: `Bearer ${token}`,
    });
    assert.equal(status, 200);
    assert.equal(body.sub, 'google:refresh-user');
    assert.equal(body.name, '');
    assert.equal(body.type, 'session');
    assert.ok(body.scopes.includes('vault:read'));
  });

  it('e2e: expired token is rejected with 401 SESSION_EXPIRED', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = makeJwt({
      ...validPayload(),
      iat: now - 3 * 60 * 60 - 10,
      exp: now - 1,
    });
    const { status, body } = await get(`${gw.url}/api/v1/auth/session`, {
      Authorization: `Bearer ${token}`,
    });
    assert.equal(status, 401);
    assert.equal(body.code, 'SESSION_EXPIRED');
  });

  it('e2e: two concurrent calls with the same token return identical responses', async () => {
    const token = makeJwt(validPayload());
    const [a, b] = await Promise.all([
      get(`${gw.url}/api/v1/auth/session`, { Authorization: `Bearer ${token}` }),
      get(`${gw.url}/api/v1/auth/session`, { Authorization: `Bearer ${token}` }),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.deepEqual(a.body, b.body);
  });

  // ─── 4. STRESS ───────────────────────────────────────────────────────────

  it('stress: 50 concurrent valid requests all succeed', async () => {
    const token = makeJwt(validPayload());
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        get(`${gw.url}/api/v1/auth/session`, { Authorization: `Bearer ${token}` }),
      ),
    );
    const failures = results.filter((r) => r.status !== 200);
    assert.equal(failures.length, 0, `${failures.length}/50 requests failed`);
  });

  it('stress: 30 concurrent invalid requests all return 401', async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, () => get(`${gw.url}/api/v1/auth/session`)),
    );
    const nonAuth = results.filter((r) => r.status !== 401);
    assert.equal(nonAuth.length, 0, 'all must be 401');
  });

  // ─── 5. DATA INTEGRITY ───────────────────────────────────────────────────

  it('data-integrity: JWT secret is not present in the response', async () => {
    const token = makeJwt(validPayload());
    const { body } = await get(`${gw.url}/api/v1/auth/session`, {
      Authorization: `Bearer ${token}`,
    });
    const bodyStr = JSON.stringify(body);
    assert.ok(!bodyStr.includes(SECRET), 'response must not contain the signing secret');
  });

  it('data-integrity: extra JWT fields are not passed through to the response', async () => {
    const token = makeJwt(validPayload({ extraField: 'MUST_NOT_LEAK' }));
    const { body } = await get(`${gw.url}/api/v1/auth/session`, {
      Authorization: `Bearer ${token}`,
    });
    assert.ok(!('extraField' in body), 'undocumented JWT fields must not appear in response');
  });

  it('data-integrity: scopes is always an array even when role is absent from token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = makeJwt({
      sub: 'google:norole',
      provider: 'google',
      id: 'norole',
      name: '',
      type: 'session',
      iat: now - 60,
      exp: now - 60 + 3 * 60 * 60,
    });
    const { status, body } = await get(`${gw.url}/api/v1/auth/session`, {
      Authorization: `Bearer ${token}`,
    });
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.scopes), 'scopes must always be an array');
    assert.ok(body.scopes.length > 0, 'must default to at least one scope');
  });

  it('data-integrity: iat and exp are numbers (not strings)', async () => {
    const token = makeJwt(validPayload());
    const { body } = await get(`${gw.url}/api/v1/auth/session`, {
      Authorization: `Bearer ${token}`,
    });
    assert.strictEqual(typeof body.iat, 'number');
    assert.strictEqual(typeof body.exp, 'number');
  });

  it('data-integrity: sub is canonical provider:id for both google and github tokens', async () => {
    for (const [provider, rawId] of [
      ['google', '111'],
      ['github', '222'],
    ]) {
      const token = makeJwt(validPayload({ sub: `${provider}:${rawId}`, provider, id: rawId }));
      const { body } = await get(`${gw.url}/api/v1/auth/session`, {
        Authorization: `Bearer ${token}`,
      });
      assert.equal(body.sub, `${provider}:${rawId}`);
      assert.equal(body.provider, provider);
      assert.equal(body.id, rawId);
    }
  });

  // ─── 6. PERFORMANCE ──────────────────────────────────────────────────────

  it('performance: p99 of 20 sequential calls is under 100ms', async () => {
    const token = makeJwt(validPayload());
    const times = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      await get(`${gw.url}/api/v1/auth/session`, { Authorization: `Bearer ${token}` });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p99 = times[Math.ceil(times.length * 0.99) - 1];
    assert.ok(p99 < 100, `p99 ${p99.toFixed(1)}ms exceeds 100ms budget`);
  });

  // ─── 7. SECURITY ─────────────────────────────────────────────────────────

  it('security: token signed with wrong secret is rejected', async () => {
    const token = makeJwt(validPayload(), 'WRONG-SECRET-THAT-DOES-NOT-MATCH');
    const { status } = await get(`${gw.url}/api/v1/auth/session`, {
      Authorization: `Bearer ${token}`,
    });
    assert.equal(status, 401);
  });

  it('security: tampered payload (one char flipped in body segment) is rejected', async () => {
    const token = makeJwt(validPayload());
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1].slice(0, -1)}X.${parts[2]}`;
    const { status } = await get(`${gw.url}/api/v1/auth/session`, {
      Authorization: `Bearer ${tampered}`,
    });
    assert.equal(status, 401);
  });

  it('security: alg:none token (algorithm confusion attack) is rejected', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(validPayload())).toString('base64url');
    const noneToken = `${header}.${body}.`;
    const { status } = await get(`${gw.url}/api/v1/auth/session`, {
      Authorization: `Bearer ${noneToken}`,
    });
    assert.equal(status, 401, 'alg:none tokens must be rejected');
  });

  it('security: empty sub in a valid-signature token is rejected', async () => {
    const token = makeJwt({ ...validPayload(), sub: '' });
    const { status } = await get(`${gw.url}/api/v1/auth/session`, {
      Authorization: `Bearer ${token}`,
    });
    assert.equal(status, 401, 'empty sub must be rejected — no anonymous identity');
  });

  it('security: token passed via query string (not header) is not accepted', async () => {
    const token = makeJwt(validPayload());
    const res = await fetch(`${gw.url}/api/v1/auth/session?token=${token}`);
    assert.equal(res.status, 401, 'query-string token must not be accepted');
  });

  it('security: completely garbage token string returns 401', async () => {
    const { status } = await get(`${gw.url}/api/v1/auth/session`, {
      Authorization: 'Bearer this.is.not.a.jwt',
    });
    assert.equal(status, 401);
  });

  it('security: 401 response does not leak stack traces or internal paths', async () => {
    const { body } = await get(`${gw.url}/api/v1/auth/session`, {
      Authorization: 'Bearer garbage',
    });
    const s = JSON.stringify(body);
    assert.ok(!s.includes('at '), 'must not leak stack trace');
    assert.ok(!s.includes('node_modules'), 'must not leak internal paths');
  });

  it('security: 401 response does not include server version header', async () => {
    const res = await fetch(`${gw.url}/api/v1/auth/session`, {
      headers: { Authorization: 'Bearer garbage' },
    });
    assert.ok(!res.headers.get('x-powered-by'), 'must not expose x-powered-by');
  });
});

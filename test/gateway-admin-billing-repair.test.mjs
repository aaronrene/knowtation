/**
 * Tests for POST /api/v1/admin/billing/repair
 *
 * 7 tiers: unit → integration → e2e → stress → data-integrity → performance → security
 *
 * The endpoint writes directly to the billing DB to repair missed Stripe webhook events.
 * Auth: admin JWT (sub must be in HUB_ADMIN_USER_IDS env var). Non-admins get 403.
 *
 * SEC-KN-3a decision: do **not** skip/gate on a canister replica. This suite already sets
 * CANISTER_URL='' and never calls the canister. The plain-`npm test` hang was a corrupt
 * shared `data/hosted_billing.json` plus leftover HTTP handles — fixed by isolating the
 * billing DB via KNOWTATION_BILLING_DB_PATH (see createGateway).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER_SRC = fs.readFileSync(path.join(ROOT, 'hub', 'gateway', 'server.mjs'), 'utf8');

// ─── Shared test identities ───────────────────────────────────────────────────
const SECRET = 'admin-billing-repair-test-secret-32c';
const ADMIN_SUB = 'google:admin-billing-test-00001';
const MEMBER_SUB = 'google:member-billing-test-00002';
const OTHER_SUB = 'google:other-billing-test-00003';

// ─── JWT helpers (manual HMAC-SHA256, same as C7 tests) ──────────────────────
function makeJwt(sub, role = 'member', secret = SECRET) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub, role, provider: 'google', id: sub, iat: now - 5, exp: now + 3600,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function adminToken() { return makeJwt(ADMIN_SUB, 'admin'); }
function memberToken() { return makeJwt(MEMBER_SUB, 'member'); }

// ─── Server helpers ───────────────────────────────────────────────────────────
function startServer(app) {
  const srv = http.createServer(app);
  return new Promise((resolve, reject) => {
    srv.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      resolve({
        url: `http://127.0.0.1:${srv.address().port}`,
        close: () => new Promise((r) => {
          // closeAllConnections() destroys keepalive connections so srv.close() can finish.
          if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
          srv.close(() => r());
        }),
      });
    });
  });
}

/**
 * Each call gets a fresh module instance (cache-busting query string) and an
 * isolated billing DB file so concurrent / prior suite runs cannot share a
 * corrupt repo-local data/hosted_billing.json.
 */
async function createGateway() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-billing-repair-'));
  process.env.SESSION_SECRET = SECRET;
  process.env.HUB_ADMIN_USER_IDS = ADMIN_SUB;
  process.env.BILLING_ENFORCE = 'false';
  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = '';
  process.env.BRIDGE_URL = '';
  process.env.STRIPE_SECRET_KEY = '';            // not needed for repair endpoint
  process.env.KNOWTATION_BILLING_DB_PATH = path.join(tmpDir, 'hosted_billing.json');
  // Ensure file-backed store (billing-store prefers blob when this global is set).
  delete globalThis.__knowtation_gateway_blob;
  const entry = pathToFileURL(path.join(ROOT, 'hub', 'gateway', 'server.mjs')).href;
  const { app } = await import(`${entry}?repair-test=${Date.now()}-${Math.random()}`);
  const srv = await startServer(app);
  return {
    ...srv,
    close: async () => {
      await srv.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    },
  };
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
async function post(baseUrl, path_, body, token) {
  const raw = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl + path_);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(raw),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers }); }
        catch { resolve({ status: res.statusCode, body: data, headers: res.headers }); }
      });
    });
    req.on('error', reject);
    req.write(raw);
    req.end();
  });
}

/** Same as post() but sends Connection: close — prevents keep-alive socket reuse in stress tests. */
async function postClose(baseUrl, path_, body, token) {
  const raw = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl + path_);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(raw),
        'Connection': 'close',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(raw);
    req.end();
  });
}

async function get(baseUrl, path_, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl + path_);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const REPAIR = '/api/v1/admin/billing/repair';
const SUMMARY = '/api/v1/billing/summary';

// ─── 1. Unit: structural wiring ───────────────────────────────────────────────

describe('admin/billing/repair — unit: structural wiring', () => {
  it('endpoint is declared in server.mjs', () => {
    assert.ok(
      SERVER_SRC.includes("'/api/v1/admin/billing/repair'"),
      'route must be mounted in server.mjs',
    );
  });

  it('MONTHLY_INCLUDED_CENTS_BY_TIER is imported in server.mjs', () => {
    assert.ok(
      SERVER_SRC.includes('MONTHLY_INCLUDED_CENTS_BY_TIER'),
      'must import MONTHLY_INCLUDED_CENTS_BY_TIER from billing-constants',
    );
  });

  it('VALID_REPAIR_TIERS set is declared in server.mjs', () => {
    assert.ok(SERVER_SRC.includes('VALID_REPAIR_TIERS'), 'tier allowlist must exist');
  });
});

// ─── 2. Integration: DB mutation ──────────────────────────────────────────────

describe('admin/billing/repair — integration: DB mutation', () => {
  let gw;
  before(async () => { gw = await createGateway(); });
  after(() => gw.close());

  it('returns ok:true with uid, tier, and before snapshot', async () => {
    const { status, body } = await post(gw.url, REPAIR, { tier: 'plus' }, adminToken());
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.tier, 'plus');
    assert.equal(typeof body.uid, 'string');
    assert.ok('before' in body, 'before snapshot required');
  });

  it('defaults uid to the calling admin when uid is omitted', async () => {
    const { body } = await post(gw.url, REPAIR, { tier: 'growth' }, adminToken());
    assert.equal(body.uid, ADMIN_SUB);
  });

  it('accepts an explicit uid different from the caller', async () => {
    const { body } = await post(gw.url, REPAIR, { uid: OTHER_SUB, tier: 'plus' }, adminToken());
    assert.equal(body.uid, OTHER_SUB);
  });

  it('tier change is reflected in billing/summary', async () => {
    await post(gw.url, REPAIR, { uid: ADMIN_SUB, tier: 'plus' }, adminToken());
    const { body } = await get(gw.url, SUMMARY, adminToken());
    assert.equal(body.tier, 'plus');
  });

  it('setting stripe_subscription_id → has_active_subscription:true in summary', async () => {
    await post(gw.url, REPAIR,
      { uid: ADMIN_SUB, tier: 'plus', stripe_subscription_id: 'sub_integration_test' }, adminToken());
    const { body } = await get(gw.url, SUMMARY, adminToken());
    assert.equal(body.has_active_subscription, true);
  });

  it('clearing stripe_subscription_id (empty string) → has_active_subscription:false', async () => {
    await post(gw.url, REPAIR, { uid: ADMIN_SUB, tier: 'plus', stripe_subscription_id: 'sub_will_clear' }, adminToken());
    await post(gw.url, REPAIR, { uid: ADMIN_SUB, tier: 'plus', stripe_subscription_id: '' }, adminToken());
    const { body } = await get(gw.url, SUMMARY, adminToken());
    assert.equal(body.has_active_subscription, false);
  });

  it('omitting stripe_subscription_id leaves existing value intact', async () => {
    await post(gw.url, REPAIR, { uid: ADMIN_SUB, tier: 'plus', stripe_subscription_id: 'sub_preserved' }, adminToken());
    await post(gw.url, REPAIR, { uid: ADMIN_SUB, tier: 'growth' }, adminToken());  // no sub field
    const { body } = await get(gw.url, SUMMARY, adminToken());
    assert.equal(body.has_active_subscription, true, 'sub id should survive tier-only repair');
  });

  it('before snapshot reflects the previous tier', async () => {
    await post(gw.url, REPAIR, { uid: ADMIN_SUB, tier: 'free' }, adminToken());
    const { body } = await post(gw.url, REPAIR, { uid: ADMIN_SUB, tier: 'pro' }, adminToken());
    assert.equal(body.before.tier, 'free');
    assert.equal(body.tier, 'pro');
  });

  it('accepts all valid tier names', async () => {
    const tiers = ['free', 'beta', 'plus', 'growth', 'pro', 'starter', 'team'];
    for (const tier of tiers) {
      const { status } = await post(gw.url, REPAIR, { tier }, adminToken());
      assert.equal(status, 200, `tier "${tier}" must be accepted`);
    }
  });
});

// ─── 3. End-to-end: full pack-visibility repair scenario ──────────────────────

describe('admin/billing/repair — e2e: pack-visibility repair', () => {
  let gw;
  before(async () => { gw = await createGateway(); });
  after(() => gw.close());

  it('user starts at beta → admin repairs to plus+sub → both gates fixed', async () => {
    // Verify initial state (fresh gateway starts users at beta/default)
    const initial = await get(gw.url, SUMMARY, adminToken());
    assert.notEqual(initial.body.tier, 'plus', 'should not already be plus before repair');

    // Perform repair
    const repair = await post(gw.url, REPAIR,
      { uid: ADMIN_SUB, tier: 'plus', stripe_subscription_id: 'sub_e2e_repair' }, adminToken());
    assert.equal(repair.status, 200);
    assert.equal(repair.body.ok, true);

    // Verify both pack gates are now satisfied
    const after = await get(gw.url, SUMMARY, adminToken());
    assert.equal(after.body.tier, 'plus');
    assert.equal(after.body.has_active_subscription, true);
    // stripe_configured depends on STRIPE_SECRET_KEY env, which we blanked for tests.
    // The other two gates (tier != beta/free, has_active_subscription) are now fixed.
  });
});

// ─── 4. Stress: rapid concurrent repairs ─────────────────────────────────────

describe('admin/billing/repair — stress: concurrent repairs', () => {
  let gw;
  before(async () => { gw = await createGateway(); });
  after(() => gw.close());

  it('5 concurrent repair calls all succeed without throwing', async () => {
    // Use connection:close on each request so the HTTP agent does not queue
    // requests behind a shared keep-alive socket, which prevents the server
    // from closing cleanly when there are concurrent file writes.
    const calls = Array.from({ length: 5 }, () =>
      postClose(gw.url, REPAIR, { uid: ADMIN_SUB, tier: 'plus' }, adminToken()),
    );
    const results = await Promise.allSettled(calls);
    for (const r of results) {
      assert.equal(r.status, 'fulfilled', 'call must resolve, not reject');
      assert.equal(r.value.status, 200, 'all concurrent repair calls should succeed');
    }
  });
});

// ─── 5. Data integrity ────────────────────────────────────────────────────────

describe('admin/billing/repair — data-integrity', () => {
  let gw;
  before(async () => { gw = await createGateway(); });
  after(() => gw.close());

  it('response contains no JWT secrets or signing keys', async () => {
    const { body } = await post(gw.url, REPAIR,
      { uid: ADMIN_SUB, tier: 'plus', stripe_subscription_id: 'sub_secret_check' }, adminToken());
    const s = JSON.stringify(body);
    assert.ok(!s.includes(SECRET), 'JWT secret must not appear in response');
    assert.ok(!s.includes('eyJ'), 'JWT token must not appear in response');
  });

  it('invalid tier returns 400 with a valid_tiers list', async () => {
    const { status, body } = await post(gw.url, REPAIR, { tier: 'ultraplus' }, adminToken());
    assert.equal(status, 400);
    assert.ok(Array.isArray(body.valid_tiers), 'valid_tiers list must be in 400 response');
  });

  it('missing tier returns 400', async () => {
    const { status } = await post(gw.url, REPAIR, {}, adminToken());
    assert.equal(status, 400);
  });

  it('unknown body fields are silently ignored and do not corrupt the record', async () => {
    const { status, body } = await post(gw.url, REPAIR,
      { tier: 'plus', evil: 'injection', foo: 123 }, adminToken());
    assert.equal(status, 200);
    assert.equal(body.tier, 'plus');
    assert.ok(!('evil' in body), 'unknown fields must not appear in response');
  });

  it('empty string uid falls back to caller uid (not an empty-string user)', async () => {
    const { body } = await post(gw.url, REPAIR, { uid: '', tier: 'plus' }, adminToken());
    assert.equal(body.uid, ADMIN_SUB, 'empty uid must fall back to caller');
  });
});

// ─── 6. Performance ──────────────────────────────────────────────────────────

describe('admin/billing/repair — performance', () => {
  let gw;
  before(async () => { gw = await createGateway(); });
  after(() => gw.close());

  it('responds within 2000 ms', async () => {
    const start = Date.now();
    const { status } = await post(gw.url, REPAIR, { tier: 'plus' }, adminToken());
    const elapsed = Date.now() - start;
    assert.equal(status, 200);
    assert.ok(elapsed < 2000, `must respond within 2000 ms; took ${elapsed} ms`);
  });
});

// ─── 7. Security ─────────────────────────────────────────────────────────────

describe('admin/billing/repair — security', () => {
  let gw;
  before(async () => { gw = await createGateway(); });
  after(() => gw.close());

  it('returns 401 with no Authorization header', async () => {
    const { status } = await post(gw.url, REPAIR, { tier: 'plus' }, null);
    assert.equal(status, 401);
  });

  it('returns 403 for a valid non-admin JWT', async () => {
    const { status } = await post(gw.url, REPAIR, { tier: 'plus' }, memberToken());
    assert.equal(status, 403);
  });

  it('returns 401 for a token signed with the wrong secret', async () => {
    const badToken = makeJwt(ADMIN_SUB, 'admin', 'wrong-secret');
    const { status } = await post(gw.url, REPAIR, { tier: 'plus' }, badToken);
    assert.equal(status, 401);
  });

  it('returns 401 for an alg:none algorithm-confusion token', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: ADMIN_SUB, role: 'admin' })).toString('base64url');
    const { status } = await post(gw.url, REPAIR, { tier: 'plus' }, `${header}.${payload}.`);
    assert.equal(status, 401);
  });

  it('member cannot escalate their own tier by targeting their own uid', async () => {
    const { status } = await post(gw.url, REPAIR, { uid: MEMBER_SUB, tier: 'pro' }, memberToken());
    assert.equal(status, 403);
  });

  it('response does not include X-Powered-By header', async () => {
    const xpb = await new Promise((resolve, reject) => {
      const raw = JSON.stringify({ tier: 'plus' });
      const u = new URL(gw.url + REPAIR);
      const req = http.request({
        hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw),
          Authorization: `Bearer ${adminToken()}` },
      }, (res) => resolve(res.headers['x-powered-by']));
      req.on('error', reject);
      req.write(raw);
      req.end();
    });
    assert.ok(!xpb, `X-Powered-By must not be set; got: ${xpb}`);
  });

  it('injection payloads in tier field are rejected with 400', async () => {
    const payloads = ["'; DROP TABLE users; --", '{"$gt":""}', '<script>alert(1)</script>', '../../../etc/passwd'];
    for (const tier of payloads) {
      const { status } = await post(gw.url, REPAIR, { tier }, adminToken());
      assert.equal(status, 400, `injection payload "${tier}" should be rejected`);
    }
  });

  it('error responses do not leak stack traces or server internals', async () => {
    const { body } = await post(gw.url, REPAIR, { tier: 'bad' }, adminToken());
    const s = JSON.stringify(body);
    assert.ok(!s.includes('at '), 'stack traces must not appear in error responses');
    assert.ok(!s.includes('node_modules'), 'internal paths must not be exposed');
  });
});

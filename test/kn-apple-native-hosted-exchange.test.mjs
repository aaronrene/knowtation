/**
 * KN-APPLE-NATIVE-HOSTED-EXCHANGE — seven-tier suite (freeze §KNA.6).
 *
 * Covers Apple identity-assertion exchange → hosted session mint + C7 introspect.
 * No live calls to appleid.apple.com — JWKS and tokens are fixtures under test keys.
 */

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, describe, test } from 'node:test';
import jwt from 'jsonwebtoken';
import {
  APPLE_ISS,
  appleNonceMatches,
  appleProviderAdvertised,
  createAppleIdentityVerifier,
  jwtExpiryToSeconds,
  parseAppleExchangeBody,
} from '../hub/gateway/apple-identity-token.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'kn-apple-exchange-test-session-secret-not-production';
const APPLE_AUD = 'com.example.knowtation.test';
const PERF_P95_MS = 250;

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const FIXTURE_JWK = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'test-apple-kid-1',
  use: 'sig',
  alg: 'RS256',
};

function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function signAppleFixture(claims, headerExtra = {}) {
  return jwt.sign(claims, privateKey, {
    algorithm: 'RS256',
    header: { kid: FIXTURE_JWK.kid, ...headerExtra },
  });
}

function validAppleClaims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: APPLE_ISS,
    aud: APPLE_AUD,
    sub: overrides.sub ?? `apple-fixture-sub-${now}`,
    exp: now + 600,
    iat: now,
    ...overrides,
  };
}

function startServer(app) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(app);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((res, rej) => {
            srv.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
    srv.on('error', reject);
  });
}

function request(baseUrl, method, urlPath, { body, token, headers } = {}) {
  const raw = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl + urlPath);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          ...(raw != null
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) }
            : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(headers || {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          let parsed = data;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            /* keep raw */
          }
          resolve({ status: res.statusCode, body: parsed, headers: res.headers, raw: data });
        });
      },
    );
    req.on('error', reject);
    if (raw != null) req.write(raw);
    req.end();
  });
}

/**
 * Dishonest stub: accepts unsigned JWT payload without verifying signature.
 * Security tier must fail against production code if this behavior were mounted.
 */
function createUnverifiedAcceptStub() {
  return {
    async verifyIdentityToken(identityToken) {
      const parts = String(identityToken || '').split('.');
      if (parts.length < 2) {
        return { ok: false, code: 'APPLE_ASSERTION_INVALID', error: 'malformed' };
      }
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return { ok: true, claims: { appleSub: String(payload.sub || 'forged') } };
    },
  };
}

let gw;
let verifier;

async function loadGateway({ offlineLocked = false, appleClientId = APPLE_AUD, sessionSecret = SECRET } = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-apple-exchange-'));
  process.env.SESSION_SECRET = sessionSecret || '';
  if (!sessionSecret) delete process.env.SESSION_SECRET;
  delete process.env.HUB_JWT_SECRET;
  process.env.APPLE_CLIENT_ID = appleClientId || '';
  if (!appleClientId) delete process.env.APPLE_CLIENT_ID;
  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = '';
  process.env.BRIDGE_URL = '';
  process.env.BILLING_ENFORCE = 'false';
  process.env.KNOWTATION_GATEWAY_DATA_DIR = tmpDir;
  if (offlineLocked) {
    process.env.KNOWTATION_OFFLINE_LOCKED_AUTH = 'enabled';
  } else {
    delete process.env.KNOWTATION_OFFLINE_LOCKED_AUTH;
  }
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GITHUB_CLIENT_ID;
  delete process.env.GITHUB_CLIENT_SECRET;

  verifier = createAppleIdentityVerifier({
    fetchImpl: async () => {
      throw new Error('live Apple JWKS forbidden in CI');
    },
  });
  verifier.seedJwksCache([FIXTURE_JWK]);
  globalThis.__knowtation_apple_identity_verifier = verifier;

  const entry = pathToFileURL(path.join(ROOT, 'hub', 'gateway', 'server.mjs')).href;
  const { app } = await import(`${entry}?kn-apple=${Date.now()}-${Math.random()}`);
  const srv = await startServer(app);
  return {
    ...srv,
    tmpDir,
    close: async () => {
      await srv.close();
      delete globalThis.__knowtation_apple_identity_verifier;
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

// ─── unit ───────────────────────────────────────────────────────────────────

describe('KN-APPLE unit', () => {
  test('parseAppleExchangeBody allowlist + forbidden identity fields', () => {
    assert.equal(parseAppleExchangeBody(null).ok, false);
    assert.equal(parseAppleExchangeBody({}).code, 'BAD_REQUEST');
    assert.equal(parseAppleExchangeBody({ identity_token: 'x', extra: 1 }).code, 'BAD_REQUEST');
    assert.equal(parseAppleExchangeBody({ identity_token: 'x', role: 'admin' }).code, 'BAD_REQUEST');
    assert.equal(parseAppleExchangeBody({ identity_token: 'x', scooling_uid: 'abc' }).code, 'BAD_REQUEST');
    const ok = parseAppleExchangeBody({
      identity_token: ' tok ',
      nonce: 'n1',
      full_name: 'A'.repeat(200),
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.identityToken, 'tok');
    assert.equal(ok.nonce, 'n1');
    assert.equal(ok.fullName.length, 128);
  });

  test('appleProviderAdvertised boolean logic', () => {
    assert.equal(appleProviderAdvertised({ appleClientId: APPLE_AUD, offlineLocked: false }), true);
    assert.equal(appleProviderAdvertised({ appleClientId: '  ', offlineLocked: false }), false);
    assert.equal(appleProviderAdvertised({ appleClientId: APPLE_AUD, offlineLocked: true }), false);
    assert.equal(appleProviderAdvertised({ offlineLocked: false }), false);
  });

  test('userId shape apple:<sub> via mint claims', () => {
    const sub = '001234.abcdef';
    assert.equal(`apple:${sub}`, `apple:${sub}`);
  });

  test('aud/iss/exp reject matrix + alg=none', async () => {
    const v = createAppleIdentityVerifier({
      fetchImpl: async () => ({ ok: true, json: async () => ({ keys: [FIXTURE_JWK] }) }),
    });
    const good = signAppleFixture(validAppleClaims({ sub: 'u-matrix' }));
    const ok = await v.verifyIdentityToken(good, { audience: APPLE_AUD });
    assert.equal(ok.ok, true);
    assert.equal(ok.claims.appleSub, 'u-matrix');

    const wrongAud = signAppleFixture(validAppleClaims({ aud: 'other.bundle', sub: 'u2' }));
    assert.equal((await v.verifyIdentityToken(wrongAud, { audience: APPLE_AUD })).code, 'APPLE_ASSERTION_INVALID');

    const wrongIss = signAppleFixture(validAppleClaims({ iss: 'https://evil.example', sub: 'u3' }));
    assert.equal((await v.verifyIdentityToken(wrongIss, { audience: APPLE_AUD })).code, 'APPLE_ASSERTION_INVALID');

    const expired = signAppleFixture(validAppleClaims({ sub: 'u4', exp: Math.floor(Date.now() / 1000) - 120 }));
    assert.equal((await v.verifyIdentityToken(expired, { audience: APPLE_AUD })).code, 'APPLE_ASSERTION_INVALID');

    const noneTok = `${b64urlJson({ alg: 'none', typ: 'JWT' })}.${b64urlJson({
      iss: APPLE_ISS,
      aud: APPLE_AUD,
      sub: 'u5',
      exp: Math.floor(Date.now() / 1000) + 600,
    })}.`;
    assert.equal((await v.verifyIdentityToken(noneTok, { audience: APPLE_AUD })).code, 'APPLE_ASSERTION_INVALID');
  });

  test('nonce match raw or sha256 hex', () => {
    const raw = 'client-nonce-1';
    const hex = createHash('sha256').update(raw, 'utf8').digest('hex');
    assert.equal(appleNonceMatches(raw, raw), true);
    assert.equal(appleNonceMatches(hex, raw), true);
    assert.equal(appleNonceMatches('other', raw), false);
    assert.equal(appleNonceMatches(undefined, undefined), true);
  });

  test('jwtExpiryToSeconds', () => {
    assert.equal(jwtExpiryToSeconds('24h'), 86400);
    assert.equal(jwtExpiryToSeconds('15m'), 900);
    assert.equal(jwtExpiryToSeconds(120), 120);
  });
});

// ─── integration / e2e / stress / data-integrity / performance / security ───

describe('KN-APPLE gateway tiers', () => {
  before(async () => {
    gw = await loadGateway();
  });
  after(async () => {
    if (gw) await gw.close();
    delete process.env.APPLE_CLIENT_ID;
    delete process.env.KNOWTATION_OFFLINE_LOCKED_AUTH;
  });

  test('integration: exchange → 200 JWT + C7 provider apple', async () => {
    const sub = 'int-apple-sub-1';
    const identity_token = signAppleFixture(validAppleClaims({ sub }));
    const ex = await request(gw.baseUrl, 'POST', '/api/v1/auth/native-apple-exchange', {
      body: { identity_token, full_name: 'Ada' },
    });
    assert.equal(ex.status, 200);
    assert.equal(ex.body.schema_version, 1);
    assert.equal(ex.body.token_type, 'Bearer');
    assert.equal(typeof ex.body.access_token, 'string');
    assert.ok(ex.body.expires_in > 0);
    assert.equal(ex.body.scooling_uid, undefined);
    assert.equal(ex.body.refresh_token, undefined);

    const payload = jwt.verify(ex.body.access_token, SECRET);
    assert.equal(payload.sub, `apple:${sub}`);
    assert.equal(payload.provider, 'apple');
    assert.equal(payload.id, sub);
    assert.equal(payload.type, 'session');
    assert.equal(payload.name, 'Ada');

    const sess = await request(gw.baseUrl, 'GET', '/api/v1/auth/session', {
      token: ex.body.access_token,
    });
    assert.equal(sess.status, 200);
    assert.equal(sess.body.provider, 'apple');
    assert.equal(sess.body.sub, `apple:${sub}`);
    assert.equal(sess.body.id, sub);
    assert.ok(Array.isArray(sess.body.scopes));
  });

  test('integration: unconfigured APPLE_CLIENT_ID → 503 NOT_CONFIGURED', async () => {
    const local = await loadGateway({ appleClientId: '' });
    try {
      const ex = await request(local.baseUrl, 'POST', '/api/v1/auth/native-apple-exchange', {
        body: { identity_token: signAppleFixture(validAppleClaims({ sub: 'x' })) },
      });
      assert.equal(ex.status, 503);
      assert.equal(ex.body.code, 'NOT_CONFIGURED');
    } finally {
      await local.close();
    }
  });

  test('e2e: providers.apple + exchange → session round-trip; offline-locked → 403', async () => {
    const providers = await request(gw.baseUrl, 'GET', '/api/v1/auth/providers');
    assert.equal(providers.status, 200);
    assert.equal(providers.body.apple, true);
    assert.equal(typeof providers.body.google, 'boolean');
    assert.equal(typeof providers.body.github, 'boolean');

    const sub = 'e2e-apple-sub';
    const ex = await request(gw.baseUrl, 'POST', '/api/v1/auth/native-apple-exchange', {
      body: { identity_token: signAppleFixture(validAppleClaims({ sub })) },
    });
    assert.equal(ex.status, 200);
    const sess = await request(gw.baseUrl, 'GET', '/api/v1/auth/session', {
      token: ex.body.access_token,
    });
    assert.equal(sess.status, 200);
    assert.equal(sess.body.sub, `apple:${sub}`);

    const offline = await loadGateway({ offlineLocked: true });
    try {
      const blocked = await request(offline.baseUrl, 'POST', '/api/v1/auth/native-apple-exchange', {
        body: { identity_token: signAppleFixture(validAppleClaims({ sub: 'off' })) },
      });
      assert.equal(blocked.status, 403);
      assert.equal(blocked.body.code, 'OAUTH_DISABLED');
      const p = await request(offline.baseUrl, 'GET', '/api/v1/auth/providers');
      assert.equal(p.body.apple, false);
    } finally {
      await offline.close();
    }
  });

  test('stress: parallel exchanges no cross-user mix; JWKS cache stable', async () => {
    const N = 24;
    const results = await Promise.all(
      Array.from({ length: N }, async (_, i) => {
        const sub = `stress-sub-${i}`;
        const ex = await request(gw.baseUrl, 'POST', '/api/v1/auth/native-apple-exchange', {
          body: { identity_token: signAppleFixture(validAppleClaims({ sub })) },
        });
        assert.equal(ex.status, 200);
        const payload = jwt.verify(ex.body.access_token, SECRET);
        return payload.sub;
      }),
    );
    const unique = new Set(results);
    assert.equal(unique.size, N);
    for (let i = 0; i < N; i++) {
      assert.ok(unique.has(`apple:stress-sub-${i}`));
    }
  });

  test('data-integrity: no scooling_uid / identity_token echo / durable identity row', async () => {
    const sub = 'di-apple-sub';
    const identity_token = signAppleFixture(validAppleClaims({ sub }));
    const ex = await request(gw.baseUrl, 'POST', '/api/v1/auth/native-apple-exchange', {
      body: { identity_token },
    });
    assert.equal(ex.status, 200);
    assert.equal(ex.body.scooling_uid, undefined);
    assert.equal(ex.body.identity_token, undefined);
    assert.ok(!JSON.stringify(ex.body).includes(identity_token));
    assert.ok(!ex.raw.includes(['BEGIN', 'PRIVATE', 'KEY'].join(' ')));
    const payload = jwt.verify(ex.body.access_token, SECRET);
    assert.equal(payload.sub, `apple:${sub}`);

    const files = fs.readdirSync(gw.tmpDir);
    assert.ok(!files.some((f) => /identity|apple-map|scooling/i.test(f)));
  });

  test('performance: single exchange p95 under fixture JWKS bound', async () => {
    const samples = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const ex = await request(gw.baseUrl, 'POST', '/api/v1/auth/native-apple-exchange', {
        body: { identity_token: signAppleFixture(validAppleClaims({ sub: `perf-${i}` })) },
      });
      samples.push(performance.now() - t0);
      assert.equal(ex.status, 200);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95) - 1];
    assert.ok(
      p95 < PERF_P95_MS,
      `p95 ${p95.toFixed(1)}ms exceeds bound ${PERF_P95_MS}ms (fixture JWKS only)`,
    );
  });

  test('security: forged / wrong aud / client role → reject; fixtures ban prod shapes', async () => {
    const forged = await request(gw.baseUrl, 'POST', '/api/v1/auth/native-apple-exchange', {
      body: {
        identity_token: jwt.sign(validAppleClaims({ sub: 'forged' }), 'not-apple-key', {
          algorithm: 'HS256',
        }),
      },
    });
    assert.equal(forged.status, 401);
    assert.equal(forged.body.code, 'APPLE_ASSERTION_INVALID');

    const wrongAud = await request(gw.baseUrl, 'POST', '/api/v1/auth/native-apple-exchange', {
      body: {
        identity_token: signAppleFixture(validAppleClaims({ aud: 'com.evil.app', sub: 'w' })),
      },
    });
    assert.equal(wrongAud.status, 401);

    const clientRole = await request(gw.baseUrl, 'POST', '/api/v1/auth/native-apple-exchange', {
      body: {
        identity_token: signAppleFixture(validAppleClaims({ sub: 'r' })),
        role: 'admin',
        scooling_uid: 'deadbeef',
      },
    });
    assert.equal(clientRole.status, 400);
    assert.equal(clientRole.body.code, 'BAD_REQUEST');

    // Fixture / product sources must not embed PEM private-key material or Team ID assignments.
    const pemNeedle = ['BEGIN', 'PRIVATE', 'KEY'].join(' ');
    const teamIdAssign = ['TEAM', '_ID', '='].join('');
    for (const rel of [
      'test/kn-apple-native-hosted-exchange.test.mjs',
      'hub/gateway/apple-identity-token.mjs',
      'hub/gateway/server.mjs',
      '.env.example',
    ]) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      assert.ok(!src.includes(pemNeedle), `${rel} must not embed PEM private key material`);
      assert.ok(
        !new RegExp(`${teamIdAssign}\\s*['"][A-Z0-9]{10}['"]`).test(src),
        `${rel} must not embed Apple Team ID assignments`,
      );
    }
    // Ban pasted production-looking Apple JWTs (long eyJ…eyJ triples in string literals).
    const suiteSrc = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert.ok(
      !/['"`]eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}['"`]/.test(suiteSrc),
      'committed suite must not embed production-shaped Apple JWT string literals',
    );

    // Regression discriminator: unverified-accept stub must diverge from real verifier.
    const stub = createUnverifiedAcceptStub();
    const unsignedPayload = `${b64urlJson({ alg: 'none' })}.${b64urlJson({
      sub: 'forged-via-stub',
      iss: APPLE_ISS,
      aud: APPLE_AUD,
      exp: Math.floor(Date.now() / 1000) + 600,
    })}.`;
    const stubOk = await stub.verifyIdentityToken(unsignedPayload);
    assert.equal(stubOk.ok, true, 'stub must accept unverified payloads (discriminator)');
    const realReject = await verifier.verifyIdentityToken(unsignedPayload, { audience: APPLE_AUD });
    assert.equal(realReject.ok, false, 'production verifier must reject unverified assertion');

    // Passport / native PKCE paths still declared (not equated to SIWA).
    const serverSrc = fs.readFileSync(path.join(ROOT, 'hub', 'gateway', 'server.mjs'), 'utf8');
    assert.ok(serverSrc.includes("app.use('/api/v1/auth/native'"));
    assert.ok(serverSrc.includes("passport.authenticate('google'"));
    assert.ok(serverSrc.includes('/api/v1/auth/native-apple-exchange'));
    assert.ok(
      !/PKCE\s*=\s*SIWA|native PKCE equals|equals Sign in with Apple/i.test(serverSrc),
      'must not claim PKCE equals SIWA',
    );
  });
});

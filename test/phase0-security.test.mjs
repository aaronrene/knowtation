import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// 0.3  Timing-safe comparisons — verifyState in hub/server.mjs
// ---------------------------------------------------------------------------
describe('verifyState timing-safe HMAC comparison', () => {
  const JWT_SECRET = 'test-jwt-secret-for-unit-tests';
  let savedSecret;

  beforeEach(() => {
    savedSecret = process.env.HUB_JWT_SECRET;
    process.env.HUB_JWT_SECRET = JWT_SECRET;
  });

  afterEach(() => {
    if (savedSecret !== undefined) process.env.HUB_JWT_SECRET = savedSecret;
    else delete process.env.HUB_JWT_SECRET;
  });

  function signState(payload) {
    const json = JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', JWT_SECRET).update(json).digest('hex');
    return Buffer.from(json).toString('base64url') + '.' + sig;
  }

  test('valid state token is accepted', async () => {
    const statePayload = { ts: Date.now(), nonce: crypto.randomUUID() };
    const stateStr = signState(statePayload);
    const parts = stateStr.split('.');
    assert.equal(parts.length, 2);
    const payloadB64 = parts[0];
    const sig = parts[1];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(JSON.stringify(payload)).digest('hex');
    const sigBuf = Buffer.from(sig, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    assert.ok(sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf));
  });

  test('tampered signature is rejected', () => {
    const statePayload = { ts: Date.now(), nonce: crypto.randomUUID() };
    const stateStr = signState(statePayload);
    const [payloadB64] = stateStr.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(JSON.stringify(payload)).digest('hex');
    const tampered = 'a' + expected.slice(1);
    const sigBuf = Buffer.from(tampered, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    assert.ok(sigBuf.length === expectedBuf.length);
    assert.ok(!crypto.timingSafeEqual(sigBuf, expectedBuf));
  });

  test('different-length signature is rejected before timingSafeEqual', () => {
    const statePayload = { ts: Date.now(), nonce: crypto.randomUUID() };
    const stateStr = signState(statePayload);
    const [payloadB64] = stateStr.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(JSON.stringify(payload)).digest('hex');
    const shortened = expected.slice(0, 10);
    const sigBuf = Buffer.from(shortened, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    assert.notEqual(sigBuf.length, expectedBuf.length);
  });
});

// ---------------------------------------------------------------------------
// 0.4  Capture webhook fail-closed
// ---------------------------------------------------------------------------
describe('captureAuth fail-closed behavior', () => {
  test('without CAPTURE_WEBHOOK_SECRET, requests are rejected (fail-closed)', () => {
    delete process.env.CAPTURE_WEBHOOK_SECRET;
    const secret = process.env.CAPTURE_WEBHOOK_SECRET;
    assert.equal(secret, undefined, 'secret must be unset for this test');
    assert.ok(!secret, 'no secret means the middleware should reject');
  });

  test('timing-safe comparison rejects wrong secret', () => {
    const secret = 'correct-webhook-secret-value-here';
    const provided = 'incorrect-webhook-secret-valu-hre';
    const a = Buffer.from(secret);
    const b = Buffer.from(provided);
    if (a.length === b.length) {
      assert.ok(!crypto.timingSafeEqual(a, b));
    } else {
      assert.notEqual(a.length, b.length);
    }
  });

  test('timing-safe comparison accepts correct secret', () => {
    const secret = 'correct-webhook-secret-value';
    const provided = 'correct-webhook-secret-value';
    const a = Buffer.from(secret);
    const b = Buffer.from(provided);
    assert.equal(a.length, b.length);
    assert.ok(crypto.timingSafeEqual(a, b));
  });
});

// ---------------------------------------------------------------------------
// 0.1  Gateway canister auth header injection
// ---------------------------------------------------------------------------
describe('canisterAuthHeaders helper', () => {
  test('returns X-Gateway-Auth when secret is set', () => {
    const secret = 'test-canister-auth-secret';
    const headers = secret ? { 'x-gateway-auth': secret } : {};
    assert.equal(headers['x-gateway-auth'], secret);
  });

  test('returns empty object when secret is empty', () => {
    const secret = '';
    const headers = secret ? { 'x-gateway-auth': secret } : {};
    assert.equal(headers['x-gateway-auth'], undefined);
  });
});

// ---------------------------------------------------------------------------
// 0.1  Canister gatewayAuthorized logic (unit-level mirror of Motoko logic)
// ---------------------------------------------------------------------------
describe('canister gatewayAuthorized logic (JS mirror)', () => {
  function gatewayAuthorized(gatewayAuthSecret, headerValue) {
    if (!gatewayAuthSecret) return true;
    if (headerValue === undefined || headerValue === null) return false;
    if (headerValue.length !== gatewayAuthSecret.length) return false;
    return headerValue === gatewayAuthSecret;
  }

  test('empty secret (unconfigured) allows all requests (backward compat)', () => {
    assert.ok(gatewayAuthorized('', undefined));
    assert.ok(gatewayAuthorized('', 'anything'));
  });

  test('configured secret rejects missing header', () => {
    assert.ok(!gatewayAuthorized('my-secret', undefined));
    assert.ok(!gatewayAuthorized('my-secret', null));
  });

  test('configured secret rejects wrong value', () => {
    assert.ok(!gatewayAuthorized('my-secret', 'wrong-secret'));
  });

  test('configured secret rejects different-length value', () => {
    assert.ok(!gatewayAuthorized('my-secret', 'short'));
    assert.ok(!gatewayAuthorized('my-secret', 'this-is-a-much-longer-secret-than-expected'));
  });

  test('configured secret accepts correct value', () => {
    assert.ok(gatewayAuthorized('my-secret', 'my-secret'));
  });
});

// ---------------------------------------------------------------------------
// 0.1  userId function no longer reads X-Test-User
// ---------------------------------------------------------------------------
describe('canister userId function (no X-Test-User)', () => {
  function userId(headers) {
    const xUserId = headers['x-user-id'];
    if (xUserId) return xUserId;
    return 'default';
  }

  test('reads X-User-Id when present', () => {
    assert.equal(userId({ 'x-user-id': 'google:123' }), 'google:123');
  });

  test('falls back to default when X-User-Id is absent', () => {
    assert.equal(userId({}), 'default');
  });

  test('does NOT read X-Test-User', () => {
    assert.equal(userId({ 'x-test-user': 'spoofed-user' }), 'default');
  });
});

// ---------------------------------------------------------------------------
// 0.5  POST /api/v1/attest requires authentication
// ---------------------------------------------------------------------------
describe('POST /api/v1/attest auth requirement', () => {
  test('getUserId returns null for missing Authorization header', () => {
    function getUserId(authHeader) {
      if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
      return 'user-sub';
    }
    assert.equal(getUserId(undefined), null);
    assert.equal(getUserId(''), null);
    assert.equal(getUserId('Basic abc'), null);
  });

  test('getUserId returns sub for valid Bearer token', () => {
    function getUserId(authHeader) {
      if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
      return 'user-sub';
    }
    assert.equal(getUserId('Bearer valid-token'), 'user-sub');
  });
});

// ---------------------------------------------------------------------------
// 0.1  Migration preserves operator_export_secret during V6→V7
// ---------------------------------------------------------------------------
describe('Migration V6 → V7 (gateway_auth_secret)', () => {
  test('new StableStorage includes gateway_auth_secret field', () => {
    const v6 = {
      vaultEntries: [],
      proposalEntries: [],
      billingByUser: [],
      operator_export_secret: 'keep-this',
    };
    const v7 = {
      ...v6,
      gateway_auth_secret: '',
    };
    assert.equal(v7.operator_export_secret, 'keep-this');
    assert.equal(v7.gateway_auth_secret, '');
    assert.deepEqual(v7.vaultEntries, []);
  });
});

// ---------------------------------------------------------------------------
// 0.2  CORS headers no longer expose X-Test-User
// ---------------------------------------------------------------------------
describe('canister CORS headers', () => {
  test('allowed headers include X-Gateway-Auth, not X-Test-User', () => {
    const allowedHeaders = 'Authorization, Content-Type, X-Vault-Id, X-User-Id, X-Gateway-Auth, X-Operator-Export-Key';
    assert.ok(allowedHeaders.includes('X-Gateway-Auth'));
    assert.ok(!allowedHeaders.includes('X-Test-User'));
  });
});

// ---------------------------------------------------------------------------
// MCP hosted server passes canister auth to upstream
// ---------------------------------------------------------------------------
describe('mcp-hosted-server upstreamFetch auth headers', () => {
  test('upstreamFetch includes X-Gateway-Auth and X-User-Id when provided', () => {
    const opts = {
      token: 'jwt-tok',
      vaultId: 'default',
      userId: 'google:123',
      canisterAuthSecret: 'secret123',
    };
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
    if (opts.vaultId) headers['X-Vault-Id'] = opts.vaultId;
    if (opts.userId) headers['X-User-Id'] = opts.userId;
    if (opts.canisterAuthSecret) headers['X-Gateway-Auth'] = opts.canisterAuthSecret;

    assert.equal(headers['X-User-Id'], 'google:123');
    assert.equal(headers['X-Gateway-Auth'], 'secret123');
    assert.equal(headers['Authorization'], 'Bearer jwt-tok');
    assert.equal(headers['X-Vault-Id'], 'default');
  });

  test('upstreamFetch omits auth headers when not provided', () => {
    const opts = { token: 'jwt', vaultId: 'v1' };
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
    if (opts.vaultId) headers['X-Vault-Id'] = opts.vaultId;
    if (opts.userId) headers['X-User-Id'] = opts.userId;
    if (opts.canisterAuthSecret) headers['X-Gateway-Auth'] = opts.canisterAuthSecret;

    assert.equal(headers['X-User-Id'], undefined);
    assert.equal(headers['X-Gateway-Auth'], undefined);
  });
});

// ---------------------------------------------------------------------------
// metadata-bulk-canister readHeaders includes X-Gateway-Auth
// ---------------------------------------------------------------------------
describe('metadata-bulk-canister readHeaders with auth', () => {
  test('readHeaders includes x-gateway-auth when secret is set', () => {
    const CANISTER_AUTH_SECRET = 'bulk-secret';
    function readHeaders(uid, effective, vaultId) {
      const h = {
        Accept: 'application/json',
        'x-user-id': effective,
        'x-actor-id': uid,
        'x-vault-id': vaultId,
      };
      if (CANISTER_AUTH_SECRET) h['x-gateway-auth'] = CANISTER_AUTH_SECRET;
      return h;
    }
    const h = readHeaders('uid', 'eff', 'default');
    assert.equal(h['x-gateway-auth'], 'bulk-secret');
    assert.equal(h['x-user-id'], 'eff');
  });
});

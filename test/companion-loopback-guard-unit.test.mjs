/**
 * Tier 1 — UNIT: lib/companion-loopback-guard.mjs
 *
 * Smallest behavioural contracts of the pure helpers and verifyLoopbackRequest in total
 * isolation — no network, no env, no socket. Each control (method, host, origin, rate, token)
 * is exercised on its own with everything else valid, so a failure points at one control.
 *
 * Reference: docs/COMPANION-APP-PHASE-2-LOOPBACK-SECURITY.md (guard contract),
 *            docs/COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md §4 (the 8 loopback controls).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyLoopbackRequest,
  createLoopbackRateState,
  recordLoopbackRequest,
  evaluateRateLimit,
  constantTimeStringEqual,
  parseHostHeader,
  isLoopbackHost,
  shouldCountTowardRateLimit,
  ALLOWED_METHODS,
  LOOPBACK_HOSTNAMES,
  LOOPBACK_GUARD_REASONS,
} from '../lib/companion-loopback-guard.mjs';

const TOKEN = 'a'.repeat(43); // ~256-bit base64url-ish length
const PORT = '51847';
const ALLOWED_HOSTS = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];

/** A request that should be admitted, with one override slot. */
function goodRequest(overrides = {}) {
  return {
    method: 'POST',
    headers: {
      Host: `127.0.0.1:${PORT}`,
      Origin: `http://127.0.0.1:${PORT}`,
      'Sec-Fetch-Site': 'same-origin',
    },
    token: TOKEN,
    expectedToken: TOKEN,
    allowedHosts: ALLOWED_HOSTS,
    now: 1_000_000,
    rateState: createLoopbackRateState({ windowMs: 60_000, maxRequests: 60 }),
    ...overrides,
  };
}

describe('Unit — happy path', () => {
  it('admits a well-formed same-origin POST with valid token', () => {
    const v = verifyLoopbackRequest(goodRequest());
    assert.deepEqual(v, { allow: true, status: 200, reason: 'ok' });
  });

  it('admits a GET health probe', () => {
    const v = verifyLoopbackRequest(goodRequest({ method: 'GET' }));
    assert.equal(v.allow, true);
    assert.equal(v.status, 200);
  });

  it('admits a non-browser local client (no Origin, no Sec-Fetch-Site)', () => {
    const v = verifyLoopbackRequest(
      goodRequest({ headers: { Host: `127.0.0.1:${PORT}` } }),
    );
    assert.equal(v.allow, true);
  });
});

describe('Unit — method allowlist', () => {
  it('ALLOWED_METHODS is exactly GET and POST', () => {
    assert.deepEqual([...ALLOWED_METHODS].sort(), ['GET', 'POST']);
  });

  for (const method of ['OPTIONS', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'TRACE']) {
    it(`rejects ${method} with 403 method_not_allowed`, () => {
      const v = verifyLoopbackRequest(goodRequest({ method }));
      assert.equal(v.allow, false);
      assert.equal(v.status, 403);
      assert.equal(v.reason, LOOPBACK_GUARD_REASONS.METHOD_NOT_ALLOWED);
    });
  }

  it('method is matched case-insensitively (post → POST)', () => {
    const v = verifyLoopbackRequest(goodRequest({ method: 'post' }));
    assert.equal(v.allow, true);
  });
});

describe('Unit — host allowlist + loopback', () => {
  it('rejects a missing Host header', () => {
    const v = verifyLoopbackRequest(goodRequest({ headers: { Origin: `http://127.0.0.1:${PORT}` } }));
    assert.equal(v.status, 403);
    assert.equal(v.reason, LOOPBACK_GUARD_REASONS.HOST_NOT_ALLOWED);
  });

  it('rejects a Host not in the allowlist', () => {
    const v = verifyLoopbackRequest(goodRequest({ headers: { Host: `127.0.0.1:9999` } }));
    assert.equal(v.reason, LOOPBACK_GUARD_REASONS.HOST_NOT_ALLOWED);
  });

  it('rejects when allowedHosts is empty (cannot validate)', () => {
    const v = verifyLoopbackRequest(goodRequest({ allowedHosts: [] }));
    assert.equal(v.reason, LOOPBACK_GUARD_REASONS.HOST_NOT_ALLOWED);
  });

  it('accepts localhost:<port> form', () => {
    const v = verifyLoopbackRequest(
      goodRequest({ headers: { Host: `localhost:${PORT}`, 'Sec-Fetch-Site': 'same-origin', Origin: `http://localhost:${PORT}` } }),
    );
    assert.equal(v.allow, true);
  });
});

describe('Unit — origin / sec-fetch-site', () => {
  it('rejects Sec-Fetch-Site: cross-site', () => {
    const v = verifyLoopbackRequest(goodRequest({
      headers: { Host: `127.0.0.1:${PORT}`, 'Sec-Fetch-Site': 'cross-site' },
    }));
    assert.equal(v.status, 403);
    assert.equal(v.reason, LOOPBACK_GUARD_REASONS.CROSS_SITE_FORBIDDEN);
  });

  it('rejects Sec-Fetch-Site: same-site (loopback has no same-site siblings)', () => {
    const v = verifyLoopbackRequest(goodRequest({
      headers: { Host: `127.0.0.1:${PORT}`, 'Sec-Fetch-Site': 'same-site' },
    }));
    assert.equal(v.reason, LOOPBACK_GUARD_REASONS.CROSS_SITE_FORBIDDEN);
  });

  it('rejects an unrecognised Sec-Fetch-Site value (fail-closed)', () => {
    const v = verifyLoopbackRequest(goodRequest({
      headers: { Host: `127.0.0.1:${PORT}`, 'Sec-Fetch-Site': 'totally-made-up' },
    }));
    assert.equal(v.reason, LOOPBACK_GUARD_REASONS.CROSS_SITE_FORBIDDEN);
  });

  it('rejects a foreign Origin even when Host is loopback', () => {
    const v = verifyLoopbackRequest(goodRequest({
      headers: { Host: `127.0.0.1:${PORT}`, Origin: 'https://evil.example' },
    }));
    assert.equal(v.reason, LOOPBACK_GUARD_REASONS.CROSS_SITE_FORBIDDEN);
  });

  it('accepts Sec-Fetch-Site: none (top-level navigation)', () => {
    const v = verifyLoopbackRequest(goodRequest({
      headers: { Host: `127.0.0.1:${PORT}`, 'Sec-Fetch-Site': 'none' },
    }));
    assert.equal(v.allow, true);
  });
});

describe('Unit — token', () => {
  it('rejects a missing token with 401 missing_token', () => {
    const v = verifyLoopbackRequest(goodRequest({ token: undefined }));
    assert.equal(v.status, 401);
    assert.equal(v.reason, LOOPBACK_GUARD_REASONS.MISSING_TOKEN);
  });

  it('rejects an empty-string token with 401 missing_token', () => {
    const v = verifyLoopbackRequest(goodRequest({ token: '' }));
    assert.equal(v.reason, LOOPBACK_GUARD_REASONS.MISSING_TOKEN);
  });

  it('rejects a wrong token with 401 invalid_token', () => {
    const v = verifyLoopbackRequest(goodRequest({ token: 'b'.repeat(43) }));
    assert.equal(v.status, 401);
    assert.equal(v.reason, LOOPBACK_GUARD_REASONS.INVALID_TOKEN);
  });

  it('rejects when no expectedToken is configured (fail-closed)', () => {
    const v = verifyLoopbackRequest(goodRequest({ expectedToken: undefined }));
    assert.equal(v.status, 401);
    assert.equal(v.reason, LOOPBACK_GUARD_REASONS.INVALID_TOKEN);
  });
});

describe('Unit — rate limit', () => {
  it('rejects with 429 rate_limited when the window is full', () => {
    const rateState = { windowMs: 60_000, maxRequests: 2, timestamps: [999_999, 1_000_000] };
    const v = verifyLoopbackRequest(goodRequest({ rateState, now: 1_000_001 }));
    assert.equal(v.status, 429);
    assert.equal(v.reason, LOOPBACK_GUARD_REASONS.RATE_LIMITED);
  });

  it('rejects with 429 rate_state_unavailable when rateState is missing', () => {
    const v = verifyLoopbackRequest(goodRequest({ rateState: undefined }));
    assert.equal(v.status, 429);
    assert.equal(v.reason, LOOPBACK_GUARD_REASONS.RATE_STATE_UNAVAILABLE);
  });
});

describe('Unit — constantTimeStringEqual', () => {
  it('true for equal strings', () => {
    assert.equal(constantTimeStringEqual('abc123', 'abc123'), true);
  });
  it('false for different strings of equal length', () => {
    assert.equal(constantTimeStringEqual('abc123', 'abc124'), false);
  });
  it('false for different lengths (no throw)', () => {
    assert.equal(constantTimeStringEqual('abc', 'abcdef'), false);
  });
  it('false for non-string / empty inputs', () => {
    assert.equal(constantTimeStringEqual('', 'x'), false);
    assert.equal(constantTimeStringEqual(undefined, 'x'), false);
    assert.equal(constantTimeStringEqual('x', null), false);
    assert.equal(constantTimeStringEqual(123, 123), false);
  });
});

describe('Unit — parseHostHeader / isLoopbackHost', () => {
  it('parses ipv4:port', () => {
    assert.deepEqual(parseHostHeader('127.0.0.1:8080'), { hostname: '127.0.0.1', port: '8080' });
  });
  it('parses hostname:port', () => {
    assert.deepEqual(parseHostHeader('localhost:8080'), { hostname: 'localhost', port: '8080' });
  });
  it('parses ipv6 bracket form', () => {
    assert.deepEqual(parseHostHeader('[::1]:8080'), { hostname: '::1', port: '8080' });
  });
  it('returns null for bare ipv6 without brackets', () => {
    assert.equal(parseHostHeader('::1:8080'), null);
  });
  it('isLoopbackHost recognises the loopback set', () => {
    assert.equal(isLoopbackHost('127.0.0.1:1'), true);
    assert.equal(isLoopbackHost('localhost:1'), true);
    assert.equal(isLoopbackHost('[::1]:1'), true);
    assert.equal(isLoopbackHost('10.0.0.5:1'), false);
    assert.equal(isLoopbackHost('attacker.example:1'), false);
  });
  it('LOOPBACK_HOSTNAMES is the documented set', () => {
    assert.deepEqual([...LOOPBACK_HOSTNAMES].sort(), ['127.0.0.1', '::1', 'localhost']);
  });
});

describe('Unit — evaluateRateLimit / recordLoopbackRequest', () => {
  it('evaluateRateLimit ok under limit', () => {
    assert.deepEqual(evaluateRateLimit({ windowMs: 1000, maxRequests: 3, timestamps: [] }, 0), { ok: true });
  });
  it('evaluateRateLimit prunes out-of-window timestamps', () => {
    const r = evaluateRateLimit({ windowMs: 1000, maxRequests: 2, timestamps: [0, 1, 2] }, 5000);
    assert.deepEqual(r, { ok: true }); // all three timestamps are outside the 1s window at now=5000
  });
  it('recordLoopbackRequest appends now and prunes, returning new state', () => {
    const s0 = createLoopbackRateState({ windowMs: 1000, maxRequests: 5 });
    const s1 = recordLoopbackRequest(s0, 100);
    assert.deepEqual(s0.timestamps, [], 'input not mutated');
    assert.deepEqual(s1.timestamps, [100]);
    const s2 = recordLoopbackRequest(s1, 2000);
    assert.deepEqual(s2.timestamps, [2000], 'stale 100 pruned at now=2000');
  });
  it('shouldCountTowardRateLimit counts only slot-consuming (token-stage) verdicts', () => {
    // Pre-rate rejections never consume budget (no DoS via cross-origin/rebinding floods).
    assert.equal(shouldCountTowardRateLimit({ reason: LOOPBACK_GUARD_REASONS.MALFORMED_REQUEST }), false);
    assert.equal(shouldCountTowardRateLimit({ reason: LOOPBACK_GUARD_REASONS.METHOD_NOT_ALLOWED }), false);
    assert.equal(shouldCountTowardRateLimit({ reason: LOOPBACK_GUARD_REASONS.HOST_NOT_ALLOWED }), false);
    assert.equal(shouldCountTowardRateLimit({ reason: LOOPBACK_GUARD_REASONS.CROSS_SITE_FORBIDDEN }), false);
    // Rate rejections did not get a slot → not recorded (keeps the array bounded by maxRequests).
    assert.equal(shouldCountTowardRateLimit({ reason: LOOPBACK_GUARD_REASONS.RATE_LIMITED }), false);
    assert.equal(shouldCountTowardRateLimit({ reason: LOOPBACK_GUARD_REASONS.RATE_STATE_UNAVAILABLE }), false);
    // Token-stage verdicts consume a slot (failed auth must count so brute-force is bounded).
    assert.equal(shouldCountTowardRateLimit({ reason: LOOPBACK_GUARD_REASONS.MISSING_TOKEN }), true);
    assert.equal(shouldCountTowardRateLimit({ reason: LOOPBACK_GUARD_REASONS.INVALID_TOKEN }), true);
    assert.equal(shouldCountTowardRateLimit({ reason: LOOPBACK_GUARD_REASONS.OK }), true);
  });
});

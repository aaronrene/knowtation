/**
 * SEC-KN-1 — seven-tier coverage for fail-closed `gatewayAuthorized`.
 *
 * Frozen requirement: Pass 2 P1
 * (`~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md`) —
 * empty `gateway_auth_secret` must DENY, not allow.
 *
 * Tiers: unit · integration · e2e · stress · data-integrity · performance · security
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  gatewayAuthorized,
  httpRequestRequiresGatewayAuth,
  healthPayload,
} from '../lib/gateway-authorized.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MAIN_MO = path.join(ROOT, 'hub/icp/src/hub/main.mo');

function readMainMo() {
  return fs.readFileSync(MAIN_MO, 'utf8');
}

function extractGatewayAuthorizedBlock(src) {
  const start = src.indexOf('func gatewayAuthorized(req : HttpRequest) : Bool {');
  assert.ok(start >= 0, 'gatewayAuthorized must exist in main.mo');
  const end = src.indexOf('\n};', start);
  assert.ok(end > start, 'gatewayAuthorized block must close');
  return src.slice(start, end + 3);
}

/** Pre-fix fail-open behavior — security tier must prove this is wrong. */
function gatewayAuthorizedFailOpenLegacy(gatewayAuthSecret, headerValue) {
  if (!gatewayAuthSecret) return true;
  if (headerValue === undefined || headerValue === null) return false;
  if (headerValue.length !== gatewayAuthSecret.length) return false;
  return headerValue === gatewayAuthSecret;
}

// ---------------------------------------------------------------------------
// Tier 1 — unit
// ---------------------------------------------------------------------------
describe('SEC-KN-1 unit — gatewayAuthorized fail-closed', () => {
  test('empty secret denies missing, wrong, and empty headers', () => {
    assert.equal(gatewayAuthorized('', undefined), false);
    assert.equal(gatewayAuthorized('', null), false);
    assert.equal(gatewayAuthorized('', ''), false);
    assert.equal(gatewayAuthorized('', 'forged'), false);
  });

  test('configured secret accepts only exact match', () => {
    assert.equal(gatewayAuthorized('sec', 'sec'), true);
    assert.equal(gatewayAuthorized('sec', 'se'), false);
    assert.equal(gatewayAuthorized('sec', 'secc'), false);
    assert.equal(gatewayAuthorized('sec', undefined), false);
  });

  test('healthPayload stays ok:true and reports configured flag loudly', () => {
    assert.deepEqual(healthPayload(''), {
      ok: true,
      gateway_auth_configured: false,
    });
    assert.deepEqual(healthPayload('set'), {
      ok: true,
      gateway_auth_configured: true,
    });
  });

  test('health and OPTIONS do not require gateway auth; vaults GET does', () => {
    assert.equal(httpRequestRequiresGatewayAuth('GET', 'health'), false);
    assert.equal(httpRequestRequiresGatewayAuth('OPTIONS', 'vaults'), false);
    assert.equal(httpRequestRequiresGatewayAuth('GET', 'vaults'), true);
    assert.equal(httpRequestRequiresGatewayAuth('POST', 'notes'), true);
  });
});

// ---------------------------------------------------------------------------
// Tier 2 — integration (Motoko source + JS mirror + request routing)
// ---------------------------------------------------------------------------
describe('SEC-KN-1 integration — Motoko + routing contract', () => {
  test('Motoko empty-secret branch returns false (not true)', () => {
    const block = extractGatewayAuthorizedBlock(readMainMo());
    assert.ok(
      block.includes('if (Text.size(expected) == 0) { return false }'),
      'empty secret must return false'
    );
    assert.ok(
      !block.includes('if (Text.size(expected) == 0) { return true }'),
      'fail-open return true must be gone'
    );
  });

  test('http_request serves health and OPTIONS before gatewayAuthorized', () => {
    const src = readMainMo();
    const healthIdx = src.indexOf('if (pathKind == "health")');
    const optionsIdx = src.indexOf('if (req.method == "OPTIONS")');
    const authIdx = src.indexOf('if (not gatewayAuthorized(req))');
    assert.ok(healthIdx > 0 && optionsIdx > healthIdx && authIdx > optionsIdx);
  });

  test('http_request_update also gates with gatewayAuthorized', () => {
    const src = readMainMo();
    const updateStart = src.indexOf('public func http_request_update');
    assert.ok(updateStart > 0);
    const slice = src.slice(updateStart, updateStart + 400);
    assert.ok(slice.includes('if (not gatewayAuthorized(req))'));
  });

  test('forged X-User-Id alone never authorizes when secret empty or mismatched', () => {
    // Identity header is independent of gatewayAuthorized — auth must fail first.
    assert.equal(gatewayAuthorized('', 'attacker-user-id'), false);
    assert.equal(gatewayAuthorized('real-secret', 'attacker-user-id'), false);
    assert.equal(gatewayAuthorized('real-secret', 'real-secret'), true);
  });
});

// ---------------------------------------------------------------------------
// Tier 3 — e2e (fixture request matrix through routing + auth decision)
// ---------------------------------------------------------------------------
describe('SEC-KN-1 e2e — request matrix', () => {
  function decide(secret, method, pathKind, gatewayHeader) {
    if (!httpRequestRequiresGatewayAuth(method, pathKind)) {
      return { status: 200, body: healthPayload(secret) };
    }
    if (!gatewayAuthorized(secret, gatewayHeader)) {
      return {
        status: 403,
        body: {
          error: 'Gateway authentication required',
          code: 'GATEWAY_AUTH_REQUIRED',
        },
      };
    }
    return { status: 200, body: { ok: true, pathKind } };
  }

  test('empty secret: health 200 with gateway_auth_configured false; vaults 403', () => {
    const health = decide('', 'GET', 'health', undefined);
    assert.equal(health.status, 200);
    assert.equal(health.body.gateway_auth_configured, false);
    assert.equal(health.body.ok, true);

    const vaults = decide('', 'GET', 'vaults', undefined);
    assert.equal(vaults.status, 403);
    assert.equal(vaults.body.code, 'GATEWAY_AUTH_REQUIRED');

    const options = decide('', 'OPTIONS', 'vaults', undefined);
    assert.equal(options.status, 200);
  });

  test('configured secret: forged user id header value as auth still 403; correct auth 200', () => {
    const forged = decide('prod-secret', 'GET', 'vaults', 'google:evil');
    assert.equal(forged.status, 403);
    const ok = decide('prod-secret', 'GET', 'vaults', 'prod-secret');
    assert.equal(ok.status, 200);
  });
});

// ---------------------------------------------------------------------------
// Tier 4 — stress
// ---------------------------------------------------------------------------
describe('SEC-KN-1 stress — many empty-secret and forged decisions', () => {
  test('10_000 empty-secret denials stay false with no throw', () => {
    for (let i = 0; i < 10_000; i++) {
      assert.equal(gatewayAuthorized('', i % 2 === 0 ? undefined : `forge-${i}`), false);
    }
  });

  test('10_000 alternating correct/wrong secrets', () => {
    const secret = 's'.repeat(64);
    for (let i = 0; i < 10_000; i++) {
      const header = i % 2 === 0 ? secret : secret.slice(0, -1) + 'x';
      assert.equal(gatewayAuthorized(secret, header), i % 2 === 0);
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 5 — data-integrity
// ---------------------------------------------------------------------------
describe('SEC-KN-1 data-integrity — idempotent decisions + Motoko health loud field', () => {
  test('same inputs always yield same allow/deny', () => {
    const cases = [
      ['', undefined],
      ['', 'x'],
      ['abc', 'abc'],
      ['abc', 'abd'],
    ];
    for (const [s, h] of cases) {
      const a = gatewayAuthorized(s, h);
      const b = gatewayAuthorized(s, h);
      assert.equal(a, b);
    }
  });

  test('Motoko health JSON includes gateway_auth_configured true/false branches', () => {
    const src = readMainMo();
    assert.ok(src.includes('gateway_auth_configured'));
    assert.ok(src.includes('\\"gateway_auth_configured\\":true}'));
    assert.ok(src.includes('\\"gateway_auth_configured\\":false}'));
  });
});

// ---------------------------------------------------------------------------
// Tier 6 — performance
// ---------------------------------------------------------------------------
describe('SEC-KN-1 performance — bounded auth decision time', () => {
  test('100k decisions complete under 500ms', () => {
    const secret = 'perf-secret-value-32-chars!!!!';
    const t0 = performance.now();
    for (let i = 0; i < 100_000; i++) {
      gatewayAuthorized(secret, i % 3 === 0 ? secret : 'wrong');
      gatewayAuthorized('', undefined);
    }
    const ms = performance.now() - t0;
    assert.ok(ms < 500, `expected <500ms, got ${ms.toFixed(1)}ms`);
  });
});

// ---------------------------------------------------------------------------
// Tier 7 — security (regression must FAIL against pre-fix fail-open)
// ---------------------------------------------------------------------------
describe('SEC-KN-1 security — regression vs fail-open', () => {
  test('security regression: empty secret must DENY (legacy fail-open would ALLOW)', () => {
    // Against pre-fix code this assertion fails — that is the point of the tier.
    assert.equal(
      gatewayAuthorizedFailOpenLegacy('', undefined),
      true,
      'sanity: legacy helper still models fail-open'
    );
    assert.equal(
      gatewayAuthorized('', undefined),
      false,
      'current contract must deny empty secret'
    );
    assert.notEqual(
      gatewayAuthorized('', undefined),
      gatewayAuthorizedFailOpenLegacy('', undefined),
      'fixed behavior must diverge from fail-open on empty secret'
    );
  });

  test('Motoko source must not contain fail-open empty-secret allow', () => {
    const block = extractGatewayAuthorizedBlock(readMainMo());
    assert.match(block, /Text\.size\(expected\) == 0\) \{ return false \}/);
    assert.doesNotMatch(block, /Text\.size\(expected\) == 0\) \{ return true \}/);
  });

  test('forged X-User-Id without valid X-Gateway-Auth is denied when secret set', () => {
    // Canister trusts X-User-Id only AFTER gatewayAuthorized — missing auth → 403.
    assert.equal(gatewayAuthorized('canister-secret', undefined), false);
    assert.equal(gatewayAuthorized('canister-secret', 'google:attacker'), false);
  });

  test('canisterAuthHeaders empty secret produces no header (caller would be denied)', async () => {
    const { canisterAuthHeaders } = await import('../hub/gateway/canister-auth-headers.mjs');
    const saved = process.env.CANISTER_AUTH_SECRET;
    try {
      process.env.CANISTER_AUTH_SECRET = '';
      const headers = canisterAuthHeaders();
      assert.deepEqual(headers, {});
      assert.equal(gatewayAuthorized('', headers['x-gateway-auth']), false);
    } finally {
      if (saved === undefined) delete process.env.CANISTER_AUTH_SECRET;
      else process.env.CANISTER_AUTH_SECRET = saved;
    }
  });
});

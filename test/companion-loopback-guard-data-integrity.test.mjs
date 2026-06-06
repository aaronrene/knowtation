/**
 * Tier 5 — DATA-INTEGRITY: purity, determinism, and no-mutation guarantees.
 *
 * The guard is a decision authority; its trustworthiness depends on being a PURE function of its
 * inputs. This tier proves: identical inputs → identical verdict; inputs are never mutated; the
 * verdict shape is invariant; reason codes come only from the frozen constant set; and the
 * rate-state helpers produce new state without aliasing the input.
 *
 * Reference: docs/COMPANION-APP-PHASE-2-LOOPBACK-SECURITY.md (purity / fail-closed invariants).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyLoopbackRequest,
  createLoopbackRateState,
  recordLoopbackRequest,
  LOOPBACK_GUARD_REASONS,
} from '../lib/companion-loopback-guard.mjs';

const PORT = '53550';
const TOKEN = 'integ-' + 'f'.repeat(40);
const ALLOWED_HOSTS = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
const REASON_VALUES = new Set(Object.values(LOOPBACK_GUARD_REASONS));

function base(overrides = {}) {
  return {
    method: 'POST',
    headers: { Host: `127.0.0.1:${PORT}`, Origin: `http://127.0.0.1:${PORT}`, 'Sec-Fetch-Site': 'same-origin' },
    token: TOKEN,
    expectedToken: TOKEN,
    allowedHosts: ALLOWED_HOSTS,
    now: 1000,
    rateState: createLoopbackRateState(),
    ...overrides,
  };
}

describe('Data-integrity — determinism', () => {
  it('identical inputs produce identical verdicts across 10k calls', () => {
    const input = base();
    const first = verifyLoopbackRequest(input);
    for (let i = 0; i < 10_000; i++) {
      assert.deepEqual(verifyLoopbackRequest(input), first);
    }
  });

  it('each distinct rejection class is stable', () => {
    const cases = [
      base({ method: 'DELETE' }),
      base({ headers: { Host: 'bad.example' } }),
      base({ headers: { Host: `127.0.0.1:${PORT}`, 'Sec-Fetch-Site': 'cross-site' } }),
      base({ token: 'x' }),
      base({ rateState: { windowMs: 1000, maxRequests: 1, timestamps: [1000] } }),
    ];
    for (const c of cases) {
      const a = verifyLoopbackRequest(c);
      const b = verifyLoopbackRequest(c);
      assert.deepEqual(a, b);
    }
  });
});

describe('Data-integrity — no input mutation', () => {
  it('verifyLoopbackRequest does not mutate headers, allowedHosts, or rateState', () => {
    const headers = { Host: `127.0.0.1:${PORT}`, Origin: `http://127.0.0.1:${PORT}`, 'Sec-Fetch-Site': 'same-origin' };
    const allowedHosts = [`127.0.0.1:${PORT}`];
    const rateState = createLoopbackRateState({ windowMs: 1000, maxRequests: 5 });
    const headersSnapshot = JSON.stringify(headers);
    const hostsSnapshot = JSON.stringify(allowedHosts);
    const rateSnapshot = JSON.stringify(rateState);

    verifyLoopbackRequest({ method: 'POST', headers, token: TOKEN, expectedToken: TOKEN, allowedHosts, now: 1, rateState });

    assert.equal(JSON.stringify(headers), headersSnapshot);
    assert.equal(JSON.stringify(allowedHosts), hostsSnapshot);
    assert.equal(JSON.stringify(rateState), rateSnapshot);
  });

  it('recordLoopbackRequest returns a new object and leaves the input untouched', () => {
    const s0 = createLoopbackRateState({ windowMs: 1000, maxRequests: 5 });
    const before = JSON.stringify(s0);
    const s1 = recordLoopbackRequest(s0, 10);
    assert.notEqual(s1, s0, 'must be a new reference');
    assert.notEqual(s1.timestamps, s0.timestamps, 'timestamps array must be a new array');
    assert.equal(JSON.stringify(s0), before, 'input not mutated');
  });
});

describe('Data-integrity — verdict shape and reason domain', () => {
  it('every verdict has exactly { allow, status, reason } with valid types', () => {
    const inputs = [
      base(),
      base({ method: 'PUT' }),
      base({ headers: { Host: 'bad' } }),
      base({ token: undefined }),
      base({ rateState: undefined }),
    ];
    for (const inp of inputs) {
      const v = verifyLoopbackRequest(inp);
      assert.deepEqual(Object.keys(v).sort(), ['allow', 'reason', 'status']);
      assert.equal(typeof v.allow, 'boolean');
      assert.ok([200, 401, 403, 429].includes(v.status));
      assert.ok(REASON_VALUES.has(v.reason), `reason ${v.reason} must be a known constant`);
    }
  });

  it('allow===true iff status===200 iff reason===ok', () => {
    const inputs = [base(), base({ token: 'bad' }), base({ method: 'PUT' }), base({ rateState: undefined })];
    for (const inp of inputs) {
      const v = verifyLoopbackRequest(inp);
      assert.equal(v.allow, v.status === 200);
      assert.equal(v.allow, v.reason === LOOPBACK_GUARD_REASONS.OK);
    }
  });

  it('LOOPBACK_GUARD_REASONS is frozen', () => {
    assert.equal(Object.isFrozen(LOOPBACK_GUARD_REASONS), true);
  });
});

describe('Data-integrity — no global / env state read', () => {
  it('produces the same verdict regardless of surrounding env vars', () => {
    const v1 = verifyLoopbackRequest(base());
    process.env.KNOWTATION_FAKE_TEST_VAR = 'tampered';
    const v2 = verifyLoopbackRequest(base());
    delete process.env.KNOWTATION_FAKE_TEST_VAR;
    assert.deepEqual(v1, v2);
  });
});

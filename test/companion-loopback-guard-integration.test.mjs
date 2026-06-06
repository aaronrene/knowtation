/**
 * Tier 2 — INTEGRATION: verifyLoopbackRequest composed with the rate-state lifecycle.
 *
 * Exercises the guard the way a future Phase 5 listener will: decide → (conditionally) record →
 * carry the new rate state to the next request. Verifies the EVALUATION ORDER holds across
 * combined inputs (e.g. a bad-host request is rejected for host even when its token is also
 * wrong) and that the caller-side record contract bounds brute-force without enabling a
 * budget-exhaustion DoS.
 *
 * Reference: docs/COMPANION-APP-PHASE-2-LOOPBACK-SECURITY.md (guard contract, evaluation order).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyLoopbackRequest,
  createLoopbackRateState,
  recordLoopbackRequest,
  shouldCountTowardRateLimit,
  LOOPBACK_GUARD_REASONS,
} from '../lib/companion-loopback-guard.mjs';

const TOKEN = 'tok-' + 'c'.repeat(40);
const PORT = '49215';
const ALLOWED_HOSTS = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];

function req(overrides = {}, rateState) {
  return {
    method: 'POST',
    headers: { Host: `127.0.0.1:${PORT}`, Origin: `http://127.0.0.1:${PORT}`, 'Sec-Fetch-Site': 'same-origin' },
    token: TOKEN,
    expectedToken: TOKEN,
    allowedHosts: ALLOWED_HOSTS,
    now: 0,
    rateState,
    ...overrides,
  };
}

/** Simulate a listener loop: decide, then record iff the verdict counts. Returns {verdict, state}. */
function step(request) {
  const verdict = verifyLoopbackRequest(request);
  let state = request.rateState;
  if (shouldCountTowardRateLimit(verdict)) {
    state = recordLoopbackRequest(state, request.now);
  }
  return { verdict, state };
}

describe('Integration — evaluation order under combined faults', () => {
  it('bad host wins over bad token (host checked before token)', () => {
    const v = verifyLoopbackRequest(req({
      headers: { Host: 'attacker.example:443' },
      token: 'wrong',
    }, createLoopbackRateState()));
    assert.equal(v.reason, LOOPBACK_GUARD_REASONS.HOST_NOT_ALLOWED);
  });

  it('cross-site wins over bad token (origin checked before token)', () => {
    const v = verifyLoopbackRequest(req({
      headers: { Host: `127.0.0.1:${PORT}`, 'Sec-Fetch-Site': 'cross-site' },
      token: 'wrong',
    }, createLoopbackRateState()));
    assert.equal(v.reason, LOOPBACK_GUARD_REASONS.CROSS_SITE_FORBIDDEN);
  });

  it('rate limit wins over a valid token (rate checked before token)', () => {
    const rateState = { windowMs: 60_000, maxRequests: 1, timestamps: [0] };
    const v = verifyLoopbackRequest(req({ now: 1 }, rateState));
    assert.equal(v.reason, LOOPBACK_GUARD_REASONS.RATE_LIMITED);
  });

  it('rate limit wins over an INVALID token too (so brute-force is bounded by 429, not 401)', () => {
    const rateState = { windowMs: 60_000, maxRequests: 1, timestamps: [0] };
    const v = verifyLoopbackRequest(req({ now: 1, token: 'wrong-guess' }, rateState));
    assert.equal(v.reason, LOOPBACK_GUARD_REASONS.RATE_LIMITED);
  });

  it('method wins over everything (checked first)', () => {
    const v = verifyLoopbackRequest(req({
      method: 'DELETE',
      headers: { Host: 'attacker.example' },
      token: 'wrong',
    }, undefined));
    assert.equal(v.reason, LOOPBACK_GUARD_REASONS.METHOD_NOT_ALLOWED);
  });
});

describe('Integration — rate-state lifecycle across a request sequence', () => {
  it('admits up to maxRequests, then trips 429, then recovers after the window slides', () => {
    let state = createLoopbackRateState({ windowMs: 1000, maxRequests: 3 });
    // 3 admitted within the window.
    for (let i = 0; i < 3; i++) {
      const r = step(req({ now: 100 + i }, state));
      assert.equal(r.verdict.allow, true, `request ${i} should be admitted`);
      state = r.state;
    }
    // 4th within the window → 429.
    const fourth = step(req({ now: 110 }, state));
    assert.equal(fourth.verdict.status, 429);
    assert.equal(fourth.verdict.reason, LOOPBACK_GUARD_REASONS.RATE_LIMITED);
    state = fourth.state;
    // After the window slides past all three, a new request is admitted again.
    const later = step(req({ now: 2000 }, state));
    assert.equal(later.verdict.allow, true);
  });
});

describe('Integration — brute-force bounding (failed auth consumes budget)', () => {
  it('token-guessing reaches 429 once the window fills, not an unbounded stream of 401s', () => {
    let state = createLoopbackRateState({ windowMs: 60_000, maxRequests: 5 });
    let saw429 = false;
    for (let i = 0; i < 50; i++) {
      const r = step(req({ now: 1000 + i, token: `guess-${i}` }, state));
      state = r.state;
      if (r.verdict.status === 429) { saw429 = true; break; }
      assert.equal(r.verdict.status, 401, 'pre-429 guesses are 401');
    }
    assert.equal(saw429, true, 'brute-force must hit a 429 ceiling');
  });
});

describe('Integration — budget-exhaustion DoS is prevented', () => {
  it('cross-origin/bad-host probes do NOT consume the rate budget', () => {
    let state = createLoopbackRateState({ windowMs: 60_000, maxRequests: 3 });
    // 100 cross-site probes — each 403, none recorded.
    for (let i = 0; i < 100; i++) {
      const r = step(req({
        now: 1000 + i,
        headers: { Host: `127.0.0.1:${PORT}`, 'Sec-Fetch-Site': 'cross-site' },
      }, state));
      assert.equal(r.verdict.reason, LOOPBACK_GUARD_REASONS.CROSS_SITE_FORBIDDEN);
      state = r.state;
    }
    assert.equal(state.timestamps.length, 0, 'no probe should have consumed budget');
    // The legitimate client is still fully served.
    const legit = step(req({ now: 1200 }, state));
    assert.equal(legit.verdict.allow, true);
  });
});

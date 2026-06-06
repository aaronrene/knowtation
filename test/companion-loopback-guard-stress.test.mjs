/**
 * Tier 4 — STRESS: high-volume and adversarial-volume behaviour.
 *
 * The guard is pure and synchronous, so "stress" here means correctness and stability under
 * large request counts: many auth attempts (gate §10 stress requirement), large allowlists,
 * large rate windows, and pathological header bags. No socket, no concurrency primitives — the
 * pure function must stay correct and bounded regardless of volume.
 *
 * Reference: docs/COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md §10 (stress: many auth attempts).
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

const PORT = '50001';
const TOKEN = 'stress-' + 'e'.repeat(40);
const ALLOWED_HOSTS = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];

function base(overrides = {}, rateState) {
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

describe('Stress — 100k auth attempts with wrong tokens', () => {
  it('every wrong-token request is denied; never a single accidental allow', () => {
    let allows = 0;
    for (let i = 0; i < 100_000; i++) {
      // generous rate budget so we isolate the token decision, not the rate decision
      const v = verifyLoopbackRequest(base({ token: `bad-${i}` }, { windowMs: 60_000, maxRequests: 1_000_000, timestamps: [] }));
      if (v.allow) allows++;
    }
    assert.equal(allows, 0);
  });
});

describe('Stress — rate window stays bounded under sustained load', () => {
  it('timestamps array never grows beyond what the window can hold', () => {
    const windowMs = 1000;
    let state = createLoopbackRateState({ windowMs, maxRequests: 100 });
    let maxLen = 0;
    for (let i = 0; i < 50_000; i++) {
      // advance time by 1ms each request → window holds ~1000 entries max before pruning
      const now = i;
      const v = verifyLoopbackRequest(base({ now }, state));
      if (shouldCountTowardRateLimit(v)) state = recordLoopbackRequest(state, now);
      if (state.timestamps.length > maxLen) maxLen = state.timestamps.length;
    }
    // Only slot-consuming (token-stage) verdicts are recorded; once maxRequests slots are filled
    // in-window the guard returns 429 and the caller records nothing, so the array is bounded by
    // maxRequests, never by total request volume.
    assert.ok(maxLen <= 100, `timestamps grew to ${maxLen}, expected ≤ 100 (maxRequests)`);
  });
});

describe('Stress — very large allowlist', () => {
  it('matches correctly even with a 10k-entry allowedHosts', () => {
    const big = [];
    for (let i = 0; i < 10_000; i++) big.push(`127.0.0.1:${10000 + i}`);
    big.push(`127.0.0.1:${PORT}`);
    const v = verifyLoopbackRequest(base({ allowedHosts: big }, createLoopbackRateState()));
    assert.equal(v.allow, true);
  });
});

describe('Stress — pathological header bags', () => {
  it('handles many junk headers without misclassifying the decision', () => {
    const headers = { Host: `127.0.0.1:${PORT}`, Origin: `http://127.0.0.1:${PORT}`, 'Sec-Fetch-Site': 'same-origin' };
    for (let i = 0; i < 5000; i++) headers[`X-Junk-${i}`] = `v${i}`;
    const v = verifyLoopbackRequest(base({ headers }, createLoopbackRateState()));
    assert.equal(v.allow, true);
  });

  it('handles a header value that is a huge string without leaking it or crashing', () => {
    const huge = 'A'.repeat(1_000_000);
    const v = verifyLoopbackRequest(base({
      headers: { Host: `127.0.0.1:${PORT}`, 'X-Evil': huge, 'Sec-Fetch-Site': 'same-origin', Origin: `http://127.0.0.1:${PORT}` },
    }, createLoopbackRateState()));
    assert.equal(v.allow, true);
    assert.ok(!v.reason.includes('A'));
  });
});

describe('Stress — interleaved mixed verdicts remain individually correct', () => {
  it('a rotating mix of good/bad-host/cross-site/bad-token always yields the right reason', () => {
    const rotation = [
      { o: {}, want: LOOPBACK_GUARD_REASONS.OK, allow: true },
      { o: { headers: { Host: 'bad.example' } }, want: LOOPBACK_GUARD_REASONS.HOST_NOT_ALLOWED, allow: false },
      { o: { headers: { Host: `127.0.0.1:${PORT}`, 'Sec-Fetch-Site': 'cross-site' } }, want: LOOPBACK_GUARD_REASONS.CROSS_SITE_FORBIDDEN, allow: false },
      { o: { token: 'nope' }, want: LOOPBACK_GUARD_REASONS.INVALID_TOKEN, allow: false },
    ];
    for (let i = 0; i < 20_000; i++) {
      const { o, want, allow } = rotation[i % rotation.length];
      const v = verifyLoopbackRequest(base({ ...o }, { windowMs: 60_000, maxRequests: 1_000_000, timestamps: [] }));
      assert.equal(v.reason, want);
      assert.equal(v.allow, allow);
    }
  });
});

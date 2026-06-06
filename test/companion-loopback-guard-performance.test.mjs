/**
 * Tier 6 — PERFORMANCE: the guard must add negligible, bounded overhead.
 *
 * The loopback endpoint will call verifyLoopbackRequest on EVERY request before any model work,
 * so its cost must be tiny and must not degrade with request volume (gate §10 performance:
 * endpoint overhead bounds; no event-loop starvation). These are generous CI-safe thresholds —
 * they catch accidental O(n^2) / blocking regressions, not micro-fluctuations.
 *
 * Reference: docs/COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md §10 (performance).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyLoopbackRequest,
  createLoopbackRateState,
  recordLoopbackRequest,
  shouldCountTowardRateLimit,
} from '../lib/companion-loopback-guard.mjs';

const PORT = '54000';
const TOKEN = 'perf-' + 'a'.repeat(40);
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

describe('Performance — per-decision overhead', () => {
  it('100k admit decisions complete well under 2 seconds', () => {
    const rateState = { windowMs: 60_000, maxRequests: 1_000_000, timestamps: [] };
    const start = performance.now();
    for (let i = 0; i < 100_000; i++) {
      verifyLoopbackRequest(base({ now: i }, rateState));
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 2000, `100k decisions took ${elapsed.toFixed(1)}ms, expected < 2000ms`);
  });

  it('mean per-decision cost is sub-millisecond', () => {
    const rateState = { windowMs: 60_000, maxRequests: 1_000_000, timestamps: [] };
    const N = 50_000;
    const start = performance.now();
    for (let i = 0; i < N; i++) verifyLoopbackRequest(base({ now: i }, rateState));
    const perCall = (performance.now() - start) / N;
    assert.ok(perCall < 0.5, `mean ${perCall.toFixed(4)}ms/call, expected < 0.5ms`);
  });
});

describe('Performance — no super-linear blowup with rate window size', () => {
  it('decision cost with a steady-state window does not explode', () => {
    // Fill a window to its cap, then time decisions against the full window.
    let state = createLoopbackRateState({ windowMs: 10_000, maxRequests: 1000 });
    for (let i = 0; i < 1000; i++) {
      const v = verifyLoopbackRequest(base({ now: i }, state));
      if (shouldCountTowardRateLimit(v)) state = recordLoopbackRequest(state, i);
    }
    const start = performance.now();
    for (let i = 0; i < 20_000; i++) verifyLoopbackRequest(base({ now: 1000 + i }, state));
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 2000, `20k decisions over a 1000-entry window took ${elapsed.toFixed(1)}ms`);
  });
});

describe('Performance — constant-time compare is not pathologically slow', () => {
  it('100k token comparisons (hash + timingSafeEqual) stay bounded', () => {
    const rateState = { windowMs: 60_000, maxRequests: 1_000_000, timestamps: [] };
    const start = performance.now();
    for (let i = 0; i < 100_000; i++) {
      verifyLoopbackRequest(base({ token: `wrong-${i}` }, rateState));
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 3000, `100k constant-time compares took ${elapsed.toFixed(1)}ms`);
  });
});

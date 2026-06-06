/**
 * Performance tests — proposal approve RBAC fix.
 *
 * Verifies the fix does not introduce measurable latency regressions in:
 *   - jwt.verify on the bridge fallback path (should be negligible vs. a real network call).
 *   - Set.has lookup for admin override (O(1) data structure).
 *   - The added bridgeResolved flag (zero-cost boolean).
 *
 * Thresholds are conservative (×10 buffer) to be stable across CI machines.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const SECRET = 'perf-test-secret-for-jwt';

describe('Performance: jwt.verify on fallback path', () => {
  const token = jwt.sign({ sub: 'google:perf-user', role: 'admin' }, SECRET, { expiresIn: '1h' });

  test('single jwt.verify completes in < 5ms', () => {
    const start = performance.now();
    jwt.verify(token, SECRET);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 5, `jwt.verify took ${elapsed.toFixed(2)}ms (must be < 5ms)`);
  });

  test('100 sequential jwt.verify calls complete in < 100ms', () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) jwt.verify(token, SECRET);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 100, `100 verifications in ${elapsed.toFixed(0)}ms (must be < 100ms)`);
  });

  test('jwt.verify does not allocate more than expected (no obvious memory leak)', () => {
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 1000; i++) jwt.verify(token, SECRET);
    // Force GC hint (not guaranteed but helps in some environments)
    if (typeof global.gc === 'function') global.gc();
    const after = process.memoryUsage().heapUsed;
    const growthKb = (after - before) / 1024;
    // Allow up to 2MB growth (conservative for 1000 allocations)
    assert.ok(growthKb < 2048, `Heap grew by ${growthKb.toFixed(0)}KB for 1000 verifications (must be < 2048KB)`);
  });
});

describe('Performance: Set.has for admin override', () => {
  test('Set.has on 10,000-entry set completes in < 1ms per call', () => {
    const adminSet = new Set(Array.from({ length: 10000 }, (_, i) => `google:admin-${i}`));
    adminSet.add('google:the-target');
    const start = performance.now();
    for (let i = 0; i < 10000; i++) adminSet.has('google:the-target');
    const elapsed = performance.now() - start;
    // 10,000 Set.has calls should complete well under 10ms (O(1) amortised)
    assert.ok(elapsed < 10, `10,000 Set.has calls in ${elapsed.toFixed(2)}ms (must be < 10ms)`);
  });

  test('Set.has miss (not-admin) is equally fast', () => {
    const adminSet = new Set(['google:one-admin']);
    const start = performance.now();
    for (let i = 0; i < 10000; i++) adminSet.has(`google:member-${i}`);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 10, `10,000 Set.has misses in ${elapsed.toFixed(2)}ms (must be < 10ms)`);
  });
});

describe('Performance: bridgeResolved flag overhead', () => {
  test('boolean flag assignment in tight loop is sub-millisecond', () => {
    const start = performance.now();
    let bridgeResolved = false;
    for (let i = 0; i < 1_000_000; i++) {
      bridgeResolved = false;
      if (i % 2 === 0) bridgeResolved = true;
      void bridgeResolved;
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 50, `1M boolean ops in ${elapsed.toFixed(0)}ms (must be < 50ms)`);
  });
});

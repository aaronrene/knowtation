/**
 * Phase 8 P1b — performance tier: Argon2id latency bounds (§9).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassphrase,
  verifyPassphrase,
  ARGON2_PARAMS,
} from '../../hub/lib/local-auth.mjs';

describe('phase8-p1b Argon2id latency (performance)', () => {
  test('verify latency on floor params: ≥50ms and ≤2000ms', async () => {
    let maxMs = 0;
    for (let i = 0; i < 3; i++) {
      const phc = await hashPassphrase(`PerfTest123!Xy${i}`);
      const start = performance.now();
      const ok = await verifyPassphrase(phc, `PerfTest123!Xy${i}`);
      maxMs = Math.max(maxMs, performance.now() - start);
      assert.equal(ok, true);
    }
    assert.ok(maxMs >= 50, `expected ≥50ms on at least one sample, max=${maxMs}`);
    assert.ok(maxMs <= 2000, `expected ≤2000ms, got ${maxMs}`);
    assert.equal(ARGON2_PARAMS.timeCost, 3);
    assert.equal(ARGON2_PARAMS.memoryCost, 65536);
    assert.equal(ARGON2_PARAMS.parallelism, 4);
  });

  test('hash at floor params completes within 3000ms', async () => {
    const start = performance.now();
    await hashPassphrase('BootstrapPerf123!');
    const ms = performance.now() - start;
    assert.ok(ms <= 3000, `bootstrap hash took ${ms}ms`);
  });
});

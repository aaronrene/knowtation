/**
 * Tier 6 — PERFORMANCE: Phase 5 cache and admission overhead bounds.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createCompanionInferenceListener } from '../lib/companion-inference-listener.mjs';
import { createCompanionResourceProbe } from '../lib/companion-resource-probe.mjs';

describe('resource probe cache', () => {
  it('honors the <=500ms cache bound', async () => {
    let now = 1000;
    let reads = 0;
    const probe = createCompanionResourceProbe({
      pid: 123,
      platform: 'linux',
      now: () => now,
      readFile: async () => {
        reads += 1;
        return '100 25 0 0 0 0 0';
      },
      pageSizeBytes: 4096,
      cacheMs: 500,
    });

    assert.equal((await probe.statResources()).ramBytes, 25 * 4096);
    now += 499;
    assert.equal((await probe.statResources()).ramBytes, 25 * 4096);
    assert.equal(reads, 1);
    now += 2;
    await probe.statResources();
    assert.equal(reads, 2);
  });
});

describe('front-door admission overhead', () => {
  it('handles a small burst of admitted health requests without event-loop starvation', async () => {
    const listener = createCompanionInferenceListener({
      expectedToken: 'loopback-token',
      runtimeRequest(_req, res) {
        res.statusCode = 200;
        res.end('ok');
      },
    });
    const bound = await listener.start();
    try {
      const start = performance.now();
      const responses = await Promise.all(Array.from({ length: 25 }, () => fetch(`http://127.0.0.1:${bound.port}/v1/models`, {
        headers: { Authorization: 'Bearer loopback-token' },
      })));
      const elapsed = performance.now() - start;
      assert.equal(responses.every((res) => res.status === 200), true);
      assert.ok(elapsed < 2000, `front-door burst took ${elapsed}ms`);
    } finally {
      await listener.close();
    }
  });
});

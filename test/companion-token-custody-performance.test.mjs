/**
 * Tier 6 — PERFORMANCE: custody operations over the (in-memory) adapter are cheap. Real keychain
 * latency is a Phase 5 concern; here we guard the module's own overhead against a regression.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionMeta, createTokenCustody } from '../lib/companion-token-custody.mjs';
import { makeSyncKeychain } from './helpers/companion-keychain-fake.mjs';

function timed(fn) {
  const t0 = performance.now();
  return fn().then(() => performance.now() - t0);
}

describe('Performance — bounds', () => {
  it('100k buildSessionMeta calls in under 2s', () => {
    const tr = { expiresIn: 3600, refreshToken: 'r', scope: 'vault:read', tokenType: 'Bearer' };
    const t0 = performance.now();
    for (let i = 0; i < 100_000; i++) buildSessionMeta(tr, { now: i, refreshTtlMs: 1000 });
    const ms = performance.now() - t0;
    assert.ok(ms < 2000, `buildSessionMeta x100k took ${ms.toFixed(0)}ms`);
  });

  it('20k store+load cycles in under 3s', async () => {
    const custody = createTokenCustody(makeSyncKeychain());
    const ms = await timed(async () => {
      for (let i = 0; i < 20_000; i++) {
        const meta = buildSessionMeta({ expiresIn: 60, refreshToken: 'r' + i, scope: null, tokenType: 'Bearer' }, { now: i, refreshTtlMs: 1000 });
        await custody.storeSession({ accessToken: 'jwt' + i, refreshToken: 'r' + i, meta });
        await custody.loadSession();
      }
    });
    assert.ok(ms < 3000, `store+load x20k took ${ms.toFixed(0)}ms`);
  });
});

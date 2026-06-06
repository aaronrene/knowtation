/**
 * Tier 4 — STRESS: many store/rotate/load cycles stay consistent and bounded; the store never
 * accumulates stale secrets across rotations.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { KEYCHAIN_ACCOUNTS, buildSessionMeta, createTokenCustody } from '../lib/companion-token-custody.mjs';
import { makeSyncKeychain } from './helpers/companion-keychain-fake.mjs';

describe('Stress — repeated rotation keeps a single live secret per account', () => {
  it('10k access-token rotations leave exactly one access token and bounded store size', async () => {
    const kc = makeSyncKeychain();
    const custody = createTokenCustody(kc);
    const baseMeta = buildSessionMeta({ expiresIn: 60, refreshToken: 'r0', scope: null, tokenType: 'Bearer' }, { now: 0, refreshTtlMs: 1_000_000 });
    await custody.storeSession({ accessToken: 'jwt0', refreshToken: 'r0', meta: baseMeta });
    for (let i = 1; i <= 10_000; i++) {
      await custody.updateAccessToken({ accessToken: 'jwt' + i, refreshToken: 'r' + i, meta: buildSessionMeta({ expiresIn: 60, refreshToken: 'r' + i, scope: null, tokenType: 'Bearer' }, { now: i, refreshTtlMs: 1_000_000 }) });
    }
    const loaded = await custody.loadSession();
    assert.equal(loaded.accessToken, 'jwt10000');
    assert.equal(loaded.refreshToken, 'r10000');
    // Store holds only the 3 session accounts (no per-rotation accumulation).
    assert.ok(kc._store.size <= 4);
  });

  it('10k loopback rotations always yield the latest token only', async () => {
    const kc = makeSyncKeychain();
    const custody = createTokenCustody(kc);
    for (let i = 0; i < 10_000; i++) await custody.rotateLoopbackToken('lb' + i);
    assert.equal(await custody.getLoopbackToken(), 'lb9999');
    assert.equal(kc._store.get(KEYCHAIN_ACCOUNTS.LOOPBACK_TOKEN), 'lb9999');
  });
});

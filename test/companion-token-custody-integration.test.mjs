/**
 * Tier 2 — INTEGRATION: custody composed with the PKCE core across the acquire → use → refresh →
 * logout lifecycle, over an async keychain adapter (the realistic shape).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateTokenResponse } from '../lib/companion-oauth-pkce.mjs';
import { buildSessionMeta, createTokenCustody } from '../lib/companion-token-custody.mjs';
import { makeAsyncKeychain } from './helpers/companion-keychain-fake.mjs';

describe('Integration — token response → custody → refresh decision', () => {
  it('stores a validated token response and decides correctly over time', async () => {
    const custody = createTokenCustody(makeAsyncKeychain());
    const tr = validateTokenResponse({ access_token: 'jwt', token_type: 'Bearer', expires_in: 3600, refresh_token: 'r', scope: 'vault:read vault:write' });
    assert.equal(tr.ok, true);

    const now = 1_000_000;
    const meta = buildSessionMeta(tr, { now, refreshTtlMs: 86_400_000, issuer: 'https://knowtation.store' });
    await custody.storeSession({ accessToken: tr.accessToken, refreshToken: tr.refreshToken, meta });

    assert.equal(await custody.decide({ now, skewMs: 30_000 }), 'valid');
    assert.equal(await custody.decide({ now: meta.expiresAt - 10, skewMs: 30_000 }), 'refresh');
    assert.equal(await custody.decide({ now: meta.refreshExpiresAt + 1 }), 'reauth');
  });
});

describe('Integration — refresh rotation lifecycle', () => {
  it('a refreshed token response rotates the stored secrets', async () => {
    const custody = createTokenCustody(makeAsyncKeychain());
    const first = validateTokenResponse({ access_token: 'jwt1', token_type: 'Bearer', expires_in: 60, refresh_token: 'r1' });
    await custody.storeSession({ accessToken: first.accessToken, refreshToken: first.refreshToken, meta: buildSessionMeta(first, { now: 0, refreshTtlMs: 1_000_000 }) });

    const refreshed = validateTokenResponse({ access_token: 'jwt2', token_type: 'Bearer', expires_in: 60, refresh_token: 'r2' });
    await custody.updateAccessToken({ accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, meta: buildSessionMeta(refreshed, { now: 1000, refreshTtlMs: 1_000_000 }) });

    const loaded = await custody.loadSession();
    assert.equal(loaded.accessToken, 'jwt2');
    assert.equal(loaded.refreshToken, 'r2');
  });
});

describe('Integration — invalid_grant on refresh forces a full logout', () => {
  it('an invalid_grant token response leads the caller to clearSession → reauth', async () => {
    const custody = createTokenCustody(makeAsyncKeychain());
    const first = validateTokenResponse({ access_token: 'jwt1', token_type: 'Bearer', expires_in: 60, refresh_token: 'r1' });
    await custody.storeSession({ accessToken: first.accessToken, refreshToken: first.refreshToken, meta: buildSessionMeta(first, { now: 0, refreshTtlMs: 1_000_000 }) });

    const refreshAttempt = validateTokenResponse({ error: 'invalid_grant' });
    assert.equal(refreshAttempt.ok, false);
    // Caller policy on refresh failure: clear and re-auth.
    await custody.clearSession();
    assert.equal(await custody.decide({ now: 0 }), 'reauth');
  });
});

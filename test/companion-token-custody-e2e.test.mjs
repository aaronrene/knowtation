/**
 * Tier 3 — END-TO-END: a realistic companion session driving custody from first sign-in through
 * a refresh to logout, plus the per-session loopback token rotated at each companion start. Uses
 * the async keychain fake; no real OS keychain (Phase 5).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { validateTokenResponse } from '../lib/companion-oauth-pkce.mjs';
import { buildSessionMeta, createTokenCustody } from '../lib/companion-token-custody.mjs';
import { makeAsyncKeychain } from './helpers/companion-keychain-fake.mjs';

describe('E2E — companion session lifecycle', () => {
  it('start → sign-in → use → refresh → restart (rotate loopback) → logout', async () => {
    const kc = makeAsyncKeychain();
    const custody = createTokenCustody(kc);

    // Companion start #1: mint and store a per-session loopback token (Phase 2 credential).
    const loopback1 = crypto.randomBytes(32).toString('base64url');
    await custody.rotateLoopbackToken(loopback1);
    assert.equal(await custody.getLoopbackToken(), loopback1);

    // Sign-in: the token endpoint returned a bearer + refresh; store the session.
    const signin = validateTokenResponse({ access_token: 'jwt-A', token_type: 'Bearer', expires_in: 3600, refresh_token: 'refresh-A', scope: 'vault:read vault:write' });
    const t0 = 1_700_000_000_000;
    await custody.storeSession({ accessToken: signin.accessToken, refreshToken: signin.refreshToken, meta: buildSessionMeta(signin, { now: t0, refreshTtlMs: 90 * 86_400_000 }) });

    // Use: the access token is valid now.
    assert.equal(await custody.decide({ now: t0 + 60_000 }), 'valid');

    // Later: access token near expiry → refresh.
    const session = await custody.loadSession();
    assert.equal(await custody.decide({ now: session.expiresAt - 5_000 }), 'refresh');
    const refreshed = validateTokenResponse({ access_token: 'jwt-B', token_type: 'Bearer', expires_in: 3600, refresh_token: 'refresh-B' });
    await custody.updateAccessToken({ accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, meta: buildSessionMeta(refreshed, { now: session.expiresAt, refreshTtlMs: 90 * 86_400_000 }) });
    assert.equal((await custody.loadSession()).accessToken, 'jwt-B');

    // Companion restart #2: a NEW loopback token replaces the old one; OAuth session persists.
    const loopback2 = crypto.randomBytes(32).toString('base64url');
    await custody.rotateLoopbackToken(loopback2);
    assert.equal(await custody.getLoopbackToken(), loopback2);
    assert.notEqual(loopback2, loopback1);
    assert.equal((await custody.loadSession()).accessToken, 'jwt-B'); // session survived restart

    // Logout: clear the OAuth session and the loopback token.
    await custody.clearSession();
    await custody.clearLoopbackToken();
    assert.equal(await custody.loadSession(), null);
    assert.equal(await custody.getLoopbackToken(), null);
    assert.equal(await custody.decide({ now: Date.now() }), 'reauth');
  });
});

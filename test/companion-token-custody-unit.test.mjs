/**
 * Tier 1 — UNIT: token-custody functions in isolation over an injected in-memory keychain.
 * Reference: docs/COMPANION-APP-PHASE-3-OAUTH-PKCE.md (custody/rotation rules).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEYCHAIN_ACCOUNTS,
  buildSessionMeta,
  createTokenCustody,
} from '../lib/companion-token-custody.mjs';
import { makeSyncKeychain } from './helpers/companion-keychain-fake.mjs';

describe('buildSessionMeta', () => {
  it('computes expiresAt and refreshExpiresAt from the clock', () => {
    const meta = buildSessionMeta(
      { expiresIn: 3600, refreshToken: 'r', scope: 'vault:read', tokenType: 'Bearer' },
      { now: 1_000_000, refreshTtlMs: 86_400_000, issuer: 'https://knowtation.store' },
    );
    assert.equal(meta.expiresAt, 1_000_000 + 3600 * 1000);
    assert.equal(meta.refreshExpiresAt, 1_000_000 + 86_400_000);
    assert.equal(meta.scope, 'vault:read');
    assert.equal(meta.issuer, 'https://knowtation.store');
  });
  it('leaves refreshExpiresAt null without a refresh token or TTL', () => {
    assert.equal(buildSessionMeta({ expiresIn: 60, refreshToken: null, scope: null, tokenType: 'Bearer' }, { now: 0 }).refreshExpiresAt, null);
    assert.equal(buildSessionMeta({ expiresIn: 60, refreshToken: 'r', scope: null, tokenType: 'Bearer' }, { now: 0 }).refreshExpiresAt, null);
  });
  it('throws on a bad clock or bad expiresIn (no secret in message)', () => {
    assert.throws(() => buildSessionMeta({ expiresIn: 60 }, { now: NaN }));
    assert.throws(() => buildSessionMeta({ expiresIn: 0 }, { now: 0 }));
  });
});

describe('createTokenCustody — adapter contract', () => {
  it('throws if the adapter is missing a method', () => {
    assert.throws(() => createTokenCustody({ get() {}, set() {} }), /\{ get, set, delete \}/);
    assert.throws(() => createTokenCustody(null), /adapter/);
  });
});

describe('storeSession / loadSession', () => {
  it('round-trips a full session through the keychain', async () => {
    const kc = makeSyncKeychain();
    const custody = createTokenCustody(kc);
    const meta = buildSessionMeta({ expiresIn: 3600, refreshToken: 'refresh-1', scope: 'vault:read vault:write', tokenType: 'Bearer' }, { now: 1000, refreshTtlMs: 1_000_000 });
    await custody.storeSession({ accessToken: 'jwt-1', refreshToken: 'refresh-1', meta });

    const loaded = await custody.loadSession();
    assert.equal(loaded.accessToken, 'jwt-1');
    assert.equal(loaded.refreshToken, 'refresh-1');
    assert.equal(loaded.expiresAt, 1000 + 3600 * 1000);
    assert.equal(loaded.scope, 'vault:read vault:write');
  });

  it('persists each secret under its own keychain account', async () => {
    const kc = makeSyncKeychain();
    const custody = createTokenCustody(kc);
    const meta = buildSessionMeta({ expiresIn: 60, refreshToken: 'r', scope: null, tokenType: 'Bearer' }, { now: 0 });
    await custody.storeSession({ accessToken: 'jwt', refreshToken: 'r', meta });
    assert.equal(kc._store.get(KEYCHAIN_ACCOUNTS.ACCESS_TOKEN), 'jwt');
    assert.equal(kc._store.get(KEYCHAIN_ACCOUNTS.REFRESH_TOKEN), 'r');
    assert.ok(kc._store.has(KEYCHAIN_ACCOUNTS.SESSION_META));
  });

  it('storing without a refresh token clears any stale one', async () => {
    const kc = makeSyncKeychain();
    const custody = createTokenCustody(kc);
    kc._store.set(KEYCHAIN_ACCOUNTS.REFRESH_TOKEN, 'stale');
    const meta = buildSessionMeta({ expiresIn: 60, refreshToken: null, scope: null, tokenType: 'Bearer' }, { now: 0 });
    await custody.storeSession({ accessToken: 'jwt', meta });
    assert.equal(kc._store.has(KEYCHAIN_ACCOUNTS.REFRESH_TOKEN), false);
  });

  it('throws on an empty access token', async () => {
    const custody = createTokenCustody(makeSyncKeychain());
    const meta = buildSessionMeta({ expiresIn: 60, refreshToken: null, scope: null, tokenType: 'Bearer' }, { now: 0 });
    await assert.rejects(() => custody.storeSession({ accessToken: '', meta }), /accessToken/);
  });
});

describe('loadSession — fail-closed', () => {
  it('returns null when there is no session', async () => {
    assert.equal(await createTokenCustody(makeSyncKeychain()).loadSession(), null);
  });
  it('returns null when metadata is missing or corrupt', async () => {
    const kc = makeSyncKeychain();
    kc._store.set(KEYCHAIN_ACCOUNTS.ACCESS_TOKEN, 'jwt');
    const custody = createTokenCustody(kc);
    assert.equal(await custody.loadSession(), null); // no meta
    kc._store.set(KEYCHAIN_ACCOUNTS.SESSION_META, '{not json');
    assert.equal(await custody.loadSession(), null); // corrupt meta
  });
});

describe('clearSession', () => {
  it('removes all OAuth secrets and is idempotent', async () => {
    const kc = makeSyncKeychain();
    const custody = createTokenCustody(kc);
    const meta = buildSessionMeta({ expiresIn: 60, refreshToken: 'r', scope: null, tokenType: 'Bearer' }, { now: 0 });
    await custody.storeSession({ accessToken: 'jwt', refreshToken: 'r', meta });
    await custody.clearSession();
    assert.equal(await custody.loadSession(), null);
    await custody.clearSession(); // idempotent
    assert.equal(kc._store.has(KEYCHAIN_ACCOUNTS.ACCESS_TOKEN), false);
  });
});

describe('updateAccessToken — refresh rotation', () => {
  it('replaces the access token and rotates the refresh token', async () => {
    const kc = makeSyncKeychain();
    const custody = createTokenCustody(kc);
    const meta1 = buildSessionMeta({ expiresIn: 60, refreshToken: 'r1', scope: null, tokenType: 'Bearer' }, { now: 0 });
    await custody.storeSession({ accessToken: 'jwt1', refreshToken: 'r1', meta: meta1 });
    const meta2 = buildSessionMeta({ expiresIn: 60, refreshToken: 'r2', scope: null, tokenType: 'Bearer' }, { now: 1000 });
    await custody.updateAccessToken({ accessToken: 'jwt2', refreshToken: 'r2', meta: meta2 });
    const loaded = await custody.loadSession();
    assert.equal(loaded.accessToken, 'jwt2');
    assert.equal(loaded.refreshToken, 'r2');
  });
  it('keeps the existing refresh token when none is supplied', async () => {
    const kc = makeSyncKeychain();
    const custody = createTokenCustody(kc);
    const meta1 = buildSessionMeta({ expiresIn: 60, refreshToken: 'r1', scope: null, tokenType: 'Bearer' }, { now: 0 });
    await custody.storeSession({ accessToken: 'jwt1', refreshToken: 'r1', meta: meta1 });
    const meta2 = buildSessionMeta({ expiresIn: 60, refreshToken: null, scope: null, tokenType: 'Bearer' }, { now: 1000 });
    await custody.updateAccessToken({ accessToken: 'jwt2', meta: meta2 });
    assert.equal((await custody.loadSession()).refreshToken, 'r1');
  });
});

describe('loopback token custody (Phase 2 per-session token)', () => {
  it('stores, reads, rotates, and clears the loopback token independently of the session', async () => {
    const kc = makeSyncKeychain();
    const custody = createTokenCustody(kc);
    assert.equal(await custody.getLoopbackToken(), null);
    await custody.storeLoopbackToken('lb-1');
    assert.equal(await custody.getLoopbackToken(), 'lb-1');
    await custody.rotateLoopbackToken('lb-2');
    assert.equal(await custody.getLoopbackToken(), 'lb-2');
    await custody.clearLoopbackToken();
    assert.equal(await custody.getLoopbackToken(), null);
  });
  it('clearSession does NOT remove the loopback token', async () => {
    const kc = makeSyncKeychain();
    const custody = createTokenCustody(kc);
    await custody.storeLoopbackToken('lb-1');
    const meta = buildSessionMeta({ expiresIn: 60, refreshToken: null, scope: null, tokenType: 'Bearer' }, { now: 0 });
    await custody.storeSession({ accessToken: 'jwt', meta });
    await custody.clearSession();
    assert.equal(await custody.getLoopbackToken(), 'lb-1');
  });
});

describe('decide', () => {
  it('returns reauth when there is no session', async () => {
    assert.equal(await createTokenCustody(makeSyncKeychain()).decide({ now: 0 }), 'reauth');
  });
  it('reflects decideTokenRefresh against stored expiry', async () => {
    const kc = makeSyncKeychain();
    const custody = createTokenCustody(kc);
    const meta = buildSessionMeta({ expiresIn: 3600, refreshToken: 'r', scope: null, tokenType: 'Bearer' }, { now: 0, refreshTtlMs: 10_000_000 });
    await custody.storeSession({ accessToken: 'jwt', refreshToken: 'r', meta });
    assert.equal(await custody.decide({ now: 0, skewMs: 1000 }), 'valid');
    assert.equal(await custody.decide({ now: meta.expiresAt + 1, skewMs: 1000 }), 'refresh');
  });
});

/**
 * Tier 7 — SECURITY: custody-at-rest properties (Phase 3 threat model, attacker capability F:
 * JWT/refresh-token theft at rest, and the loopback-token lifecycle).
 *
 * Asserts:
 *   - secrets are persisted ONLY through the injected keychain adapter (never a file, never env);
 *   - the module NEVER logs a secret (console is captured during a full session);
 *   - thrown errors never contain a secret;
 *   - clearSession (logout / refresh-reuse) actually removes both tokens;
 *   - the loopback token has an independent lifecycle and account from the JWT.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEYCHAIN_ACCOUNTS,
  buildSessionMeta,
  createTokenCustody,
} from '../lib/companion-token-custody.mjs';
import { makeSyncKeychain, makeAsyncKeychain } from './helpers/companion-keychain-fake.mjs';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.PRIVATE-JWT-' + 'A'.repeat(40) + '.sig';
const REFRESH = 'refresh-SECRET-' + 'B'.repeat(40);
const LOOPBACK = 'kc_loopback_' + 'C'.repeat(40);

describe('Security — secrets persist ONLY via the injected adapter', () => {
  it('every secret written lands in the keychain store and nowhere else the test can see', async () => {
    const kc = makeSyncKeychain();
    const custody = createTokenCustody(kc);
    const meta = buildSessionMeta({ expiresIn: 3600, refreshToken: REFRESH, scope: 'vault:read', tokenType: 'Bearer' }, { now: 0, refreshTtlMs: 1_000_000 });
    await custody.storeSession({ accessToken: JWT, refreshToken: REFRESH, meta });
    await custody.storeLoopbackToken(LOOPBACK);

    // The only place the secrets exist is the adapter store, under the documented accounts.
    assert.equal(kc._store.get(KEYCHAIN_ACCOUNTS.ACCESS_TOKEN), JWT);
    assert.equal(kc._store.get(KEYCHAIN_ACCOUNTS.REFRESH_TOKEN), REFRESH);
    assert.equal(kc._store.get(KEYCHAIN_ACCOUNTS.LOOPBACK_TOKEN), LOOPBACK);
    // Metadata is non-secret: it must NOT contain either token.
    const metaBlob = kc._store.get(KEYCHAIN_ACCOUNTS.SESSION_META);
    assert.ok(!metaBlob.includes(JWT));
    assert.ok(!metaBlob.includes(REFRESH));
  });
});

describe('Security — the custody module never logs a secret', () => {
  /** @type {string[]} */
  let logged;
  /** @type {Record<string, Function>} */
  let original;
  beforeEach(() => {
    logged = [];
    original = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
    for (const k of Object.keys(original)) {
      console[k] = (...args) => { logged.push(args.map(String).join(' ')); };
    }
  });
  afterEach(() => {
    for (const k of Object.keys(original)) console[k] = original[k];
  });

  it('a full session lifecycle emits no log line containing a secret', async () => {
    const kc = makeAsyncKeychain();
    const custody = createTokenCustody(kc);
    const meta = buildSessionMeta({ expiresIn: 3600, refreshToken: REFRESH, scope: null, tokenType: 'Bearer' }, { now: 0, refreshTtlMs: 1_000_000 });
    await custody.storeSession({ accessToken: JWT, refreshToken: REFRESH, meta });
    await custody.loadSession();
    await custody.decide({ now: 0 });
    await custody.storeLoopbackToken(LOOPBACK);
    await custody.getLoopbackToken();
    await custody.updateAccessToken({ accessToken: JWT + '2', meta });
    await custody.clearSession();
    await custody.clearLoopbackToken();

    const all = logged.join('\n');
    assert.equal(logged.length, 0, 'custody should emit no logs at all');
    assert.ok(!all.includes(JWT));
    assert.ok(!all.includes(REFRESH));
    assert.ok(!all.includes(LOOPBACK));
  });
});

describe('Security — thrown errors never carry a secret', () => {
  it('an oversized secret is rejected without echoing it', async () => {
    const custody = createTokenCustody(makeSyncKeychain());
    const huge = 'SECRET-' + 'Z'.repeat(9000);
    const meta = buildSessionMeta({ expiresIn: 60, refreshToken: null, scope: null, tokenType: 'Bearer' }, { now: 0 });
    await assert.rejects(
      () => custody.storeSession({ accessToken: huge, meta }),
      (e) => { assert.ok(!String(e.message).includes(huge)); return true; },
    );
  });
});

describe('Security — clearSession truly removes both tokens (logout / refresh-reuse)', () => {
  it('after clearSession the JWT and refresh token are gone', async () => {
    const kc = makeSyncKeychain();
    const custody = createTokenCustody(kc);
    const meta = buildSessionMeta({ expiresIn: 60, refreshToken: REFRESH, scope: null, tokenType: 'Bearer' }, { now: 0, refreshTtlMs: 1000 });
    await custody.storeSession({ accessToken: JWT, refreshToken: REFRESH, meta });
    await custody.clearSession();
    assert.equal(kc._store.has(KEYCHAIN_ACCOUNTS.ACCESS_TOKEN), false);
    assert.equal(kc._store.has(KEYCHAIN_ACCOUNTS.REFRESH_TOKEN), false);
    assert.equal(kc._store.has(KEYCHAIN_ACCOUNTS.SESSION_META), false);
  });
});

describe('Security — loopback token is isolated from the OAuth session', () => {
  it('the loopback token uses a distinct account and survives an OAuth logout', async () => {
    const kc = makeSyncKeychain();
    const custody = createTokenCustody(kc);
    await custody.storeLoopbackToken(LOOPBACK);
    const meta = buildSessionMeta({ expiresIn: 60, refreshToken: REFRESH, scope: null, tokenType: 'Bearer' }, { now: 0, refreshTtlMs: 1000 });
    await custody.storeSession({ accessToken: JWT, refreshToken: REFRESH, meta });
    assert.notEqual(KEYCHAIN_ACCOUNTS.LOOPBACK_TOKEN, KEYCHAIN_ACCOUNTS.ACCESS_TOKEN);
    await custody.clearSession();
    assert.equal(await custody.getLoopbackToken(), LOOPBACK);
  });
});

describe('Security — fail-closed load on a corrupt store', () => {
  it('a corrupt metadata blob yields no session (no partial trust)', async () => {
    const kc = makeSyncKeychain();
    kc._store.set(KEYCHAIN_ACCOUNTS.ACCESS_TOKEN, JWT);
    kc._store.set(KEYCHAIN_ACCOUNTS.SESSION_META, '{"expiresAt":"not-a-number"}');
    const custody = createTokenCustody(kc);
    assert.equal(await custody.loadSession(), null);
    assert.equal(await custody.decide({ now: 0 }), 'reauth');
  });
});

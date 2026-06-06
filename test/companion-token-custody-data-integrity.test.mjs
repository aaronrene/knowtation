/**
 * Tier 5 — DATA INTEGRITY: buildSessionMeta is pure/deterministic; what is stored is exactly what
 * is loaded; metadata holds no secret; the module reads nothing from the environment.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionMeta, createTokenCustody } from '../lib/companion-token-custody.mjs';
import { makeSyncKeychain } from './helpers/companion-keychain-fake.mjs';

describe('Data integrity — buildSessionMeta is pure/deterministic', () => {
  it('same inputs → identical metadata', () => {
    const tr = { expiresIn: 3600, refreshToken: 'r', scope: 'vault:read', tokenType: 'Bearer' };
    const ctx = { now: 12345, refreshTtlMs: 1000, issuer: 'https://knowtation.store' };
    assert.deepEqual(buildSessionMeta(tr, ctx), buildSessionMeta(tr, ctx));
  });
  it('does not mutate its inputs', () => {
    const tr = { expiresIn: 3600, refreshToken: 'r', scope: 'vault:read', tokenType: 'Bearer' };
    const ctx = { now: 1, refreshTtlMs: 1000 };
    const trSnap = JSON.stringify(tr);
    const ctxSnap = JSON.stringify(ctx);
    buildSessionMeta(tr, ctx);
    assert.equal(JSON.stringify(tr), trSnap);
    assert.equal(JSON.stringify(ctx), ctxSnap);
  });
});

describe('Data integrity — store/load fidelity', () => {
  it('loaded session fields equal the stored values', async () => {
    const custody = createTokenCustody(makeSyncKeychain());
    const meta = buildSessionMeta({ expiresIn: 7200, refreshToken: 'r', scope: 'vault:read vault:write', tokenType: 'Bearer' }, { now: 500, refreshTtlMs: 2000, issuer: 'https://knowtation.store' });
    await custody.storeSession({ accessToken: 'jwt', refreshToken: 'r', meta });
    const loaded = await custody.loadSession();
    assert.equal(loaded.expiresAt, meta.expiresAt);
    assert.equal(loaded.refreshExpiresAt, meta.refreshExpiresAt);
    assert.equal(loaded.scope, 'vault:read vault:write');
    assert.equal(loaded.issuer, 'https://knowtation.store');
    assert.equal(loaded.tokenType, 'Bearer');
  });
});

describe('Data integrity — environment independence', () => {
  it('metadata does not change with process.env', () => {
    const tr = { expiresIn: 60, refreshToken: null, scope: null, tokenType: 'Bearer' };
    const before = buildSessionMeta(tr, { now: 0 });
    process.env.KNOWTATION_CUSTODY_TEST = 'x';
    const after = buildSessionMeta(tr, { now: 0 });
    delete process.env.KNOWTATION_CUSTODY_TEST;
    assert.deepEqual(before, after);
  });
});

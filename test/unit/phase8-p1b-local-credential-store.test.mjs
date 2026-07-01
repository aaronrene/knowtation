/**
 * Phase 8 P1b — unit tier: credential store, Argon2id, issueLocalToken (§9).
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import {
  normalizeUsername,
  hashPassphrase,
  verifyPassphrase,
  parsePhcParams,
  assertArgon2ParamsFloor,
  loadCredentialStore,
  saveCredentialStore,
  createLocalCredential,
  issueLocalToken,
  credentialsPath,
  DECOY_ARGON2_PHC,
  chmod0600,
} from '../../hub/lib/local-auth.mjs';
import { resolveLocalAuthRole } from '../../hub/lib/local-auth-role.mjs';
import { makeTempDataDir, TEST_PASSPHRASE, TEST_SECRET } from '../helpers/phase8-p1b-local-auth-harness.mjs';

describe('phase8-p1b local credential store (unit)', () => {
  /** @type {{ dataDir: string, cleanup: () => void }} */
  let tmp;

  before(async () => {
    tmp = await makeTempDataDir();
  });

  after(() => tmp.cleanup());

  test('normalizeUsername: NFC, trim, lowercase-fold', () => {
    assert.equal(normalizeUsername('  Admin  '), 'admin');
    assert.equal(normalizeUsername('café'), normalizeUsername('café'));
  });

  test('Argon2id hash/verify round-trip', async () => {
    const phc = await hashPassphrase(TEST_PASSPHRASE);
    assert.ok(phc.startsWith('$argon2id$'));
    assert.equal(await verifyPassphrase(phc, TEST_PASSPHRASE), true);
    assert.equal(await verifyPassphrase(phc, 'wrong-passphrase'), false);
  });

  test('PHC parse enforces parameter floors', () => {
    const phc = '$argon2id$v=19$m=65536,t=3,p=4$salt$hash';
    assert.equal(parsePhcParams(phc).ok, true);
    assert.equal(assertArgon2ParamsFloor({ timeCost: 2, memoryCost: 65536, parallelism: 4 }), false);
    assert.equal(assertArgon2ParamsFloor({ timeCost: 3, memoryCost: 32768, parallelism: 4 }), false);
    assert.equal(assertArgon2ParamsFloor({ timeCost: 3, memoryCost: 65536, parallelism: 2 }), false);
  });

  test('credential store CRUD writes 0600 perms', async () => {
    await createLocalCredential(tmp.dataDir, 'admin', TEST_PASSPHRASE, { role: 'admin' });
    const st = fs.statSync(credentialsPath(tmp.dataDir));
    assert.equal(st.mode & 0o777, 0o600);
    const store = loadCredentialStore(tmp.dataDir);
    assert.equal(Object.keys(store.credentials).length, 1);
    saveCredentialStore(tmp.dataDir, store);
    assert.equal(fs.statSync(credentialsPath(tmp.dataDir)).mode & 0o777, 0o600);
  });

  test('issueLocalToken payload matches OAuth shape with provider local', async () => {
    const { userId } = await createLocalCredential(tmp.dataDir, 'user2', TEST_PASSPHRASE, {
      role: 'admin',
    });
    const store = loadCredentialStore(tmp.dataDir);
    const cred = store.credentials[`local:${userId}`];
    const token = issueLocalToken(cred, 'admin', TEST_SECRET, '24h');
    const payload = jwt.verify(token, TEST_SECRET);
    assert.equal(payload.sub, `local:${userId}`);
    assert.equal(payload.provider, 'local');
    assert.equal(payload.id, userId);
    assert.equal(payload.name, cred.username);
    assert.equal(payload.role, 'admin');
  });

  test('timing-safe verify uses decoy when username absent', async () => {
    const t0 = Date.now();
    await verifyPassphrase(null, 'missing-user-pass');
    const t1 = Date.now();
    const phc = await hashPassphrase(TEST_PASSPHRASE);
    const t2 = Date.now();
    await verifyPassphrase(phc, 'bad');
    const t3 = Date.now();
    assert.ok(t1 - t0 > 0);
    assert.ok(t3 - t2 > 0);
    assert.equal(DECOY_ARGON2_PHC.startsWith('$argon2id$'), true);
  });

  test('effectiveRole parity: local sub resolves admin; empty store denied when offline-locked', async () => {
    const sub = 'local:admin_001';
    const role = resolveLocalAuthRole(tmp.dataDir, sub, { offlineLockedActive: true });
    assert.equal(role, 'admin');
    const emptyDenied = resolveLocalAuthRole(tmp.dataDir, 'local:nobody', {
      offlineLockedActive: true,
    });
    assert.equal(emptyDenied, 'member');
    const empty = await makeTempDataDir();
    const legacyAdmin = resolveLocalAuthRole(empty.dataDir, 'google:1', {
      offlineLockedActive: false,
    });
    assert.equal(legacyAdmin, 'admin');
    empty.cleanup();
  });

  test('chmod0600 helper', () => {
    const f = path.join(tmp.dataDir, 'perm-test.json');
    fs.writeFileSync(f, '{}');
    chmod0600(f);
    assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  });
});

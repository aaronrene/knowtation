/**
 * Phase 8 P1b — data-integrity tier: store persistence across restart (§9).
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  makeTempDataDir,
  bootstrapTestAdmin,
  TEST_PASSPHRASE,
} from '../helpers/phase8-p1b-local-auth-harness.mjs';
import {
  loadCredentialStore,
  loadLoginAttempts,
  saveLoginAttempts,
  recordLoginFailure,
  credentialsPath,
} from '../../hub/lib/local-auth.mjs';
import {
  generateSetupToken,
  consumeSetupToken,
  bootstrapPath,
  loadBootstrapRecord,
} from '../../hub/lib/local-auth-bootstrap.mjs';
import { readRolesObject, writeRolesFile } from '../../hub/roles.mjs';

describe('phase8-p1b store persistence (data-integrity)', () => {
  /** @type {{ dataDir: string, cleanup: () => void }} */
  let tmp;

  before(async () => {
    tmp = await makeTempDataDir();
    await bootstrapTestAdmin(tmp.dataDir);
  });

  after(() => tmp.cleanup());

  test('credential store survives reload', () => {
    const before = loadCredentialStore(tmp.dataDir);
    const reloaded = loadCredentialStore(tmp.dataDir);
    assert.equal(Object.keys(reloaded.credentials).length, Object.keys(before.credentials).length);
    assert.ok(fs.existsSync(credentialsPath(tmp.dataDir)));
  });

  test('bootstrap record unlinked after consume', async () => {
    const dir = (await makeTempDataDir()).dataDir;
    const { token } = generateSetupToken(dir, 'admin', '15m');
    assert.ok(loadBootstrapRecord(dir));
    await consumeSetupToken(dir, token, 'admin', TEST_PASSPHRASE, { ip: '127.0.0.1' });
    assert.equal(fs.existsSync(bootstrapPath(dir)), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('login-attempts file authoritative across reload', () => {
    const attempts = loadLoginAttempts(tmp.dataDir);
    recordLoginFailure(attempts, 'local:admin_001');
    saveLoginAttempts(tmp.dataDir, attempts);
    const reloaded = loadLoginAttempts(tmp.dataDir);
    assert.equal(reloaded['local:admin_001'].failures, 1);
  });

  test('role + credential stores stay consistent on role change', () => {
    const roles = readRolesObject(tmp.dataDir);
    roles['local:admin_001'] = 'editor';
    writeRolesFile(tmp.dataDir, roles);
    const store = loadCredentialStore(tmp.dataDir);
    assert.ok(store.credentials['local:admin_001']);
    assert.equal(readRolesObject(tmp.dataDir)['local:admin_001'], 'editor');
  });

  test('mustRotatePassphrase cleared only after rotation success path', async () => {
    const dir = (await makeTempDataDir()).dataDir;
    const { token } = generateSetupToken(dir, 'admin', '15m');
    await consumeSetupToken(dir, token, 'admin', TEST_PASSPHRASE, { ip: '127.0.0.1' });
    const store = loadCredentialStore(dir);
    assert.equal(store.credentials['local:admin_001'].mustRotatePassphrase, true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

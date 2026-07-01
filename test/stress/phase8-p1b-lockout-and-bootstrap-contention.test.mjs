/**
 * Phase 8 P1b — stress tier: lockout + bootstrap contention (§9).
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import {
  makeTempDataDir,
  enableOfflineLockedTestEnv,
  bootstrapTestAdmin,
  TEST_PASSPHRASE,
  TEST_SECRET,
} from '../helpers/phase8-p1b-local-auth-harness.mjs';
import {
  authenticateLocalUser,
  resetGlobalLoginRateLimitForTests,
} from '../../hub/lib/local-auth.mjs';
import {
  generateSetupToken,
  consumeSetupToken,
  resetBootstrapRateLimitForTests,
} from '../../hub/lib/local-auth-bootstrap.mjs';

describe('phase8-p1b lockout and bootstrap contention (stress)', () => {
  /** @type {{ dataDir: string, cleanup: () => void }} */
  let tmp;

  before(async () => {
    tmp = await makeTempDataDir();
    enableOfflineLockedTestEnv(tmp.dataDir);
    resetGlobalLoginRateLimitForTests();
    resetBootstrapRateLimitForTests();
    await bootstrapTestAdmin(tmp.dataDir);
  });

  after(() => {
    tmp.cleanup();
    delete process.env.KNOWTATION_OFFLINE_LOCKED_AUTH;
    delete process.env.KNOWTATION_OFFLINE_LOCKED_AUTH_TEST_SHIPPED;
  });

  test('10k failed logins lock at 5; correct passphrase blocked until unlock window', async () => {
    const opts = { sessionSecret: TEST_SECRET, offlineLockedActive: true };
    let locked = false;
    for (let i = 0; i < 10000; i++) {
      resetGlobalLoginRateLimitForTests();
      const r = await authenticateLocalUser(tmp.dataDir, 'admin', 'wrong-' + i, opts);
      if (r.code === 'ACCOUNT_LOCKED') {
        locked = true;
        if (i >= 4) break;
      }
    }
    assert.equal(locked, true);
    resetGlobalLoginRateLimitForTests();
    const afterLock = await authenticateLocalUser(tmp.dataDir, 'admin', TEST_PASSPHRASE, opts);
    assert.equal(afterLock.ok, false);
    assert.equal(afterLock.code, 'ACCOUNT_LOCKED');
  });

  test('concurrent bootstrap consume: exactly one succeeds', async () => {
    const dir = (await makeTempDataDir()).dataDir;
    enableOfflineLockedTestEnv(dir);
    resetBootstrapRateLimitForTests();
    process.env.KNOWTATION_OFFLINE_LOCKED_AUTH_TEST_NO_BOOTSTRAP_RL = '1';
    const { token } = generateSetupToken(dir, 'admin', '15m');
    const attempts = Array.from({ length: 50 }, () =>
      consumeSetupToken(dir, token, 'admin', TEST_PASSPHRASE, { ip: '127.0.0.1' })
    );
    const results = await Promise.all(attempts);
    const okCount = results.filter((r) => r.ok).length;
    const consumedCount = results.filter((r) => r.code === 'BOOTSTRAP_TOKEN_CONSUMED').length;
    assert.equal(okCount, 1);
    assert.ok(consumedCount >= 1);
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.KNOWTATION_OFFLINE_LOCKED_AUTH_TEST_NO_BOOTSTRAP_RL;
  });
});

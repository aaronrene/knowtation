/**
 * Phase 8 P1b — security tier: bootstrap token replay (§9).
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import {
  makeTempDataDir,
  TEST_PASSPHRASE,
} from '../helpers/phase8-p1b-local-auth-harness.mjs';
import {
  generateSetupToken,
  consumeSetupToken,
  resetBootstrapRateLimitForTests,
  bootstrapPath,
} from '../../hub/lib/local-auth-bootstrap.mjs';

describe('phase8-p1b bootstrap replay (security)', () => {
  /** @type {{ dataDir: string, cleanup: () => void }} */
  let tmp;

  before(async () => {
    tmp = await makeTempDataDir();
    resetBootstrapRateLimitForTests();
  });

  after(() => tmp.cleanup());

  test('setup token replay returns BOOTSTRAP_TOKEN_CONSUMED', async () => {
    const { token } = generateSetupToken(tmp.dataDir, 'admin', '15m');
    const first = await consumeSetupToken(tmp.dataDir, token, 'admin', TEST_PASSPHRASE, {
      ip: '127.0.0.1',
    });
    assert.equal(first.ok, true);
    assert.equal(fs.existsSync(bootstrapPath(tmp.dataDir)), false);

    resetBootstrapRateLimitForTests();
    const second = await consumeSetupToken(tmp.dataDir, token, 'admin', TEST_PASSPHRASE, {
      ip: '127.0.0.1',
    });
    assert.equal(second.ok, false);
    assert.equal(second.code, 'BOOTSTRAP_TOKEN_CONSUMED');
  });

  test('expired token rejected', async () => {
    const dir = (await makeTempDataDir()).dataDir;
    const { token } = generateSetupToken(dir, 'admin', '1m');
    const rec = JSON.parse(fs.readFileSync(bootstrapPath(dir), 'utf8'));
    rec.expiresAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(bootstrapPath(dir), JSON.stringify(rec));
    resetBootstrapRateLimitForTests();
    const result = await consumeSetupToken(dir, token, 'admin', TEST_PASSPHRASE, { ip: '127.0.0.1' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'BOOTSTRAP_TOKEN_EXPIRED');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

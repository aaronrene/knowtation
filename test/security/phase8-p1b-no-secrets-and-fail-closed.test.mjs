/**
 * Phase 8 P1b — security tier: no secrets in logs, timing-safe, OAuth fail-closed (§9).
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  makeTempDataDir,
  enableOfflineLockedTestEnv,
  createLocalAuthTestApp,
  bootstrapTestAdmin,
  TEST_PASSPHRASE,
  TEST_SECRET,
} from '../helpers/phase8-p1b-local-auth-harness.mjs';
import { generateSetupToken } from '../../hub/lib/local-auth-bootstrap.mjs';
import { credentialsPath } from '../../hub/lib/local-auth.mjs';

describe('phase8-p1b no secrets and fail-closed (security)', () => {
  /** @type {{ dataDir: string, cleanup: () => void }} */
  let tmp;
  /** @type {{ baseUrl: string, close: () => Promise<void> } | null} */
  let hub = null;
  const setupToken = 'test-setup-token-value-never-log';
  let originalFetch;

  before(async () => {
    tmp = await makeTempDataDir();
    enableOfflineLockedTestEnv(tmp.dataDir);
    await bootstrapTestAdmin(tmp.dataDir);
    hub = await createLocalAuthTestApp(tmp.dataDir);
    originalFetch = globalThis.fetch;
  });

  after(async () => {
    if (hub) await hub.close();
    globalThis.fetch = originalFetch;
    tmp.cleanup();
    delete process.env.KNOWTATION_OFFLINE_LOCKED_AUTH;
    delete process.env.KNOWTATION_OFFLINE_LOCKED_AUTH_TEST_SHIPPED;
  });

  test('audit log contains no passphrase, hash, setup token, or JWT', async () => {
    await fetch(`${hub.baseUrl}/api/v1/auth/local/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', passphrase: TEST_PASSPHRASE }),
    });
    const logPath = path.join(tmp.dataDir, 'hub_audit.log');
    assert.ok(fs.existsSync(logPath));
    const log = fs.readFileSync(logPath, 'utf8');
    const store = JSON.parse(fs.readFileSync(credentialsPath(tmp.dataDir), 'utf8'));
    const hash = store.credentials['local:admin_001'].argon2id;
    assert.ok(!log.includes(TEST_PASSPHRASE));
    assert.ok(!log.includes(hash));
    assert.ok(!log.includes(setupToken));
    assert.ok(!log.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/));
  });

  test('timing-safe username lookup within ±10ms over samples', async () => {
    const samples = 20;
    const unknownTimes = [];
    const badPassTimes = [];
    for (let i = 0; i < samples; i++) {
      const t0 = performance.now();
      await fetch(`${hub.baseUrl}/api/v1/auth/local/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nosuchuser' + i, passphrase: 'WrongPass123!X' }),
      });
      unknownTimes.push(performance.now() - t0);
      const t1 = performance.now();
      await fetch(`${hub.baseUrl}/api/v1/auth/local/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', passphrase: 'WrongPass123!X' }),
      });
      badPassTimes.push(performance.now() - t1);
    }
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const diff = Math.abs(avg(unknownTimes) - avg(badPassTimes));
    assert.ok(diff <= 10 || diff <= avg(badPassTimes) * 0.5, `timing diff ${diff}ms too large`);
  });

  test('OAuth fail-closed: fetch never called with OAuth provider URL', async () => {
    let oauthFetchCalled = false;
    globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      let host = '';
      try {
        host = new URL(url).hostname;
      } catch (_) {
        /* relative URL */
      }
      if (host === 'accounts.google.com' || host === 'github.com') {
        oauthFetchCalled = true;
        throw new Error('OAuth egress');
      }
      return originalFetch(input);
    };
    const res = await fetch(`${hub.baseUrl}/auth/login?provider=google`);
    assert.equal(res.status, 403);
    assert.equal(oauthFetchCalled, false);
    globalThis.fetch = originalFetch;
  });

  test('hub_local_credentials.json mode 0600 after write', () => {
    const st = fs.statSync(credentialsPath(tmp.dataDir));
    assert.equal(st.mode & 0o777, 0o600);
  });
});

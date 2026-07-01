/**
 * Phase 8 P1b — e2e tier: air-gapped walkthrough, zero OAuth egress (§9).
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeTempDataDir,
  enableOfflineLockedTestEnv,
  createLocalAuthTestApp,
  TEST_PASSPHRASE,
  TEST_SECRET,
} from '../helpers/phase8-p1b-local-auth-harness.mjs';
import { generateSetupToken } from '../../hub/lib/local-auth-bootstrap.mjs';
import { issueCliLocalToken } from '../../hub/lib/local-auth.mjs';

describe('phase8-p1b airgapped walkthrough (e2e)', () => {
  /** @type {{ dataDir: string, cleanup: () => void }} */
  let tmp;
  /** @type {{ baseUrl: string, close: () => Promise<void> } | null} */
  let hub = null;
  /** @type {typeof globalThis.fetch} */
  let originalFetch;

  before(async () => {
    tmp = await makeTempDataDir();
    enableOfflineLockedTestEnv(tmp.dataDir);
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      const host = new URL(url, 'http://localhost').hostname;
      if (host !== '127.0.0.1' && host !== 'localhost') {
        throw new Error(`Egress blocked in air-gapped test: ${url}`);
      }
      if (url.includes('accounts.google.com') || url.includes('github.com')) {
        throw new Error(`OAuth provider egress blocked: ${url}`);
      }
      return originalFetch(input, init);
    };
    hub = await createLocalAuthTestApp(tmp.dataDir);
  });

  after(async () => {
    if (hub) await hub.close();
    globalThis.fetch = originalFetch;
    tmp.cleanup();
    delete process.env.KNOWTATION_OFFLINE_LOCKED_AUTH;
    delete process.env.KNOWTATION_OFFLINE_LOCKED_AUTH_TEST_SHIPPED;
  });

  test('gate on, not bootstrapped → 503', async () => {
    const res = await fetch(`${hub.baseUrl}/api/v1/auth/local/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', passphrase: TEST_PASSPHRASE }),
    });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'OFFLINE_LOCKED_NOT_BOOTSTRAPPED');
  });

  test('setup token → bootstrap → login → CLI token → bearer session', async () => {
    const { token: setupToken } = generateSetupToken(tmp.dataDir, 'admin', '15m');
    const bootRes = await fetch(`${hub.baseUrl}/api/v1/auth/local/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setupToken,
        username: 'admin',
        passphrase: TEST_PASSPHRASE,
      }),
    });
    assert.equal(bootRes.status, 200);
    const bootBody = await bootRes.json();
    assert.equal(bootBody.userId, 'admin_001');

    const loginRes = await fetch(`${hub.baseUrl}/api/v1/auth/local/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', passphrase: TEST_PASSPHRASE }),
    });
    assert.equal(loginRes.status, 200);
    const { token } = await loginRes.json();

    const cliResult = await issueCliLocalToken(tmp.dataDir, 'admin', TEST_PASSPHRASE, {
      sessionSecret: TEST_SECRET,
      offlineLockedActive: true,
    });
    assert.equal(cliResult.ok, true);

    const sessionRes = await fetch(`${hub.baseUrl}/api/v1/auth/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(sessionRes.status, 200);
    assert.equal((await sessionRes.json()).provider, 'local');
  });
});

/**
 * Phase B — device OAuth: security tier.
 *
 * Auth gates, brute-force rate limits, poll slow_down, and invariant that error
 * bodies and durable store files never leak device_code or refresh secrets.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  startDeviceOAuthApp,
  authHeaders,
  DEVICE_GRANT_TYPE,
} from './helpers/device-oauth-harness.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

describe('Phase B security — auth and rate limits', () => {
  it('approve without auth returns 401', async () => {
    const app = await startDeviceOAuthApp();
    cleanups.push(async () => {
      await app.stop();
      await app.tmp.cleanup();
    });

    const authRes = await app.fetch('POST', `${app.mountPath}/authorize`, {});
    const res = await app.fetch('POST', `${app.mountPath}/approve`, {
      user_code: authRes.json.user_code,
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.error, 'unauthorized');
  });

  it('many wrong user_codes on approve eventually returns 429', async () => {
    const app = await startDeviceOAuthApp();
    cleanups.push(async () => {
      await app.stop();
      await app.tmp.cleanup();
    });

    let saw429 = false;
    const bruteIp = { 'X-Forwarded-For': '10.99.0.1' };
    for (let i = 0; i < 25; i++) {
      const res = await app.fetch(
        'POST',
        `${app.mountPath}/approve`,
        { user_code: `ZZZZ-${String(i).padStart(4, '0')}` },
        { ...authHeaders(), ...bruteIp }
      );
      if (res.status === 429) {
        saw429 = true;
        assert.equal(res.json.error, 'rate_limited');
        break;
      }
      assert.ok([404, 400].includes(res.status), `unexpected status ${res.status}`);
    }
    assert.ok(saw429, 'approve brute-force must rate-limit after APPROVE_MAX_ATTEMPTS');
  });

  it('poll too fast returns slow_down', async () => {
    const app = await startDeviceOAuthApp();
    cleanups.push(async () => {
      await app.stop();
      await app.tmp.cleanup();
    });

    const authRes = await app.fetch('POST', `${app.mountPath}/authorize`, {});
    const deviceCode = authRes.json.device_code;

    const first = await app.fetch('POST', `${app.mountPath}/token`, {
      grant_type: DEVICE_GRANT_TYPE,
      device_code: deviceCode,
    });
    assert.equal(first.status, 400);
    assert.equal(first.json.error, 'authorization_pending');

    const fast = await app.fetch('POST', `${app.mountPath}/token`, {
      grant_type: DEVICE_GRANT_TYPE,
      device_code: deviceCode,
    });
    assert.equal(fast.status, 400);
    assert.equal(fast.json.error, 'slow_down');
  });
});

describe('Phase B security — no secrets in errors or store', () => {
  it('error bodies never contain device_code or refresh secrets from store', async () => {
    const app = await startDeviceOAuthApp();
    cleanups.push(async () => {
      await app.stop();
      await app.tmp.cleanup();
    });

    const authRes = await app.fetch('POST', `${app.mountPath}/authorize`, {});
    const deviceCode = authRes.json.device_code;
    const approveRes = await app.fetch(
      'POST',
      `${app.mountPath}/approve`,
      { user_code: authRes.json.user_code },
      authHeaders()
    );
    assert.equal(approveRes.status, 200);

    const tokenRes = await app.fetch('POST', `${app.mountPath}/token`, {
      grant_type: DEVICE_GRANT_TYPE,
      device_code: deviceCode,
    });
    assert.equal(tokenRes.status, 200);
    assert.ok(tokenRes.json.refresh_token);
    const refreshSecret = tokenRes.json.refresh_token.split('.')[1];

    const badPoll = await app.fetch('POST', `${app.mountPath}/token`, {
      grant_type: DEVICE_GRANT_TYPE,
      device_code: 'totally-wrong-device-code',
    });
    assert.ok(!badPoll.text.includes(deviceCode));
    assert.ok(!badPoll.text.includes(refreshSecret));

    const badRefresh = await app.fetch('POST', `${app.mountPath}/token`, {
      grant_type: 'refresh_token',
      refresh_token: 'not-a-real-refresh',
    });
    assert.ok(!badRefresh.text.includes(refreshSecret));
    assert.ok(!badRefresh.text.includes(deviceCode));
  });

  it('raw device_code never written to device_pending_codes.json', async () => {
    const app = await startDeviceOAuthApp();
    cleanups.push(async () => {
      await app.stop();
      await app.tmp.cleanup();
    });

    const authRes = await app.fetch('POST', `${app.mountPath}/authorize`, {});
    const raw = await fs.readFile(path.join(app.tmp.dir, 'device_pending_codes.json'), 'utf8');
    assert.ok(!raw.includes(authRes.json.device_code), 'store must not contain raw device_code');
    const refreshRaw = await fs.readFile(
      path.join(app.tmp.dir, 'hosted_refresh_tokens.json'),
      'utf8'
    ).catch(() => '{}');
    if (authRes.json.refresh_token) {
      assert.ok(!refreshRaw.includes(authRes.json.refresh_token));
    }
  });
});

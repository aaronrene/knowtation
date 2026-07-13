/**
 * Phase B — device OAuth: e2e tier.
 *
 * Scripted Hub + agent journey: authorize, pending list, approve, token exchange,
 * refresh revoke; and deny path ending in access_denied.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  startDeviceOAuthApp,
  authHeaders,
  TEST_SECRET,
  DEVICE_GRANT_TYPE,
} from './helpers/device-oauth-harness.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

describe('Phase B e2e — full Hub + agent journey', () => {
  it('authorize → pending list → approve → token → revoke refresh', async () => {
    const app = await startDeviceOAuthApp();
    cleanups.push(async () => {
      await app.stop();
      await app.tmp.cleanup();
    });

    const authRes = await app.fetch('POST', `${app.mountPath}/authorize`, {
      client_id: 'e2e-agent',
      client_name: 'E2E Cloud Agent',
    });
    assert.equal(authRes.status, 200);
    const { device_code: deviceCode, user_code: userCode } = authRes.json;

    const pendingRes = await app.fetch('GET', `${app.mountPath}/pending`, undefined, authHeaders());
    assert.equal(pendingRes.status, 200);
    assert.ok(Array.isArray(pendingRes.json.pending));
    assert.ok(
      pendingRes.json.pending.some((p) => p.userCode === userCode),
      'pending list must include user_code'
    );
    assert.ok(!JSON.stringify(pendingRes.json).includes(deviceCode), 'pending must not expose device_code');

    const approveRes = await app.fetch(
      'POST',
      `${app.mountPath}/approve`,
      { user_code: userCode },
      authHeaders()
    );
    assert.equal(approveRes.status, 200);

    const tokenRes = await app.fetch('POST', `${app.mountPath}/token`, {
      grant_type: DEVICE_GRANT_TYPE,
      device_code: deviceCode,
    });
    assert.equal(tokenRes.status, 200);
    const payload = jwt.verify(tokenRes.json.access_token, TEST_SECRET);
    assert.equal(payload.type, 'mcp_access');

    const revokeRes = await app.fetch('POST', `${app.mountPath}/revoke`, {
      refresh_token: tokenRes.json.refresh_token,
    });
    assert.equal(revokeRes.status, 200);
    assert.equal(revokeRes.json.ok, true);

    const refreshFail = await app.fetch('POST', `${app.mountPath}/token`, {
      grant_type: 'refresh_token',
      refresh_token: tokenRes.json.refresh_token,
    });
    assert.equal(refreshFail.status, 400);
    assert.equal(refreshFail.json.error, 'invalid_grant');
  });

  it('deny path: authorize → deny → poll access_denied', async () => {
    const app = await startDeviceOAuthApp();
    cleanups.push(async () => {
      await app.stop();
      await app.tmp.cleanup();
    });

    const authRes = await app.fetch('POST', `${app.mountPath}/authorize`, {});
    const { device_code: deviceCode, user_code: userCode } = authRes.json;

    const denyRes = await app.fetch(
      'POST',
      `${app.mountPath}/deny`,
      { user_code: userCode },
      authHeaders()
    );
    assert.equal(denyRes.status, 200);
    assert.equal(denyRes.json.ok, true);

    const tokenRes = await app.fetch('POST', `${app.mountPath}/token`, {
      grant_type: DEVICE_GRANT_TYPE,
      device_code: deviceCode,
    });
    assert.equal(tokenRes.status, 400);
    assert.equal(tokenRes.json.error, 'access_denied');
  });
});

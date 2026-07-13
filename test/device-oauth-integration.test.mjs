/**
 * Phase B — device OAuth: integration tier.
 *
 * HTTP authorize → approve → token poll; refresh rotation; setup-pack non-secrets;
 * durability across a new router instance on the same data directory.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createGatewayRefreshStore } from '../hub/gateway/refresh-token-store.mjs';
import {
  startDeviceOAuthApp,
  authHeaders,
  TEST_SECRET,
  DEVICE_GRANT_TYPE,
  createTempStrongStore,
} from './helpers/device-oauth-harness.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

describe('Phase B integration — HTTP device flow', () => {
  it('authorize → approve → poll /token returns mcp_access + refresh', async () => {
    const app = await startDeviceOAuthApp();
    cleanups.push(async () => {
      await app.stop();
      await app.tmp.cleanup();
    });

    const authRes = await app.fetch('POST', `${app.mountPath}/authorize`, {
      client_id: 'hermes-cloud',
      client_name: 'Hermes Agent',
      scope: 'vault:read vault:write',
    });
    assert.equal(authRes.status, 200);
    assert.ok(authRes.json.device_code);
    assert.ok(authRes.json.user_code);

    const approveRes = await app.fetch(
      'POST',
      `${app.mountPath}/approve`,
      { user_code: authRes.json.user_code },
      authHeaders()
    );
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.json.ok, true);

    const tokenRes = await app.fetch('POST', `${app.mountPath}/token`, {
      grant_type: DEVICE_GRANT_TYPE,
      device_code: authRes.json.device_code,
    });
    assert.equal(tokenRes.status, 200);
    assert.ok(tokenRes.json.access_token);
    assert.ok(tokenRes.json.refresh_token);
    assert.equal(tokenRes.json.token_type, 'bearer');

    const payload = jwt.verify(tokenRes.json.access_token, TEST_SECRET);
    assert.equal(payload.type, 'mcp_access');
    assert.equal(payload.sub, 'google:device-test');
    assert.ok(payload.scopes.includes('vault:read'));
  });

  it('refresh_token grant rotates refresh secret', async () => {
    const app = await startDeviceOAuthApp();
    cleanups.push(async () => {
      await app.stop();
      await app.tmp.cleanup();
    });

    const authRes = await app.fetch('POST', `${app.mountPath}/authorize`, {});
    await app.fetch(
      'POST',
      `${app.mountPath}/approve`,
      { user_code: authRes.json.user_code },
      authHeaders()
    );
    const first = await app.fetch('POST', `${app.mountPath}/token`, {
      grant_type: DEVICE_GRANT_TYPE,
      device_code: authRes.json.device_code,
    });
    const refresh1 = first.json.refresh_token;

    const rotated = await app.fetch('POST', `${app.mountPath}/token`, {
      grant_type: 'refresh_token',
      refresh_token: refresh1,
    });
    assert.equal(rotated.status, 200);
    assert.ok(rotated.json.access_token);
    assert.ok(rotated.json.refresh_token);
    assert.notEqual(rotated.json.refresh_token, refresh1);
  });

  it('setup-pack returns secrets:false and no token fields', async () => {
    const app = await startDeviceOAuthApp();
    cleanups.push(async () => {
      await app.stop();
      await app.tmp.cleanup();
    });

    const res = await app.fetch('GET', `${app.mountPath}/setup-pack`);
    assert.equal(res.status, 200);
    assert.equal(res.json.secrets, false);
    assert.ok(!('access_token' in res.json));
    assert.ok(!('refresh_token' in res.json));
    assert.ok(!('device_code' in res.json));
    assert.equal(res.json.phase_b?.status, 'available');
  });

  it('restart durability: pending code survives new router on same store dir', async () => {
    const tmp = await createTempStrongStore();
    cleanups.push(tmp.cleanup);

    const app1 = await startDeviceOAuthApp({ tmp });
    cleanups.push(async () => app1.stop());
    const authRes = await app1.fetch('POST', `${app1.mountPath}/authorize`, {
      client_name: 'Restart Test',
    });

    const store2 = createGatewayRefreshStore({ consistency: 'strong' });
    const app2 = await startDeviceOAuthApp({ tmp, refreshStore: store2 });
    cleanups.push(async () => app2.stop());
    await app1.stop();

    const approveRes = await app2.fetch(
      'POST',
      `${app2.mountPath}/approve`,
      { user_code: authRes.json.user_code },
      authHeaders()
    );
    assert.equal(approveRes.status, 200);

    const tokenRes = await app2.fetch('POST', `${app2.mountPath}/token`, {
      grant_type: DEVICE_GRANT_TYPE,
      device_code: authRes.json.device_code,
    });
    assert.equal(tokenRes.status, 200);
    assert.ok(tokenRes.json.access_token);
  });
});

/**
 * Phase 8 P1b — integration tier: bootstrap → login → session → roles (§9).
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  makeTempDataDir,
  enableOfflineLockedTestEnv,
  createLocalAuthTestApp,
  bootstrapTestAdmin,
  TEST_PASSPHRASE,
  TEST_SECRET,
} from '../helpers/phase8-p1b-local-auth-harness.mjs';
import { readRolesObject } from '../../hub/roles.mjs';

function bridgeEffectiveRole(uid, storedRoles) {
  const VALID = new Set(['admin', 'editor', 'viewer', 'evaluator']);
  if (!uid) return 'member';
  const stored = storedRoles && storedRoles[uid];
  if (stored && VALID.has(stored)) return stored;
  return 'member';
}

describe('phase8-p1b local login flow (integration)', () => {
  /** @type {{ dataDir: string, cleanup: () => void }} */
  let tmp;
  /** @type {{ baseUrl: string, close: () => Promise<void> } | null} */
  let hub = null;

  before(async () => {
    tmp = await makeTempDataDir();
    enableOfflineLockedTestEnv(tmp.dataDir);
    await bootstrapTestAdmin(tmp.dataDir);
    hub = await createLocalAuthTestApp(tmp.dataDir);
  });

  after(async () => {
    if (hub) await hub.close();
    tmp.cleanup();
    delete process.env.KNOWTATION_OFFLINE_LOCKED_AUTH;
    delete process.env.KNOWTATION_OFFLINE_LOCKED_AUTH_TEST_SHIPPED;
  });

  test('OAuth routes return 403 when gate on', async () => {
    for (const route of ['/api/v1/auth/login', '/auth/login']) {
      const res = await fetch(`${hub.baseUrl}${route}`);
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.equal(body.code, 'OAUTH_DISABLED');
    }
  });

  test('providers reports local only', async () => {
    const res = await fetch(`${hub.baseUrl}/api/v1/auth/providers`);
    const body = await res.json();
    assert.deepEqual(body, { google: false, github: false, local: true });
  });

  test('POST login → JWT → session → roles', async () => {
    const loginRes = await fetch(`${hub.baseUrl}/api/v1/auth/local/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', passphrase: TEST_PASSPHRASE }),
    });
    assert.equal(loginRes.status, 200);
    const { token, expiresIn } = await loginRes.json();
    assert.ok(token);
    assert.equal(expiresIn, '24h');

    const sessionRes = await fetch(`${hub.baseUrl}/api/v1/auth/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(sessionRes.status, 200);
    const session = await sessionRes.json();
    assert.equal(session.sub, 'local:admin_001');
    assert.equal(session.provider, 'local');
    assert.equal(session.role, 'admin');

    const rolesRes = await fetch(`${hub.baseUrl}/api/v1/roles`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(rolesRes.status, 200);
    const rolesBody = await rolesRes.json();
    assert.equal(rolesBody.roles['local:admin_001'], 'admin');

    const payload = jwt.verify(token, TEST_SECRET);
    assert.equal(payload.sub, 'local:admin_001');
  });

  test('bridge effectiveRole resolves local sub', () => {
    const roles = readRolesObject(tmp.dataDir);
    const role = bridgeEffectiveRole('local:admin_001', roles);
    assert.equal(role, 'admin');
  });
});

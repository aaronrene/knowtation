/**
 * Phase C + Lane D — security: mint gates, no SESSION_STORE_UNAVAILABLE from agent routes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { createAgentCredentialRouter } from '../hub/gateway/agent-credential-routes.mjs';
import {
  mayApplyAdminAllowlistOverride,
  subFromVerifiedPayload,
  roleFromVerifiedAccessPayload,
} from '../hub/gateway/access-token-authz.mjs';
import { roleEligibleForPersonalSelfApply } from '../lib/hub-proposal-personal-self-apply.mjs';
import { normalizeScopes, agentScopesPermitMethod } from '../hub/lib/agent-credential-core.mjs';

const SECRET = 'phase-c-security-test-secret-32byte!!';
const routesSrc = await readFile(
  new URL('../hub/gateway/agent-credential-routes.mjs', import.meta.url),
  'utf8'
);

describe('Phase C security — agent credentials', () => {
  it('rejects admin scopes at normalize', () => {
    assert.throws(() => normalizeScopes(['admin']), (e) => e.code === 'AGENT_SCOPE_FORBIDDEN');
    assert.throws(() => normalizeScopes(['vault:admin']), (e) => e.code === 'AGENT_SCOPE_FORBIDDEN');
  });

  it('mayApplyAdminAllowlistOverride is false for agent_access', () => {
    assert.equal(mayApplyAdminAllowlistOverride({ type: 'agent_access', sub: 'google:1' }), false);
    const role = roleFromVerifiedAccessPayload(
      { type: 'agent_access', sub: 'google:1', scopes: ['propose', 'vault:read'] },
      () => 'admin'
    );
    assert.equal(role.role, 'member');
    assert.equal(role.isAgentAccess, true);
  });

  it('propose cannot approve paths', () => {
    const scopes = ['propose', 'vault:read'];
    assert.equal(agentScopesPermitMethod(scopes, 'POST', '/api/v1/proposals/x/approve'), false);
    assert.equal(agentScopesPermitMethod(scopes, 'POST', '/api/v1/proposals/x/discard'), false);
  });

  it('self-apply refuses agent_access tokenType', () => {
    assert.equal(
      roleEligibleForPersonalSelfApply('member', { tokenType: 'agent_access', humanActor: true }),
      false
    );
  });

  it('browser refresh-shaped token rejected by exchange; mcp cannot mint', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kt-agent-sec-'));
    process.env.KNOWTATION_GATEWAY_DATA_DIR = dir;
    const app = express();
    const { router } = createAgentCredentialRouter({
      sessionSecret: SECRET,
      getSessionSub: (req) => {
        try {
          return jwt.verify(req.headers.authorization.slice(7), SECRET).sub;
        } catch {
          return null;
        }
      },
      getSessionPayload: (req) => {
        try {
          return jwt.verify(req.headers.authorization.slice(7), SECRET);
        } catch {
          return null;
        }
      },
      grantedScopes: () => ['vault:read', 'vault:write'],
    });
    app.use('/api/v1/auth/agent', router);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const bad = await fetch(`${base}/api/v1/auth/agent/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: 'notprefix.secretvalue' }),
      });
      assert.equal(bad.status, 401);

      const mcpTok = jwt.sign(
        { sub: 'google:1', type: 'mcp_access', scopes: ['vault:write'] },
        SECRET,
        { expiresIn: '1h' }
      );
      const mint = await fetch(`${base}/api/v1/auth/agent/credentials`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${mcpTok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x', vault_ids: ['default'] }),
      });
      assert.equal(mint.status, 403);

      const offlineApp = express();
      const { router: offlineRouter } = createAgentCredentialRouter({
        sessionSecret: SECRET,
        getSessionSub: () => 'google:1',
        getSessionPayload: () => ({ type: 'session', sub: 'google:1' }),
        grantedScopes: () => ['vault:read'],
        offlineLockedActive: true,
      });
      offlineApp.use('/api/v1/auth/agent', offlineRouter);
      const s2 = http.createServer(offlineApp);
      await new Promise((r) => s2.listen(0, r));
      const b2 = `http://127.0.0.1:${s2.address().port}`;
      const ol = await fetch(`${b2}/api/v1/auth/agent/credentials`, {
        method: 'POST',
        headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x', vault_ids: ['default'] }),
      });
      assert.equal(ol.status, 503);
      const olBody = await ol.json();
      assert.equal(olBody.code, 'AGENT_CREDENTIALS_UNSUPPORTED_OFFLINE_LOCKED');
      await new Promise((r) => s2.close(r));

      // Regression: pre-Phase-C style payload without typ/aud must not authorize propose.
      assert.equal(
        subFromVerifiedPayload(
          { sub: 'google:1', type: 'agent_access', scopes: ['propose', 'vault:read'] },
          { method: 'POST', path: '/api/v1/proposals' }
        ),
        null
      );
    } finally {
      await new Promise((r) => server.close(r));
      delete process.env.KNOWTATION_GATEWAY_DATA_DIR;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('agent routes source never emits SESSION_STORE_UNAVAILABLE', () => {
    assert.ok(!routesSrc.includes('SESSION_STORE_UNAVAILABLE'));
  });

  it('list omits secret hash and lookup_id on health rows', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kt-agent-sec-list-'));
    process.env.KNOWTATION_GATEWAY_DATA_DIR = dir;
    const app = express();
    const { router } = createAgentCredentialRouter({
      sessionSecret: SECRET,
      getSessionSub: () => 'google:1',
      getSessionPayload: () => ({ sub: 'google:1', type: 'session' }),
      grantedScopes: () => ['vault:read'],
    });
    app.use('/api/v1/auth/agent', router);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = jwt.sign({ sub: 'google:1', type: 'session' }, SECRET, { expiresIn: '1h' });
    try {
      const mint = await fetch(`${base}/api/v1/auth/agent/credentials`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'sec', vault_ids: ['default'] }),
      });
      const m = await mint.json();
      const list = await (await fetch(`${base}/api/v1/auth/agent/credentials`, {
        headers: { Authorization: `Bearer ${session}` },
      })).json();
      const row = list.credentials[0];
      assert.equal(row.credential, undefined);
      assert.equal(row.token_hash, undefined);
      assert.equal(row.lookup_id, undefined);
      assert.ok(!JSON.stringify(list).includes(m.credential));
    } finally {
      await new Promise((r) => server.close(r));
      delete process.env.KNOWTATION_GATEWAY_DATA_DIR;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

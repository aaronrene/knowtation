/**
 * Phase C — integration: mint → exchange → REST propose; revoke; wrong vault.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { createAgentCredentialRouter } from '../hub/gateway/agent-credential-routes.mjs';
import {
  subFromVerifiedPayload,
  assertAgentVaultAllowed,
} from '../hub/gateway/access-token-authz.mjs';
import express from 'express';

const SECRET = 'phase-c-integration-test-secret-32b!!';

async function withTempStore(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kt-agent-cred-'));
  const prev = process.env.KNOWTATION_GATEWAY_DATA_DIR;
  process.env.KNOWTATION_GATEWAY_DATA_DIR = dir;
  try {
    await fn(dir);
  } finally {
    if (prev === undefined) delete process.env.KNOWTATION_GATEWAY_DATA_DIR;
    else process.env.KNOWTATION_GATEWAY_DATA_DIR = prev;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function sessionJwt(sub = 'google:tester') {
  return jwt.sign({ sub, type: 'session', role: 'member' }, SECRET, { expiresIn: '1h' });
}

describe('Phase C integration — agent credentials', () => {
  it('mint → exchange → propose path authorized; revoke blocks exchange; wrong vault denied', async () => {
    await withTempStore(async () => {
      const app = express();
      const { router } = createAgentCredentialRouter({
        sessionSecret: SECRET,
        getSessionSub: (req) => {
          const auth = req.headers.authorization || '';
          const t = auth.startsWith('Bearer ') ? auth.slice(7) : '';
          try {
            const p = jwt.verify(t, SECRET);
            return p.sub || null;
          } catch {
            return null;
          }
        },
        getSessionPayload: (req) => {
          const auth = req.headers.authorization || '';
          const t = auth.startsWith('Bearer ') ? auth.slice(7) : '';
          try {
            return jwt.verify(t, SECRET);
          } catch {
            return null;
          }
        },
        grantedScopes: () => ['vault:read', 'vault:write'],
      });
      app.use('/api/v1/auth/agent', router);
      const server = http.createServer(app);
      await new Promise((r) => server.listen(0, r));
      const port = server.address().port;
      const base = `http://127.0.0.1:${port}`;

      try {
        const mintRes = await fetch(`${base}/api/v1/auth/agent/credentials`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sessionJwt()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: 'videofactory-trend-agent',
            vault_ids: ['default'],
            scopes: ['propose', 'vault:read'],
          }),
        });
        assert.equal(mintRes.status, 201);
        const minted = await mintRes.json();
        assert.ok(String(minted.credential).startsWith('kt_agent_'));

        const tokRes = await fetch(`${base}/api/v1/auth/agent/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: minted.credential }),
        });
        assert.equal(tokRes.status, 200);
        const tok = await tokRes.json();
        assert.equal(tok.expires_in, 900);
        const access = jwt.verify(tok.access_token, SECRET);
        assert.equal(access.type, 'agent_access');
        assert.equal(
          subFromVerifiedPayload(access, { method: 'POST', path: '/api/v1/proposals' }),
          'google:tester'
        );
        assert.equal(
          subFromVerifiedPayload(access, { method: 'POST', path: '/api/v1/notes' }),
          null
        );
        assert.equal(assertAgentVaultAllowed(access, 'default'), true);
        assert.equal(assertAgentVaultAllowed(access, 'other'), false);

        const rev = await fetch(`${base}/api/v1/auth/agent/credentials/${minted.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${sessionJwt()}` },
        });
        assert.equal(rev.status, 200);

        const tok2 = await fetch(`${base}/api/v1/auth/agent/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: minted.credential }),
        });
        assert.equal(tok2.status, 401);
        const body = await tok2.json();
        assert.equal(body.code, 'AGENT_CREDENTIAL_INVALID');
      } finally {
        await new Promise((r) => server.close(r));
      }
    });
  });
});

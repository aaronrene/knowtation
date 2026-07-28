/**
 * Phase C — e2e: session mint + list + rotate + revoke against test router.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import express from 'express';
import { createAgentCredentialRouter } from '../hub/gateway/agent-credential-routes.mjs';
import { parseAgentCredential } from '../hub/lib/agent-credential-core.mjs';

const SECRET = 'phase-c-e2e-test-secret-value-32bytes!';

describe('Phase C e2e — agent credential lifecycle', () => {
  it('mint list rotate revoke', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kt-agent-e2e-'));
    process.env.KNOWTATION_GATEWAY_DATA_DIR = dir;
    const app = express();
    const session = jwt.sign({ sub: 'github:42', type: 'session' }, SECRET, { expiresIn: '1h' });
    const { router } = createAgentCredentialRouter({
      sessionSecret: SECRET,
      getSessionSub: () => 'github:42',
      getSessionPayload: () => ({ sub: 'github:42', type: 'session' }),
      grantedScopes: () => ['vault:read', 'vault:write'],
    });
    app.use('/api/v1/auth/agent', router);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const mint = await fetch(`${base}/api/v1/auth/agent/credentials`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'e2e', vault_ids: ['default'] }),
      });
      assert.equal(mint.status, 201);
      const m = await mint.json();
      const list = await (await fetch(`${base}/api/v1/auth/agent/credentials`, {
        headers: { Authorization: `Bearer ${session}` },
      })).json();
      assert.equal(list.credentials.length, 1);
      assert.equal(list.credentials[0].id, m.id);
      assert.equal(list.credentials[0].credential, undefined);

      const rot = await fetch(`${base}/api/v1/auth/agent/credentials/${m.id}/rotate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session}` },
      });
      assert.equal(rot.status, 200);
      const r = await rot.json();
      assert.ok(parseAgentCredential(r.credential));
      assert.notEqual(r.credential, m.credential);

      const oldTok = await fetch(`${base}/api/v1/auth/agent/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: m.credential }),
      });
      assert.equal(oldTok.status, 401);

      const newTok = await fetch(`${base}/api/v1/auth/agent/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: r.credential }),
      });
      assert.equal(newTok.status, 200);

      await fetch(`${base}/api/v1/auth/agent/credentials/${m.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session}` },
      });
      const after = await (await fetch(`${base}/api/v1/auth/agent/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: r.credential }),
      })).json();
      assert.equal(after.code, 'AGENT_CREDENTIAL_INVALID');
    } finally {
      await new Promise((r) => server.close(r));
      delete process.env.KNOWTATION_GATEWAY_DATA_DIR;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

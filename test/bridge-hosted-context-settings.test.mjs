/**
 * Hosted bridge context latency guard:
 * explicit delegated vault access is authoritative for the access gate, so the
 * bridge must not block MCP/session setup on canister vault enumeration.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const SECRET = 'bridge-hosted-context-settings-secret-32';

function signTestJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

test('bridge hosted-context/settings returns delegated Business allowlist without canister vault fetch', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-bridge-context-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, 'hub_workspace.json'), JSON.stringify({ owner_user_id: 'google:owner' }));
  fs.writeFileSync(path.join(dataDir, 'hub_roles.json'), JSON.stringify({ roles: { 'google:user456': 'evaluator' } }));
  fs.writeFileSync(path.join(dataDir, 'hub_vault_access.json'), JSON.stringify({ 'google:user456': ['Business'] }));
  fs.writeFileSync(path.join(dataDir, 'hub_evaluator_may_approve.json'), JSON.stringify({ 'google:user456': true }));

  const origFetch = globalThis.fetch.bind(globalThis);
  t.after(() => {
    globalThis.fetch = origFetch;
  });
  let canisterVaultFetches = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === 'https://mock-canister.test/api/v1/vaults') {
      canisterVaultFetches += 1;
      throw new Error('explicit delegated access must not fetch canister vaults');
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };

  process.env.NETLIFY = '1';
  process.env.DATA_DIR = dataDir;
  process.env.CANISTER_URL = 'https://mock-canister.test';
  process.env.SESSION_SECRET = SECRET;
  delete process.env.HUB_EVALUATOR_MAY_APPROVE;

  const bridgeEntry = pathToFileURL(path.join(projectRoot, 'hub', 'bridge', 'server.mjs')).href;
  const { app } = await import(`${bridgeEntry}?contextsettings=${Date.now()}`);
  const srv = http.createServer(app);
  await new Promise((resolve, reject) => {
    srv.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((resolve) => srv.close(() => resolve())));

  const port = srv.address().port;
  const token = signTestJwt({ sub: 'google:user456', role: 'evaluator' });
  const settingsRes = await origFetch(`http://127.0.0.1:${port}/api/v1/hosted-context/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const settingsText = await settingsRes.text();
  assert.equal(settingsRes.status, 200, settingsText);
  const settings = JSON.parse(settingsText);
  assert.equal(settings.effective_canister_user_id, 'google:owner');
  assert.equal(settings.delegating, true);
  assert.deepEqual(settings.allowed_vault_ids, ['Business']);
  assert.equal(settings.role, 'evaluator');
  assert.equal(settings.may_approve_proposals, true);

  const businessRes = await origFetch(`http://127.0.0.1:${port}/api/v1/hosted-context`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Vault-Id': 'Business' },
  });
  assert.equal(businessRes.status, 200, await businessRes.text());

  const defaultRes = await origFetch(`http://127.0.0.1:${port}/api/v1/hosted-context`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Vault-Id': 'default' },
  });
  assert.equal(defaultRes.status, 403);
  assert.equal(canisterVaultFetches, 0);
});

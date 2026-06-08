/**
 * Hosted Hub settings vault filter:
 * a delegated evaluator with explicit Business access must not see owner/default
 * canister vaults in the switcher.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const SECRET = 'gateway-settings-hosted-vault-filter-secret-32';

function signTestJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

test('gateway settings filters delegated evaluator switcher to bridge-allowed Business vault', async (t) => {
  const origFetch = globalThis.fetch.bind(globalThis);
  t.after(() => {
    globalThis.fetch = origFetch;
  });

  /** @type {Array<{ url: string, method: string, headers?: HeadersInit }>} */
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || 'GET';
    calls.push({ url: u, method, headers: init.headers });

    if (u === 'https://mock-bridge.test/api/v1/hosted-context/settings') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          actor_sub: 'google:user456',
          workspace_owner_id: 'google:owner',
          effective_canister_user_id: 'google:owner',
          delegating: true,
          allowed_vault_ids: ['Business'],
          role: 'evaluator',
          may_approve_proposals: true,
        }),
      };
    }
    if (u === 'https://mock-bridge.test/api/v1/hosted-context') {
      throw new Error('settings must not request default hosted-context');
    }
    if (u === 'https://mock-canister.test/api/v1/vaults') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          vaults: [
            { id: 'Personal', label: 'Personal' },
            { id: 'Secrets', label: 'Secrets' },
            { id: 'Ideas', label: 'Ideas' },
            { id: 'default', label: 'Default' },
            { id: 'Business', label: 'Business' },
          ],
        }),
      };
    }
    if (u === 'https://mock-bridge.test/api/v1/vault/github-status') {
      return { ok: true, status: 200, json: async () => ({ github_connected: false, repo: null }) };
    }
    if (u === 'https://mock-bridge.test/api/v1/role') {
      return { ok: true, status: 200, json: async () => ({ role: 'evaluator', may_approve_proposals: true }) };
    }
    return { ok: false, status: 404, json: async () => ({ error: 'unexpected ' + u }), text: async () => '' };
  };

  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'https://mock-canister.test';
  process.env.SESSION_SECRET = SECRET;
  process.env.BRIDGE_URL = 'https://mock-bridge.test';
  delete process.env.BILLING_ENFORCE;
  delete process.env.KNOWTATION_AIR_ENDPOINT;

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app } = await import(`${gwEntry}?settingsvaultfilter=${Date.now()}`);
  const srv = http.createServer(app);
  await new Promise((resolve, reject) => {
    srv.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((resolve) => srv.close(() => resolve())));

  const port = srv.address().port;
  const token = signTestJwt({ sub: 'google:user456', role: 'evaluator' });
  const res = await origFetch(`http://127.0.0.1:${port}/api/v1/settings`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Vault-Id': 'Business' },
  });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text);

  assert.deepEqual(body.allowed_vault_ids, ['Business']);
  assert.deepEqual(body.vault_list, [{ id: 'Business', label: 'Business' }]);
  assert.equal(body.workspace_owner_id, 'google:owner');
  assert.equal(body.hosted_delegating, true);
  assert.equal(body.role, 'evaluator');

  const hostedContextCalls = calls.filter((c) => c.url.includes('/api/v1/hosted-context'));
  assert.deepEqual(
    hostedContextCalls.map((c) => c.url),
    ['https://mock-bridge.test/api/v1/hosted-context/settings'],
  );
  const vaultCall = calls.find((c) => c.url === 'https://mock-canister.test/api/v1/vaults');
  assert.ok(vaultCall, 'settings must still read canister vault labels');
  assert.match(String(vaultCall.headers?.['X-User-Id'] || vaultCall.headers?.['x-user-id']), /google:owner/);
});

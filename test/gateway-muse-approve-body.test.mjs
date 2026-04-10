/**
 * Gateway merges resolved external_ref into approve POST body before canister proxy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const SECRET = 'gateway-muse-approve-test-secret-32chars';

function signTestJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

test('gateway POST proposals/:id/approve forwards external_ref from Muse lineage when MUSE_URL set', async (t) => {
  /** @type {string | null} */
  let capturedBody = null;

  const mockMuse = http.createServer((req, res) => {
    if (!req.url || !req.url.startsWith('/knowtation/v1/lineage-ref')) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ external_ref: 'ref-from-muse-lineage' }));
  });
  await new Promise((resolve, reject) => {
    mockMuse.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => mockMuse.close(() => r())));
  const musePort = /** @type {import('net').AddressInfo} */ (mockMuse.address()).port;
  const museUrl = `http://127.0.0.1:${musePort}`;

  const mockCanister = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/v1/proposals/prop-muse/approve')) {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        capturedBody = Buffer.concat(chunks).toString('utf8');
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            proposal_id: 'prop-muse',
            status: 'approved',
            approval_log_path: 'approvals/x.md',
            approval_log_written: true,
            external_ref: 'ref-from-muse-lineage',
          }),
        );
      });
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((resolve, reject) => {
    mockCanister.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => mockCanister.close(() => r())));
  const canisterPort = /** @type {import('net').AddressInfo} */ (mockCanister.address()).port;
  const canisterUrl = `http://127.0.0.1:${canisterPort}`;

  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = canisterUrl;
  process.env.SESSION_SECRET = SECRET;
  process.env.MUSE_URL = museUrl;
  process.env.HUB_ADMIN_USER_IDS = 'google:gw-muse-test';
  delete process.env.BRIDGE_URL;
  delete process.env.MUSE_API_KEY;

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gwmuse=${Date.now()}`);

  const gwSrv = http.createServer(gwApp);
  await new Promise((resolve, reject) => {
    gwSrv.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => gwSrv.close(() => r())));
  const gwPort = /** @type {import('net').AddressInfo} */ (gwSrv.address()).port;

  const token = signTestJwt({ sub: 'google:gw-muse-test' });
  const res = await fetch(`http://127.0.0.1:${gwPort}/api/v1/proposals/prop-muse/approve`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Vault-Id': 'default',
    },
    body: JSON.stringify({}),
  });

  assert.strictEqual(res.status, 200, await res.text());
  assert.ok(capturedBody);
  const parsed = JSON.parse(/** @type {string} */ (capturedBody));
  assert.strictEqual(parsed.external_ref, 'ref-from-muse-lineage');
});

test('gateway POST proposals/:id/approve still proxies when Muse lineage fails', async (t) => {
  let capturedBody = null;

  const mockMuse = http.createServer((_req, res) => {
    res.statusCode = 503;
    res.end('unavailable');
  });
  await new Promise((resolve, reject) => {
    mockMuse.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => mockMuse.close(() => r())));
  const musePort = /** @type {import('net').AddressInfo} */ (mockMuse.address()).port;
  const museUrl = `http://127.0.0.1:${musePort}`;

  const mockCanister = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/v1/proposals/prop-down/approve')) {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        capturedBody = Buffer.concat(chunks).toString('utf8');
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            proposal_id: 'prop-down',
            status: 'approved',
            approval_log_path: 'approvals/y.md',
            approval_log_written: true,
            external_ref: '',
          }),
        );
      });
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((resolve, reject) => {
    mockCanister.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => mockCanister.close(() => r())));
  const canisterPort = /** @type {import('net').AddressInfo} */ (mockCanister.address()).port;
  const canisterUrl = `http://127.0.0.1:${canisterPort}`;

  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = canisterUrl;
  process.env.SESSION_SECRET = SECRET;
  process.env.MUSE_URL = museUrl;
  process.env.HUB_ADMIN_USER_IDS = 'google:gw-muse-test2';
  delete process.env.BRIDGE_URL;

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gwmuse2=${Date.now()}`);

  const gwSrv = http.createServer(gwApp);
  await new Promise((resolve, reject) => {
    gwSrv.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => gwSrv.close(() => r())));
  const gwPort = /** @type {import('net').AddressInfo} */ (gwSrv.address()).port;

  const token = signTestJwt({ sub: 'google:gw-muse-test2' });
  const res = await fetch(`http://127.0.0.1:${gwPort}/api/v1/proposals/prop-down/approve`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Vault-Id': 'default',
    },
    body: JSON.stringify({}),
  });

  assert.strictEqual(res.status, 200, await res.text());
  assert.ok(capturedBody);
  const parsed = JSON.parse(/** @type {string} */ (capturedBody));
  assert.strictEqual(parsed.external_ref ?? '', '');
});

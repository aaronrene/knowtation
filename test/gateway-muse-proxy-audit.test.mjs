/**
 * Gateway: operator Muse proxy — auth, 404 when disabled, path validation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const SECRET = 'gateway-muse-proxy-audit-secret-32chars!!';

function signTestJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

test('GET operator/muse/proxy returns 404 when MUSE_URL unset (no auth required for this branch)', async (t) => {
  delete process.env.MUSE_URL;
  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://127.0.0.1:9';
  process.env.SESSION_SECRET = SECRET;

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gwMuseProxyOff=${Date.now()}`);

  const srv = http.createServer(gwApp);
  await new Promise((resolve, reject) => srv.listen(0, '127.0.0.1', (e) => (e ? reject(e) : resolve())));
  t.after(() => new Promise((r) => srv.close(() => r())));
  const port = /** @type {import('net').AddressInfo} */ (srv.address()).port;

  const res = await fetch(`http://127.0.0.1:${port}/api/v1/operator/muse/proxy?path=${encodeURIComponent('/knowtation/v1/x')}`);
  assert.strictEqual(res.status, 404);
  const j = await res.json();
  assert.strictEqual(j.code, 'NOT_FOUND');
});

test('GET operator/muse/proxy returns 401 without JWT when MUSE_URL set', async (t) => {
  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://127.0.0.1:9';
  process.env.SESSION_SECRET = SECRET;
  process.env.MUSE_URL = 'https://muse-operator.example.com';
  delete process.env.BRIDGE_URL;

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gwMuseProxy401=${Date.now()}`);

  const srv = http.createServer(gwApp);
  await new Promise((resolve, reject) => srv.listen(0, '127.0.0.1', (e) => (e ? reject(e) : resolve())));
  t.after(() => new Promise((r) => srv.close(() => r())));
  const port = /** @type {import('net').AddressInfo} */ (srv.address()).port;

  const res = await fetch(
    `http://127.0.0.1:${port}/api/v1/operator/muse/proxy?path=${encodeURIComponent('/knowtation/v1/x')}`,
  );
  assert.strictEqual(res.status, 401);
});

test('GET operator/muse/proxy returns 403 for non-admin when MUSE_URL set', async (t) => {
  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://127.0.0.1:9';
  process.env.SESSION_SECRET = SECRET;
  process.env.MUSE_URL = 'https://muse-operator.example.com';
  process.env.HUB_ADMIN_USER_IDS = 'google:only-admin-here';
  delete process.env.BRIDGE_URL;

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gwMuseProxy403=${Date.now()}`);

  const srv = http.createServer(gwApp);
  await new Promise((resolve, reject) => srv.listen(0, '127.0.0.1', (e) => (e ? reject(e) : resolve())));
  t.after(() => new Promise((r) => srv.close(() => r())));
  const port = /** @type {import('net').AddressInfo} */ (srv.address()).port;

  const token = signTestJwt({ sub: 'google:regular-member-not-admin' });
  const res = await fetch(
    `http://127.0.0.1:${port}/api/v1/operator/muse/proxy?path=${encodeURIComponent('/knowtation/v1/x')}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  assert.strictEqual(res.status, 403);
});

test('GET operator/muse/proxy returns 400 when path missing', async (t) => {
  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://127.0.0.1:9';
  process.env.SESSION_SECRET = SECRET;
  process.env.MUSE_URL = 'https://muse-operator.example.com';
  process.env.HUB_ADMIN_USER_IDS = 'google:muse-proxy-admin';

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gwMuseProxy400=${Date.now()}`);

  const srv = http.createServer(gwApp);
  await new Promise((resolve, reject) => srv.listen(0, '127.0.0.1', (e) => (e ? reject(e) : resolve())));
  t.after(() => new Promise((r) => srv.close(() => r())));
  const port = /** @type {import('net').AddressInfo} */ (srv.address()).port;

  const token = signTestJwt({ sub: 'google:muse-proxy-admin' });
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/operator/muse/proxy`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(res.status, 400);
});

test('GET operator/muse/proxy returns 400 for disallowed path prefix', async (t) => {
  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://127.0.0.1:9';
  process.env.SESSION_SECRET = SECRET;
  process.env.MUSE_URL = 'https://muse-operator.example.com';
  process.env.HUB_ADMIN_USER_IDS = 'google:muse-proxy-admin2';

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gwMuseProxy400b=${Date.now()}`);

  const srv = http.createServer(gwApp);
  await new Promise((resolve, reject) => srv.listen(0, '127.0.0.1', (e) => (e ? reject(e) : resolve())));
  t.after(() => new Promise((r) => srv.close(() => r())));
  const port = /** @type {import('net').AddressInfo} */ (srv.address()).port;

  const token = signTestJwt({ sub: 'google:muse-proxy-admin2' });
  const res = await fetch(
    `http://127.0.0.1:${port}/api/v1/operator/muse/proxy?path=${encodeURIComponent('/etc/passwd')}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  assert.strictEqual(res.status, 400);
});

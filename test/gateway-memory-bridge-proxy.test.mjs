/**
 * Gateway → bridge memory routes: same-origin proxy forwards path, query, Authorization, X-Vault-Id.
 * Track B3 prep — contract boundary tests before hosted MCP prompts call these URLs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const SECRET = 'gateway-memory-bridge-proxy-test-secret-32';

function signTestJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

/**
 * @param {import('express').Express} mockBridge
 * @returns {Promise<{ bridgeUrl: string, close: () => Promise<void> }>}
 */
function startMockBridge(mockBridge) {
  const srv = http.createServer(mockBridge);
  return new Promise((resolve, reject) => {
    srv.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      const port = /** @type {import('net').AddressInfo} */ (srv.address()).port;
      resolve({
        bridgeUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => srv.close(() => r())),
      });
    });
  });
}

test('gateway proxies GET /api/v1/memory to bridge with query + auth headers', async (t) => {
  /** @type {Array<{ method: string, url: string, auth?: string, vault?: string }>} */
  const calls = [];
  const mockBridge = express();
  mockBridge.get(/.*/, (req, res) => {
    calls.push({
      method: req.method,
      url: req.originalUrl,
      auth: req.headers.authorization,
      vault: req.headers['x-vault-id'],
    });
    res.json({ events: [], count: 0 });
  });

  const { bridgeUrl, close } = await startMockBridge(mockBridge);
  t.after(close);

  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://canister.placeholder.test';
  process.env.SESSION_SECRET = SECRET;
  process.env.BRIDGE_URL = bridgeUrl;

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gwmem=${Date.now()}`);

  const gwSrv = http.createServer(gwApp);
  await new Promise((resolve, reject) => {
    gwSrv.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => gwSrv.close(() => r())));
  const gwPort = /** @type {import('net').AddressInfo} */ (gwSrv.address()).port;

  const token = signTestJwt({ sub: 'google:mem-proxy-test', role: 'editor' });
  const res = await fetch(`http://127.0.0.1:${gwPort}/api/v1/memory?limit=7&type=user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Vault-Id': 'vault-a',
    },
  });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, '/api/v1/memory?limit=7&type=user');
  assert.equal(calls[0].auth, `Bearer ${token}`);
  assert.equal(calls[0].vault, 'vault-a');
});

test('gateway proxies GET /api/v1/memory/:key with encoded key', async (t) => {
  const calls = [];
  const mockBridge = express();
  mockBridge.get('/api/v1/memory/:key', (req, res) => {
    calls.push({ url: req.originalUrl, key: req.params.key });
    res.json({ key: req.params.key, value: null, updated_at: null });
  });

  const { bridgeUrl, close } = await startMockBridge(mockBridge);
  t.after(close);

  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://canister.placeholder.test';
  process.env.SESSION_SECRET = SECRET;
  process.env.BRIDGE_URL = bridgeUrl;

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gwmem2=${Date.now()}`);

  const gwSrv = http.createServer(gwApp);
  await new Promise((resolve, reject) => {
    gwSrv.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => gwSrv.close(() => r())));
  const gwPort = /** @type {import('net').AddressInfo} */ (gwSrv.address()).port;

  const token = signTestJwt({ sub: 'google:mem-key-test', role: 'viewer' });
  const key = 'topic/foo';
  const res = await fetch(
    `http://127.0.0.1:${gwPort}/api/v1/memory/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${token}`, 'X-Vault-Id': 'default' } },
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, key);
});

test('gateway proxies POST /api/v1/memory/search JSON body to bridge', async (t) => {
  const calls = [];
  const mockBridge = express();
  mockBridge.use(express.json({ limit: '1mb' }));
  mockBridge.post('/api/v1/memory/search', (req, res) => {
    calls.push({
      method: req.method,
      body: req.body,
      auth: req.headers.authorization,
      vault: req.headers['x-vault-id'],
    });
    res.json({ results: [], count: 0, note: 'stub' });
  });

  const { bridgeUrl, close } = await startMockBridge(mockBridge);
  t.after(close);

  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://canister.placeholder.test';
  process.env.SESSION_SECRET = SECRET;
  process.env.BRIDGE_URL = bridgeUrl;

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gwmem3=${Date.now()}`);

  const gwSrv = http.createServer(gwApp);
  await new Promise((resolve, reject) => {
    gwSrv.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => gwSrv.close(() => r())));
  const gwPort = /** @type {import('net').AddressInfo} */ (gwSrv.address()).port;

  const token = signTestJwt({ sub: 'google:mem-search-test', role: 'editor' });
  const payload = { query: 'hello', limit: 5 };
  const res = await fetch(`http://127.0.0.1:${gwPort}/api/v1/memory/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Vault-Id': 'default',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, payload);
  assert.equal(calls[0].auth, `Bearer ${token}`);
});

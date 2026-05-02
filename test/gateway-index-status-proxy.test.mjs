/**
 * Gateway → bridge `/api/v1/index/status` proxy contract.
 *
 * Why this file exists (regression context, May 2026):
 *   PR #205 added `GET /api/v1/index/status` to the bridge so the Hub UI could
 *   render `Last indexed: N minutes ago` next to the Re-index button. The
 *   bridge route was implemented and tested in
 *   `test/bridge-index-auto-routing-contract.test.mjs`, but the gateway was
 *   never updated to forward this NEW path to the bridge — Express returned
 *   404 to the browser. The UI line stayed empty even on vaults that had
 *   successfully written the sidecar.
 *
 * This test locks in the proxy wiring so the same regression can't recur:
 * if anyone removes the gateway handler, this test fails before deploy
 * instead of silently breaking the UI line again.
 *
 * Test pattern mirrors `test/gateway-memory-bridge-proxy.test.mjs`.
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

const SECRET = 'gateway-index-status-proxy-test-secret-32';

function signTestJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function startMockBridge(mockBridge) {
  const srv = http.createServer(mockBridge);
  return new Promise((resolve, reject) => {
    srv.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      const port = srv.address().port;
      resolve({
        bridgeUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => srv.close(() => r())),
      });
    });
  });
}

test('gateway proxies GET /api/v1/index/status to bridge with auth + vault headers', async (t) => {
  const calls = [];
  const mockBridge = express();
  mockBridge.get('/api/v1/index/status', (req, res) => {
    calls.push({
      method: req.method,
      url: req.originalUrl,
      auth: req.headers.authorization,
      vault: req.headers['x-vault-id'],
    });
    res.json({
      lastIndexed: { lastIndexedAtEpochMs: 1735689600000, chunksIndexed: 251, mode: 'sync' },
      inProgress: false,
      job: null,
    });
  });

  const { bridgeUrl, close } = await startMockBridge(mockBridge);
  t.after(close);

  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://canister.placeholder.test';
  process.env.SESSION_SECRET = SECRET;
  process.env.BRIDGE_URL = bridgeUrl;

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gwidxstatus=${Date.now()}`);

  const gwSrv = http.createServer(gwApp);
  await new Promise((resolve, reject) => {
    gwSrv.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => gwSrv.close(() => r())));
  const gwPort = gwSrv.address().port;

  const token = signTestJwt({ sub: 'google:idx-status-test', role: 'editor' });
  const res = await fetch(`http://127.0.0.1:${gwPort}/api/v1/index/status`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Vault-Id': 'Business',
    },
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  assert.equal(calls.length, 1, 'bridge must be called exactly once');
  assert.equal(calls[0].method, 'GET');
  assert.equal(
    calls[0].url,
    '/api/v1/index/status',
    'gateway must preserve the path when proxying',
  );
  assert.equal(calls[0].auth, `Bearer ${token}`, 'Authorization header must be forwarded');
  assert.equal(calls[0].vault, 'Business', 'X-Vault-Id header must be forwarded');

  const body = JSON.parse(text);
  assert.equal(body.inProgress, false, 'response body must be passed through');
  assert.ok(body.lastIndexed, 'lastIndexed must be passed through');
});

test('gateway does NOT bill/charge for GET /api/v1/index/status (read-only sidecar)', async (t) => {
  // The sidecar read is a passive UI status check — it MUST NOT trigger the
  // billing gate that POST /api/v1/index uses. Otherwise every Hub page load
  // would charge the user 50¢ for an "index" operation that did nothing.
  // We assert this by reading from a mock bridge and confirming the request
  // succeeds without a paid-tier user account being required.
  const calls = [];
  const mockBridge = express();
  mockBridge.get('/api/v1/index/status', (_req, res) => {
    calls.push(1);
    res.json({ lastIndexed: null, inProgress: false, job: null });
  });

  const { bridgeUrl, close } = await startMockBridge(mockBridge);
  t.after(close);

  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://canister.placeholder.test';
  process.env.SESSION_SECRET = SECRET;
  process.env.BRIDGE_URL = bridgeUrl;

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gwidxstatusbill=${Date.now()}`);

  const gwSrv = http.createServer(gwApp);
  await new Promise((resolve, reject) => {
    gwSrv.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => gwSrv.close(() => r())));
  const gwPort = gwSrv.address().port;

  const token = signTestJwt({ sub: 'google:idx-status-billing-test', role: 'viewer' });
  const res = await fetch(`http://127.0.0.1:${gwPort}/api/v1/index/status`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Vault-Id': 'Business',
    },
  });

  // Even a viewer (no billing entitlement to write) can READ status. The
  // bridge is the source of truth for auth scoping; the gateway just forwards.
  assert.equal(res.status, 200, 'viewer must still be able to read index status');
  assert.equal(calls.length, 1, 'request must reach the bridge (no billing block)');
});

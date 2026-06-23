/**
 * Gateway → bridge delegation route proxy contract (Phase 7C-L1).
 *
 * Locks in proxy wiring so hosted gateway forwards delegation REST to bridge,
 * mirroring calendar/flow hosted parity pattern.
 */

import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const SECRET = 'gateway-delegation-proxy-test-secret-32chars';

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

test('gateway proxies POST /api/v1/delegation/grants to bridge with auth headers', async (t) => {
  const calls = [];
  const mockBridge = express();
  mockBridge.use(express.json());
  mockBridge.post('/api/v1/delegation/grants', (req, res) => {
    calls.push({
      method: req.method,
      url: req.originalUrl,
      auth: req.headers.authorization,
      vault: req.headers['x-vault-id'],
      body: req.body,
    });
    res.status(201).json({
      schema: 'knowtation.delegation_grant_mint/v0',
      grant: { grant_id: 'dgrnt_test01', consent_id: req.body?.consent_id },
      bearer: 'dgrnt_bearer_test_only',
    });
  });

  const { bridgeUrl, close } = await startMockBridge(mockBridge);
  t.after(close);

  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://canister.placeholder.test';
  process.env.SESSION_SECRET = SECRET;
  process.env.BRIDGE_URL = bridgeUrl;

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gwdelegation=${Date.now()}`);

  const gwSrv = http.createServer(gwApp);
  await new Promise((resolve, reject) => {
    gwSrv.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => gwSrv.close(() => r())));

  const port = gwSrv.address().port;
  const token = signTestJwt({ sub: 'user-delegation-smoke', role: 'editor' });
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/delegation/grants`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-vault-id': 'default',
    },
    body: JSON.stringify({ consent_id: 'dcons_test01', actor_agent_id: 'agent_tutor_test01' }),
  });
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.equal(json.grant?.grant_id, 'dgrnt_test01');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].auth, /^Bearer /);
  assert.equal(calls[0].vault, 'default');
});

test('gateway source registers delegation proxy routes', () => {
  const src = fs.readFileSync(path.join(projectRoot, 'hub', 'gateway', 'server.mjs'), 'utf8');
  assert.match(src, /Agent delegation \(hosted parity — 7C-L1\)/);
  assert.match(src, /\/api\/v1\/delegation\/grants/);
  assert.match(src, /\/api\/v1\/agents\/identities/);
});

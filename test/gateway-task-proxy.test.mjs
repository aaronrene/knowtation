/**
 * Gateway → bridge task route proxy contract (Phase 2G hosted parity).
 *
 * Locks in proxy wiring so hosted gateway forwards task REST to bridge,
 * mirroring calendar/delegation hosted parity pattern.
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

const SECRET = 'gateway-task-proxy-test-secret-32chars';

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

test('gateway proxies GET /api/v1/tasks to bridge with auth headers', async (t) => {
  const calls = [];
  const mockBridge = express();
  mockBridge.get('/api/v1/tasks', (req, res) => {
    calls.push({
      method: req.method,
      url: req.originalUrl,
      auth: req.headers.authorization,
      vault: req.headers['x-vault-id'],
    });
    res.status(200).json({
      schema: 'knowtation.task_list/v0',
      vault_id: 'default',
      effective_scope: 'personal',
      tasks: [{ task_id: 'task_personal_practice', scope: 'personal', kind: 'personal', status: 'pending', title: 'Practice', workspace_id: 'ws', due_at: null, run_ref: null, truncated: false }],
      truncated: false,
    });
  });

  const { bridgeUrl, close } = await startMockBridge(mockBridge);
  t.after(close);

  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://canister.placeholder.test';
  process.env.SESSION_SECRET = SECRET;
  process.env.BRIDGE_URL = bridgeUrl;

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gwtask=${Date.now()}`);

  const gwSrv = http.createServer(gwApp);
  await new Promise((resolve, reject) => {
    gwSrv.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => gwSrv.close(() => r())));

  const port = gwSrv.address().port;
  const token = signTestJwt({ sub: 'user-task-smoke', role: 'editor' });
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/tasks`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'x-vault-id': 'default',
    },
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.schema, 'knowtation.task_list/v0');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].auth, /^Bearer /);
  assert.equal(calls[0].vault, 'default');
});

test('gateway proxies POST /api/v1/tasks/proposals to bridge', async (t) => {
  const calls = [];
  const mockBridge = express();
  mockBridge.use(express.json());
  mockBridge.post('/api/v1/tasks/proposals', (req, res) => {
    calls.push({ method: req.method, body: req.body, vault: req.headers['x-vault-id'] });
    res.status(403).json({ error: 'Task writes are disabled', code: 'TASK_WRITES_DISABLED' });
  });

  const { bridgeUrl, close } = await startMockBridge(mockBridge);
  t.after(close);

  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://canister.placeholder.test';
  process.env.SESSION_SECRET = SECRET;
  process.env.BRIDGE_URL = bridgeUrl;

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gwtaskpost=${Date.now()}`);

  const gwSrv = http.createServer(gwApp);
  await new Promise((resolve, reject) => {
    gwSrv.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => gwSrv.close(() => r())));

  const port = gwSrv.address().port;
  const token = signTestJwt({ sub: 'user-task-write', role: 'editor' });
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/tasks/proposals`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-vault-id': 'default',
    },
    body: JSON.stringify({ proposal_kind: 'task_create', intent: 'test', task: { task_id: 'task_x' } }),
  });
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.code, 'TASK_WRITES_DISABLED');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
});

test('gateway proxies GET /api/v1/task-loops to bridge', async (t) => {
  const calls = [];
  const mockBridge = express();
  mockBridge.get('/api/v1/task-loops', (req, res) => {
    calls.push({ method: req.method, vault: req.headers['x-vault-id'] });
    res.status(200).json({
      schema: 'knowtation.task_loop_list/v0',
      vault_id: 'default',
      effective_scope: 'personal',
      loops: [{ loop_id: 'loop_school_trip', scope: 'personal', status: 'active', title: 't', truncated: false }],
      truncated: false,
    });
  });

  const { bridgeUrl, close } = await startMockBridge(mockBridge);
  t.after(close);

  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://canister.placeholder.test';
  process.env.SESSION_SECRET = SECRET;
  process.env.BRIDGE_URL = bridgeUrl;

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gwloop=${Date.now()}`);

  const gwSrv = http.createServer(gwApp);
  await new Promise((resolve, reject) => {
    gwSrv.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => gwSrv.close(() => r())));

  const port = gwSrv.address().port;
  const token = signTestJwt({ sub: 'user-loop-smoke', role: 'editor' });
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/task-loops`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'x-vault-id': 'default',
    },
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.schema, 'knowtation.task_loop_list/v0');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
});

test('gateway source registers task + loop proxy routes', () => {
  const src = fs.readFileSync(path.join(projectRoot, 'hub', 'gateway', 'server.mjs'), 'utf8');
  assert.match(src, /Task routes \(hosted parity — 2G\)/);
  assert.match(src, /\/api\/v1\/tasks/);
  assert.match(src, /\/api\/v1\/task-loops/);
  assert.match(src, /\/api\/v1\/loop-pass-audit/);
  assert.match(src, /\/api\/v1\/tasks\/proposals/);
  assert.match(src, /maybeApplyHostedTaskAfterApprove/);
});

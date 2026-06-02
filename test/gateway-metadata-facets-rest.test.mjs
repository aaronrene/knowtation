/**
 * Gateway REST MetadataFacets tests.
 *
 * The hosted gateway route returns bounded body-free MetadataFacets while
 * preserving auth, active vault, effective canister user, path safety,
 * sanitized errors, and the no-body/no-full-frontmatter output boundary.
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
const SECRET = 'gateway-metadata-facets-rest-test-secret-32';
const GATEWAY_AUTH_SECRET = 'gateway-metadata-facets-gw-secret';

function signTestJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function startServer(app) {
  const srv = http.createServer(app);
  return new Promise((resolve, reject) => {
    srv.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      resolve({
        url: `http://127.0.0.1:${srv.address().port}`,
        close: () => new Promise((r) => srv.close(() => r())),
      });
    });
  });
}

async function startGateway(canisterUrl, bridgeUrl) {
  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = canisterUrl;
  process.env.BRIDGE_URL = bridgeUrl || '';
  process.env.SESSION_SECRET = SECRET;
  process.env.CANISTER_AUTH_SECRET = GATEWAY_AUTH_SECRET;
  process.env.BILLING_ENFORCE = 'false';

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gwmetadatafacets=${Date.now()}-${Math.random()}`);
  return startServer(gwApp);
}

test('unit: GET /api/v1/metadata-facets is auth-gated before upstream fetch', async (t) => {
  const canisterCalls = [];
  const canister = express();
  canister.get(/.*/, (req, res) => {
    canisterCalls.push(req.originalUrl);
    res.status(500).json({ error: 'must not be called' });
  });
  const canisterSrv = await startServer(canister);
  t.after(canisterSrv.close);
  const gateway = await startGateway(canisterSrv.url, '');
  t.after(gateway.close);

  const res = await fetch(`${gateway.url}/api/v1/metadata-facets?path=inbox/a.md`);
  const body = await res.json();

  assert.equal(res.status, 401);
  assert.deepEqual(body, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
  assert.equal(canisterCalls.length, 0);
});

test('integration: MetadataFacets REST uses active vault and effective canister user headers', async (t) => {
  const bridgeCalls = [];
  const bridge = express();
  bridge.get('/api/v1/hosted-context', (req, res) => {
    bridgeCalls.push({ vault: req.headers['x-vault-id'], auth: req.headers.authorization });
    res.json({
      effective_canister_user_id: 'google:owner',
      allowed_vault_ids: ['vault-facets'],
      role: 'viewer',
    });
  });
  const bridgeSrv = await startServer(bridge);
  t.after(bridgeSrv.close);

  const canisterCalls = [];
  const canister = express();
  canister.get('/api/v1/notes/:path', (req, res) => {
    canisterCalls.push({
      url: req.originalUrl,
      user: req.headers['x-user-id'],
      actor: req.headers['x-actor-id'],
      vault: req.headers['x-vault-id'],
      gatewayAuth: req.headers['x-gateway-auth'],
    });
    res.json({
      path: '/Users/private/upstream.md',
      frontmatter: '{"project":"REST Facets","tags":["Alpha"],"api_key":"must-not-leak"}',
      body: 'Body must not leak.',
    });
  });
  const canisterSrv = await startServer(canister);
  t.after(canisterSrv.close);
  const gateway = await startGateway(canisterSrv.url, bridgeSrv.url);
  t.after(gateway.close);

  const token = signTestJwt({ sub: 'google:actor', role: 'viewer' });
  const res = await fetch(`${gateway.url}/api/v1/metadata-facets?path=${encodeURIComponent('inbox/hello world.md')}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Vault-Id': 'vault-facets',
    },
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(bridgeCalls.length, 1);
  assert.equal(bridgeCalls[0].vault, 'vault-facets');
  assert.equal(bridgeCalls[0].auth, `Bearer ${token}`);
  assert.equal(canisterCalls.length, 1);
  assert.equal(canisterCalls[0].url, `/api/v1/notes/${encodeURIComponent('inbox/hello world.md')}`);
  assert.equal(canisterCalls[0].user, 'google:owner');
  assert.equal(canisterCalls[0].actor, 'google:actor');
  assert.equal(canisterCalls[0].vault, 'vault-facets');
  assert.equal(canisterCalls[0].gatewayAuth, GATEWAY_AUTH_SECRET);
  assert.equal(body.schema, 'knowtation.metadata_facets/v0');
  assert.equal(body.path, 'inbox/hello world.md');
});

test('end-to-end: MetadataFacets REST returns the body-free allowlist only', async (t) => {
  const canister = express();
  canister.get('/api/v1/notes/:path', (_req, res) => {
    res.json({
      path: '/Users/private/upstream.md',
      frontmatter:
        '{"project":"REST Facets","tags":["Alpha","Beta"],"date":"2026-05-24","updated":"2026-05-25","causal_chain_id":"Launch Rollout","entity":["Alice B"],"episode_id":"Episode 1","api_key":"must-not-leak","label":"do not include"}',
      body: 'Body must not leak.',
    });
  });
  const canisterSrv = await startServer(canister);
  t.after(canisterSrv.close);
  const gateway = await startGateway(canisterSrv.url, '');
  t.after(gateway.close);

  const token = signTestJwt({ sub: 'google:actor', role: 'viewer' });
  const res = await fetch(`${gateway.url}/api/v1/metadata-facets?path=safe.md`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  const serialized = JSON.stringify(body);

  assert.equal(res.status, 200);
  assert.deepEqual(body, {
    schema: 'knowtation.metadata_facets/v0',
    path: 'safe.md',
    facets: {
      project: 'rest-facets',
      tags: ['alpha', 'beta'],
      date: '2026-05-24',
      updated: '2026-05-25',
      causal_chain_id: 'launch-rollout',
      entity: ['alice-b'],
      episode_id: 'episode-1',
    },
    inferred: {
      folder: null,
      source_type: null,
    },
    truncated: false,
  });
  assert.equal(Object.hasOwn(body, 'body'), false);
  assert.equal(Object.hasOwn(body, 'frontmatter'), false);
  assert.equal(Object.hasOwn(body, 'snippet'), false);
  assert.equal(Object.hasOwn(body, 'summary'), false);
  assert.equal(Object.hasOwn(body, 'labels'), false);
  assert.equal(Object.hasOwn(body, 'resource_uri'), false);
  assert.equal(serialized.includes('Body must not leak'), false);
  assert.equal(serialized.includes('must-not-leak'), false);
  assert.equal(serialized.includes('do not include'), false);
  assert.equal(serialized.includes('/Users/private'), false);
  assert.equal(serialized.includes('knowtation://'), false);
});

test('stress: MetadataFacets REST repeated calls are deterministic and one-note bounded', async (t) => {
  const canisterCalls = [];
  const canister = express();
  canister.get('/api/v1/notes/:path', (req, res) => {
    canisterCalls.push(req.originalUrl);
    res.json({
      path: 'ignored.md',
      frontmatter: '{"tags":["Repeatable"]}',
      body: 'private body',
    });
  });
  canister.all(/.*/, (req, res) => {
    canisterCalls.push(req.originalUrl);
    res.status(500).json({ error: 'unexpected route' });
  });
  const canisterSrv = await startServer(canister);
  t.after(canisterSrv.close);
  const gateway = await startGateway(canisterSrv.url, '');
  t.after(gateway.close);
  const token = signTestJwt({ sub: 'google:actor', role: 'viewer' });

  const outputs = [];
  for (let index = 0; index < 5; index += 1) {
    const res = await fetch(`${gateway.url}/api/v1/metadata-facets?path=repeat.md`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    outputs.push(await res.text());
  }

  assert.equal(new Set(outputs).size, 1);
  assert.equal(canisterCalls.length, 5);
  assert.equal(canisterCalls.every((url) => url === '/api/v1/notes/repeat.md'), true);
  assert.equal(outputs[0].includes('private body'), false);
});

test('data-integrity: MetadataFacets REST rejects unsafe paths before upstream fetch', async (t) => {
  const canisterCalls = [];
  const canister = express();
  canister.get(/.*/, (req, res) => {
    canisterCalls.push(req.originalUrl);
    res.status(500).json({ error: 'must not be called' });
  });
  const canisterSrv = await startServer(canister);
  t.after(canisterSrv.close);
  const gateway = await startGateway(canisterSrv.url, '');
  t.after(gateway.close);
  const token = signTestJwt({ sub: 'google:actor', role: 'viewer' });

  for (const unsafePath of ['../secret.md', '/Users/owner/secret.md', 'C:\\Users\\owner\\secret.md']) {
    const res = await fetch(`${gateway.url}/api/v1/metadata-facets?path=${encodeURIComponent(unsafePath)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    const serialized = JSON.stringify(body);

    assert.equal(res.status, 400);
    assert.deepEqual(body, { error: 'Invalid path', code: 'INVALID_PATH' });
    assert.equal(serialized.includes('secret.md'), false);
    assert.equal(serialized.includes('/Users'), false);
    assert.equal(serialized.includes('C:'), false);
  }
  assert.equal(canisterCalls.length, 0);
});

test('performance: MetadataFacets REST does not call bridge search, index, memory, or providers', async (t) => {
  const bridgeCalls = [];
  const bridge = express();
  bridge.get('/api/v1/hosted-context', (_req, res) => {
    bridgeCalls.push('/api/v1/hosted-context');
    res.json({ effective_canister_user_id: 'google:owner', allowed_vault_ids: ['default'], role: 'viewer' });
  });
  bridge.all(/.*/, (req, res) => {
    bridgeCalls.push(req.originalUrl);
    res.status(500).json({ error: 'unexpected bridge route' });
  });
  const bridgeSrv = await startServer(bridge);
  t.after(bridgeSrv.close);
  const canister = express();
  canister.get('/api/v1/notes/:path', (_req, res) => {
    res.json({ frontmatter: '{"tags":["A"]}', body: 'Private body.' });
  });
  const canisterSrv = await startServer(canister);
  t.after(canisterSrv.close);
  const gateway = await startGateway(canisterSrv.url, bridgeSrv.url);
  t.after(gateway.close);
  const token = signTestJwt({ sub: 'google:actor', role: 'viewer' });

  const res = await fetch(`${gateway.url}/api/v1/metadata-facets?path=a.md`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(bridgeCalls, ['/api/v1/hosted-context']);
});

test('security: MetadataFacets REST sanitizes missing, unauthorized, and upstream failures', async (t) => {
  const canister = express();
  canister.get('/api/v1/notes/missing.md', (_req, res) => {
    res.status(404).json({ error: 'not found', body: 'private missing body' });
  });
  canister.get('/api/v1/notes/private.md', (_req, res) => {
    res.status(403).json({ error: 'forbidden', frontmatter: 'api_key: must-not-leak' });
  });
  canister.get('/api/v1/notes/broken.md', (_req, res) => {
    res.status(500).json({ error: 'stack trace', body: 'private upstream body' });
  });
  const canisterSrv = await startServer(canister);
  t.after(canisterSrv.close);
  const gateway = await startGateway(canisterSrv.url, '');
  t.after(gateway.close);
  const token = signTestJwt({ sub: 'google:actor', role: 'viewer' });

  const missing = await fetch(`${gateway.url}/api/v1/metadata-facets?path=missing.md`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const forbidden = await fetch(`${gateway.url}/api/v1/metadata-facets?path=private.md`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const broken = await fetch(`${gateway.url}/api/v1/metadata-facets?path=broken.md`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payloads = [await missing.json(), await forbidden.json(), await broken.json()];
  const serialized = JSON.stringify(payloads);

  assert.equal(missing.status, 404);
  assert.equal(forbidden.status, 403);
  assert.equal(broken.status, 502);
  assert.deepEqual(payloads, [
    { error: 'Not found', code: 'NOT_FOUND' },
    { error: 'Forbidden', code: 'FORBIDDEN' },
    { error: 'Upstream 500', code: 'BAD_GATEWAY' },
  ]);
  assert.equal(serialized.includes('private missing body'), false);
  assert.equal(serialized.includes('must-not-leak'), false);
  assert.equal(serialized.includes('private upstream body'), false);
});

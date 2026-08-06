/**
 * FLOW-WRITE-LIVE-GATEWAY-PROXY — seven-tier coverage.
 *
 * Proves gateway Flow authoring POSTs hit BRIDGE_URL (not the canister catch-all),
 * and that bridge + gateway source wires the three routes (parity with tasks/proposals).
 *
 * Tiers: unit · integration · e2e · stress · data-integrity · performance · security
 */

import fs from 'node:fs';
import { describe, it, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'url';

import { bridgeFlowHandlerRole } from '../hub/bridge/flow-routes.mjs';
import {
  mergeFlowFrontmatter,
  normalizeCanisterProposalForFlowPrecheck,
  FM_PROPOSAL_SOURCE,
  FM_FLOW_KIND,
  FLOW_PROPOSAL_SOURCE,
} from '../lib/flow/flow-hosted-proposal.mjs';
import { matchesScoolingFlowFingerprint } from '../lib/hub-proposal-personal-self-apply.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const SECRET = 'gateway-flow-proxy-test-secret-32chars!!';

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

function readRepo(rel) {
  return fs.readFileSync(path.join(projectRoot, rel), 'utf8');
}

async function bootGateway(t, bridgeUrl, cacheBust) {
  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://canister.placeholder.test';
  process.env.SESSION_SECRET = SECRET;
  process.env.BRIDGE_URL = bridgeUrl;

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gwflow=${cacheBust}`);

  const gwSrv = http.createServer(gwApp);
  await new Promise((resolve, reject) => {
    gwSrv.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => gwSrv.close(() => r())));
  return gwSrv.address().port;
}

const SAMPLE_BODY = {
  intent: 'draft personal flow',
  flow: {
    schema: 'knowtation.flow/v0',
    flow_id: 'flow_gw_proxy_1',
    title: 'Gateway proxy',
    version: '1.0.0',
    scope: 'personal',
    summary: 'test',
    tags: [],
    steps: [],
    inputs: [],
    vault_mirror_path: 'meta/flows/gw-proxy-1.md',
  },
  steps: [],
  external_ref: 'scooling.flow:gw-proxy-001',
};

describe('FLOW-WRITE-LIVE-GATEWAY-PROXY — unit', () => {
  it('bridgeFlowHandlerRole maps member → editor', () => {
    assert.equal(bridgeFlowHandlerRole('member'), 'editor');
    assert.equal(bridgeFlowHandlerRole('admin'), 'admin');
    assert.equal(bridgeFlowHandlerRole('viewer'), 'viewer');
  });

  it('mergeFlowFrontmatter embeds source + kind for canister rows', () => {
    const fm = mergeFlowFrontmatter({ type: 'flow' }, { kind: 'new', flow_id: 'flow_x', scope: 'personal' });
    assert.equal(fm[FM_PROPOSAL_SOURCE], FLOW_PROPOSAL_SOURCE);
    assert.equal(fm[FM_FLOW_KIND], 'new');
    assert.equal(fm.scope, 'personal');
  });

  it('normalizeCanisterProposalForFlowPrecheck reconstructs flow_meta from frontmatter', () => {
    const fm = mergeFlowFrontmatter(
      {},
      { kind: 'import', base_state_id: 'flowst1_absent', scope: 'personal', flow_id: 'flow_gw_proxy_1' },
    );
    const normalized = normalizeCanisterProposalForFlowPrecheck({
      proposal_id: 'p1',
      path: 'meta/flows/gw-proxy-1.md',
      external_ref: 'scooling.flow:gw-proxy-001',
      frontmatter: fm,
      body: JSON.stringify({
        flow: {
          schema: 'knowtation.flow/v0',
          flow_id: 'flow_gw_proxy_1',
          scope: 'personal',
        },
        steps: [],
      }),
    });
    assert.ok(normalized);
    assert.equal(normalized.source, FLOW_PROPOSAL_SOURCE);
    assert.equal(normalized.flow_meta.kind, 'import');
    assert.equal(matchesScoolingFlowFingerprint(normalized), true);
  });

  it('gateway + bridge source register the three Flow authoring proxies', () => {
    const gw = readRepo('hub/gateway/server.mjs');
    const bridge = readRepo('hub/bridge/server.mjs');
    const routes = readRepo('hub/bridge/flow-routes.mjs');
    assert.match(gw, /Flow authoring write-back \(hosted parity — FLOW-WRITE-LIVE-GATEWAY-PROXY\)/);
    assert.match(gw, /\/api\/v1\/flows\/import/);
    assert.match(gw, /app\.post\('\/api\/v1\/flows'/);
    assert.match(gw, /\/api\/v1\/flows\/:id\/proposals/);
    assert.match(bridge, /registerBridgeFlowRoutes/);
    assert.match(routes, /createFlowProposalOnCanister/);
    assert.match(routes, /FLOW_AUTHORING/);
    // Run proxies land in SITE-FINISH-FLOW-RUN-KN-b (separate module).
    assert.match(readRepo('hub/gateway/server.mjs'), /SITE-FINISH-FLOW-RUN-KN-b/);
  });
});

describe('FLOW-WRITE-LIVE-GATEWAY-PROXY — integration', () => {
  it('POST /api/v1/flows reaches mock bridge with auth headers (not canister)', async (t) => {
    const calls = [];
    const mockBridge = express();
    mockBridge.use(express.json());
    mockBridge.post('/api/v1/flows', (req, res) => {
      calls.push({
        method: req.method,
        url: req.originalUrl,
        auth: req.headers.authorization,
        vault: req.headers['x-vault-id'],
        body: req.body,
      });
      res.status(403).json({ error: 'Flow authoring writes are disabled', code: 'FLOW_AUTHORING_DISABLED' });
    });

    const { bridgeUrl, close } = await startMockBridge(mockBridge);
    t.after(close);
    const port = await bootGateway(t, bridgeUrl, `post-${Date.now()}`);

    const token = signTestJwt({ sub: 'user-flow-proxy', role: 'editor', type: 'session' });
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/flows`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-vault-id': 'default',
      },
      body: JSON.stringify(SAMPLE_BODY),
    });
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.code, 'FLOW_AUTHORING_DISABLED');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.match(calls[0].auth, /^Bearer /);
    assert.equal(calls[0].vault, 'default');
  });
});

describe('FLOW-WRITE-LIVE-GATEWAY-PROXY — e2e', () => {
  it('POST import + POST :id/proposals both hit bridge', async (t) => {
    const calls = [];
    const mockBridge = express();
    mockBridge.use(express.json());
    mockBridge.post('/api/v1/flows/import', (req, res) => {
      calls.push({ path: '/import', body: req.body });
      res.status(201).json({
        schema: 'knowtation.flow_proposal/v0',
        proposal_id: 'prop_import_1',
        flow_id: 'flow_imported',
        base_version: null,
        base_state_id: null,
        scope: 'personal',
        auto_approvable: false,
        status: 'proposed',
        review_queue: 'flow-authoring',
      });
    });
    mockBridge.post('/api/v1/flows/:id/proposals', (req, res) => {
      calls.push({ path: `/proposals/${req.params.id}`, body: req.body });
      res.status(403).json({ error: 'Flow authoring writes are disabled', code: 'FLOW_AUTHORING_DISABLED' });
    });

    const { bridgeUrl, close } = await startMockBridge(mockBridge);
    t.after(close);
    const port = await bootGateway(t, bridgeUrl, `e2e-${Date.now()}`);
    const token = signTestJwt({ sub: 'user-flow-e2e', role: 'editor', type: 'session' });

    const importRes = await fetch(`http://127.0.0.1:${port}/api/v1/flows/import`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-vault-id': 'default',
      },
      body: JSON.stringify({ intent: 'import', bundle: { flow: SAMPLE_BODY.flow, steps: [] } }),
    });
    assert.equal(importRes.status, 201);
    const imported = await importRes.json();
    assert.equal(imported.proposal_id, 'prop_import_1');

    const editRes = await fetch(
      `http://127.0.0.1:${port}/api/v1/flows/${encodeURIComponent('flow_gw_proxy_1')}/proposals`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-vault-id': 'default',
        },
        body: JSON.stringify({
          ...SAMPLE_BODY,
          base_version: '1.0.0',
          base_state_id: 'flowst1_deadbeefdeadbe',
        }),
      },
    );
    assert.equal(editRes.status, 403);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].path, '/import');
    assert.equal(calls[1].path, '/proposals/flow_gw_proxy_1');
  });
});

describe('FLOW-WRITE-LIVE-GATEWAY-PROXY — stress', () => {
  it('N concurrent POST /api/v1/flows all hit bridge (no cross-talk)', async (t) => {
    const calls = [];
    const mockBridge = express();
    mockBridge.use(express.json());
    mockBridge.post('/api/v1/flows', (req, res) => {
      calls.push(req.body?.intent || '');
      res.status(403).json({ code: 'FLOW_AUTHORING_DISABLED', error: 'disabled' });
    });
    const { bridgeUrl, close } = await startMockBridge(mockBridge);
    t.after(close);
    const port = await bootGateway(t, bridgeUrl, `stress-${Date.now()}`);
    const token = signTestJwt({ sub: 'user-flow-stress', role: 'editor', type: 'session' });
    const N = 12;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        fetch(`http://127.0.0.1:${port}/api/v1/flows`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'x-vault-id': 'default',
          },
          body: JSON.stringify({ ...SAMPLE_BODY, intent: `intent-${i}` }),
        }).then((r) => r.status),
      ),
    );
    assert.equal(results.every((s) => s === 403), true);
    assert.equal(calls.length, N);
    assert.equal(new Set(calls).size, N);
  });
});

describe('FLOW-WRITE-LIVE-GATEWAY-PROXY — data-integrity', () => {
  it('gateway forwards JSON body intact to bridge', async (t) => {
    let seen = null;
    const mockBridge = express();
    mockBridge.use(express.json({ limit: '1mb' }));
    mockBridge.post('/api/v1/flows', (req, res) => {
      seen = req.body;
      res.status(201).json({
        schema: 'knowtation.flow_proposal/v0',
        proposal_id: 'prop_di',
        flow_id: SAMPLE_BODY.flow.flow_id,
        base_version: null,
        base_state_id: null,
        scope: 'personal',
        auto_approvable: false,
        status: 'proposed',
        review_queue: 'flow-authoring',
      });
    });
    const { bridgeUrl, close } = await startMockBridge(mockBridge);
    t.after(close);
    const port = await bootGateway(t, bridgeUrl, `di-${Date.now()}`);
    const token = signTestJwt({ sub: 'user-flow-di', role: 'editor', type: 'session' });
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/flows`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-vault-id': 'default',
      },
      body: JSON.stringify(SAMPLE_BODY),
    });
    assert.equal(res.status, 201);
    assert.deepEqual(seen.flow.flow_id, SAMPLE_BODY.flow.flow_id);
    assert.equal(seen.external_ref, SAMPLE_BODY.external_ref);
    assert.equal(seen.intent, SAMPLE_BODY.intent);
  });
});

describe('FLOW-WRITE-LIVE-GATEWAY-PROXY — performance', () => {
  it('proxy round-trip stays under 2s for disabled-gate response', async (t) => {
    const mockBridge = express();
    mockBridge.use(express.json());
    mockBridge.post('/api/v1/flows', (_req, res) => {
      res.status(403).json({ code: 'FLOW_AUTHORING_DISABLED', error: 'disabled' });
    });
    const { bridgeUrl, close } = await startMockBridge(mockBridge);
    t.after(close);
    const port = await bootGateway(t, bridgeUrl, `perf-${Date.now()}`);
    const token = signTestJwt({ sub: 'user-flow-perf', role: 'editor', type: 'session' });
    const t0 = performance.now();
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/flows`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-vault-id': 'default',
      },
      body: JSON.stringify(SAMPLE_BODY),
    });
    const elapsed = performance.now() - t0;
    assert.equal(res.status, 403);
    assert.ok(elapsed < 2000, `elapsed ${elapsed}ms`);
  });
});

describe('FLOW-WRITE-LIVE-GATEWAY-PROXY — security', () => {
  it('import path is not captured as :id; run proxies coexist with authoring', async (t) => {
    const calls = [];
    const mockBridge = express();
    mockBridge.use(express.json());
    mockBridge.post('/api/v1/flows/import', (req, res) => {
      calls.push('import');
      res.status(403).json({ code: 'FLOW_AUTHORING_DISABLED', error: 'disabled' });
    });
    mockBridge.post('/api/v1/flows/:id/proposals', (req, res) => {
      calls.push(`id=${req.params.id}`);
      res.status(403).json({ code: 'FLOW_AUTHORING_DISABLED', error: 'disabled' });
    });
    const { bridgeUrl, close } = await startMockBridge(mockBridge);
    t.after(close);
    const port = await bootGateway(t, bridgeUrl, `sec-${Date.now()}`);
    const token = signTestJwt({ sub: 'user-flow-sec', role: 'editor', type: 'session' });
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/flows/import`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-vault-id': 'default',
      },
      body: JSON.stringify({ intent: 'x', bundle: { flow: SAMPLE_BODY.flow, steps: [] } }),
    });
    assert.equal(res.status, 403);
    assert.deepEqual(calls, ['import']);
    const gw = readRepo('hub/gateway/server.mjs');
    assert.match(gw, /SITE-FINISH-FLOW-RUN-KN-b/);
    assert.match(gw, /app\.post\('\/api\/v1\/flows\/:id\/runs'/);
  });

  it('source scan: no Delegation write env and no Scooling Hub JWT envs added', () => {
    const gw = readRepo('hub/gateway/server.mjs');
    const bridgeRoutes = readRepo('hub/bridge/flow-routes.mjs');
    assert.doesNotMatch(bridgeRoutes, /DELEGATION_WRITES\s*=/);
    assert.doesNotMatch(gw, /SCOOLING_.*HUB.*JWT/);
    assert.doesNotMatch(bridgeRoutes, /FLOW_CAPTURE_WRITES\s*=\s*['"]1['"]/);
    assert.doesNotMatch(bridgeRoutes, /FLOW_RUN_WRITES\s*=\s*['"]1['"]/);
  });
});

test('gateway proxies POST /api/v1/flows to bridge (smoke alias)', async (t) => {
  // Kept as a top-level smoke for quick single-test runs (mirrors gateway-task-proxy style).
  const calls = [];
  const mockBridge = express();
  mockBridge.use(express.json());
  mockBridge.post('/api/v1/flows', (req, res) => {
    calls.push(1);
    res.status(403).json({ code: 'FLOW_AUTHORING_DISABLED', error: 'disabled' });
  });
  const { bridgeUrl, close } = await startMockBridge(mockBridge);
  t.after(close);
  const port = await bootGateway(t, bridgeUrl, `smoke-${Date.now()}`);
  const token = signTestJwt({ sub: 'user-flow-smoke', role: 'editor', type: 'session' });
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/flows`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-vault-id': 'default',
    },
    body: JSON.stringify(SAMPLE_BODY),
  });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 1);
});

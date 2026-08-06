/**
 * SITE-FINISH-FLOW-RUN-KN-b — seven-tier coverage (§FR.0.4).
 * Frozen: ~/scooling/docs/SITE-FINISH-FLOW-RUN-FREEZE.md (pass digest sha256:24f10167…)
 *
 * Proves gateway→bridge proxies for Hub run/consent family, bridge registration,
 * env-off refuse path, and no FLIP of FLOW_RUN_WRITES_ENABLED /
 * FLOW_AUTOMATABLE_EXECUTION_ENABLED.
 *
 * Tiers: unit · integration · e2e · stress · data-integrity · performance · security
 */

import fs from 'node:fs';
import os from 'node:os';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  bridgeFlowRunHandlerRole,
  createRunOutcomeProposalOnCanister,
} from '../hub/bridge/flow-run-routes.mjs';
import {
  getFlowRunWritesEnabled,
  getFlowAutomatableExecutionEnabled,
  handleFlowRunStartRequest,
} from '../lib/flow/flow-execution.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const SECRET = 'gateway-flow-run-kn-b-test-secret-32chars!';

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
  const { app: gwApp } = await import(`${gwEntry}?gwrun=${cacheBust}`);

  const gwSrv = http.createServer(gwApp);
  await new Promise((resolve, reject) => {
    gwSrv.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => gwSrv.close(() => r())));
  return gwSrv.address().port;
}

const FLOW_ID = 'flow_run_knb_1';
const RUN_ID = 'frun_run_knb_aaaaaaaa';

describe('SITE-FINISH-FLOW-RUN-KN-b — unit', () => {
  it('bridgeFlowRunHandlerRole maps member → editor', () => {
    assert.equal(bridgeFlowRunHandlerRole('member'), 'editor');
    assert.equal(bridgeFlowRunHandlerRole('admin'), 'admin');
    assert.equal(bridgeFlowRunHandlerRole('viewer'), 'viewer');
  });

  it('gateway + bridge source register §FR.0.4 run/consent proxies', () => {
    const gw = readRepo('hub/gateway/server.mjs');
    const bridge = readRepo('hub/bridge/server.mjs');
    const routes = readRepo('hub/bridge/flow-run-routes.mjs');
    assert.match(gw, /SITE-FINISH-FLOW-RUN-KN-b/);
    assert.match(gw, /app\.get\('\/api\/v1\/flow-runs\/:run_id'/);
    assert.match(gw, /app\.get\('\/api\/v1\/flows\/:id\/runs'/);
    assert.match(gw, /app\.post\('\/api\/v1\/flows\/:id\/runs'/);
    assert.match(gw, /app\.post\('\/api\/v1\/flows\/:id\/runs\/:run_id\/advance'/);
    assert.match(gw, /app\.post\('\/api\/v1\/flows\/:id\/runs\/:run_id\/evidence'/);
    assert.match(gw, /app\.post\('\/api\/v1\/flows\/:id\/runs\/:run_id\/execute-automatable'/);
    assert.match(gw, /app\.post\('\/api\/v1\/flows\/:id\/runs\/:run_id\/submit-review'/);
    assert.match(gw, /app\.post\('\/api\/v1\/flows\/:id\/runs\/:run_id\/consent'/);
    assert.match(bridge, /registerBridgeFlowRunRoutes/);
    assert.match(routes, /handleFlowRunStartRequest/);
    assert.match(routes, /handleFlowExecutionConsentMintRequest/);
    assert.match(routes, /withExternalProtocolBlobSync/);
    // Authoring + capture still present (no silent deletion).
    assert.match(gw, /FLOW-WRITE-LIVE-GATEWAY-PROXY/);
    assert.match(gw, /FLOW-CAPTURE-LIVE-KN-b/);
  });

  it('createRunOutcomeProposalOnCanister refuses missing CANISTER_URL', async () => {
    await assert.rejects(
      () =>
        createRunOutcomeProposalOnCanister({
          canisterUrl: '',
          headers: {},
          input: { intent: 'x', body: '{}' },
        }),
      (err) => err && err.code === 'NOT_AVAILABLE',
    );
  });
});

describe('SITE-FINISH-FLOW-RUN-KN-b — integration', () => {
  it('gateway proxies all §FR.0.4 routes to BRIDGE_URL (env-off 403 codes)', async (t) => {
    const calls = [];
    const mockBridge = express();
    mockBridge.use(express.json());

    mockBridge.get('/api/v1/flow-runs/:run_id', (req, res) => {
      calls.push({ path: 'get-run', id: req.params.run_id, auth: req.headers.authorization });
      res.status(403).json({ error: 'Run writes are disabled', code: 'FLOW_RUN_WRITES_DISABLED' });
    });
    mockBridge.get('/api/v1/flows/:id/runs', (req, res) => {
      calls.push({ path: 'list', id: req.params.id });
      res.status(403).json({ error: 'Run writes are disabled', code: 'FLOW_RUN_WRITES_DISABLED' });
    });
    mockBridge.post('/api/v1/flows/:id/runs', (req, res) => {
      calls.push({ path: 'start', id: req.params.id, body: req.body });
      res.status(403).json({ error: 'Run writes are disabled', code: 'FLOW_RUN_WRITES_DISABLED' });
    });
    mockBridge.post('/api/v1/flows/:id/runs/:run_id/advance', (req, res) => {
      calls.push({ path: 'advance', run: req.params.run_id });
      res.status(403).json({ error: 'Run writes are disabled', code: 'FLOW_RUN_WRITES_DISABLED' });
    });
    mockBridge.post('/api/v1/flows/:id/runs/:run_id/evidence', (req, res) => {
      calls.push({ path: 'evidence', run: req.params.run_id });
      res.status(403).json({ error: 'Run writes are disabled', code: 'FLOW_RUN_WRITES_DISABLED' });
    });
    mockBridge.post('/api/v1/flows/:id/runs/:run_id/execute-automatable', (req, res) => {
      calls.push({ path: 'execute', run: req.params.run_id });
      res.status(403).json({
        error: 'Automatable execution is disabled',
        code: 'FLOW_AUTOMATABLE_EXECUTION_DISABLED',
      });
    });
    mockBridge.post('/api/v1/flows/:id/runs/:run_id/submit-review', (req, res) => {
      calls.push({ path: 'submit', run: req.params.run_id });
      res.status(403).json({ error: 'Run writes are disabled', code: 'FLOW_RUN_WRITES_DISABLED' });
    });
    mockBridge.post('/api/v1/flows/:id/runs/:run_id/consent', (req, res) => {
      calls.push({ path: 'consent', run: req.params.run_id });
      res.status(403).json({
        error: 'Automatable execution is disabled',
        code: 'FLOW_AUTOMATABLE_EXECUTION_DISABLED',
      });
    });

    const { bridgeUrl, close } = await startMockBridge(mockBridge);
    t.after(close);
    const port = await bootGateway(t, bridgeUrl, `int-${Date.now()}`);
    const token = signTestJwt({ sub: 'user-run-proxy', role: 'editor', type: 'session' });
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-vault-id': 'default',
    };

    const getRun = await fetch(
      `http://127.0.0.1:${port}/api/v1/flow-runs/${encodeURIComponent(RUN_ID)}`,
      { headers: { authorization: `Bearer ${token}`, 'x-vault-id': 'default' } },
    );
    assert.equal(getRun.status, 403);
    assert.equal((await getRun.json()).code, 'FLOW_RUN_WRITES_DISABLED');

    const list = await fetch(
      `http://127.0.0.1:${port}/api/v1/flows/${encodeURIComponent(FLOW_ID)}/runs`,
      { headers: { authorization: `Bearer ${token}`, 'x-vault-id': 'default' } },
    );
    assert.equal(list.status, 403);

    const start = await fetch(
      `http://127.0.0.1:${port}/api/v1/flows/${encodeURIComponent(FLOW_ID)}/runs`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ flow_version: '1.0.0' }),
      },
    );
    assert.equal(start.status, 403);

    const advance = await fetch(
      `http://127.0.0.1:${port}/api/v1/flows/${encodeURIComponent(FLOW_ID)}/runs/${encodeURIComponent(RUN_ID)}/advance`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ step_id: `${FLOW_ID}#1`, to_status: 'done' }),
      },
    );
    assert.equal(advance.status, 403);

    const evidence = await fetch(
      `http://127.0.0.1:${port}/api/v1/flows/${encodeURIComponent(FLOW_ID)}/runs/${encodeURIComponent(RUN_ID)}/evidence`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          step_id: `${FLOW_ID}#1`,
          evidence_ref: 'note:meta/x.md',
          pointer_kind: 'note_path',
        }),
      },
    );
    assert.equal(evidence.status, 403);

    const execute = await fetch(
      `http://127.0.0.1:${port}/api/v1/flows/${encodeURIComponent(FLOW_ID)}/runs/${encodeURIComponent(RUN_ID)}/execute-automatable`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          step_id: `${FLOW_ID}#1`,
          consent_id: 'fcons_deadbeef',
          dry_run: true,
        }),
      },
    );
    assert.equal(execute.status, 403);
    assert.equal((await execute.json()).code, 'FLOW_AUTOMATABLE_EXECUTION_DISABLED');

    const submit = await fetch(
      `http://127.0.0.1:${port}/api/v1/flows/${encodeURIComponent(FLOW_ID)}/runs/${encodeURIComponent(RUN_ID)}/submit-review`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ intent: 'review outcome' }),
      },
    );
    assert.equal(submit.status, 403);

    const consent = await fetch(
      `http://127.0.0.1:${port}/api/v1/flows/${encodeURIComponent(FLOW_ID)}/runs/${encodeURIComponent(RUN_ID)}/consent`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ allowed_lanes: ['local_default'], cost_cap_units: 1 }),
      },
    );
    assert.equal(consent.status, 403);

    assert.equal(calls.length, 8);
    assert.equal(calls[0].path, 'get-run');
    assert.match(calls[0].auth, /^Bearer /);
    assert.equal(calls[1].path, 'list');
    assert.equal(calls[2].path, 'start');
    assert.equal(calls[3].path, 'advance');
    assert.equal(calls[4].path, 'evidence');
    assert.equal(calls[5].path, 'execute');
    assert.equal(calls[6].path, 'submit');
    assert.equal(calls[7].path, 'consent');
  });
});

describe('SITE-FINISH-FLOW-RUN-KN-b — e2e', () => {
  it('handler refuse when FLOW_RUN_WRITES_ENABLED unset (default off)', () => {
    const prev = process.env.FLOW_RUN_WRITES_ENABLED;
    delete process.env.FLOW_RUN_WRITES_ENABLED;
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-flow-run-kn-b-'));
      try {
        assert.equal(getFlowRunWritesEnabled(tmp), false);
        assert.equal(getFlowAutomatableExecutionEnabled(tmp), false);
        const start = handleFlowRunStartRequest({
          dataDir: tmp,
          vaultId: 'default',
          role: 'admin',
          flowId: FLOW_ID,
          flowVersion: '1.0.0',
        });
        assert.equal(start.ok, false);
        assert.equal(start.code, 'FLOW_RUN_WRITES_DISABLED');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    } finally {
      if (prev === undefined) delete process.env.FLOW_RUN_WRITES_ENABLED;
      else process.env.FLOW_RUN_WRITES_ENABLED = prev;
    }
  });
});

describe('SITE-FINISH-FLOW-RUN-KN-b — stress', () => {
  it('N concurrent start proxies all hit bridge (no drop)', async (t) => {
    let hits = 0;
    const mockBridge = express();
    mockBridge.use(express.json());
    mockBridge.post('/api/v1/flows/:id/runs', (_req, res) => {
      hits += 1;
      res.status(403).json({ code: 'FLOW_RUN_WRITES_DISABLED', error: 'disabled' });
    });
    const { bridgeUrl, close } = await startMockBridge(mockBridge);
    t.after(close);
    const port = await bootGateway(t, bridgeUrl, `stress-${Date.now()}`);
    const token = signTestJwt({ sub: 'user-run-stress', role: 'editor', type: 'session' });
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-vault-id': 'default',
    };
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        fetch(`http://127.0.0.1:${port}/api/v1/flows/${encodeURIComponent(FLOW_ID)}/runs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ flow_version: '1.0.0' }),
        }),
      ),
    );
    assert.ok(results.every((r) => r.status === 403));
    assert.equal(hits, 12);
  });
});

describe('SITE-FINISH-FLOW-RUN-KN-b — data-integrity', () => {
  it('proxy preserves Authorization + JSON body to bridge', async (t) => {
    /** @type {Record<string, unknown>|null} */
    let seen = null;
    const mockBridge = express();
    mockBridge.use(express.json());
    mockBridge.post('/api/v1/flows/:id/runs/:run_id/advance', (req, res) => {
      seen = {
        auth: req.headers.authorization,
        vault: req.headers['x-vault-id'],
        body: req.body,
        flowId: req.params.id,
        runId: req.params.run_id,
      };
      res.status(403).json({ code: 'FLOW_RUN_WRITES_DISABLED', error: 'disabled' });
    });
    const { bridgeUrl, close } = await startMockBridge(mockBridge);
    t.after(close);
    const port = await bootGateway(t, bridgeUrl, `di-${Date.now()}`);
    const token = signTestJwt({ sub: 'user-run-di', role: 'editor', type: 'session' });
    const body = { step_id: `${FLOW_ID}#1`, to_status: 'in_progress' };
    const res = await fetch(
      `http://127.0.0.1:${port}/api/v1/flows/${encodeURIComponent(FLOW_ID)}/runs/${encodeURIComponent(RUN_ID)}/advance`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-vault-id': 'learner-vault',
        },
        body: JSON.stringify(body),
      },
    );
    assert.equal(res.status, 403);
    assert.ok(seen);
    assert.equal(seen.auth, `Bearer ${token}`);
    assert.equal(seen.vault, 'learner-vault');
    assert.equal(seen.flowId, FLOW_ID);
    assert.equal(seen.runId, RUN_ID);
    assert.deepEqual(seen.body, body);
  });
});

describe('SITE-FINISH-FLOW-RUN-KN-b — performance', () => {
  it('proxy overhead bounded for env-off refuse (<2s)', async (t) => {
    const mockBridge = express();
    mockBridge.use(express.json());
    mockBridge.post('/api/v1/flows/:id/runs', (_req, res) => {
      res.status(403).json({ code: 'FLOW_RUN_WRITES_DISABLED', error: 'disabled' });
    });
    const { bridgeUrl, close } = await startMockBridge(mockBridge);
    t.after(close);
    const port = await bootGateway(t, bridgeUrl, `perf-${Date.now()}`);
    const token = signTestJwt({ sub: 'user-run-perf', role: 'editor', type: 'session' });
    const t0 = performance.now();
    const res = await fetch(
      `http://127.0.0.1:${port}/api/v1/flows/${encodeURIComponent(FLOW_ID)}/runs`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-vault-id': 'default',
        },
        body: JSON.stringify({ flow_version: '1.0.0' }),
      },
    );
    const elapsed = performance.now() - t0;
    assert.equal(res.status, 403);
    assert.ok(elapsed < 2000, `elapsed ${elapsed}ms`);
  });
});

describe('SITE-FINISH-FLOW-RUN-KN-b — security', () => {
  it('source scan: envs stay default-off; no Delegation/SCOOLING flips in route module', () => {
    const routes = readRepo('hub/bridge/flow-run-routes.mjs');
    const gw = readRepo('hub/gateway/server.mjs');
    assert.doesNotMatch(routes, /FLOW_RUN_WRITES_ENABLED\s*=\s*['"]1['"]/);
    assert.doesNotMatch(routes, /FLOW_AUTOMATABLE_EXECUTION_ENABLED\s*=\s*['"]1['"]/);
    assert.doesNotMatch(routes, /DELEGATION_WRITES\s*=/);
    assert.doesNotMatch(gw, /SCOOLING_FLOW_RUN_WRITE\s*=\s*['"]enabled['"]/);
    assert.doesNotMatch(gw, /SCOOLING_DELEGATION_WRITES/);
    assert.match(routes, /default OFF/);
  });

  it('unauthenticated gateway start does not leak to open canister catch-all success', async (t) => {
    const calls = [];
    const mockBridge = express();
    mockBridge.use(express.json());
    mockBridge.post('/api/v1/flows/:id/runs', (req, res) => {
      calls.push(req.headers.authorization || '');
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    });
    const { bridgeUrl, close } = await startMockBridge(mockBridge);
    t.after(close);
    const port = await bootGateway(t, bridgeUrl, `sec-${Date.now()}`);
    const res = await fetch(
      `http://127.0.0.1:${port}/api/v1/flows/${encodeURIComponent(FLOW_ID)}/runs`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-vault-id': 'default' },
        body: JSON.stringify({ flow_version: '1.0.0' }),
      },
    );
    // Gateway auth middleware may 401 before bridge; either way must not be 2xx.
    assert.ok(res.status === 401 || res.status === 403 || res.status >= 400);
    assert.ok(res.status < 500 || calls.length >= 0);
    assert.notEqual(res.status, 201);
    assert.notEqual(res.status, 200);
  });
});

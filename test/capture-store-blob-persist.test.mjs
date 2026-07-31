/**
 * CAPTURE-STORE-BLOB-PERSIST — seven-tier regression suite.
 *
 * Root cause (found live 2026-07-31, prop-1785500300353491755): the hosted
 * bridge capture routes (observe / candidates / propose / dismiss) wrote the
 * flow store only to the lambda's ephemeral DATA_DIR. A candidate created by
 * observe+propose evaporated when the warm lambda recycled, so the Hub-complete
 * apply at approve time refused with FLOW_CANDIDATE_NOT_PROMOTABLE and no Flow
 * was indexed even though the canister proposal was approved.
 *
 * These tiers boot the REAL registerBridgeFlowCaptureRoutes express app against
 * an in-memory Netlify-Blobs stand-in and simulate separate lambda instances as
 * separate DATA_DIRs sharing one blob store. Every tier fails against the
 * pre-fix routes (no blob hydrate/persist on observe/candidates/propose/dismiss).
 *
 * Tiers: unit, integration, e2e, stress, data-integrity, performance, security.
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { performance } from 'node:perf_hooks';

import express from 'express';

import { registerBridgeFlowCaptureRoutes } from '../hub/bridge/flow-capture-routes.mjs';
import {
  externalProtocolBlobKey,
  mergeFlowStoreJson,
} from '../hub/bridge/external-agent-blob-store.mjs';
import { FLOW_STORE_FILENAME } from '../lib/flow/flow-store.mjs';
import { validSessionMeta } from './fixtures/flow/capture-helpers.mjs';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-blob-persist-'));
const ACTOR = 'google:learner-persist';
const VAULT = 'default';
const FLOW_STORE_BLOB_KEY = externalProtocolBlobKey(FLOW_STORE_FILENAME);

/** In-memory Netlify-Blobs stand-in shared across simulated lambda instances. */
function fakeBlobStore(initial = {}) {
  const store = new Map(Object.entries(initial));
  const sets = [];
  return {
    store,
    sets,
    get: async (key) => (store.has(key) ? store.get(key) : null),
    set: async (key, value) => {
      sets.push(key);
      store.set(key, value);
    },
  };
}

/**
 * Mock canister: stores POSTed proposals, serves GETs, flips status on approve.
 * Mirrors the row shape parseCanisterProposalGetBody expects.
 */
function startMockCanister() {
  const rows = new Map();
  let seq = 0;
  const app = express();
  app.use(express.json());
  app.post('/api/v1/proposals', (req, res) => {
    seq += 1;
    const id = `prop-persist-${seq}`;
    rows.set(id, {
      proposal_id: id,
      status: 'proposed',
      path: req.body.path,
      body: req.body.body ?? '',
      intent: req.body.intent ?? '',
      frontmatter: req.body.frontmatter ?? {},
      base_state_id: req.body.base_state_id ?? '',
      vault_id: VAULT,
    });
    res.status(201).json({ proposal_id: id, path: req.body.path, status: 'proposed' });
  });
  app.get('/api/v1/proposals/:id', (req, res) => {
    const row = rows.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    res.json(row);
  });
  const srv = http.createServer(app);
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      resolve({
        rows,
        url: `http://127.0.0.1:${srv.address().port}`,
        close: () => new Promise((r) => srv.close(() => r())),
      });
    });
  });
}

/**
 * Boot ONE simulated lambda instance: real capture routes, own DATA_DIR,
 * shared blob store. Auth/context deps are stubbed (auth is not under test).
 */
function startInstance({ dataDir, blobStore, canisterUrl, role = 'admin' }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const app = express();
  app.use(express.json());
  registerBridgeFlowCaptureRoutes(app, {
    dataDir,
    canisterUrl,
    canisterHeaders: (extra = {}) => ({ ...extra }),
    requireBridgeAuth: (req, _res, next) => {
      req.uid = ACTOR;
      req.blobStore = blobStore;
      next();
    },
    resolveHostedBridgeContext: async (_req, actorUid) => ({
      ok: true,
      vaultId: VAULT,
      effectiveCanisterUid: actorUid,
      actorUid,
    }),
    effectiveRole: () => role,
    loadRoles: async () => ({}),
  });
  const srv = http.createServer(app);
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${srv.address().port}`,
        close: () => new Promise((r) => srv.close(() => r())),
      });
    });
  });
}

/** JSON helper against an instance. */
async function call(instance, method, route, body) {
  const res = await fetch(`${instance.url}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

/** Observe on an instance and return the created candidate_id. */
async function observeCandidate(instance, sessionId) {
  const r = await call(instance, 'POST', '/api/v1/flows/capture/observe', {
    ...validSessionMeta(sessionId ? { session_id: sessionId } : {}),
    harness: 'test',
  });
  assert.equal(r.status, 200, `observe failed: ${JSON.stringify(r.json)}`);
  assert.equal(r.json.detection_authorized, true);
  assert.ok(r.json.candidates.length >= 1, 'observe returned no candidates');
  return r.json.candidates[0].candidate_id;
}

let instanceSeq = 0;
/** Fresh DATA_DIR per simulated cold lambda. */
function freshDataDir() {
  instanceSeq += 1;
  return path.join(tmpRoot, `instance-${instanceSeq}`);
}

let canister;
before(async () => {
  process.env.FLOW_CAPTURE_DETECTION_ENABLED = '1';
  process.env.FLOW_CAPTURE_WRITES_ENABLED = '1';
  canister = await startMockCanister();
});
after(async () => {
  delete process.env.FLOW_CAPTURE_DETECTION_ENABLED;
  delete process.env.FLOW_CAPTURE_WRITES_ENABLED;
  await canister.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe('CAPTURE-STORE-BLOB-PERSIST — unit', () => {
  it('observe persists the flow store (with the candidate) to the blob store', async () => {
    const blob = fakeBlobStore();
    const a = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
    try {
      const candidateId = await observeCandidate(a);
      const raw = blob.store.get(FLOW_STORE_BLOB_KEY);
      assert.ok(typeof raw === 'string' && raw.includes(candidateId),
        'flow store blob missing the observed candidate (pre-fix regression)');
    } finally {
      await a.close();
    }
  });

  it('candidates list hydrates from blob on a cold instance', async () => {
    const blob = fakeBlobStore();
    const a = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
    let candidateId;
    try {
      candidateId = await observeCandidate(a);
    } finally {
      await a.close();
    }
    const b = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
    try {
      const r = await call(b, 'GET', '/api/v1/flows/candidates');
      assert.equal(r.status, 200);
      const ids = (r.json.candidates || []).map((c) => c.candidate_id);
      assert.ok(ids.includes(candidateId),
        'cold instance did not hydrate candidates from blob (pre-fix regression)');
    } finally {
      await b.close();
    }
  });
});

describe('CAPTURE-STORE-BLOB-PERSIST — unit (warm-lambda stale merge)', () => {
  // Live failure 2026-07-31 (prop-1785526040570098296): a WARM lambda whose
  // local store predated the candidate hydrated the blob, but the merge let the
  // stale local candidates array mask the blob's — apply refused
  // FLOW_CANDIDATE_NOT_PROMOTABLE while a cold-lambda retry succeeded.
  it('blob-only candidates/flows survive a merge against a stale local store', () => {
    const staleLocal = JSON.stringify({
      vaults: {
        [VAULT]: { flows: [], steps: [], runs: [], candidates: [], tasks: [], task_loops: [] },
      },
    });
    const blob = JSON.stringify({
      vaults: {
        [VAULT]: {
          candidates: [
            { candidate_id: 'cand_blob_only', status: 'pending_review', updated: '2026-07-31T19:00:00Z' },
          ],
          flows: [
            { flow_id: 'flow_blob_only', version: '0.1.0', updated: '2026-07-31T19:00:00Z' },
          ],
          steps: [
            { step_id: 'step_1', flow_id: 'flow_blob_only', flow_version: '0.1.0' },
          ],
          runs: [{ run_id: 'run_blob_only' }],
          tasks: [],
          task_loops: [],
        },
      },
    });
    const merged = JSON.parse(mergeFlowStoreJson(staleLocal, blob));
    const vault = merged.vaults[VAULT];
    assert.equal(vault.candidates.length, 1, 'stale local candidates masked blob candidate');
    assert.equal(vault.candidates[0].candidate_id, 'cand_blob_only');
    assert.equal(vault.flows.length, 1, 'stale local flows masked blob flow');
    assert.equal(vault.steps.length, 1, 'stale local steps masked blob step');
    assert.equal(vault.runs.length, 1, 'stale local runs masked blob run');
  });

  it('newer record wins on key collision; distinct flow versions both survive', () => {
    const local = JSON.stringify({
      vaults: {
        [VAULT]: {
          candidates: [
            { candidate_id: 'cand_x', status: 'promoted', updated: '2026-07-31T20:00:00Z' },
          ],
          flows: [{ flow_id: 'flow_x', version: '0.2.0', updated: '2026-07-31T20:00:00Z' }],
        },
      },
    });
    const blob = JSON.stringify({
      vaults: {
        [VAULT]: {
          candidates: [
            { candidate_id: 'cand_x', status: 'pending_review', updated: '2026-07-31T19:00:00Z' },
          ],
          flows: [{ flow_id: 'flow_x', version: '0.1.0', updated: '2026-07-31T19:00:00Z' }],
        },
      },
    });
    const merged = JSON.parse(mergeFlowStoreJson(local, blob));
    const vault = merged.vaults[VAULT];
    assert.equal(vault.candidates.length, 1);
    assert.equal(vault.candidates[0].status, 'promoted', 'older blob record overwrote newer local');
    assert.equal(vault.flows.length, 2, 'distinct flow versions collapsed');
  });
});

describe('CAPTURE-STORE-BLOB-PERSIST — integration', () => {
  it('propose on a cold instance finds the blob-persisted candidate and persists its state change', async () => {
    const blob = fakeBlobStore();
    const a = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
    let candidateId;
    try {
      candidateId = await observeCandidate(a);
    } finally {
      await a.close();
    }

    const b = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
    try {
      const r = await call(b, 'POST', `/api/v1/flows/candidates/${candidateId}/propose`, {
        confirmed_scope: 'personal',
        intent: 'promote across lambda instances',
      });
      assert.equal(r.status, 201, `propose failed: ${JSON.stringify(r.json)}`);
      assert.equal(r.json.candidate_id, candidateId);
      // Propose keeps the candidate pending_review in the flow store (the
      // pending-proposal guard reads the proposals store — canister-side when
      // hosted). The regression property is that the candidate must still be
      // present and promotable in the shared blob after the cold-instance call.
      const parsed = JSON.parse(blob.store.get(FLOW_STORE_BLOB_KEY));
      const rec = parsed.vaults[VAULT].candidates.find((c) => c.candidate_id === candidateId);
      assert.ok(rec, 'candidate lost from blob after cold-instance propose');
      assert.equal(rec.status, 'pending_review');
    } finally {
      await b.close();
    }
  });

  it('dismiss on a cold instance finds the blob-persisted candidate', async () => {
    const blob = fakeBlobStore();
    const a = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
    let candidateId;
    try {
      candidateId = await observeCandidate(a, 'd'.repeat(64));
    } finally {
      await a.close();
    }
    const b = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
    try {
      const r = await call(b, 'POST', `/api/v1/flows/candidates/${candidateId}/dismiss`, {
        intent: 'dismiss across lambda instances',
      });
      assert.equal(r.status, 201, `dismiss failed: ${JSON.stringify(r.json)}`);
    } finally {
      await b.close();
    }
  });
});

describe('CAPTURE-STORE-BLOB-PERSIST — e2e', () => {
  it('observe→propose→approve→apply-approved across four cold instances yields a listed Flow', async () => {
    const blob = fakeBlobStore();

    // Instance A: observe.
    const a = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
    let candidateId;
    try {
      candidateId = await observeCandidate(a, 'e'.repeat(64));
    } finally {
      await a.close();
    }

    // Instance B: propose (creates canister proposal).
    const b = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
    let proposalId;
    try {
      const r = await call(b, 'POST', `/api/v1/flows/candidates/${candidateId}/propose`, {
        confirmed_scope: 'personal',
        intent: 'e2e promote',
      });
      assert.equal(r.status, 201, `propose failed: ${JSON.stringify(r.json)}`);
      proposalId = r.json.proposal_id;
    } finally {
      await b.close();
    }

    // Approve on the (durable) canister — the operator's Hub click.
    canister.rows.get(proposalId).status = 'approved';

    // Instance C: Hub-complete apply (this exact call failed live pre-fix).
    const c = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
    let flowId;
    try {
      const r = await call(c, 'POST', `/api/v1/flows/capture/proposals/${proposalId}/apply-approved`, {});
      assert.equal(r.status, 200,
        `apply-approved refused (${r.json.code}) — live bug regression`);
      assert.equal(r.json.proposal_kind, 'flow_candidate_promote');
      flowId = r.json.flow_id;
      assert.ok(flowId, 'apply payload missing flow_id');
    } finally {
      await c.close();
    }

    // Instance D: the promoted Flow is observable (CHA-C5).
    const d = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
    try {
      const list = await call(d, 'GET', '/api/v1/flows');
      assert.equal(list.status, 200);
      const ids = (list.json.flows || []).map((f) => f.flow_id || f.id);
      assert.ok(ids.includes(flowId), 'promoted flow not listed on cold instance');
      const one = await call(d, 'GET', `/api/v1/flows/${flowId}`);
      assert.equal(one.status, 200);
    } finally {
      await d.close();
    }
  });
});

describe('CAPTURE-STORE-BLOB-PERSIST — e2e (warm stale lambda)', () => {
  it('apply-approved on a WARM instance with a stale local store still finds the blob candidate', async () => {
    const blob = fakeBlobStore();

    // Instance A: observe + propose (candidate + proposal in blob/canister).
    const a = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
    let candidateId;
    let proposalId;
    try {
      candidateId = await observeCandidate(a, '7'.repeat(64));
      const r = await call(a, 'POST', `/api/v1/flows/candidates/${candidateId}/propose`, {
        confirmed_scope: 'personal',
        intent: 'warm stale lambda regression',
      });
      assert.equal(r.status, 201, `propose failed: ${JSON.stringify(r.json)}`);
      proposalId = r.json.proposal_id;
    } finally {
      await a.close();
    }
    canister.rows.get(proposalId).status = 'approved';

    // Instance B: WARM — its local DATA_DIR already holds a stale flow store
    // (vault exists, candidate absent), exactly the live 2026-07-31 failure.
    const staleDir = freshDataDir();
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(
      path.join(staleDir, FLOW_STORE_FILENAME),
      JSON.stringify({
        vaults: {
          [VAULT]: { flows: [], steps: [], runs: [], candidates: [], projections: [], tasks: [], task_loops: [] },
        },
      }),
      'utf8',
    );
    const b = await startInstance({ dataDir: staleDir, blobStore: blob, canisterUrl: canister.url });
    try {
      const r = await call(b, 'POST', `/api/v1/flows/capture/proposals/${proposalId}/apply-approved`, {});
      assert.equal(r.status, 200,
        `warm stale lambda refused apply (${r.json.code}) — live 2026-07-31 regression`);
      assert.ok(r.json.flow_id, 'apply payload missing flow_id');
    } finally {
      await b.close();
    }
  });
});

describe('CAPTURE-STORE-BLOB-PERSIST — stress', () => {
  it('12 candidates across alternating instances all survive', async () => {
    const blob = fakeBlobStore();
    const created = [];
    for (let i = 0; i < 12; i += 1) {
      const inst = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
      try {
        created.push(await observeCandidate(inst, String(i % 10).repeat(64)));
      } finally {
        await inst.close();
      }
    }
    const reader = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
    try {
      const r = await call(reader, 'GET', '/api/v1/flows/candidates?limit=50');
      assert.equal(r.status, 200);
      const ids = new Set((r.json.candidates || []).map((c) => c.candidate_id));
      for (const id of created) {
        assert.ok(ids.has(id), `candidate ${id} lost across instances`);
      }
    } finally {
      await reader.close();
    }
  });
});

describe('CAPTURE-STORE-BLOB-PERSIST — data-integrity', () => {
  it('blob flow store stays valid JSON and candidate fields survive the round-trip intact', async () => {
    const blob = fakeBlobStore();
    const a = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
    let candidateId;
    try {
      candidateId = await observeCandidate(a, 'f'.repeat(64));
    } finally {
      await a.close();
    }

    const raw = blob.store.get(FLOW_STORE_BLOB_KEY);
    const parsed = JSON.parse(raw);
    const rec = parsed.vaults[VAULT].candidates.find((c) => c.candidate_id === candidateId);
    assert.ok(rec, 'candidate record absent from blob JSON');
    assert.equal(rec.status, 'pending_review');
    assert.equal(rec.schema, 'knowtation.flow_candidate/v0');
    assert.ok(Array.isArray(rec.draft_steps) && rec.draft_steps.length > 0);

    const b = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
    try {
      const r = await call(b, 'GET', '/api/v1/flows/candidates');
      const back = (r.json.candidates || []).find((c) => c.candidate_id === candidateId);
      assert.ok(back, 'candidate missing after hydration');
      assert.equal(back.status, 'pending_review');
    } finally {
      await b.close();
    }
  });

  it('does not clobber unrelated vault state already in the blob (merge, not overwrite)', async () => {
    const seeded = {
      version: 1,
      vaults: {
        other_vault: { flows: [], candidates: [], tasks: [{ task_id: 't-keep', updated: '2026-07-30T00:00:00Z' }] },
      },
    };
    const blob = fakeBlobStore({ [FLOW_STORE_BLOB_KEY]: JSON.stringify(seeded) });
    const a = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
    try {
      await observeCandidate(a, 'a'.repeat(64));
    } finally {
      await a.close();
    }
    const parsed = JSON.parse(blob.store.get(FLOW_STORE_BLOB_KEY));
    assert.ok(parsed.vaults.other_vault, 'unrelated vault dropped from blob');
    assert.equal(parsed.vaults.other_vault.tasks[0].task_id, 't-keep');
  });
});

describe('CAPTURE-STORE-BLOB-PERSIST — performance', () => {
  it('observe with blob sync stays under 250ms p95 (in-memory blob)', async () => {
    const blob = fakeBlobStore();
    const inst = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
    try {
      const samples = [];
      for (let i = 0; i < 20; i += 1) {
        const t0 = performance.now();
        await call(inst, 'POST', '/api/v1/flows/capture/observe', {
          ...validSessionMeta({ session_id: String(i % 10).repeat(64) }),
          harness: 'test',
        });
        samples.push(performance.now() - t0);
      }
      samples.sort((x, y) => x - y);
      const p95 = samples[Math.floor(samples.length * 0.95) - 1] ?? samples[samples.length - 1];
      assert.ok(p95 < 250, `observe p95=${p95.toFixed(1)}ms exceeds 250ms budget`);
    } finally {
      await inst.close();
    }
  });
});

describe('CAPTURE-STORE-BLOB-PERSIST — security', () => {
  it('refused propose (wrong scope) does not mutate the blob store', async () => {
    const blob = fakeBlobStore();
    const a = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
    let candidateId;
    try {
      candidateId = await observeCandidate(a, '9'.repeat(64));
    } finally {
      await a.close();
    }
    const before = blob.store.get(FLOW_STORE_BLOB_KEY);

    const b = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
    try {
      const r = await call(b, 'POST', `/api/v1/flows/candidates/${candidateId}/propose`, {
        confirmed_scope: 'org',
        intent: 'scope widen without ack must refuse',
      });
      assert.ok(r.status >= 400, `expected refusal, got ${r.status}`);
      assert.equal(blob.store.get(FLOW_STORE_BLOB_KEY), before,
        'refused propose mutated the persisted store');
    } finally {
      await b.close();
    }
  });

  it('persisted blob carries no raw session content (content-minimized candidates only)', async () => {
    const blob = fakeBlobStore();
    const a = await startInstance({ dataDir: freshDataDir(), blobStore: blob, canisterUrl: canister.url });
    try {
      const r = await call(a, 'POST', '/api/v1/flows/capture/observe', {
        ...validSessionMeta({ session_id: '8'.repeat(64) }),
        prompt: 'RAW PROMPT MUST NOT PERSIST',
        completion: 'RAW COMPLETION MUST NOT PERSIST',
        harness: 'test',
      });
      // Payload-bearing meta is refused by the handler; if a variant were accepted,
      // the persisted blob still must not carry raw content.
      const raw = blob.store.get(FLOW_STORE_BLOB_KEY) || '';
      assert.ok(!raw.includes('RAW PROMPT MUST NOT PERSIST'), 'raw prompt leaked into blob');
      assert.ok(!raw.includes('RAW COMPLETION MUST NOT PERSIST'), 'raw completion leaked into blob');
      assert.ok(r.status === 200 || r.status === 400);
    } finally {
      await a.close();
    }
  });
});

/**
 * CAPTURE-HOSTED-APPLY-KN-b — seven-tier coverage (§CHA.4 matrix).
 * Frozen: docs/CAPTURE-HOSTED-APPLY-FREEZE.md (CHA-C1–C11).
 *
 * Tiers: unit · integration · e2e · stress · data-integrity · performance · security
 *
 * Proves: gateway post-approve capture hook + response merge (CHA-C1); bridge
 * apply-approved via shared precheck/apply (CHA-C2/C3/C10); hosted GET flows
 * list/get exposure after promote (CHA-C5); T5 stays refuse-all (CHA-C4);
 * fail-closed 409/400 gates (CHA-C8); approve-then-apply honesty (CHA-C11).
 */

import fs from 'node:fs';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  maybeApplyHostedCaptureAfterApprove,
  mergeCaptureApplyIntoApproveResponse,
} from '../hub/gateway/capture-approve-hosted.mjs';
import { applyApprovedCaptureProposalFromCanister } from '../lib/flow/flow-capture-hosted-apply.mjs';
import {
  FLOW_CAPTURE_PROPOSAL_SOURCE,
  handleFlowCaptureProposeRequest,
} from '../lib/flow/flow-capture.mjs';
import {
  FM_PROPOSAL_SOURCE,
  FM_CAPTURE_PROPOSAL_KIND,
  FM_CAPTURE_CANDIDATE_ID,
} from '../lib/flow/flow-capture-hosted-proposal.mjs';
import { handleFlowListRequest, handleFlowGetRequest } from '../lib/flow/flow-handlers.mjs';
import {
  upsertCandidate,
  getCandidate,
  getFlow,
  loadFlowStore,
  FLOW_STORE_FILENAME,
} from '../lib/flow/flow-store.mjs';
import {
  withExternalProtocolBlobSync,
  externalProtocolBlobKey,
} from '../hub/bridge/external-agent-blob-store.mjs';
import {
  personalSelfApplyRefusalReason,
  isAdmittedSeamSelfApplyFingerprint,
} from '../lib/hub-proposal-personal-self-apply.mjs';
import { createProposal, getProposal } from '../hub/proposals-store.mjs';
import { makeCandidateRecord, emptyStarterDir } from './fixtures/flow/capture-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-capture-hosted-apply-kn-b');

const SECRET = 'capture-hosted-apply-kn-b-secret-32!!';
const ACTOR = 'google:learner-cap';
const visible = new Set(['personal', 'project', 'org']);

/** Sign an HS256 JWT for gateway auth in live-server tiers. */
function signTestJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

/** Start an HTTP server on an ephemeral port; returns { url, close }. */
function startServer(handler) {
  const srv = http.createServer(handler);
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

/**
 * Mock canister serving GET /api/v1/proposals/:id from a Map and 200 on approve.
 * @param {Map<string, Record<string, unknown>>} rows
 */
function mockCanisterApp(rows) {
  const app = express();
  app.use(express.json());
  app.post('/api/v1/proposals/:id/approve', (req, res) => {
    const row = rows.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    row.status = 'approved';
    res.json({ proposal_id: req.params.id, status: 'approved' });
  });
  app.get('/api/v1/proposals/:id', (req, res) => {
    const row = rows.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    res.json(row);
  });
  return app;
}

/** In-memory Netlify-Blobs stand-in recording set() keys. */
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
 * Seed a pending candidate + real promote proposal body through the shared
 * propose handler, then shape it as the canister GET row for apply.
 * Requires FLOW_CAPTURE_WRITES_ENABLED=1.
 */
async function seedPromoteRow(dataDir, starterDir, candidateId, { status = 'approved', proposalId } = {}) {
  upsertCandidate(
    dataDir,
    'default',
    makeCandidateRecord({ candidate_id: candidateId, status: 'pending_review' }),
  );
  const proposed = await handleFlowCaptureProposeRequest({
    dataDir,
    vaultId: 'default',
    visibleScopes: visible,
    candidateId,
    confirmedScope: 'personal',
    intent: 'promote for hosted apply',
    createProposal,
    starterDir,
    userId: ACTOR,
  });
  assert.equal(proposed.ok, true, `seed propose failed: ${proposed.code}`);
  const stored = getProposal(dataDir, proposed.payload.proposal_id);
  return {
    ...stored,
    proposal_id: proposalId ?? stored.proposal_id,
    status,
  };
}

/** Canister row for a dismiss proposal (no bundle needed by precheck). */
function dismissRow(proposalId, candidateId, status = 'approved') {
  return {
    proposal_id: proposalId,
    status,
    path: `meta/candidates/${candidateId}.md`,
    body: JSON.stringify({ proposal_kind: 'flow_candidate_dismiss', candidate_id: candidateId }),
    frontmatter: {
      [FM_PROPOSAL_SOURCE]: FLOW_CAPTURE_PROPOSAL_SOURCE,
      type: 'flow_capture',
      [FM_CAPTURE_PROPOSAL_KIND]: 'flow_candidate_dismiss',
      [FM_CAPTURE_CANDIDATE_ID]: candidateId,
    },
    vault_id: 'default',
  };
}

/** Non-capture canister row (plain note proposal). */
function noteRow(proposalId, status = 'approved') {
  return {
    proposal_id: proposalId,
    status,
    path: 'notes/plain.md',
    body: 'plain note body',
    frontmatter: { type: 'note' },
    vault_id: 'default',
  };
}

/** Eligibility scaffold for personalSelfApplyRefusalReason (T5 regression). */
function eligible(proposal, extra = {}) {
  return {
    proposal,
    hasVaultWrite: true,
    partitionOwned: true,
    role: 'member',
    humanActor: true,
    tokenType: null,
    actorKind: 'human',
    sessionBound: true,
    authorActorId: ACTOR,
    approverActorId: ACTOR,
    ...extra,
  };
}

function readRepo(rel) {
  return fs.readFileSync(path.join(projectRoot, rel), 'utf8');
}

/** Boot the real gateway Express app against mock canister + bridge URLs. */
async function bootGateway(t, { canisterUrl, bridgeUrl, adminSub, cacheBust }) {
  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = canisterUrl;
  process.env.SESSION_SECRET = SECRET;
  process.env.BRIDGE_URL = bridgeUrl;
  process.env.HUB_ADMIN_USER_IDS = adminSub;
  t.after(() => {
    delete process.env.HUB_ADMIN_USER_IDS;
  });

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gwcapapply=${cacheBust}`);
  const gwSrv = http.createServer(gwApp);
  await new Promise((resolve, reject) => {
    gwSrv.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => gwSrv.close(() => r())));
  return gwSrv.address().port;
}

/** Mock bridge for e2e: admin role, no hosted-context, records apply calls. */
function mockBridgeApp(applyCalls, applyResponse) {
  const app = express();
  app.use(express.json());
  app.get('/api/v1/role', (_req, res) => {
    res.json({ role: 'admin', may_approve_proposals: true });
  });
  app.get('/api/v1/hosted-context', (_req, res) => {
    res.status(404).json({ error: 'not hosted', code: 'NOT_FOUND' });
  });
  app.post('/api/v1/flows/capture/proposals/:proposal_id/apply-approved', (req, res) => {
    applyCalls.push({
      proposalId: req.params.proposal_id,
      auth: req.headers.authorization,
      vault: req.headers['x-vault-id'],
    });
    res.json({ applied: true, ...applyResponse, proposal_id: req.params.proposal_id });
  });
  return app;
}

// ---------------------------------------------------------------------------

describe('CAPTURE-HOSTED-APPLY-KN-b — unit', () => {
  const dataDir = path.join(tmpRoot, 'unit');
  let starterDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    starterDir = emptyStarterDir(dataDir);
    process.env.FLOW_CAPTURE_WRITES_ENABLED = '1';
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_CAPTURE_WRITES_ENABLED;
  });

  it('mergeCaptureApplyIntoApproveResponse merges success / failure / null', () => {
    const base = JSON.stringify({ proposal_id: 'p1', status: 'approved' });

    assert.equal(mergeCaptureApplyIntoApproveResponse(base, null), base);

    const ok = JSON.parse(
      mergeCaptureApplyIntoApproveResponse(base, {
        applied: true,
        payload: { applied: true, proposal_id: 'p1', proposal_kind: 'flow_candidate_promote', flow_id: 'flow_cap_x' },
      }),
    );
    assert.equal(ok.capture_index_applied, true);
    assert.equal(ok.capture_apply.flow_id, 'flow_cap_x');
    assert.equal(ok.capture_apply_error, undefined);

    const fail = JSON.parse(
      mergeCaptureApplyIntoApproveResponse(base, {
        applied: false,
        error: 'Candidate not promotable at approve time',
        code: 'FLOW_CANDIDATE_NOT_PROMOTABLE',
      }),
    );
    assert.equal(fail.capture_index_applied, false);
    assert.equal(fail.capture_apply_code, 'FLOW_CANDIDATE_NOT_PROMOTABLE');
    assert.equal(fail.capture_apply, undefined);

    // Non-JSON upstream body passes through untouched.
    assert.equal(
      mergeCaptureApplyIntoApproveResponse('not-json', { applied: true, payload: {} }),
      'not-json',
    );
  });

  it('hook returns null for non-approve paths and non-2xx approve', async () => {
    const ctxBase = {
      method: 'POST',
      pathOnly: '/api/v1/proposals/p1/approve',
      upstreamStatus: 200,
      canisterUrl: 'http://127.0.0.1:1',
      bridgeUrl: 'http://127.0.0.1:1',
      authorization: undefined,
      vaultId: 'default',
      effectiveUserId: 'u',
      actorUserId: 'u',
      canisterAuthHeaders: () => ({}),
    };
    assert.equal(await maybeApplyHostedCaptureAfterApprove({ ...ctxBase, method: 'GET' }), null);
    assert.equal(
      await maybeApplyHostedCaptureAfterApprove({
        ...ctxBase,
        pathOnly: '/api/v1/proposals/p1/discard',
      }),
      null,
    );
    assert.equal(
      await maybeApplyHostedCaptureAfterApprove({ ...ctxBase, upstreamStatus: 403 }),
      null,
    );
    assert.equal(await maybeApplyHostedCaptureAfterApprove({ ...ctxBase, bridgeUrl: '' }), null);
  });

  it('apply helper refuses non-capture (400) and non-approved (409); promote payload includes flow_id', async (t) => {
    const rows = new Map();
    rows.set('prop-note', noteRow('prop-note'));
    rows.set('prop-dis-pending', dismissRow('prop-dis-pending', 'cand_unit01', 'proposed'));
    const promoteRow = await seedPromoteRow(dataDir, starterDir, 'cand_unit02', {
      proposalId: 'prop-promote-unit',
    });
    rows.set('prop-promote-unit', promoteRow);

    const { url: canisterUrl, close } = await startServer(mockCanisterApp(rows));
    t.after(close);

    const nonCapture = await applyApprovedCaptureProposalFromCanister({
      dataDir,
      canisterUrl,
      headers: {},
      proposalId: 'prop-note',
    });
    assert.equal(nonCapture.ok, false);
    assert.equal(nonCapture.status, 400);
    assert.equal(nonCapture.code, 'BAD_REQUEST');

    const notApproved = await applyApprovedCaptureProposalFromCanister({
      dataDir,
      canisterUrl,
      headers: {},
      proposalId: 'prop-dis-pending',
    });
    assert.equal(notApproved.ok, false);
    assert.equal(notApproved.status, 409);
    assert.equal(notApproved.code, 'CONFLICT');

    const promoted = await applyApprovedCaptureProposalFromCanister({
      dataDir,
      canisterUrl,
      headers: {},
      proposalId: 'prop-promote-unit',
    });
    assert.equal(promoted.ok, true, JSON.stringify(promoted));
    assert.equal(promoted.payload.applied, true);
    assert.equal(promoted.payload.proposal_kind, 'flow_candidate_promote');
    assert.equal(promoted.payload.flow_id, 'flow_cap_unit02');
    assert.equal(promoted.payload.apply_result, 'promote');
  });
});

describe('CAPTURE-HOSTED-APPLY-KN-b — integration', () => {
  const dataDir = path.join(tmpRoot, 'int');
  let starterDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    starterDir = emptyStarterDir(dataDir);
    process.env.FLOW_CAPTURE_WRITES_ENABLED = '1';
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_CAPTURE_WRITES_ENABLED;
  });

  it('apply-approved → upsertFlowVersion visible via list/get; blob persisted', async (t) => {
    const rows = new Map();
    rows.set(
      'prop-int-promote',
      await seedPromoteRow(dataDir, starterDir, 'cand_int01', { proposalId: 'prop-int-promote' }),
    );
    const { url: canisterUrl, close } = await startServer(mockCanisterApp(rows));
    t.after(close);

    const blobStore = fakeBlobStore();
    const result = await withExternalProtocolBlobSync({
      blobStore,
      dataDir,
      run: () =>
        applyApprovedCaptureProposalFromCanister({
          dataDir,
          canisterUrl,
          headers: {},
          proposalId: 'prop-int-promote',
          requireApproved: true,
        }),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.payload.flow_id, 'flow_cap_int01');

    // CHA-C5: promote is observable through the same handlers the bridge mounts.
    const list = handleFlowListRequest({
      dataDir,
      vaultId: 'default',
      visibleScopes: visible,
    });
    assert.equal(list.ok, true);
    assert.ok(
      list.payload.flows.some((f) => f.flow_id === 'flow_cap_int01'),
      'promoted flow must appear in list',
    );
    const got = handleFlowGetRequest({
      dataDir,
      vaultId: 'default',
      flowId: 'flow_cap_int01',
      visibleScopes: visible,
    });
    assert.equal(got.ok, true);
    assert.equal(got.payload.flow.flow_id, 'flow_cap_int01');

    // Candidate terminal state + blob persist of hub_flow_store.json.
    assert.equal(getCandidate(dataDir, 'default', 'cand_int01', visible).status, 'promoted');
    assert.ok(
      blobStore.sets.includes(externalProtocolBlobKey(FLOW_STORE_FILENAME)),
      'hub_flow_store.json must be persisted to blob after apply',
    );
  });

  it('cold lambda: candidate only in blob → hydrate before precheck (CHA-C3)', async (t) => {
    // Build a flow store containing the pending candidate + real proposal in a warm dir.
    const warmDir = path.join(tmpRoot, 'int-warm');
    fs.mkdirSync(warmDir, { recursive: true });
    const warmStarter = emptyStarterDir(warmDir);
    const row = await seedPromoteRow(warmDir, warmStarter, 'cand_cold01', {
      proposalId: 'prop-cold-promote',
    });
    const warmStoreRaw = fs.readFileSync(path.join(warmDir, FLOW_STORE_FILENAME), 'utf8');

    const rows = new Map([['prop-cold-promote', row]]);
    const { url: canisterUrl, close } = await startServer(mockCanisterApp(rows));
    t.after(close);

    // Cold dir: no local store file — only the blob has the candidate.
    const coldDir = path.join(tmpRoot, 'int-cold');
    fs.mkdirSync(coldDir, { recursive: true });
    const blobStore = fakeBlobStore({
      [externalProtocolBlobKey(FLOW_STORE_FILENAME)]: warmStoreRaw,
    });

    const result = await withExternalProtocolBlobSync({
      blobStore,
      dataDir: coldDir,
      run: () =>
        applyApprovedCaptureProposalFromCanister({
          dataDir: coldDir,
          canisterUrl,
          headers: {},
          proposalId: 'prop-cold-promote',
          requireApproved: true,
        }),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.payload.flow_id, 'flow_cap_cold01');
    assert.equal(getCandidate(coldDir, 'default', 'cand_cold01', visible).status, 'promoted');
  });
});

describe('CAPTURE-HOSTED-APPLY-KN-b — e2e', () => {
  const dataDir = path.join(tmpRoot, 'e2e');
  let starterDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    starterDir = emptyStarterDir(dataDir);
    process.env.FLOW_CAPTURE_WRITES_ENABLED = '1';
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_CAPTURE_WRITES_ENABLED;
  });

  it('admin approve of capture proposal → capture_index_applied true; bridge apply invoked', async (t) => {
    const rows = new Map();
    rows.set(
      'prop-e2e-cap',
      await seedPromoteRow(dataDir, starterDir, 'cand_e2e01', {
        proposalId: 'prop-e2e-cap',
        status: 'proposed',
      }),
    );
    const { url: canisterUrl, close: closeCanister } = await startServer(mockCanisterApp(rows));
    t.after(closeCanister);

    const applyCalls = [];
    const { url: bridgeUrl, close: closeBridge } = await startServer(
      mockBridgeApp(applyCalls, {
        proposal_kind: 'flow_candidate_promote',
        flow_id: 'flow_cap_e2e01',
        vault_id: 'default',
      }),
    );
    t.after(closeBridge);

    const adminSub = 'google:cap-admin';
    const port = await bootGateway(t, {
      canisterUrl,
      bridgeUrl,
      adminSub,
      cacheBust: `e2e-${Date.now()}`,
    });
    const token = signTestJwt({ sub: adminSub });
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/proposals/prop-e2e-cap/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Vault-Id': 'default',
      },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200, await res.clone().text());
    const json = await res.json();
    assert.equal(json.status, 'approved');
    assert.equal(json.capture_index_applied, true);
    assert.equal(json.capture_apply.flow_id, 'flow_cap_e2e01');
    assert.equal(applyCalls.length, 1);
    assert.equal(applyCalls[0].proposalId, 'prop-e2e-cap');
    assert.match(applyCalls[0].auth, /^Bearer /);
    assert.equal(applyCalls[0].vault, 'default');
  });

  it('non-capture approve → no capture fields; bridge apply not invoked', async (t) => {
    const rows = new Map();
    rows.set('prop-e2e-note', noteRow('prop-e2e-note', 'proposed'));
    const { url: canisterUrl, close: closeCanister } = await startServer(mockCanisterApp(rows));
    t.after(closeCanister);

    const applyCalls = [];
    const { url: bridgeUrl, close: closeBridge } = await startServer(
      mockBridgeApp(applyCalls, {}),
    );
    t.after(closeBridge);

    const adminSub = 'google:cap-admin2';
    const port = await bootGateway(t, {
      canisterUrl,
      bridgeUrl,
      adminSub,
      cacheBust: `e2e2-${Date.now()}`,
    });
    const token = signTestJwt({ sub: adminSub });
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/proposals/prop-e2e-note/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Vault-Id': 'default',
      },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200, await res.clone().text());
    const json = await res.json();
    assert.equal(json.capture_index_applied, undefined);
    assert.equal(json.capture_apply, undefined);
    assert.equal(json.capture_apply_error, undefined);
    assert.equal(applyCalls.length, 0);
  });
});

describe('CAPTURE-HOSTED-APPLY-KN-b — stress', () => {
  const dataDir = path.join(tmpRoot, 'stress');
  let starterDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    starterDir = emptyStarterDir(dataDir);
    process.env.FLOW_CAPTURE_WRITES_ENABLED = '1';
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_CAPTURE_WRITES_ENABLED;
  });

  it('50 sequential apply-approved calls; last promote still gettable', async (t) => {
    const N = 50;
    const rows = new Map();
    // Seed all proposals before any apply so the dedup scan sees no flows yet.
    for (let i = 0; i < N; i++) {
      const candidateId = `cand_st${String(i).padStart(3, '0')}`;
      rows.set(
        `prop-st-${i}`,
        await seedPromoteRow(dataDir, starterDir, candidateId, { proposalId: `prop-st-${i}` }),
      );
    }
    const { url: canisterUrl, close } = await startServer(mockCanisterApp(rows));
    t.after(close);

    for (let i = 0; i < N; i++) {
      const result = await applyApprovedCaptureProposalFromCanister({
        dataDir,
        canisterUrl,
        headers: {},
        proposalId: `prop-st-${i}`,
        requireApproved: true,
      });
      assert.equal(result.ok, true, `apply ${i} failed: ${JSON.stringify(result)}`);
    }

    const lastId = `flow_cap_st${String(N - 1).padStart(3, '0')}`;
    const last = getFlow(dataDir, 'default', lastId, { filterScopes: visible });
    assert.ok(last, 'last promoted flow must exist');
    assert.equal(
      getCandidate(dataDir, 'default', `cand_st${String(N - 1).padStart(3, '0')}`, visible).status,
      'promoted',
    );
  });
});

describe('CAPTURE-HOSTED-APPLY-KN-b — data-integrity', () => {
  const dataDir = path.join(tmpRoot, 'di');
  let starterDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    starterDir = emptyStarterDir(dataDir);
    process.env.FLOW_CAPTURE_WRITES_ENABLED = '1';
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_CAPTURE_WRITES_ENABLED;
  });

  it('second apply after promote fails closed; no duplicate flow versions', async (t) => {
    const rows = new Map();
    rows.set(
      'prop-di-promote',
      await seedPromoteRow(dataDir, starterDir, 'cand_di01', { proposalId: 'prop-di-promote' }),
    );
    const { url: canisterUrl, close } = await startServer(mockCanisterApp(rows));
    t.after(close);

    const first = await applyApprovedCaptureProposalFromCanister({
      dataDir,
      canisterUrl,
      headers: {},
      proposalId: 'prop-di-promote',
    });
    assert.equal(first.ok, true, JSON.stringify(first));

    // Candidate is now `promoted` — the shared precheck refuses re-apply (CHA-C11
    // ops recovery only works while store state is applicable).
    const second = await applyApprovedCaptureProposalFromCanister({
      dataDir,
      canisterUrl,
      headers: {},
      proposalId: 'prop-di-promote',
    });
    assert.equal(second.ok, false);
    assert.equal(second.status, 409);
    assert.equal(second.code, 'FLOW_CANDIDATE_NOT_PROMOTABLE');

    const flow = getFlow(dataDir, 'default', 'flow_cap_di01', { filterScopes: visible });
    assert.ok(flow);
    const store = loadFlowStore(dataDir);
    const versions = store.vaults.default.flows.filter((f) => f.flow_id === 'flow_cap_di01');
    assert.equal(versions.length, 1, 'no duplicate flow versions');
    assert.equal(versions[0].version, '1.0.0');
  });

  it('merge and dismiss terminal candidate statuses stick', async (t) => {
    const rows = new Map();
    // Promote target first so merge has an existing flow.
    rows.set(
      'prop-di-target',
      await seedPromoteRow(dataDir, starterDir, 'cand_di10', { proposalId: 'prop-di-target' }),
    );
    const { url: canisterUrl, close } = await startServer(mockCanisterApp(rows));
    t.after(close);

    const target = await applyApprovedCaptureProposalFromCanister({
      dataDir,
      canisterUrl,
      headers: {},
      proposalId: 'prop-di-target',
    });
    assert.equal(target.ok, true, JSON.stringify(target));

    // Merge: propose with merge_into_flow_id (identical draft steps ⇒ dedup match).
    upsertCandidate(
      dataDir,
      'default',
      makeCandidateRecord({ candidate_id: 'cand_di11', status: 'pending_review' }),
    );
    const mergeProposed = await handleFlowCaptureProposeRequest({
      dataDir,
      vaultId: 'default',
      visibleScopes: visible,
      candidateId: 'cand_di11',
      confirmedScope: 'personal',
      mergeIntoFlowId: 'flow_cap_di10',
      intent: 'merge into existing',
      createProposal,
      starterDir,
      userId: ACTOR,
    });
    assert.equal(mergeProposed.ok, true, mergeProposed.code);
    assert.equal(mergeProposed.payload.proposal_kind, 'flow_candidate_merge');
    const mergeStored = getProposal(dataDir, mergeProposed.payload.proposal_id);
    rows.set('prop-di-merge', { ...mergeStored, proposal_id: 'prop-di-merge', status: 'approved' });

    const merged = await applyApprovedCaptureProposalFromCanister({
      dataDir,
      canisterUrl,
      headers: {},
      proposalId: 'prop-di-merge',
    });
    assert.equal(merged.ok, true, JSON.stringify(merged));
    assert.equal(merged.payload.merge_into_flow_id, 'flow_cap_di10');
    assert.equal(
      getCandidate(dataDir, 'default', 'cand_di11', visible).status,
      'merged_into:flow_cap_di10',
    );

    // Dismiss.
    upsertCandidate(
      dataDir,
      'default',
      makeCandidateRecord({ candidate_id: 'cand_di12', status: 'pending_review' }),
    );
    rows.set('prop-di-dismiss', dismissRow('prop-di-dismiss', 'cand_di12'));
    const dismissed = await applyApprovedCaptureProposalFromCanister({
      dataDir,
      canisterUrl,
      headers: {},
      proposalId: 'prop-di-dismiss',
    });
    assert.equal(dismissed.ok, true, JSON.stringify(dismissed));
    assert.equal(dismissed.payload.dismissed, true);
    assert.equal(getCandidate(dataDir, 'default', 'cand_di12', visible).status, 'rejected');

    // Terminal states survive a re-read from disk.
    assert.equal(
      getCandidate(dataDir, 'default', 'cand_di11', visible).status,
      'merged_into:flow_cap_di10',
    );
    assert.equal(getCandidate(dataDir, 'default', 'cand_di12', visible).status, 'rejected');
  });
});

describe('CAPTURE-HOSTED-APPLY-KN-b — performance', () => {
  const dataDir = path.join(tmpRoot, 'perf');
  let starterDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    starterDir = emptyStarterDir(dataDir);
    process.env.FLOW_CAPTURE_WRITES_ENABLED = '1';
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_CAPTURE_WRITES_ENABLED;
  });

  it('single apply-approved + list within documented budget (2s local fixture)', async (t) => {
    // Documented bound: mock canister on loopback, small store — apply + list must
    // finish well under 2000ms. No network to a real canister (§CHA.4 tier 6).
    const rows = new Map();
    rows.set(
      'prop-perf',
      await seedPromoteRow(dataDir, starterDir, 'cand_perf01', { proposalId: 'prop-perf' }),
    );
    const { url: canisterUrl, close } = await startServer(mockCanisterApp(rows));
    t.after(close);

    const t0 = performance.now();
    const result = await applyApprovedCaptureProposalFromCanister({
      dataDir,
      canisterUrl,
      headers: {},
      proposalId: 'prop-perf',
    });
    const list = handleFlowListRequest({ dataDir, vaultId: 'default', visibleScopes: visible });
    const elapsed = performance.now() - t0;
    assert.equal(result.ok, true);
    assert.equal(list.ok, true);
    assert.ok(elapsed < 2000, `apply+list took ${elapsed}ms (budget 2000ms)`);
  });
});

describe('CAPTURE-HOSTED-APPLY-KN-b — security', () => {
  const dataDir = path.join(tmpRoot, 'sec');
  let starterDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    starterDir = emptyStarterDir(dataDir);
    process.env.FLOW_CAPTURE_WRITES_ENABLED = '1';
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_CAPTURE_WRITES_ENABLED;
  });

  it('(a) T5 refuse-all regression — promote/merge/dismiss stay SELF_APPLY_NOT_ADMITTED', () => {
    for (const kind of [
      'flow_candidate_promote',
      'flow_candidate_merge',
      'flow_candidate_dismiss',
    ]) {
      const row = {
        proposal_id: `prop-sec-${kind}`,
        status: 'proposed',
        path: 'meta/candidates/cand_sec01.md',
        body: JSON.stringify({ proposal_kind: kind, candidate_id: 'cand_sec01' }),
        frontmatter: {
          [FM_PROPOSAL_SOURCE]: FLOW_CAPTURE_PROPOSAL_SOURCE,
          type: 'flow_capture',
          [FM_CAPTURE_PROPOSAL_KIND]: kind,
          [FM_CAPTURE_CANDIDATE_ID]: 'cand_sec01',
        },
      };
      assert.equal(isAdmittedSeamSelfApplyFingerprint(row, ACTOR), false, kind);
      assert.equal(personalSelfApplyRefusalReason(eligible(row)), 'SELF_APPLY_NOT_ADMITTED', kind);
    }
  });

  it('(b) apply-approved with status proposed → 409, store untouched', async (t) => {
    const rows = new Map();
    rows.set(
      'prop-sec-pending',
      await seedPromoteRow(dataDir, starterDir, 'cand_sec02', {
        proposalId: 'prop-sec-pending',
        status: 'proposed',
      }),
    );
    const { url: canisterUrl, close } = await startServer(mockCanisterApp(rows));
    t.after(close);

    const refused = await applyApprovedCaptureProposalFromCanister({
      dataDir,
      canisterUrl,
      headers: {},
      proposalId: 'prop-sec-pending',
      requireApproved: true,
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.status, 409);
    assert.equal(refused.code, 'CONFLICT');
    assert.equal(getCandidate(dataDir, 'default', 'cand_sec02', visible).status, 'pending_review');
    assert.equal(getFlow(dataDir, 'default', 'flow_cap_sec02', { filterScopes: visible }), null);
  });

  it('(c) source scan: no capture T5 admission; gateway wiring + ordering locked', () => {
    const selfApply = readRepo('lib/hub-proposal-personal-self-apply.mjs');
    assert.doesNotMatch(selfApply, /matchesScoolingFlowCaptureFingerprint/);
    assert.match(selfApply, /flow_capture stays SELF_APPLY_NOT_ADMITTED/);

    const applyHelper = readRepo('lib/flow/flow-capture-hosted-apply.mjs');
    assert.doesNotMatch(applyHelper, /isAdmittedSeamSelfApplyFingerprint/);
    assert.doesNotMatch(applyHelper, /FLOW_CAPTURE_WRITES_ENABLED\s*=\s*['"]1['"]/);

    const gw = readRepo('hub/gateway/server.mjs');
    assert.match(gw, /maybeApplyHostedCaptureAfterApprove/);
    assert.match(gw, /mergeCaptureApplyIntoApproveResponse/);
    assert.match(gw, /\/api\/v1\/flows\/capture\/proposals\/:proposal_id\/apply-approved/);
    // CHA-C5 ordering: candidates / external-grants / projection GETs register
    // before the GET :id proxy so static paths always win.
    const idIdx = gw.indexOf("app.get('/api/v1/flows/:id',");
    assert.ok(idIdx > 0, 'GET /api/v1/flows/:id proxy registered');
    assert.ok(gw.indexOf("app.get('/api/v1/flows/candidates'") < idIdx);
    assert.ok(gw.indexOf("app.get('/api/v1/flows/external-grants'") < idIdx);
    assert.ok(gw.indexOf("app.get('/api/v1/flows/:id/projection'") < idIdx);
    assert.ok(gw.indexOf("app.get('/api/v1/flows',") < idIdx);

    const routes = readRepo('hub/bridge/flow-capture-routes.mjs');
    assert.match(routes, /applyApprovedCaptureProposalFromCanister/);
    assert.match(routes, /withExternalProtocolBlobSync/);
    const bridgeIdIdx = routes.indexOf("app.get('/api/v1/flows/:id'");
    assert.ok(bridgeIdIdx > 0, 'bridge GET /api/v1/flows/:id registered');
    assert.ok(routes.indexOf("app.get('/api/v1/flows/candidates'") < bridgeIdIdx);
    // requireApproved must be pinned true on the bridge route (CHA-C8).
    assert.match(routes, /requireApproved:\s*true/);
  });

  it('(d) promote + list payload carries no secrets', async (t) => {
    const rows = new Map();
    rows.set(
      'prop-sec-clean',
      await seedPromoteRow(dataDir, starterDir, 'cand_sec03', { proposalId: 'prop-sec-clean' }),
    );
    const { url: canisterUrl, close } = await startServer(mockCanisterApp(rows));
    t.after(close);

    const applied = await applyApprovedCaptureProposalFromCanister({
      dataDir,
      canisterUrl,
      headers: { 'X-Gateway-Auth': 'test-canister-shared-key' },
      proposalId: 'prop-sec-clean',
    });
    assert.equal(applied.ok, true);
    const applyBlob = JSON.stringify(applied.payload);
    assert.doesNotMatch(applyBlob, /password|refresh_token|BEGIN PRIVATE|gateway-auth|shared-key/i);

    const list = handleFlowListRequest({ dataDir, vaultId: 'default', visibleScopes: visible });
    assert.equal(list.ok, true);
    const listBlob = JSON.stringify(list.payload);
    assert.doesNotMatch(listBlob, /password|refresh_token|BEGIN PRIVATE|gateway-auth|shared-key/i);
  });
});

/**
 * FLOW-CAPTURE-LIVE-KN-b — seven-tier coverage (§FCL.7 Knowtation matrix).
 * Frozen: ~/scooling/docs/FLOW-CAPTURE-LIVE-FREEZE.md (§FCL.3 KN-b / FCL-C3 / FCL-C10)
 *
 * Tiers: unit · integration · e2e · stress · data-integrity · performance · security
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
  personalSelfApplyRefusalReason,
  isAdmittedSeamSelfApplyFingerprint,
  matchesScoolingFlowFingerprint,
  isSeamSurfaceProposal,
} from '../lib/hub-proposal-personal-self-apply.mjs';
import {
  FLOW_CAPTURE_PROPOSAL_SOURCE,
  handleFlowCaptureProposeRequest,
  handleFlowCaptureDismissRequest,
  getFlowCaptureDetectionEnabled,
  getFlowCaptureWritesEnabled,
} from '../lib/flow/flow-capture.mjs';
import {
  mergeCaptureFrontmatter,
  normalizeCanisterProposalForCapturePrecheck,
  FM_PROPOSAL_SOURCE,
  FM_CAPTURE_PROPOSAL_KIND,
} from '../lib/flow/flow-capture-hosted-proposal.mjs';
import { bridgeFlowCaptureHandlerRole } from '../hub/bridge/flow-capture-routes.mjs';
import { FLOW_PROPOSAL_SOURCE } from '../lib/flow/flow-authoring.mjs';
import { DELEGATION_PROPOSAL_SOURCE } from '../lib/agent/delegation.mjs';
import { createProposal, getProposal, listProposals } from '../hub/proposals-store.mjs';
import { upsertCandidate, getCandidate } from '../lib/flow/flow-store.mjs';
import { makeCandidateRecord, emptyStarterDir } from './fixtures/flow/capture-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-capture-live-kn-b');

const SECRET = 'gateway-flow-capture-kn-b-test-secret-32!!';
const ACTOR = 'google:learner-a';
const OTHER = 'google:learner-b';
const visible = new Set(['personal', 'project', 'org']);

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
  const { app: gwApp } = await import(`${gwEntry}?gwcap=${cacheBust}`);

  const gwSrv = http.createServer(gwApp);
  await new Promise((resolve, reject) => {
    gwSrv.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => gwSrv.close(() => r())));
  return gwSrv.address().port;
}

/**
 * @param {string} kind
 * @param {Record<string, unknown>} [overrides]
 */
function captureProposal(kind, overrides = {}) {
  const candidateId = overrides.candidate_id || 'cand_fclknb01';
  const bodyObj = overrides.bodyObj || {
    proposal_kind: kind,
    candidate_id: candidateId,
    confirmed_scope: 'personal',
  };
  return {
    proposal_id: overrides.proposal_id || `prop-cap-${kind}`,
    status: 'proposed',
    source: FLOW_CAPTURE_PROPOSAL_SOURCE,
    path: `meta/candidates/${candidateId}.md`,
    body: JSON.stringify(bodyObj),
    frontmatter: {
      type: 'flow_capture',
      candidate_id: candidateId,
      proposal_kind: kind,
    },
    capture_meta: {
      proposal_kind: kind,
      candidate_id: candidateId,
      confirmed_scope: 'personal',
      ...(kind === 'flow_candidate_merge' ? { merge_into_flow_id: 'flow_merge_target' } : {}),
    },
    proposed_by: ACTOR,
    ...Object.fromEntries(
      Object.entries(overrides).filter(
        ([k]) => !['candidate_id', 'bodyObj', 'proposal_id'].includes(k),
      ),
    ),
  };
}

/**
 * @param {Record<string, unknown>} proposal
 * @param {Record<string, unknown>} [extra]
 */
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

function flowAuthoringProposal() {
  return {
    proposal_id: 'prop-flow-admit',
    status: 'proposed',
    source: FLOW_PROPOSAL_SOURCE,
    path: 'meta/flows/admit-ok.md',
    external_ref: 'scooling.flow:admit-ok',
    body: JSON.stringify({
      flow: {
        schema: 'knowtation.flow/v0',
        flow_id: 'flow_admit_ok',
        title: 'Admit',
        version: '1.0.0',
        scope: 'personal',
        summary: 'ok',
        tags: [],
        steps: [],
        inputs: [],
        vault_mirror_path: 'meta/flows/admit-ok.md',
      },
      steps: [],
    }),
    frontmatter: {
      type: 'flow',
      flow_id: 'flow_admit_ok',
      flow_version: '1.0.0',
      scope: 'personal',
    },
    flow_meta: { kind: 'new', base_version: null, base_state_id: 'flowst1_absent' },
  };
}

describe('FLOW-CAPTURE-LIVE-KN-b — unit', () => {
  it('promote/merge/dismiss → SELF_APPLY_NOT_ADMITTED when session-bound author==approver', () => {
    for (const kind of [
      'flow_candidate_promote',
      'flow_candidate_merge',
      'flow_candidate_dismiss',
    ]) {
      const p = captureProposal(kind);
      assert.equal(isSeamSurfaceProposal(p), true, kind);
      assert.equal(isAdmittedSeamSelfApplyFingerprint(p, ACTOR), false, kind);
      assert.equal(
        personalSelfApplyRefusalReason(eligible(p)),
        'SELF_APPLY_NOT_ADMITTED',
        kind,
      );
    }
  });

  it('authoring Flow fingerprint still admits; Delegation still refused', () => {
    const flow = flowAuthoringProposal();
    assert.equal(matchesScoolingFlowFingerprint(flow), true);
    assert.equal(personalSelfApplyRefusalReason(eligible(flow)), null);
    assert.equal(
      personalSelfApplyRefusalReason(
        eligible({ status: 'proposed', source: DELEGATION_PROPOSAL_SOURCE }),
      ),
      'SELF_APPLY_DELEGATION_REFUSED',
    );
  });

  it('no positive capture fingerprint helper in Wave 2 source', () => {
    const selfApply = readRepo('lib/hub-proposal-personal-self-apply.mjs');
    assert.doesNotMatch(selfApply, /matchesScoolingFlowCaptureFingerprint/);
    assert.match(selfApply, /flow_capture stays SELF_APPLY_NOT_ADMITTED/);
  });

  it('bridgeCapture role map + mergeCaptureFrontmatter + normalize', () => {
    assert.equal(bridgeFlowCaptureHandlerRole('member'), 'editor');
    assert.equal(bridgeFlowCaptureHandlerRole('admin'), 'admin');
    const fm = mergeCaptureFrontmatter(
      { type: 'flow_capture' },
      {
        proposal_kind: 'flow_candidate_promote',
        candidate_id: 'cand_x',
        confirmed_scope: 'personal',
      },
    );
    assert.equal(fm[FM_PROPOSAL_SOURCE], FLOW_CAPTURE_PROPOSAL_SOURCE);
    assert.equal(fm[FM_CAPTURE_PROPOSAL_KIND], 'flow_candidate_promote');
    const canisterRow = {
      proposal_id: 'p1',
      path: 'meta/candidates/cand_x.md',
      frontmatter: fm,
      body: JSON.stringify({ proposal_kind: 'flow_candidate_promote', candidate_id: 'cand_x' }),
    };
    // Hosted canister rows omit top-level source — seam via frontmatter normalize.
    assert.equal(canisterRow.source, undefined);
    assert.equal(isSeamSurfaceProposal(canisterRow), true);
    assert.equal(
      personalSelfApplyRefusalReason(eligible(canisterRow)),
      'SELF_APPLY_NOT_ADMITTED',
    );
    const normalized = normalizeCanisterProposalForCapturePrecheck(canisterRow);
    assert.ok(normalized);
    assert.equal(normalized.source, FLOW_CAPTURE_PROPOSAL_SOURCE);
    assert.equal(normalized.capture_meta.proposal_kind, 'flow_candidate_promote');
    assert.equal(isAdmittedSeamSelfApplyFingerprint(normalized, ACTOR), false);
  });

  it('gateway + bridge register capture proxies; capture envs stay default off', () => {
    const gw = readRepo('hub/gateway/server.mjs');
    const bridge = readRepo('hub/bridge/server.mjs');
    const routes = readRepo('hub/bridge/flow-capture-routes.mjs');
    assert.match(gw, /FLOW-CAPTURE-LIVE-KN-b/);
    assert.match(gw, /\/api\/v1\/flows\/capture\/observe/);
    assert.match(gw, /\/api\/v1\/flows\/candidates/);
    assert.match(gw, /\/api\/v1\/flows\/candidates\/:id\/propose/);
    assert.match(gw, /\/api\/v1\/flows\/candidates\/:id\/dismiss/);
    assert.match(bridge, /registerBridgeFlowCaptureRoutes/);
    assert.match(routes, /createCaptureProposalOnCanister/);
    assert.match(routes, /FLOW_CAPTURE/);
    // Hard stop: do not hard-enable capture envs in bridge source.
    assert.doesNotMatch(routes, /FLOW_CAPTURE_WRITES_ENABLED\s*=\s*['"]1['"]/);
    assert.doesNotMatch(routes, /FLOW_CAPTURE_DETECTION_ENABLED\s*=\s*['"]1['"]/);
    assert.equal(getFlowCaptureDetectionEnabled(tmpRoot), false);
    assert.equal(getFlowCaptureWritesEnabled(tmpRoot), false);
  });
});

describe('FLOW-CAPTURE-LIVE-KN-b — integration', () => {
  it('POST observe + GET candidates + propose/dismiss hit mock bridge (not canister)', async (t) => {
    const calls = [];
    const mockBridge = express();
    mockBridge.use(express.json());
    mockBridge.post('/api/v1/flows/capture/observe', (req, res) => {
      calls.push({ path: 'observe', auth: req.headers.authorization });
      res.status(200).json({
        schema: 'knowtation.flow_capture_observe/v0',
        detection_authorized: false,
        returned_count: 0,
        candidates: [],
      });
    });
    mockBridge.get('/api/v1/flows/candidates', (req, res) => {
      calls.push({ path: 'list' });
      res.status(200).json({
        schema: 'knowtation.flow_candidate_list/v0',
        candidates: [],
        returned_count: 0,
      });
    });
    mockBridge.post('/api/v1/flows/candidates/:id/propose', (req, res) => {
      calls.push({ path: 'propose', id: req.params.id, body: req.body });
      res.status(403).json({
        error: 'Flow capture writes are disabled',
        code: 'FLOW_CAPTURE_WRITES_DISABLED',
      });
    });
    mockBridge.post('/api/v1/flows/candidates/:id/dismiss', (req, res) => {
      calls.push({ path: 'dismiss', id: req.params.id });
      res.status(403).json({
        error: 'Flow capture writes are disabled',
        code: 'FLOW_CAPTURE_WRITES_DISABLED',
      });
    });

    const { bridgeUrl, close } = await startMockBridge(mockBridge);
    t.after(close);
    const port = await bootGateway(t, bridgeUrl, `int-${Date.now()}`);
    const token = signTestJwt({ sub: 'user-cap-proxy', role: 'editor', type: 'session' });
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-vault-id': 'default',
    };

    const obs = await fetch(`http://127.0.0.1:${port}/api/v1/flows/capture/observe`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ session_id: 'a'.repeat(64) }),
    });
    assert.equal(obs.status, 200);
    const list = await fetch(`http://127.0.0.1:${port}/api/v1/flows/candidates`, {
      headers: { authorization: `Bearer ${token}`, 'x-vault-id': 'default' },
    });
    assert.equal(list.status, 200);
    const prop = await fetch(
      `http://127.0.0.1:${port}/api/v1/flows/candidates/${encodeURIComponent('cand_x')}/propose`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ intent: 'promote', confirmed_scope: 'personal' }),
      },
    );
    assert.equal(prop.status, 403);
    const dis = await fetch(
      `http://127.0.0.1:${port}/api/v1/flows/candidates/${encodeURIComponent('cand_x')}/dismiss`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ intent: 'dismiss' }),
      },
    );
    assert.equal(dis.status, 403);

    assert.equal(calls.length, 4);
    assert.equal(calls[0].path, 'observe');
    assert.match(calls[0].auth, /^Bearer /);
    assert.equal(calls[1].path, 'list');
    assert.equal(calls[2].path, 'propose');
    assert.equal(calls[2].id, 'cand_x');
    assert.equal(calls[3].path, 'dismiss');
  });
});

describe('FLOW-CAPTURE-LIVE-KN-b — e2e', () => {
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

  it('propose capture → approve-time self-apply still NOT_ADMITTED (pending honesty)', async () => {
    upsertCandidate(
      dataDir,
      'default',
      makeCandidateRecord({ candidate_id: 'cand_e2eknb01', status: 'pending_review' }),
    );
    const proposed = await handleFlowCaptureProposeRequest({
      dataDir,
      vaultId: 'default',
      visibleScopes: visible,
      candidateId: 'cand_e2eknb01',
      confirmedScope: 'personal',
      intent: 'promote for review',
      createProposal,
      starterDir,
      userId: ACTOR,
    });
    assert.equal(proposed.ok, true, proposed.code);
    const stored = getProposal(dataDir, proposed.payload.proposal_id);
    assert.equal(stored.source, FLOW_CAPTURE_PROPOSAL_SOURCE);
    assert.equal(
      personalSelfApplyRefusalReason(
        eligible(stored, { authorActorId: ACTOR, approverActorId: ACTOR, sessionBound: true }),
      ),
      'SELF_APPLY_NOT_ADMITTED',
    );
  });
});

describe('FLOW-CAPTURE-LIVE-KN-b — stress', () => {
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

  it('N concurrent propose on same candidate — one wins; no cross-user leak', async () => {
    upsertCandidate(
      dataDir,
      'default',
      makeCandidateRecord({ candidate_id: 'cand_stress01', status: 'pending_review' }),
    );
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        handleFlowCaptureProposeRequest({
          dataDir,
          vaultId: 'default',
          visibleScopes: visible,
          candidateId: 'cand_stress01',
          confirmedScope: 'personal',
          intent: `promote-${i}`,
          createProposal,
          starterDir,
          userId: i % 2 === 0 ? ACTOR : OTHER,
        }),
      ),
    );
    const ok = results.filter((r) => r.ok);
    const refused = results.filter((r) => !r.ok);
    assert.equal(ok.length, 1);
    assert.ok(refused.every((r) => r.code === 'FLOW_CANDIDATE_NOT_PROMOTABLE'));
    const { proposals } = listProposals(dataDir, { source: FLOW_CAPTURE_PROPOSAL_SOURCE });
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].capture_meta.candidate_id, 'cand_stress01');
  });
});

describe('FLOW-CAPTURE-LIVE-KN-b — data-integrity', () => {
  const dataDir = path.join(tmpRoot, 'integrity');
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

  it('proposal source/capture_meta preserved; candidate status unchanged until Hub apply', async () => {
    upsertCandidate(
      dataDir,
      'default',
      makeCandidateRecord({ candidate_id: 'cand_diknb01', status: 'pending_review' }),
    );
    const proposed = await handleFlowCaptureProposeRequest({
      dataDir,
      vaultId: 'default',
      visibleScopes: visible,
      candidateId: 'cand_diknb01',
      confirmedScope: 'personal',
      intent: 'promote',
      createProposal,
      starterDir,
      userId: ACTOR,
    });
    assert.equal(proposed.ok, true, proposed.code);
    const stored = getProposal(dataDir, proposed.payload.proposal_id);
    assert.equal(stored.source, FLOW_CAPTURE_PROPOSAL_SOURCE);
    assert.equal(stored.capture_meta.proposal_kind, 'flow_candidate_promote');
    assert.equal(stored.capture_meta.candidate_id, 'cand_diknb01');
    assert.equal(stored.capture_meta.confirmed_scope, 'personal');
    const cand = getCandidate(dataDir, 'default', 'cand_diknb01', visible);
    assert.equal(cand.status, 'pending_review');
  });

  it('dismiss preserves capture_meta kind; candidate still pending_review', async () => {
    upsertCandidate(
      dataDir,
      'default',
      makeCandidateRecord({ candidate_id: 'cand_didis01', status: 'pending_review' }),
    );
    const dismissed = await handleFlowCaptureDismissRequest({
      dataDir,
      vaultId: 'default',
      visibleScopes: visible,
      candidateId: 'cand_didis01',
      intent: 'dismiss noise',
      createProposal,
      userId: ACTOR,
    });
    assert.equal(dismissed.ok, true, dismissed.code);
    const stored = getProposal(dataDir, dismissed.payload.proposal_id);
    assert.equal(stored.source, FLOW_CAPTURE_PROPOSAL_SOURCE);
    assert.equal(stored.capture_meta.proposal_kind, 'flow_candidate_dismiss');
    assert.equal(getCandidate(dataDir, 'default', 'cand_didis01', visible).status, 'pending_review');
  });
});

describe('FLOW-CAPTURE-LIVE-KN-b — performance', () => {
  it('proxy overhead bounded vs authoring proxy class (<2s env-off refuse)', async (t) => {
    const mockBridge = express();
    mockBridge.use(express.json());
    mockBridge.post('/api/v1/flows/candidates/:id/propose', (_req, res) => {
      res.status(403).json({ code: 'FLOW_CAPTURE_WRITES_DISABLED', error: 'disabled' });
    });
    const { bridgeUrl, close } = await startMockBridge(mockBridge);
    t.after(close);
    const port = await bootGateway(t, bridgeUrl, `perf-${Date.now()}`);
    const token = signTestJwt({ sub: 'user-cap-perf', role: 'editor', type: 'session' });
    const t0 = performance.now();
    const res = await fetch(
      `http://127.0.0.1:${port}/api/v1/flows/candidates/cand_perf/propose`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-vault-id': 'default',
        },
        body: JSON.stringify({ intent: 'x', confirmed_scope: 'personal' }),
      },
    );
    const elapsed = performance.now() - t0;
    assert.equal(res.status, 403);
    assert.ok(elapsed < 2000, `elapsed ${elapsed}ms`);
  });
});

describe('FLOW-CAPTURE-LIVE-KN-b — security', () => {
  const dataDir = path.join(tmpRoot, 'sec');
  let starterDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    starterDir = emptyStarterDir(dataDir);
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_CAPTURE_WRITES_ENABLED;
    delete process.env.FLOW_CAPTURE_DETECTION_ENABLED;
  });

  it('env-off refuse; scope denial; no secrets in envelopes; no positive admit', async () => {
    assert.equal(getFlowCaptureWritesEnabled(dataDir), false);
    upsertCandidate(
      dataDir,
      'default',
      makeCandidateRecord({
        candidate_id: 'cand_secknb01',
        status: 'pending_review',
        scope_hint: 'personal',
      }),
    );
    const refused = await handleFlowCaptureProposeRequest({
      dataDir,
      vaultId: 'default',
      visibleScopes: visible,
      candidateId: 'cand_secknb01',
      confirmedScope: 'personal',
      intent: 'should refuse',
      createProposal,
      starterDir,
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'FLOW_CAPTURE_WRITES_DISABLED');

    process.env.FLOW_CAPTURE_WRITES_ENABLED = '1';
    const scopeDenied = await handleFlowCaptureProposeRequest({
      dataDir,
      vaultId: 'default',
      visibleScopes: visible,
      candidateId: 'cand_secknb01',
      confirmedScope: 'org',
      scopeWidenAcknowledged: false,
      intent: 'widen',
      createProposal,
      starterDir,
    });
    assert.equal(scopeDenied.ok, false);
    assert.equal(scopeDenied.code, 'FLOW_CAPTURE_SCOPE_UNCONFIRMED');

    const okProp = await handleFlowCaptureProposeRequest({
      dataDir,
      vaultId: 'default',
      visibleScopes: visible,
      candidateId: 'cand_secknb01',
      confirmedScope: 'personal',
      intent: 'promote',
      createProposal,
      starterDir,
      userId: ACTOR,
    });
    assert.equal(okProp.ok, true, okProp.code);
    const blob = JSON.stringify(getProposal(dataDir, okProp.payload.proposal_id));
    assert.doesNotMatch(blob, /password|refresh_token|BEGIN PRIVATE/i);
    assert.equal(
      personalSelfApplyRefusalReason(eligible(getProposal(dataDir, okProp.payload.proposal_id))),
      'SELF_APPLY_NOT_ADMITTED',
    );

    const selfApplySrc = readRepo('lib/hub-proposal-personal-self-apply.mjs');
    assert.doesNotMatch(selfApplySrc, /matchesScoolingFlowCaptureFingerprint/);
  });

  it('source scan: no capture env hard-on; no Delegation write env; no secrets in gateway', () => {
    const gw = readRepo('hub/gateway/server.mjs');
    const routes = readRepo('hub/bridge/flow-capture-routes.mjs');
    assert.doesNotMatch(routes, /FLOW_CAPTURE_WRITES_ENABLED\s*=\s*['"]1['"]/);
    assert.doesNotMatch(routes, /DELEGATION_WRITES\s*=/);
    // Run proxies are SITE-FINISH-FLOW-RUN-KN-b (not this suite). Capture still
    // must not hard-on run env or embed Hub JWTs in gateway source.
    assert.doesNotMatch(gw, /FLOW_RUN_WRITES_ENABLED\s*=\s*['"]1['"]/);
    assert.doesNotMatch(gw, /FLOW_AUTOMATABLE_EXECUTION_ENABLED\s*=\s*['"]1['"]/);
    assert.doesNotMatch(gw, /SCOOLING_.*HUB.*JWT/);
  });
});

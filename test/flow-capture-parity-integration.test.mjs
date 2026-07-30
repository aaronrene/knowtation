/**
 * Tier 2 — INTEGRATION: MCP / Hub / CLI parity + sub-gates off.
 *
 * @see lib/flow/flow-capture.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleFlowCaptureObserveRequest,
  handleFlowCaptureListRequest,
  handleFlowCaptureProposeRequest,
  handleFlowCaptureDismissRequest,
} from '../lib/flow/flow-capture.mjs';
import { upsertCandidate } from '../lib/flow/flow-store.mjs';
import { createProposal, listProposals } from '../hub/proposals-store.mjs';
import { getRepoRoot } from '../lib/repo-root.mjs';
import { validSessionMeta, makeCandidateRecord } from './fixtures/flow/capture-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-capture-parity');

function stripVolatile(payload) {
  const copy = structuredClone(payload);
  if (Array.isArray(copy.candidates)) {
    for (const c of copy.candidates) {
      delete c.candidate_id;
      if (c.provenance) {
        delete c.provenance.actor;
        delete c.provenance.harness;
      }
    }
  }
  delete copy.proposal_id;
  return copy;
}

describe('Flow capture — triple-surface parity', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
    process.env.FLOW_CAPTURE_DETECTION_ENABLED = '1';
    process.env.FLOW_CAPTURE_WRITES_ENABLED = '1';
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_CAPTURE_DETECTION_ENABLED;
    delete process.env.FLOW_CAPTURE_WRITES_ENABLED;
  });

  it('observe/list/propose/dismiss produce deep-equal envelopes across surfaces', async () => {
    const hubDir = path.join(tmpRoot, 'hub');
    const cliDir = path.join(tmpRoot, 'cli');
    const mcpDir = path.join(tmpRoot, 'mcp');
    for (const d of [hubDir, cliDir, mcpDir]) fs.mkdirSync(d, { recursive: true });

    const meta = validSessionMeta();
    const hubObs = handleFlowCaptureObserveRequest({ dataDir: hubDir, vaultId: 'default', sessionMeta: meta, harness: 'hub' });
    const cliObs = handleFlowCaptureObserveRequest({ dataDir: cliDir, vaultId: 'default', cliScopes: ['personal'], sessionMeta: meta, harness: 'cli' });
    const mcpObs = handleFlowCaptureObserveRequest({ dataDir: mcpDir, vaultId: 'default', cliScopes: ['personal'], sessionMeta: meta, harness: 'mcp' });
    assert.equal(hubObs.ok, true);
    assert.equal(cliObs.ok, true);
    assert.equal(mcpObs.ok, true);
    assert.deepEqual(stripVolatile(hubObs.payload), stripVolatile(cliObs.payload));
    assert.deepEqual(stripVolatile(cliObs.payload), stripVolatile(mcpObs.payload));

    const cand = makeCandidateRecord({ candidate_id: 'cand_parity1234' });
    for (const d of [hubDir, cliDir, mcpDir]) upsertCandidate(d, 'default', cand);

    const hubList = handleFlowCaptureListRequest({ dataDir: hubDir, vaultId: 'default' });
    const cliList = handleFlowCaptureListRequest({ dataDir: cliDir, vaultId: 'default', cliScopes: ['personal'] });
    const hubRow = hubList.payload.candidates.find((c) => c.candidate_id === 'cand_parity1234');
    const cliRow = cliList.payload.candidates.find((c) => c.candidate_id === 'cand_parity1234');
    assert.deepEqual(hubRow, cliRow);

    const hubProp = await handleFlowCaptureProposeRequest({
      dataDir: hubDir, vaultId: 'default', candidateId: 'cand_parity1234', confirmedScope: 'personal', intent: 'x', createProposal,
    });
    const cliProp = await handleFlowCaptureProposeRequest({
      dataDir: cliDir, vaultId: 'default', cliScopes: ['personal'], candidateId: 'cand_parity1234', confirmedScope: 'personal', intent: 'x', createProposal,
    });
    assert.deepEqual(stripVolatile(hubProp.payload), stripVolatile(cliProp.payload));

    const dismissHubDir = path.join(tmpRoot, 'dismiss-hub');
    const dismissCliDir = path.join(tmpRoot, 'dismiss-cli');
    for (const d of [dismissHubDir, dismissCliDir]) {
      fs.mkdirSync(d, { recursive: true });
      upsertCandidate(d, 'default', makeCandidateRecord({ candidate_id: 'cand_dismiss12' }));
    }
    const hubDis = await handleFlowCaptureDismissRequest({
      dataDir: dismissHubDir, vaultId: 'default', candidateId: 'cand_dismiss12', intent: 'no', createProposal,
    });
    const cliDis = await handleFlowCaptureDismissRequest({
      dataDir: dismissCliDir, vaultId: 'default', cliScopes: ['personal'], candidateId: 'cand_dismiss12', intent: 'no', createProposal,
    });
    assert.equal(hubDis.ok, true);
    assert.equal(cliDis.ok, true);
    assert.deepEqual(stripVolatile(hubDis.payload), stripVolatile(cliDis.payload));
  });

  it('sub-gates off ⇒ all surfaces return disabled/refusal', async () => {
    delete process.env.FLOW_CAPTURE_DETECTION_ENABLED;
    delete process.env.FLOW_CAPTURE_WRITES_ENABLED;
    const dir = path.join(tmpRoot, 'off');
    fs.mkdirSync(dir, { recursive: true });

    const obs = handleFlowCaptureObserveRequest({ dataDir: dir, vaultId: 'default', sessionMeta: validSessionMeta() });
    assert.equal(obs.payload.detection_authorized, false);

    const prop = await handleFlowCaptureProposeRequest({
      dataDir: dir, vaultId: 'default', candidateId: 'cand_x1234', confirmedScope: 'personal', intent: 'x', createProposal,
    });
    assert.equal(prop.code, 'FLOW_CAPTURE_WRITES_DISABLED');

    const dis = await handleFlowCaptureDismissRequest({
      dataDir: dir, vaultId: 'default', candidateId: 'cand_x1234', intent: 'x', createProposal,
    });
    assert.equal(dis.code, 'FLOW_CAPTURE_WRITES_DISABLED');
    assert.equal(listProposals(dir, { source: 'flow_capture' }).total, 0);
  });
});

describe('Flow capture — Hub route wiring contract', () => {
  it('registers capture routes and approve reconcile', async () => {
    const src = fs.readFileSync(path.join(getRepoRoot(), 'hub/server.mjs'), 'utf8');
    assert.match(src, /\/api\/v1\/flows\/capture\/observe/);
    assert.match(src, /\/api\/v1\/flows\/candidates/);
    assert.match(src, /\/api\/v1\/flows\/candidates\/:candidate_id\/propose/);
    assert.match(src, /\/api\/v1\/flows\/candidates\/:candidate_id\/dismiss/);
    assert.match(src, /precheckApprovedCaptureProposal/);
    assert.match(src, /applyCaptureProposal/);
  });
});

/**
 * Tier 3 — E2E: observe → list → propose → approve → flow get; dismiss + dedup paths.
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
  precheckApprovedCaptureProposal,
  applyCaptureProposal,
} from '../lib/flow/flow-capture.mjs';
import { applyFlowProposalToIndex } from '../lib/flow/flow-authoring.mjs';
import { getFlow, upsertCandidate, getCandidate } from '../lib/flow/flow-store.mjs';
import { createProposal, getProposal, updateProposalStatus } from '../hub/proposals-store.mjs';
import { makeFlowBundle, emptyStarterDir } from './fixtures/flow/authoring-helpers.mjs';
import { validSessionMeta, makeCandidateRecord } from './fixtures/flow/capture-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-capture-e2e');
const visible = new Set(['personal', 'project', 'org']);

function approveCapture(dataDir, proposalId) {
  const proposal = getProposal(dataDir, proposalId);
  const pre = precheckApprovedCaptureProposal(dataDir, proposal);
  if (!pre.ok) return pre;
  applyCaptureProposal(dataDir, pre);
  updateProposalStatus(dataDir, proposalId, 'approved');
  return { ok: true, pre };
}

describe('Flow capture — full lifecycle', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';
  let starterDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    starterDir = emptyStarterDir(dataDir);
    process.env.FLOW_CAPTURE_DETECTION_ENABLED = '1';
    process.env.FLOW_CAPTURE_WRITES_ENABLED = '1';
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_CAPTURE_DETECTION_ENABLED;
    delete process.env.FLOW_CAPTURE_WRITES_ENABLED;
  });

  it('observe → list → propose → approve → flow get shows new Flow', async () => {
    const observed = handleFlowCaptureObserveRequest({
      dataDir, vaultId, visibleScopes: visible, sessionMeta: validSessionMeta(), harness: 'test',
    });
    assert.equal(observed.ok, true);
    assert.ok(observed.payload.returned_count >= 1);
    const candidateId = observed.payload.candidates[0].candidate_id;

    const listed = handleFlowCaptureListRequest({ dataDir, vaultId, visibleScopes: visible });
    assert.ok(listed.payload.candidates.some((c) => c.candidate_id === candidateId));

    const proposed = await handleFlowCaptureProposeRequest({
      dataDir, vaultId, visibleScopes: visible, candidateId, confirmedScope: 'personal', intent: 'promote it', createProposal, starterDir,
    });
    assert.equal(proposed.ok, true);
    const approve = approveCapture(dataDir, proposed.payload.proposal_id);
    assert.equal(approve.ok, true);

    const got = getFlow(dataDir, vaultId, approve.pre.flow.flow_id, { filterScopes: visible, starterDir });
    assert.ok(got);
    assert.equal(got.flow.scope, 'personal');
    assert.equal(getCandidate(dataDir, vaultId, candidateId, visible)?.status, 'promoted');
  });

  it('dismiss path → rejected terminal', async () => {
    upsertCandidate(dataDir, vaultId, makeCandidateRecord({ candidate_id: 'cand_e2edismiss' }));
    const proposed = await handleFlowCaptureDismissRequest({
      dataDir, vaultId, visibleScopes: visible, candidateId: 'cand_e2edismiss', intent: 'not recurring', createProposal,
    });
    assert.equal(proposed.ok, true);
    approveCapture(dataDir, proposed.payload.proposal_id);
    assert.equal(getCandidate(dataDir, vaultId, 'cand_e2edismiss', visible)?.status, 'rejected');
  });

  it('dedup overlap → merge proposal path', async () => {
    const existing = makeFlowBundle({
      flowId: 'flow_existing_dedup',
      steps: 2,
      summary: 'Open target URL verify response status record result pointer',
    });
    existing.steps[0].owned_job = 'Open the target URL';
    existing.steps[0].instruction = 'Open the target URL and verify response status record result pointer';
    existing.steps[1].owned_job = 'Record result pointer';
    existing.steps[1].instruction = 'Record result pointer for verify step';
    applyFlowProposalToIndex(dataDir, vaultId, existing.flow, existing.steps);

    upsertCandidate(
      dataDir,
      vaultId,
      makeCandidateRecord({
        candidate_id: 'cand_e2emerge01',
        draft_steps: [
          'Open the target URL',
          'Verify response status',
          'Record result pointer',
        ],
      }),
    );

    const blocked = await handleFlowCaptureProposeRequest({
      dataDir, vaultId, visibleScopes: visible, candidateId: 'cand_e2emerge01', confirmedScope: 'personal', intent: 'promote', createProposal, starterDir,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'FLOW_CAPTURE_DEDUP_MERGE_REQUIRED');

    const merge = await handleFlowCaptureProposeRequest({
      dataDir, vaultId, visibleScopes: visible, candidateId: 'cand_e2emerge01', confirmedScope: 'personal', intent: 'merge it', mergeIntoFlowId: 'flow_existing_dedup', createProposal, starterDir,
    });
    assert.equal(merge.ok, true);
    assert.equal(merge.payload.proposal_kind, 'flow_candidate_merge');
    approveCapture(dataDir, merge.payload.proposal_id);
    assert.equal(getCandidate(dataDir, vaultId, 'cand_e2emerge01', visible)?.status, 'merged_into:flow_existing_dedup');
  });

  it('low confidence suppressed unless flag set', async () => {
    upsertCandidate(
      dataDir,
      vaultId,
      makeCandidateRecord({ candidate_id: 'cand_lowconf01', confidence: 'low' }),
    );
    const blocked = await handleFlowCaptureProposeRequest({
      dataDir, vaultId, visibleScopes: visible, candidateId: 'cand_lowconf01', confirmedScope: 'personal', intent: 'x', createProposal, starterDir,
    });
    assert.equal(blocked.code, 'FLOW_CAPTURE_LOW_CONFIDENCE_SUPPRESSED');

    const allowed = await handleFlowCaptureProposeRequest({
      dataDir, vaultId, visibleScopes: visible, candidateId: 'cand_lowconf01', confirmedScope: 'personal', intent: 'x', allowLowConfidence: true, createProposal, starterDir,
    });
    assert.equal(allowed.ok, true);
  });
});

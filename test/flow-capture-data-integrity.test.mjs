/**
 * Tier 5 — DATA-INTEGRITY: candidate round-trip, promote reconcile, merge terminal, scope.
 *
 * @see lib/flow/flow-capture.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleFlowCaptureProposeRequest,
  precheckApprovedCaptureProposal,
  applyCaptureProposal,
  candidateSummaryForClient,
} from '../lib/flow/flow-capture.mjs';
import { getFlow, upsertCandidate, getCandidate, loadFlowStore } from '../lib/flow/flow-store.mjs';
import { applyFlowProposalToIndex } from '../lib/flow/flow-authoring.mjs';
import { makeFlowBundle } from './fixtures/flow/authoring-helpers.mjs';
import { createProposal, getProposal } from '../hub/proposals-store.mjs';
import { emptyStarterDir } from './fixtures/flow/authoring-helpers.mjs';
import { makeCandidateRecord } from './fixtures/flow/capture-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-capture-integrity');
const visible = new Set(['personal', 'project', 'org']);

describe('Flow capture — data integrity', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';
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

  it('candidate round-trip preserves fields via summary', () => {
    const raw = makeCandidateRecord({ candidate_id: 'cand_integrity1' });
    upsertCandidate(dataDir, vaultId, raw);
    const stored = getCandidate(dataDir, vaultId, 'cand_integrity1', visible);
    const summary = candidateSummaryForClient(stored);
    assert.deepEqual(summary.evidence_refs, raw.evidence_refs);
    assert.deepEqual(summary.draft_steps, raw.draft_steps);
    assert.equal(summary.scope_hint, raw.scope_hint);
  });

  it('promote approve reconciles bundle byte-stable vs proposal', () => {
    upsertCandidate(dataDir, vaultId, makeCandidateRecord({ candidate_id: 'cand_integrity2', scope_hint: 'project' }));
    const proposed = handleFlowCaptureProposeRequest({
      dataDir, vaultId, visibleScopes: visible, candidateId: 'cand_integrity2', confirmedScope: 'personal', intent: 'promote', createProposal, starterDir,
    });
    const proposal = getProposal(dataDir, proposed.payload.proposal_id);
    const pre = precheckApprovedCaptureProposal(dataDir, proposal);
    assert.equal(pre.ok, true);
    const body = JSON.parse(proposal.body);
    assert.deepEqual(pre.flow, body.bundle.flow);
    applyCaptureProposal(dataDir, pre);
    const got = getFlow(dataDir, vaultId, pre.flow.flow_id, { filterScopes: visible, starterDir });
    assert.equal(got.flow.scope, 'personal');
    assert.notEqual(got.flow.scope, 'project');
  });

  it('merge sets merged_into terminal on approve', () => {
    const existing = makeFlowBundle({
      flowId: 'flow_integrity_merge',
      steps: 2,
      summary: 'Open target URL verify response record pointer',
    });
    existing.steps[0].instruction = 'Open the target URL verify response record pointer';
    existing.steps[1].instruction = 'Record result pointer verify step';
    applyFlowProposalToIndex(dataDir, vaultId, existing.flow, existing.steps);

    upsertCandidate(
      dataDir,
      vaultId,
      makeCandidateRecord({
        candidate_id: 'cand_integrity3',
        draft_steps: ['Open the target URL', 'Verify response status', 'Record result pointer'],
      }),
    );
    const proposed = handleFlowCaptureProposeRequest({
      dataDir, vaultId, visibleScopes: visible, candidateId: 'cand_integrity3', confirmedScope: 'personal', intent: 'merge', mergeIntoFlowId: 'flow_integrity_merge', createProposal, starterDir,
    });
    assert.equal(proposed.ok, true);
    assert.equal(proposed.payload.proposal_kind, 'flow_candidate_merge');
    const pre = precheckApprovedCaptureProposal(dataDir, getProposal(dataDir, proposed.payload.proposal_id));
    assert.equal(pre.ok, true);
    applyCaptureProposal(dataDir, pre);
    assert.equal(getCandidate(dataDir, vaultId, 'cand_integrity3', visible)?.status, 'merged_into:flow_integrity_merge');
  });

  it('evidence_refs remain pointers after lifecycle', () => {
    const refs = ['hash:deadbeef', 'run:abc', 'proposal:xyz'];
    upsertCandidate(dataDir, vaultId, makeCandidateRecord({ candidate_id: 'cand_integrity4', evidence_refs: refs }));
    const proposed = handleFlowCaptureProposeRequest({
      dataDir, vaultId, visibleScopes: visible, candidateId: 'cand_integrity4', confirmedScope: 'personal', intent: 'x', createProposal, starterDir,
    });
    const pre = precheckApprovedCaptureProposal(dataDir, getProposal(dataDir, proposed.payload.proposal_id));
    applyCaptureProposal(dataDir, pre);
    const after = getCandidate(dataDir, vaultId, 'cand_integrity4', visible);
    assert.deepEqual(after.evidence_refs, refs);
    for (const ref of after.evidence_refs) {
      assert.match(ref, /^(hash:|run:|proposal:|skill:)/);
    }
  });
});

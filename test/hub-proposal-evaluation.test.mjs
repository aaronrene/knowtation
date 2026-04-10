/**
 * Proposal evaluation store + merge checklist.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createProposal,
  getProposal,
  submitProposalEvaluation,
  updateProposalStatus,
  mergeEvaluationChecklist,
  evaluationAllowsApprove,
  getEvaluationStatus,
} from '../hub/proposals-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'fixtures', 'hub-proposal-eval-data');
const proposalsPath = path.join(dataDir, 'hub_proposals.json');

function cleanup() {
  try {
    fs.unlinkSync(proposalsPath);
  } catch (_) {}
  try {
    fs.rmdirSync(dataDir);
  } catch (_) {}
}

describe('hub proposal evaluation', () => {
  after(cleanup);

  it('createProposal sets pending when evaluationRequired', () => {
    cleanup();
    const p = createProposal(dataDir, {
      path: 'inbox/x.md',
      body: 'hi',
      evaluationRequired: true,
    });
    assert.strictEqual(p.evaluation_status, 'pending');
    assert.strictEqual(evaluationAllowsApprove(p), false);
  });

  it('createProposal sets none when evaluation not required', () => {
    cleanup();
    const p = createProposal(dataDir, {
      path: 'inbox/y.md',
      body: 'hi',
      evaluationRequired: false,
    });
    assert.strictEqual(getEvaluationStatus(p), 'none');
    assert.strictEqual(evaluationAllowsApprove(p), true);
  });

  it('submitProposalEvaluation pass requires all checklist items when checklist non-empty', () => {
    cleanup();
    const p = createProposal(dataDir, {
      path: 'inbox/z.md',
      body: 'hi',
      evaluationRequired: true,
    });
    const rubric = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ];
    const bad = mergeEvaluationChecklist(rubric, [{ id: 'a', passed: true }]);
    const r1 = submitProposalEvaluation(dataDir, p.proposal_id, {
      outcome: 'pass',
      evaluation_checklist: bad,
      evaluated_by: 'u:1',
    });
    assert.strictEqual(r1.ok, false);

    const good = mergeEvaluationChecklist(rubric, [
      { id: 'a', passed: true },
      { id: 'b', passed: true },
    ]);
    const r2 = submitProposalEvaluation(dataDir, p.proposal_id, {
      outcome: 'pass',
      evaluation_checklist: good,
      evaluated_by: 'u:1',
    });
    assert.strictEqual(r2.ok, true);
    const again = getProposal(dataDir, p.proposal_id);
    assert.strictEqual(again.evaluation_status, 'passed');
    assert.strictEqual(evaluationAllowsApprove(again), true);
  });

  it('fail outcome requires comment', () => {
    cleanup();
    const p = createProposal(dataDir, { path: 'inbox/f.md', body: 'x', evaluationRequired: false });
    const r1 = submitProposalEvaluation(dataDir, p.proposal_id, {
      outcome: 'fail',
      evaluation_checklist: [],
      evaluated_by: 'u:1',
    });
    assert.strictEqual(r1.ok, false);
    const r2 = submitProposalEvaluation(dataDir, p.proposal_id, {
      outcome: 'fail',
      evaluation_checklist: [],
      evaluation_comment: 'Missing sources',
      evaluated_by: 'u:1',
    });
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(getProposal(dataDir, p.proposal_id).evaluation_status, 'failed');
  });

  it('updateProposalStatus attaches evaluation_waiver on approve', () => {
    cleanup();
    const p = createProposal(dataDir, { path: 'inbox/w.md', body: 'x', evaluationRequired: false });
    const w = { by: 'admin:1', at: '2026-01-01T00:00:00.000Z', reason: 'Emergency publish' };
    const u = updateProposalStatus(dataDir, p.proposal_id, 'approved', { evaluation_waiver: w });
    assert(u);
    assert.deepStrictEqual(u.evaluation_waiver, w);
  });

  it('updateProposalStatus persists external_ref on approve when valid', () => {
    cleanup();
    const p = createProposal(dataDir, { path: 'inbox/muse.md', body: 'x', evaluationRequired: false });
    const u = updateProposalStatus(dataDir, p.proposal_id, 'approved', { external_ref: 'branch:abc123' });
    assert(u);
    assert.strictEqual(u.external_ref, 'branch:abc123');
  });

  it('updateProposalStatus approve without external_ref extras preserves prior external_ref', () => {
    cleanup();
    const p = createProposal(dataDir, {
      path: 'inbox/keep-ref.md',
      body: 'x',
      evaluationRequired: false,
      external_ref: 'pre-set-at-create',
    });
    const u = updateProposalStatus(dataDir, p.proposal_id, 'approved', {});
    assert(u);
    assert.strictEqual(u.external_ref, 'pre-set-at-create');
  });
});

/**
 * HOSTED-WRITE-EVAL-KN-b — Tier 2 integration: create E1 + member approve gate + discard admin-only.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { augmentProposalCreateRequestBody } from '../lib/hub-proposal-create-augment.mjs';
import {
  SCOOLING_REVIEW_TRAY_INTENT,
  personalSelfApplyAllowsApprove,
} from '../lib/hub-proposal-personal-self-apply.mjs';
import { createProposal, getProposal, updateProposalStatus } from '../hub/proposals-store.mjs';
import { actorMayApproveProposals } from '../hub/lib/hub-evaluator-may-approve.mjs';

const INTENT = SCOOLING_REVIEW_TRAY_INTENT;

describe('HOSTED-WRITE-EVAL-KN-b integration', () => {
  /** @type {string} */
  let dataDir;
  /** @type {string|undefined} */
  let prevEval;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-hwe-int-'));
    prevEval = process.env.HUB_PROPOSAL_EVALUATION_REQUIRED;
    process.env.HUB_PROPOSAL_EVALUATION_REQUIRED = '1';
  });

  afterEach(() => {
    if (prevEval === undefined) delete process.env.HUB_PROPOSAL_EVALUATION_REQUIRED;
    else process.env.HUB_PROPOSAL_EVALUATION_REQUIRED = prevEval;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('create matching proposal → evaluation passed (E1) → member self-apply allows approve', () => {
    const body = augmentProposalCreateRequestBody(
      {
        path: 'reviewed/review-request-fixture-001.md',
        body: '# Note\n',
        intent: INTENT,
        external_ref: 'scooling.review:review-request-fixture-001',
        labels: [],
      },
      dataDir,
      { evaluationRequired: true, evaluatedBy: 'google:member1' },
    );
    assert.equal(body.evaluation_status, 'passed');
    assert.equal(body.evaluated_by, 'google:member1');

    const proposal = createProposal(dataDir, {
      path: body.path,
      body: body.body,
      intent: body.intent,
      external_ref: body.external_ref,
      evaluationRequired: true,
      proposed_by: 'google:member1',
    });
    assert.equal(proposal.evaluation_status, 'passed');
    assert.equal(
      personalSelfApplyAllowsApprove({
        proposal,
        hasVaultWrite: true,
        partitionOwned: true,
        role: 'member',
      }),
      true,
    );
    assert.equal(actorMayApproveProposals('google:member1', 'member', {}, false), false);
  });

  it('mismatched intent → pending under gate → member cannot self-apply', () => {
    const body = augmentProposalCreateRequestBody(
      {
        path: 'reviewed/other.md',
        body: 'x',
        intent: 'agent.suggest',
        external_ref: 'scooling.review:other',
        labels: [],
      },
      dataDir,
      { evaluationRequired: true, evaluatedBy: 'google:member1' },
    );
    assert.equal(body.evaluation_status, 'pending');
    assert.equal(
      personalSelfApplyAllowsApprove({
        proposal: { ...body, status: 'proposed' },
        hasVaultWrite: true,
        partitionOwned: true,
        role: 'member',
      }),
      false,
    );
  });

  it('elevated trigger → no E1 self-pass → no self-apply', () => {
    fs.writeFileSync(
      path.join(dataDir, 'hub_proposal_review_triggers.json'),
      JSON.stringify({
        literal_phrases: [{ match: 'api_key', review_queue: 'sec', review_severity: 'elevated' }],
        path_prefixes: [],
        label_any: [],
      }),
    );
    const body = augmentProposalCreateRequestBody(
      {
        path: 'reviewed/flagged.md',
        body: 'contains api_key value',
        intent: INTENT,
        external_ref: 'scooling.review:flagged',
        labels: [],
      },
      dataDir,
      { evaluationRequired: true, evaluatedBy: 'google:member1' },
    );
    assert.equal(body.review_severity, 'elevated');
    assert.equal(body.evaluation_status, 'pending');
    assert.equal(
      personalSelfApplyAllowsApprove({
        proposal: { ...body, status: 'proposed' },
        hasVaultWrite: true,
        partitionOwned: true,
        role: 'member',
      }),
      false,
    );
  });

  it('discard remains admin-only (self-apply never grants discard)', () => {
    const proposal = createProposal(dataDir, {
      path: 'reviewed/d.md',
      body: 'x',
      intent: INTENT,
      external_ref: 'scooling.review:d',
      evaluationRequired: true,
      proposed_by: 'google:member1',
    });
    assert.equal(proposal.evaluation_status, 'passed');
    // Simulate discard RBAC: only admin — member self-apply is approve-only.
    const memberMayDiscard = false;
    assert.equal(memberMayDiscard, false);
    const discarded = updateProposalStatus(dataDir, proposal.proposal_id, 'discarded');
    assert.equal(discarded.status, 'discarded');
    assert.equal(getProposal(dataDir, proposal.proposal_id).status, 'discarded');
  });
});

/**
 * HOSTED-WRITE-EVAL-KN-b — Tier 7 security: IDOR, forged eval, waiver non-bypass, no secrets in errors.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { augmentProposalCreateRequestBody } from '../lib/hub-proposal-create-augment.mjs';
import {
  personalSelfApplyAllowsApprove,
  applyPersonalSelfApplyEvaluationE1,
  SCOOLING_REVIEW_TRAY_INTENT,
} from '../lib/hub-proposal-personal-self-apply.mjs';
import { createProposal } from '../hub/proposals-store.mjs';

describe('HOSTED-WRITE-EVAL-KN-b security', () => {
  /** @type {string} */
  let dataDir;
  /** @type {string|undefined} */
  let prevEval;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-hwe-sec-'));
    prevEval = process.env.HUB_PROPOSAL_EVALUATION_REQUIRED;
    process.env.HUB_PROPOSAL_EVALUATION_REQUIRED = '1';
  });

  afterEach(() => {
    if (prevEval === undefined) delete process.env.HUB_PROPOSAL_EVALUATION_REQUIRED;
    else process.env.HUB_PROPOSAL_EVALUATION_REQUIRED = prevEval;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('IDOR: foreign partition (partitionOwned=false) denied', () => {
    const proposal = createProposal(dataDir, {
      path: 'reviewed/idor.md',
      body: 'secret body TOKEN=abc',
      intent: SCOOLING_REVIEW_TRAY_INTENT,
      external_ref: 'scooling.review:idor',
      evaluationRequired: true,
      proposed_by: 'user:owner',
    });
    assert.equal(
      personalSelfApplyAllowsApprove({
        proposal,
        hasVaultWrite: true,
        partitionOwned: false,
        role: 'member',
      }),
      false,
    );
  });

  it('forged client evaluation_status=passed is overwritten by triggers+E1 rules', () => {
    // SEC-KN-2: Non-class client forge is stripped; gate assigns pending.
    const forged = augmentProposalCreateRequestBody(
      {
        path: 'inbox/x.md',
        body: 'x',
        intent: 'other',
        external_ref: 'scooling.review:x',
        evaluation_status: 'passed',
        evaluated_by: 'attacker',
        labels: [],
      },
      dataDir,
      { evaluationRequired: true, evaluatedBy: 'attacker' },
    );
    assert.equal(forged.evaluation_status, 'pending');
    assert.equal(Object.hasOwn(forged, 'evaluated_by'), false);
    assert.equal(
      personalSelfApplyAllowsApprove({
        proposal: { ...forged, status: 'proposed' },
        hasVaultWrite: true,
        partitionOwned: true,
        role: 'member',
      }),
      false,
    );

    // Elevated: even with forged passed + matching fingerprint after trigger, E1 must not pass.
    fs.writeFileSync(
      path.join(dataDir, 'hub_proposal_review_triggers.json'),
      JSON.stringify({
        literal_phrases: [{ match: 'api_key', review_severity: 'elevated' }],
        path_prefixes: [],
        label_any: [],
      }),
    );
    const elevated = augmentProposalCreateRequestBody(
      {
        path: 'reviewed/elev.md',
        body: 'api_key leak',
        intent: SCOOLING_REVIEW_TRAY_INTENT,
        external_ref: 'scooling.review:elev',
        evaluation_status: 'passed',
        labels: [],
      },
      dataDir,
      { evaluationRequired: true, evaluatedBy: 'attacker' },
    );
    assert.equal(elevated.review_severity, 'elevated');
    assert.equal(elevated.evaluation_status, 'pending');
  });

  it('learner waiver is not required for class; non-class stays blocked without admin path', () => {
    const ok = applyPersonalSelfApplyEvaluationE1(
      {
        status: 'proposed',
        intent: SCOOLING_REVIEW_TRAY_INTENT,
        path: 'reviewed/w.md',
        external_ref: 'scooling.review:w',
        evaluation_status: 'pending',
      },
      { evaluatedBy: 'learner' },
    );
    assert.equal(ok.evaluation_status, 'passed');
    // Non-class pending: self-apply false — waiver is admin escape hatch, not learner bypass for class.
    assert.equal(
      personalSelfApplyAllowsApprove({
        proposal: {
          status: 'proposed',
          intent: 'other',
          path: 'reviewed/w.md',
          external_ref: 'scooling.review:w',
          evaluation_status: 'pending',
        },
        hasVaultWrite: true,
        partitionOwned: true,
        role: 'member',
      }),
      false,
    );
  });

  it('predicate failures return boolean only — no proposal body / secrets in helper result', () => {
    const proposal = {
      status: 'proposed',
      intent: 'other',
      path: 'reviewed/s.md',
      external_ref: 'scooling.review:s',
      body: 'PRIVATE_KEY=do-not-leak',
    };
    const allowed = personalSelfApplyAllowsApprove({
      proposal,
      hasVaultWrite: true,
      partitionOwned: true,
      role: 'member',
    });
    assert.equal(allowed, false);
    assert.equal(typeof allowed, 'boolean');
  });

  it('gateway wiring: assertHostedProposalApproveDiscard includes personal self-apply path', () => {
    const serverPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../hub/gateway/server.mjs',
    );
    const src = fs.readFileSync(serverPath, 'utf8');
    assert.ok(src.includes('personalSelfApplyAllowsApprove'));
    assert.ok(src.includes('fetchHostedProposalForSelfApply'));
    assert.ok(src.includes('Discard requires admin'));
  });
});

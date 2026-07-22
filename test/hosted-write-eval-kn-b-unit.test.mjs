/**
 * HOSTED-WRITE-EVAL-KN-b — Tier 1 unit: personal self-apply predicate.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCOOLING_REVIEW_TRAY_INTENT,
  matchesScoolingReviewTrayFingerprint,
  isElevatedOrAutoFlagged,
  isPersonalSelfApplyClass,
  applyPersonalSelfApplyEvaluationE1,
  parseAutoFlagReasons,
  personalSelfApplyAllowsApprove,
} from '../lib/hub-proposal-personal-self-apply.mjs';

function matchingProposal(overrides = {}) {
  return {
    status: 'proposed',
    intent: SCOOLING_REVIEW_TRAY_INTENT,
    external_ref: 'scooling.review:fixture-001',
    path: 'reviewed/fixture-001.md',
    review_severity: 'standard',
    ...overrides,
  };
}

describe('HOSTED-WRITE-EVAL-KN-b unit — predicate', () => {
  it('matches fingerprint when intent, external_ref, and path hold', () => {
    assert.equal(matchesScoolingReviewTrayFingerprint(matchingProposal()), true);
  });

  it('rejects mismatched intent', () => {
    assert.equal(
      matchesScoolingReviewTrayFingerprint(matchingProposal({ intent: 'other.intent' })),
      false,
    );
  });

  it('rejects bad external_ref and path', () => {
    assert.equal(
      matchesScoolingReviewTrayFingerprint(matchingProposal({ external_ref: 'muse:abc' })),
      false,
    );
    assert.equal(
      matchesScoolingReviewTrayFingerprint(matchingProposal({ path: 'inbox/x.md' })),
      false,
    );
  });

  it('detects elevated and auto-flag reasons (array + json)', () => {
    assert.equal(isElevatedOrAutoFlagged(matchingProposal({ review_severity: 'elevated' })), true);
    assert.equal(
      isElevatedOrAutoFlagged(matchingProposal({ auto_flag_reasons: ['phrase:secret'] })),
      true,
    );
    assert.equal(
      isElevatedOrAutoFlagged(
        matchingProposal({ auto_flag_reasons_json: JSON.stringify(['path_prefix:legal/']) }),
      ),
      true,
    );
    assert.equal(parseAutoFlagReasons(matchingProposal()).length, 0);
    assert.equal(isElevatedOrAutoFlagged(matchingProposal()), false);
  });

  it('full class requires vault:write, partition, proposed, fingerprint, not elevated', () => {
    assert.equal(
      isPersonalSelfApplyClass({
        proposal: matchingProposal(),
        hasVaultWrite: true,
        partitionOwned: true,
        role: 'member',
      }),
      true,
    );
    assert.equal(
      isPersonalSelfApplyClass({
        proposal: matchingProposal(),
        hasVaultWrite: false,
        partitionOwned: true,
        role: 'member',
      }),
      false,
    );
    assert.equal(
      isPersonalSelfApplyClass({
        proposal: matchingProposal({ status: 'approved' }),
        hasVaultWrite: true,
        partitionOwned: true,
        role: 'member',
      }),
      false,
    );
    assert.equal(
      isPersonalSelfApplyClass({
        proposal: matchingProposal({ review_severity: 'elevated' }),
        hasVaultWrite: true,
        partitionOwned: true,
        role: 'member',
      }),
      false,
    );
  });

  it('E1 sets passed only when fingerprint matches and not elevated; clears forged passed on elevated', () => {
    const passed = applyPersonalSelfApplyEvaluationE1(
      { ...matchingProposal(), evaluation_status: 'pending' },
      { evaluatedBy: 'google:learner', evaluatedAt: '2026-07-22T00:00:00.000Z' },
    );
    assert.equal(passed.evaluation_status, 'passed');
    assert.equal(passed.evaluated_by, 'google:learner');
    assert.equal(passed.evaluated_at, '2026-07-22T00:00:00.000Z');

    const elevated = applyPersonalSelfApplyEvaluationE1(
      {
        ...matchingProposal({ review_severity: 'elevated' }),
        evaluation_status: 'passed',
        auto_flag_reasons: ['phrase:x'],
        evaluated_by: 'forged',
      },
      { evaluatedBy: 'google:learner' },
    );
    assert.equal(elevated.evaluation_status, 'pending');
    assert.equal(elevated.evaluated_by, undefined);

    const mismatch = applyPersonalSelfApplyEvaluationE1(
      { intent: 'other', path: 'reviewed/a.md', external_ref: 'scooling.review:a', evaluation_status: 'pending' },
      { evaluatedBy: 'u' },
    );
    assert.equal(mismatch.evaluation_status, 'pending');
  });

  it('approve helper mirrors class check', () => {
    assert.equal(
      personalSelfApplyAllowsApprove({
        proposal: matchingProposal(),
        hasVaultWrite: true,
        partitionOwned: true,
        role: 'member',
      }),
      true,
    );
  });
});

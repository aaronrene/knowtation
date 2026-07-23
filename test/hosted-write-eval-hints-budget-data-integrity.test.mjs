/**
 * HOSTED-WRITE-EVAL hints budget — Tier 5 data-integrity: skip predicate + budget cap invariants.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SCOOLING_REVIEW_TRAY_INTENT } from '../lib/hub-proposal-personal-self-apply.mjs';
import {
  HOSTED_PROPOSAL_REVIEW_HINTS_INLINE_BUDGET_MS,
  shouldSkipInlineReviewHintsOnCreate,
} from '../hub/gateway/proposal-review-hints-async.mjs';

describe('hosted review-hints budget (data-integrity)', () => {
  it('skip is exact-intent only (no substring / case drift)', () => {
    assert.equal(shouldSkipInlineReviewHintsOnCreate({ intent: SCOOLING_REVIEW_TRAY_INTENT }), true);
    assert.equal(
      shouldSkipInlineReviewHintsOnCreate({ intent: `${SCOOLING_REVIEW_TRAY_INTENT} ` }),
      true,
    );
    assert.equal(
      shouldSkipInlineReviewHintsOnCreate({ intent: 'Scooling.review_tray.approve' }),
      false,
    );
    assert.equal(
      shouldSkipInlineReviewHintsOnCreate({ intent: 'scooling.review_tray.approve.extra' }),
      false,
    );
  });

  it('budget constant stays a positive integer under 15s', () => {
    assert.equal(Number.isInteger(HOSTED_PROPOSAL_REVIEW_HINTS_INLINE_BUDGET_MS), true);
    assert.ok(HOSTED_PROPOSAL_REVIEW_HINTS_INLINE_BUDGET_MS > 0);
    assert.ok(HOSTED_PROPOSAL_REVIEW_HINTS_INLINE_BUDGET_MS <= 5000);
  });
});

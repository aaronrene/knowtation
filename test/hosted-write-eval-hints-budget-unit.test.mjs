/**
 * HOSTED-WRITE-EVAL hints budget — Tier 1 unit: skip + default budget constants.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SCOOLING_REVIEW_TRAY_INTENT } from '../lib/hub-proposal-personal-self-apply.mjs';
import {
  HOSTED_PROPOSAL_REVIEW_HINTS_INLINE_BUDGET_MS,
  shouldSkipInlineReviewHintsOnCreate,
} from '../hub/gateway/proposal-review-hints-async.mjs';

describe('hosted review-hints inline budget (unit)', () => {
  it('default inline budget is 2000 ms (under Scooling 15s abort)', () => {
    assert.equal(HOSTED_PROPOSAL_REVIEW_HINTS_INLINE_BUDGET_MS, 2000);
    assert.ok(HOSTED_PROPOSAL_REVIEW_HINTS_INLINE_BUDGET_MS < 15_000);
  });

  it('skips Scooling review-tray intent on create', () => {
    assert.equal(
      shouldSkipInlineReviewHintsOnCreate({ intent: SCOOLING_REVIEW_TRAY_INTENT }),
      true,
    );
  });

  it('does not skip ordinary Hub create intents', () => {
    assert.equal(shouldSkipInlineReviewHintsOnCreate({ intent: 'note.update' }), false);
    assert.equal(shouldSkipInlineReviewHintsOnCreate({}), false);
    assert.equal(shouldSkipInlineReviewHintsOnCreate(null), false);
  });
});

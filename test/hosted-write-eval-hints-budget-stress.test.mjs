/**
 * HOSTED-WRITE-EVAL hints budget — Tier 4 stress: repeated skip + budget races.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SCOOLING_REVIEW_TRAY_INTENT } from '../lib/hub-proposal-personal-self-apply.mjs';
import {
  HOSTED_PROPOSAL_REVIEW_HINTS_INLINE_BUDGET_MS,
  maybeScheduleHostedProposalReviewHints,
  shouldSkipInlineReviewHintsOnCreate,
} from '../hub/gateway/proposal-review-hints-async.mjs';

describe('hosted review-hints budget (stress)', () => {
  it('N self-apply skips stay cheap and consistent', async () => {
    const N = 40;
    const started = Date.now();
    for (let i = 0; i < N; i++) {
      assert.equal(
        shouldSkipInlineReviewHintsOnCreate({ intent: SCOOLING_REVIEW_TRAY_INTENT }),
        true,
      );
      await maybeScheduleHostedProposalReviewHints({
        method: 'POST',
        pathOnly: '/api/v1/proposals',
        upstreamStatus: 200,
        responseText: JSON.stringify({ proposal_id: `prop-stress-${i}` }),
        canisterUrl: 'https://example.invalid',
        effectiveUserId: `user-${i % 3}`,
        actorUserId: `user-${i % 3}`,
        vaultId: 'default',
        hintsEnabled: true,
        createBody: { intent: SCOOLING_REVIEW_TRAY_INTENT },
      });
    }
    assert.ok(Date.now() - started < 1000);
    assert.equal(HOSTED_PROPOSAL_REVIEW_HINTS_INLINE_BUDGET_MS, 2000);
  });
});

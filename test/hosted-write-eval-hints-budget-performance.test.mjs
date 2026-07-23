/**
 * HOSTED-WRITE-EVAL hints budget — Tier 6 performance: skip + budget race wall times.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SCOOLING_REVIEW_TRAY_INTENT } from '../lib/hub-proposal-personal-self-apply.mjs';
import {
  HOSTED_PROPOSAL_REVIEW_HINTS_INLINE_BUDGET_MS,
  maybeScheduleHostedProposalReviewHints,
} from '../hub/gateway/proposal-review-hints-async.mjs';

describe('hosted review-hints budget (performance)', () => {
  it('self-apply skip completes in under 50ms', async () => {
    const t0 = performance.now();
    await maybeScheduleHostedProposalReviewHints({
      method: 'POST',
      pathOnly: '/api/v1/proposals',
      upstreamStatus: 200,
      responseText: JSON.stringify({ proposal_id: 'prop-perf-1' }),
      canisterUrl: 'https://example.invalid',
      effectiveUserId: 'u',
      actorUserId: 'u',
      vaultId: 'default',
      hintsEnabled: true,
      createBody: { intent: SCOOLING_REVIEW_TRAY_INTENT },
    });
    assert.ok(performance.now() - t0 < 50);
  });

  it('default budget constant is 2000', () => {
    assert.equal(HOSTED_PROPOSAL_REVIEW_HINTS_INLINE_BUDGET_MS, 2000);
  });

  it('budget race returns within budget + small slack', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => {
      await new Promise((r) => setTimeout(r, 2000));
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    try {
      const t0 = performance.now();
      await maybeScheduleHostedProposalReviewHints(
        {
          method: 'POST',
          pathOnly: '/api/v1/proposals',
          upstreamStatus: 200,
          responseText: JSON.stringify({ proposal_id: 'prop-perf-2' }),
          canisterUrl: 'https://example.invalid',
          effectiveUserId: 'u',
          actorUserId: 'u',
          vaultId: 'default',
          hintsEnabled: true,
          createBody: { intent: 'other' },
        },
        100,
      );
      const elapsed = performance.now() - t0;
      assert.ok(elapsed < 350, `expected ~100ms race, got ${elapsed}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

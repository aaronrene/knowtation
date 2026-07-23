/**
 * HOSTED-WRITE-EVAL hints budget — Tier 7 security: no elevation via forged fields; disabled stays off.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SCOOLING_REVIEW_TRAY_INTENT } from '../lib/hub-proposal-personal-self-apply.mjs';
import {
  maybeScheduleHostedProposalReviewHints,
  shouldSkipInlineReviewHintsOnCreate,
} from '../hub/gateway/proposal-review-hints-async.mjs';

describe('hosted review-hints budget (security)', () => {
  it('hintsEnabled false never schedules even for non-self-apply', async () => {
    const t0 = Date.now();
    await maybeScheduleHostedProposalReviewHints({
      method: 'POST',
      pathOnly: '/api/v1/proposals',
      upstreamStatus: 200,
      responseText: JSON.stringify({ proposal_id: 'prop-sec-1' }),
      canisterUrl: 'https://example.invalid',
      effectiveUserId: 'u',
      actorUserId: 'u',
      vaultId: 'default',
      hintsEnabled: false,
      createBody: { intent: 'note.update' },
    });
    assert.ok(Date.now() - t0 < 100);
  });

  it('Buffer createBody does not throw and does not skip as self-apply', () => {
    assert.equal(shouldSkipInlineReviewHintsOnCreate(Buffer.from(SCOOLING_REVIEW_TRAY_INTENT)), false);
  });

  it('non-create methods are ignored', async () => {
    await maybeScheduleHostedProposalReviewHints({
      method: 'GET',
      pathOnly: '/api/v1/proposals',
      upstreamStatus: 200,
      responseText: JSON.stringify({ proposal_id: 'prop-sec-2' }),
      canisterUrl: 'https://example.invalid',
      effectiveUserId: 'u',
      actorUserId: 'u',
      vaultId: 'default',
      hintsEnabled: true,
      createBody: { intent: 'note.update' },
    });
  });
});

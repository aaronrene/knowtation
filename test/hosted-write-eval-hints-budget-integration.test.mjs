/**
 * HOSTED-WRITE-EVAL hints budget — Tier 2 integration: schedule respects skip + budget race.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SCOOLING_REVIEW_TRAY_INTENT } from '../lib/hub-proposal-personal-self-apply.mjs';
import { maybeScheduleHostedProposalReviewHints } from '../hub/gateway/proposal-review-hints-async.mjs';

describe('hosted review-hints inline schedule (integration)', () => {
  it('returns immediately for Scooling self-apply create without waiting on LLM', async () => {
    const started = Date.now();
    await maybeScheduleHostedProposalReviewHints({
      method: 'POST',
      pathOnly: '/api/v1/proposals',
      upstreamStatus: 200,
      responseText: JSON.stringify({ proposal_id: 'prop-skip-1' }),
      canisterUrl: 'https://example.invalid',
      effectiveUserId: 'user-a',
      actorUserId: 'user-a',
      vaultId: 'default',
      hintsEnabled: true,
      createBody: { intent: SCOOLING_REVIEW_TRAY_INTENT, path: 'reviewed/x.md', body: 'n' },
    });
    assert.ok(Date.now() - started < 200, 'self-apply skip must not await hints job');
  });

  it('honors short budget when hintsEnabled and non-self-apply', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => {
      await new Promise((r) => setTimeout(r, 500));
      return new Response(JSON.stringify({ status: 'proposed', path: 'a.md', body: 'x' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    try {
      const started = Date.now();
      await maybeScheduleHostedProposalReviewHints(
        {
          method: 'POST',
          pathOnly: '/api/v1/proposals',
          upstreamStatus: 200,
          responseText: JSON.stringify({ proposal_id: 'prop-budget-1' }),
          canisterUrl: 'https://example.invalid',
          effectiveUserId: 'user-a',
          actorUserId: 'user-a',
          vaultId: 'default',
          hintsEnabled: true,
          createBody: { intent: 'note.update', path: 'a.md', body: 'x' },
        },
        80,
      );
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 400, `budget race should finish quickly, got ${elapsed}ms`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

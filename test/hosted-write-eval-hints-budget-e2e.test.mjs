/**
 * HOSTED-WRITE-EVAL hints budget — Tier 3 e2e: gateway wiring passes createBody.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('hosted review-hints gateway wiring (e2e source)', () => {
  it('server.mjs passes createBody into maybeScheduleHostedProposalReviewHints', () => {
    const src = readFileSync(join(root, 'hub/gateway/server.mjs'), 'utf8');
    assert.ok(src.includes('maybeScheduleHostedProposalReviewHints'));
    assert.ok(/createBody:\s*bodyOut/.test(src));
  });

  it('async module exports capped budget constant', () => {
    const src = readFileSync(join(root, 'hub/gateway/proposal-review-hints-async.mjs'), 'utf8');
    assert.ok(src.includes('HOSTED_PROPOSAL_REVIEW_HINTS_INLINE_BUDGET_MS = 2000'));
    assert.ok(src.includes('shouldSkipInlineReviewHintsOnCreate'));
    assert.ok(!src.includes('budgetMs = 18000'));
  });
});

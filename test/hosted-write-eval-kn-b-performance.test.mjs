/**
 * HOSTED-WRITE-EVAL-KN-b — Tier 6 performance: predicate + E1 within budget (no extra Hub round trips for E1).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPersonalSelfApplyEvaluationE1,
  isPersonalSelfApplyClass,
  SCOOLING_REVIEW_TRAY_INTENT,
} from '../lib/hub-proposal-personal-self-apply.mjs';

const ITER = 5000;
/** Pure predicate + E1 must stay well under a typical Hub RTT (no network). */
const BUDGET_MS = 250;

describe('HOSTED-WRITE-EVAL-KN-b performance', () => {
  it(`predicate + E1 × ${ITER} completes within ${BUDGET_MS}ms`, () => {
    const base = {
      status: 'proposed',
      intent: SCOOLING_REVIEW_TRAY_INTENT,
      external_ref: 'scooling.review:perf',
      path: 'reviewed/perf.md',
      evaluation_status: 'pending',
    };
    const t0 = performance.now();
    for (let i = 0; i < ITER; i++) {
      const body = applyPersonalSelfApplyEvaluationE1(
        { ...base, external_ref: `scooling.review:perf-${i}` },
        { evaluatedBy: 'u' },
      );
      assert.equal(body.evaluation_status, 'passed');
      assert.equal(
        isPersonalSelfApplyClass({
          proposal: { ...body, status: 'proposed' },
          hasVaultWrite: true,
          partitionOwned: true,
          role: 'member',
        }),
        true,
      );
    }
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < BUDGET_MS, `elapsed ${elapsed.toFixed(1)}ms exceeds ${BUDGET_MS}ms`);
  });
});

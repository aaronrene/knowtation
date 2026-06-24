/**
 * After a successful bridge index, record embedding_input_tokens for hosted billing telemetry.
 * Enforcement by token cap is documented in HOSTED-CREDITS-DESIGN.md (future: pre-flight or post-hoc policy).
 */
import { billingShadowLogEnabled } from './billing-constants.mjs';
import { defaultUserRecord, normalizeBillingUser, effectiveMonthlyIndexingTokensIncluded } from './billing-logic.mjs';
import { mutateBillingDb } from './billing-store.mjs';

/**
 * @param {string|null} uid
 * @param {number} statusCode
 * @param {string} bodyText
 */
export async function recordIndexingTokensAfterBridgeIndex(uid, statusCode, bodyText) {
  if (!uid || statusCode !== 200 || typeof bodyText !== 'string') return;
  let j;
  try {
    j = JSON.parse(bodyText);
  } catch {
    return;
  }
  const t = j.embedding_input_tokens;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) return;
  const tokens = Math.floor(t);
  if (tokens === 0) return;

  await mutateBillingDb((db) => {
    const u = db.users[uid] || defaultUserRecord(uid);
    normalizeBillingUser(u);
    if (!db.users[uid]) db.users[uid] = u;

    // Increment both counters atomically in one write to avoid a race with runBillingGate.
    // A separate write from the billing middleware risks reading a stale Blob snapshot and
    // overwriting the job counter back to 0 on Netlify's eventually-consistent store.
    u.monthly_index_jobs_used =
      Math.max(0, Math.floor(Number(u.monthly_index_jobs_used) || 0)) + 1;

    const prevTokensUsed = Math.max(0, Math.floor(Number(u.monthly_indexing_tokens_used) || 0));
    const newTokensUsed = prevTokensUsed + tokens;
    u.monthly_indexing_tokens_used = newTokensUsed;

    // Deduct from pack balance: only the marginal tokens that exceed the monthly included allotment.
    // This keeps pack_indexing_tokens_balance accurate for display even before BILLING_ENFORCE=true.
    // When the billing period resets (monthly_indexing_tokens_used → 0), the overflow restarts
    // from zero so the pack balance is not double-charged.
    const monthlyIncluded = effectiveMonthlyIndexingTokensIncluded(u);
    if (monthlyIncluded !== null) {
      const prevOverflow = Math.max(0, prevTokensUsed - monthlyIncluded);
      const newOverflow = Math.max(0, newTokensUsed - monthlyIncluded);
      const packDeduction = newOverflow - prevOverflow;
      if (packDeduction > 0) {
        u.pack_indexing_tokens_balance = Math.max(
          0,
          Math.floor(Number(u.pack_indexing_tokens_balance) || 0) - packDeduction,
        );
      }
    }
  });

  if (billingShadowLogEnabled()) {
    console.log(
      JSON.stringify({
        type: 'knowtation_billing_shadow',
        ts: new Date().toISOString(),
        user_id: uid,
        operation: 'index',
        phase: 'post_index',
        embedding_input_tokens: tokens,
        path: '/api/v1/index',
      }),
    );
  }
}

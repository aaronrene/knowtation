/**
 * After bridge accepts or completes an index, record hosted billing telemetry.
 * Sync 200 responses can include embedding_input_tokens. Background 202 responses
 * count as accepted jobs; token usage is unavailable until the bridge worker
 * finishes outside the gateway request lifecycle.
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
  if (!uid || (statusCode !== 200 && statusCode !== 202) || typeof bodyText !== 'string') return;
  let j;
  try {
    j = JSON.parse(bodyText);
  } catch {
    return;
  }

  const backgroundAccepted = statusCode === 202 && j?.status === 'background';
  const syncSucceeded = statusCode === 200;
  if (!backgroundAccepted && !syncSucceeded) return;

  let tokens = 0;
  if (syncSucceeded) {
    const t = j.embedding_input_tokens;
    if (t !== undefined) {
      if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) return;
      tokens = Math.floor(t);
    }
  }

  await mutateBillingDb((db) => {
    const u = db.users[uid] || defaultUserRecord(uid);
    normalizeBillingUser(u);
    if (!db.users[uid]) db.users[uid] = u;

    // Increment both counters atomically in one write to avoid a race with runBillingGate.
    // A separate write from the billing middleware risks reading a stale Blob snapshot and
    // overwriting the job counter back to 0 on Netlify's eventually-consistent store.
    u.monthly_index_jobs_used =
      Math.max(0, Math.floor(Number(u.monthly_index_jobs_used) || 0)) + 1;

    if (tokens === 0) return;

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
        phase: backgroundAccepted ? 'background_accepted' : 'post_index',
        embedding_input_tokens: tokens,
        path: '/api/v1/index',
      }),
    );
  }
}

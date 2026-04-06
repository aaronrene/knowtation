/**
 * After a successful bridge index, record embedding_input_tokens for hosted billing telemetry.
 * Enforcement by token cap is documented in HOSTED-CREDITS-DESIGN.md (future: pre-flight or post-hoc policy).
 */
import { billingShadowLogEnabled } from './billing-constants.mjs';
import { defaultUserRecord, normalizeBillingUser } from './billing-logic.mjs';
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
    u.monthly_indexing_tokens_used =
      Math.max(0, Math.floor(Number(u.monthly_indexing_tokens_used) || 0)) + tokens;
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

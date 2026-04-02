/**
 * GET /api/v1/billing/summary
 */
import {
  billingEnforced,
  COST_BREAKDOWN,
  INDEXING_TOKENS_POLICY,
  MONTHLY_INCLUDED_CENTS_BY_TIER,
  NOTE_CAP_BY_TIER,
} from './billing-constants.mjs';
import {
  defaultUserRecord,
  effectiveMonthlyIndexingTokensIncluded,
  effectiveMonthlySearchesIncluded,
  effectiveMonthlyIndexJobsIncluded,
  normalizeBillingUser,
} from './billing-logic.mjs';
import { loadBillingDb, resetMonthlyTokensIfNeeded } from './billing-store.mjs';

function effectiveMonthlyIncludedCents(u) {
  if (u.tier === 'free') return MONTHLY_INCLUDED_CENTS_BY_TIER.free ?? 0;
  return Math.max(0, Math.floor(Number(u.monthly_included_cents) || 0));
}

export async function handleBillingSummary(req, res, getUserId) {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });

  await resetMonthlyTokensIfNeeded(uid);

  const db = await loadBillingDb();
  const u = normalizeBillingUser(db.users[uid] || defaultUserRecord(uid));

  const tier = u.tier || 'beta';
  const noteCapRaw = NOTE_CAP_BY_TIER[tier];
  const noteCap = noteCapRaw === undefined ? null : noteCapRaw;

  return res.json({
    tier,
    period_start: u.period_start,
    period_end: u.period_end,
    monthly_included_cents: u.monthly_included_cents,
    monthly_included_effective_cents: effectiveMonthlyIncludedCents(u),
    monthly_used_cents: u.monthly_used_cents,
    addon_cents: u.addon_cents,
    billing_enforced: billingEnforced(),
    stripe_configured: Boolean(process.env.STRIPE_SECRET_KEY),
    has_active_subscription: Boolean(u.stripe_subscription_id),
    credit_policy:
      '1 credit = $1 of platform metered usage. Credits are prepaid balance for Knowtation hosted only; not tradable, not a security.',
    monthly_indexing_tokens_included: effectiveMonthlyIndexingTokensIncluded(u),
    monthly_indexing_tokens_used: Math.max(0, Math.floor(Number(u.monthly_indexing_tokens_used) || 0)),
    pack_indexing_tokens_balance: Math.max(0, Math.floor(Number(u.pack_indexing_tokens_balance) || 0)),
    monthly_searches_used: Math.max(0, Math.floor(Number(u.monthly_searches_used) || 0)),
    monthly_searches_included: effectiveMonthlySearchesIncluded(u),
    monthly_index_jobs_used: Math.max(0, Math.floor(Number(u.monthly_index_jobs_used) || 0)),
    monthly_index_jobs_included: effectiveMonthlyIndexJobsIncluded(u),
    note_cap: noteCap,
    indexing_tokens_policy: INDEXING_TOKENS_POLICY,
    cost_breakdown: COST_BREAKDOWN,
    usage_chart_status:
      'planned: time-series usage + chart in Hub (not required for launch); shadow logs via BILLING_SHADOW_LOG for research.',
  });
}

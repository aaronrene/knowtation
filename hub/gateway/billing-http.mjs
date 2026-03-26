/**
 * GET /api/v1/billing/summary
 */
import {
  billingEnforced,
  COST_BREAKDOWN,
  INDEXING_TOKENS_POLICY,
  MONTHLY_INCLUDED_CENTS_BY_TIER,
} from './billing-constants.mjs';
import {
  defaultUserRecord,
  effectiveMonthlyIndexingTokensIncluded,
  normalizeBillingUser,
} from './billing-logic.mjs';
import { loadBillingDb } from './billing-store.mjs';

function effectiveMonthlyIncludedCents(u) {
  if (u.tier === 'free') return MONTHLY_INCLUDED_CENTS_BY_TIER.free ?? 0;
  return Math.max(0, Math.floor(Number(u.monthly_included_cents) || 0));
}

export async function handleBillingSummary(req, res, getUserId) {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });

  const db = await loadBillingDb();
  const u = normalizeBillingUser(db.users[uid] || defaultUserRecord(uid));

  return res.json({
    tier: u.tier,
    period_start: u.period_start,
    period_end: u.period_end,
    monthly_included_cents: u.monthly_included_cents,
    monthly_included_effective_cents: effectiveMonthlyIncludedCents(u),
    monthly_used_cents: u.monthly_used_cents,
    addon_cents: u.addon_cents,
    billing_enforced: billingEnforced(),
    stripe_configured: Boolean(process.env.STRIPE_SECRET_KEY),
    credit_policy:
      '1 credit = $1 of platform metered usage. Credits are prepaid balance for Knowtation hosted only; not tradable, not a security.',
    monthly_indexing_tokens_included: effectiveMonthlyIndexingTokensIncluded(u),
    monthly_indexing_tokens_used: Math.max(0, Math.floor(Number(u.monthly_indexing_tokens_used) || 0)),
    pack_indexing_tokens_balance: Math.max(0, Math.floor(Number(u.pack_indexing_tokens_balance) || 0)),
    indexing_tokens_policy: INDEXING_TOKENS_POLICY,
    cost_breakdown: COST_BREAKDOWN,
    usage_chart_status:
      'planned: time-series usage + chart in Hub (not required for launch); shadow logs via BILLING_SHADOW_LOG for research.',
  });
}

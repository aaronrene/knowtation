/**
 * Deduction order: monthly included first, then add-on rollover (Netlify-style).
 */
import {
  MONTHLY_INCLUDED_CENTS_BY_TIER,
  MONTHLY_INDEXING_TOKENS_INCLUDED_BY_TIER,
  MONTHLY_SEARCHES_INCLUDED_BY_TIER,
  MONTHLY_INDEX_JOBS_INCLUDED_BY_TIER,
  CONSOLIDATION_PASSES_BY_TIER,
  PACK_TOKENS,
  PACK_CONSOLIDATIONS,
} from './billing-constants.mjs';
import {
  clampConsolidationInt,
  HOSTED_CONSOL_DEFAULT_LOOKBACK_HOURS,
  HOSTED_CONSOL_DEFAULT_MAX_EVENTS,
  HOSTED_CONSOL_DEFAULT_MAX_TOPICS,
  HOSTED_CONSOL_DEFAULT_LLM_MAX_TOKENS,
  HOSTED_CONSOL_LOOKBACK_MIN,
  HOSTED_CONSOL_LOOKBACK_MAX,
  HOSTED_CONSOL_MAX_EVENTS_MIN,
  HOSTED_CONSOL_MAX_EVENTS_MAX,
  HOSTED_CONSOL_MAX_TOPICS_MIN,
  HOSTED_CONSOL_MAX_TOPICS_MAX,
  HOSTED_CONSOL_LLM_TOKENS_MIN,
  HOSTED_CONSOL_LLM_TOKENS_MAX,
} from '../../lib/hosted-consolidation-advanced.mjs';

/**
 * @param {object} u - Billing user record
 * @returns {number|null} null = unlimited (beta or pro)
 */
export function effectiveMonthlyIndexingTokensIncluded(u) {
  const tier = String(u?.tier || 'beta');
  if (tier === 'beta') return null;
  const val = MONTHLY_INDEXING_TOKENS_INCLUDED_BY_TIER[tier];
  if (val === null || val === undefined) return null;
  if (tier === 'free') return val;
  return val;
}

/** Ensure all billing fields exist on loaded JSON records. */
export function normalizeBillingUser(u) {
  if (!u || typeof u !== 'object') return u;
  if (typeof u.monthly_indexing_tokens_used !== 'number' || !Number.isFinite(u.monthly_indexing_tokens_used)) {
    u.monthly_indexing_tokens_used = 0;
  }
  if (typeof u.pack_indexing_tokens_balance !== 'number' || !Number.isFinite(u.pack_indexing_tokens_balance)) {
    u.pack_indexing_tokens_balance = 0;
  }
  if (typeof u.pack_consolidation_passes_balance !== 'number' || !Number.isFinite(u.pack_consolidation_passes_balance)) {
    u.pack_consolidation_passes_balance = 0;
  }
  if (u.pack_consolidation_legacy_inferred !== true) {
    u.pack_consolidation_legacy_inferred = false;
  }
  if (typeof u.monthly_searches_used !== 'number' || !Number.isFinite(u.monthly_searches_used)) {
    u.monthly_searches_used = 0;
  }
  if (typeof u.monthly_index_jobs_used !== 'number' || !Number.isFinite(u.monthly_index_jobs_used)) {
    u.monthly_index_jobs_used = 0;
  }
  if (typeof u.monthly_consolidation_jobs_used !== 'number' || !Number.isFinite(u.monthly_consolidation_jobs_used)) {
    u.monthly_consolidation_jobs_used = 0;
  }
  if (u.consolidation_enabled === undefined) {
    u.consolidation_enabled = false;
  }
  if (u.consolidation_last_pass_at === undefined) {
    u.consolidation_last_pass_at = null;
  }
  if (u.consolidation_interval_minutes === undefined) {
    u.consolidation_interval_minutes = null;
  }
  if (!u.consolidation_passes || typeof u.consolidation_passes !== 'object') {
    u.consolidation_passes = { consolidate: true, verify: true, discover: false };
  }
  u.consolidation_lookback_hours = clampConsolidationInt(
    u.consolidation_lookback_hours,
    HOSTED_CONSOL_LOOKBACK_MIN,
    HOSTED_CONSOL_LOOKBACK_MAX,
    HOSTED_CONSOL_DEFAULT_LOOKBACK_HOURS,
  );
  u.consolidation_max_events_per_pass = clampConsolidationInt(
    u.consolidation_max_events_per_pass,
    HOSTED_CONSOL_MAX_EVENTS_MIN,
    HOSTED_CONSOL_MAX_EVENTS_MAX,
    HOSTED_CONSOL_DEFAULT_MAX_EVENTS,
  );
  u.consolidation_max_topics_per_pass = clampConsolidationInt(
    u.consolidation_max_topics_per_pass,
    HOSTED_CONSOL_MAX_TOPICS_MIN,
    HOSTED_CONSOL_MAX_TOPICS_MAX,
    HOSTED_CONSOL_DEFAULT_MAX_TOPICS,
  );
  u.consolidation_llm_max_tokens = clampConsolidationInt(
    u.consolidation_llm_max_tokens,
    HOSTED_CONSOL_LLM_TOKENS_MIN,
    HOSTED_CONSOL_LLM_TOKENS_MAX,
    HOSTED_CONSOL_DEFAULT_LLM_MAX_TOKENS,
  );
  return u;
}

/**
 * @param {object} u - Billing user record
 * @returns {number|null} null = unlimited
 */
export function effectiveMonthlySearchesIncluded(u) {
  const tier = String(u?.tier || 'beta');
  const val = MONTHLY_SEARCHES_INCLUDED_BY_TIER[tier];
  return val === undefined ? null : val;
}

/**
 * @param {object} u - Billing user record
 * @returns {number|null} null = unlimited
 */
export function effectiveMonthlyIndexJobsIncluded(u) {
  const tier = String(u?.tier || 'beta');
  const val = MONTHLY_INDEX_JOBS_INCLUDED_BY_TIER[tier];
  return val === undefined ? null : val;
}

/**
 * @param {object} u - Billing user record
 * @returns {number|null} null = unlimited; 0 = no hosted consolidation on this tier
 */
export function effectiveMonthlyConsolidationPassesIncluded(u) {
  const tier = String(u?.tier || 'beta');
  const val = CONSOLIDATION_PASSES_BY_TIER[tier];
  return val === undefined ? null : val;
}

/**
 * Infer how many pack consolidation passes correspond to a remaining indexing-token pack balance.
 * Uses greedy decomposition into known pack sizes (large → medium → small), then the small-pack
 * ratio (20M tokens / 50 passes) for any remainder. Used once per account to backfill purchases
 * made before `pack_consolidation_passes_balance` was credited in Stripe webhooks.
 *
 * @param {number} tokenBalance
 * @returns {number}
 */
export function inferPackConsolidationPassesFromIndexingTokenBalance(tokenBalance) {
  const n = Math.max(0, Math.floor(Number(tokenBalance) || 0));
  if (n <= 0) return 0;
  let t = n;
  let passes = 0;
  const packs = [
    { tok: PACK_TOKENS.large, pass: PACK_CONSOLIDATIONS.large },
    { tok: PACK_TOKENS.medium, pass: PACK_CONSOLIDATIONS.medium },
    { tok: PACK_TOKENS.small, pass: PACK_CONSOLIDATIONS.small },
  ];
  for (const p of packs) {
    while (t >= p.tok) {
      passes += p.pass;
      t -= p.tok;
    }
  }
  if (t > 0) {
    const tokensPerPass = PACK_TOKENS.small / PACK_CONSOLIDATIONS.small;
    passes += Math.floor(t / tokensPerPass);
  }
  return passes;
}

/**
 * @param {object} user - Billing user record from store
 * @param {number} costCents
 * @returns {{ ok: boolean, code?: string }}
 */
export function tryDeduct(user, costCents) {
  const cost = Math.max(0, Math.floor(Number(costCents) || 0));
  if (cost === 0) return { ok: true };

  if (user.tier === 'beta') return { ok: true };

  if (user.tier === 'free') {
    user.monthly_included_cents = MONTHLY_INCLUDED_CENTS_BY_TIER.free ?? 0;
  }

  const included = Math.max(0, Math.floor(Number(user.monthly_included_cents) || 0));
  const used = Math.max(0, Math.floor(Number(user.monthly_used_cents) || 0));
  const addon = Math.max(0, Math.floor(Number(user.addon_cents) || 0));

  const remainingMonthly = Math.max(0, included - used);

  if (cost <= remainingMonthly) {
    user.monthly_used_cents = used + cost;
    return { ok: true };
  }

  const needFromAddon = cost - remainingMonthly;
  if (needFromAddon <= addon) {
    user.monthly_used_cents = included;
    user.addon_cents = addon - needFromAddon;
    return { ok: true };
  }

  return { ok: false, code: 'QUOTA_EXHAUSTED' };
}

export function defaultUserRecord(userId) {
  return {
    user_id: userId,
    tier: 'beta',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    period_start: null,
    period_end: null,
    monthly_included_cents: 0,
    monthly_used_cents: 0,
    addon_cents: 0,
    monthly_indexing_tokens_used: 0,
    pack_indexing_tokens_balance: 0,
    pack_consolidation_passes_balance: 0,
    pack_consolidation_legacy_inferred: false,
    monthly_searches_used: 0,
    monthly_index_jobs_used: 0,
    monthly_consolidation_jobs_used: 0,
    consolidation_enabled: false,
    consolidation_last_pass_at: null,
    consolidation_interval_minutes: null,
    consolidation_passes: { consolidate: true, verify: true, discover: false },
    consolidation_lookback_hours: HOSTED_CONSOL_DEFAULT_LOOKBACK_HOURS,
    consolidation_max_events_per_pass: HOSTED_CONSOL_DEFAULT_MAX_EVENTS,
    consolidation_max_topics_per_pass: HOSTED_CONSOL_DEFAULT_MAX_TOPICS,
    consolidation_llm_max_tokens: HOSTED_CONSOL_DEFAULT_LLM_MAX_TOKENS,
  };
}

/**
 * Deduction order: monthly included first, then add-on rollover (Netlify-style).
 */
import {
  MONTHLY_INCLUDED_CENTS_BY_TIER,
  MONTHLY_INDEXING_TOKENS_INCLUDED_BY_TIER,
} from './billing-constants.mjs';

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

/** Ensure new billing fields exist on loaded JSON records. */
export function normalizeBillingUser(u) {
  if (!u || typeof u !== 'object') return u;
  if (typeof u.monthly_indexing_tokens_used !== 'number' || !Number.isFinite(u.monthly_indexing_tokens_used)) {
    u.monthly_indexing_tokens_used = 0;
  }
  if (
    typeof u.pack_indexing_tokens_balance !== 'number' ||
    !Number.isFinite(u.pack_indexing_tokens_balance)
  ) {
    u.pack_indexing_tokens_balance = 0;
  }
  return u;
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
  };
}

/**
 * Hosted billing constants — Phase 16 tier model. See docs/PHASE16-STRIPE-BILLING-PLAN.md §4.
 *
 * Tiers: free · plus ($9) · growth ($17) · pro ($25)
 * Legacy aliases: beta (internal dev/no-cap), starter (→ plus), team (reserved for future seats)
 */

/**
 * Monthly included credit budget in cents for legacy metered ops (search, note_write, proposal_write).
 * This parallel ledger still runs; the primary per-period limit is MONTHLY_INDEXING_TOKENS_INCLUDED_BY_TIER.
 */
export const MONTHLY_INCLUDED_CENTS_BY_TIER = {
  beta: 0,
  free: 3 * 100,
  plus: 9 * 100,
  starter: 9 * 100,      // legacy alias → plus
  growth: 17 * 100,
  pro: 25 * 100,
  team: 80 * 100,        // reserved for future team/seats tier
};

/**
 * Monthly indexing allowance (embedding input tokens) per tier.
 * `pro` = null → unlimited (no enforcement cap).
 * `beta` = null → unlimited (internal dev).
 */
export const MONTHLY_INDEXING_TOKENS_INCLUDED_BY_TIER = {
  free:    5_000_000,
  plus:   36_000_000,
  starter: 36_000_000,   // legacy alias → plus
  growth:  68_000_000,
  pro:    null,          // unlimited
  team:  400_000_000,    // reserved
};

/**
 * Note count caps per tier. null = unlimited (no hard cap enforced).
 * Enforcement: 402 STORAGE_QUOTA_EXCEEDED on POST /api/v1/notes when BILLING_ENFORCE=true.
 */
export const NOTE_CAP_BY_TIER = {
  beta:    null,
  free:    200,
  plus:    2_000,
  starter: 2_000,        // legacy alias → plus
  growth:  5_000,
  pro:     null,
  team:    null,
};

/** Shown on GET /api/v1/billing/summary and Hub billing UI. */
export const INDEXING_TOKENS_POLICY =
  'Semantic search is included (fair use). Indexing is measured in embedding input tokens per billing period; add-on token packs roll over when billing is fully enabled.';

/** Token amounts granted per pack (matches Stripe price metadata `indexing_tokens`). */
export const PACK_TOKENS = {
  small:  20_000_000,
  medium: 60_000_000,
  large: 150_000_000,
};

/**
 * Stripe Price id → subscription tier.
 * Reads STRIPE_PRICE_PLUS, STRIPE_PRICE_GROWTH, STRIPE_PRICE_PRO from env (set in Netlify).
 * Legacy STRIPE_PRICE_STARTER still maps to 'plus' for backward compat during migration.
 */
export function tierFromEnvPriceId(priceId) {
  if (!priceId) return null;
  if (process.env.STRIPE_PRICE_PLUS && priceId === process.env.STRIPE_PRICE_PLUS) return 'plus';
  if (process.env.STRIPE_PRICE_GROWTH && priceId === process.env.STRIPE_PRICE_GROWTH) return 'growth';
  if (process.env.STRIPE_PRICE_PRO && priceId === process.env.STRIPE_PRICE_PRO) return 'pro';
  if (process.env.STRIPE_PRICE_STARTER && priceId === process.env.STRIPE_PRICE_STARTER) return 'plus';
  if (process.env.STRIPE_PRICE_TEAM && priceId === process.env.STRIPE_PRICE_TEAM) return 'team';
  return null;
}

/**
 * Returns true if a given price ID is a known subscription price (for checkout mode selection).
 */
export function isSubscriptionPriceId(priceId) {
  return tierFromEnvPriceId(priceId) !== null;
}

/**
 * Returns true if a given price ID is a known token pack price (one-time payment).
 */
export function isPackPriceId(priceId) {
  if (!priceId) return false;
  return Boolean(
    (process.env.STRIPE_PRICE_PACK_10 && priceId === process.env.STRIPE_PRICE_PACK_10) ||
    (process.env.STRIPE_PRICE_PACK_25 && priceId === process.env.STRIPE_PRICE_PACK_25) ||
    (process.env.STRIPE_PRICE_PACK_50 && priceId === process.env.STRIPE_PRICE_PACK_50),
  );
}

/** Stripe Price id → add-on credits in cents (legacy credit ledger). */
export function addonCentsFromPackPriceId(priceId) {
  if (!priceId) return null;
  if (process.env.STRIPE_PRICE_PACK_10 && priceId === process.env.STRIPE_PRICE_PACK_10) return 10 * 100;
  if (process.env.STRIPE_PRICE_PACK_25 && priceId === process.env.STRIPE_PRICE_PACK_25) return 25 * 100;
  if (process.env.STRIPE_PRICE_PACK_50 && priceId === process.env.STRIPE_PRICE_PACK_50) return 50 * 100;
  return null;
}

/**
 * Stripe Price id → indexing token grant for pack purchase.
 * Matches PACK_TOKENS amounts and Stripe price metadata `indexing_tokens`.
 */
export function addonTokensFromPackPriceId(priceId) {
  if (!priceId) return null;
  if (process.env.STRIPE_PRICE_PACK_10 && priceId === process.env.STRIPE_PRICE_PACK_10) return PACK_TOKENS.small;
  if (process.env.STRIPE_PRICE_PACK_25 && priceId === process.env.STRIPE_PRICE_PACK_25) return PACK_TOKENS.medium;
  if (process.env.STRIPE_PRICE_PACK_50 && priceId === process.env.STRIPE_PRICE_PACK_50) return PACK_TOKENS.large;
  return null;
}

/**
 * Resolve a tier shorthand (e.g. 'plus', 'growth', 'pro') to its Stripe Price ID from env.
 * Returns null if the env var is not set (Stripe not configured yet).
 */
export function priceIdFromTierShorthand(tier) {
  const t = String(tier || '').toLowerCase();
  if (t === 'plus' || t === 'starter') return process.env.STRIPE_PRICE_PLUS || process.env.STRIPE_PRICE_STARTER || null;
  if (t === 'growth') return process.env.STRIPE_PRICE_GROWTH || null;
  if (t === 'pro') return process.env.STRIPE_PRICE_PRO || null;
  return null;
}

/** Metered operation → cost in cents (legacy credit ledger). Shadow-log only until BILLING_ENFORCE=true. */
export const COST_CENTS = {
  search: 1,
  index: 50,
  note_write: 2,
  proposal_write: 2,
};

/**
 * User-facing cost transparency (shown in billing summary for Hub UI).
 * cost_usd_display is for display; internal ledger uses cost_cents.
 */
export const COST_BREAKDOWN = [
  {
    operation: 'search',
    label: 'Semantic search (one request)',
    cost_cents: COST_CENTS.search,
    relates_to: 'Bridge vector search + CPU',
  },
  {
    operation: 'index',
    label: 'Re-index vault (one job)',
    cost_cents: COST_CENTS.index,
    relates_to: 'Embedding API + storage (largest variable cost)',
  },
  {
    operation: 'note_write',
    label: 'Create or update a note',
    cost_cents: COST_CENTS.note_write,
    relates_to: 'Canister write + storage',
  },
  {
    operation: 'proposal_write',
    label: 'Create a proposal',
    cost_cents: COST_CENTS.proposal_write,
    relates_to: 'Canister write + storage',
  },
].map((row) => ({
  ...row,
  cost_usd_display: (row.cost_cents / 100).toFixed(2),
  credits_display: (row.cost_cents / 100).toFixed(2),
}));

export function billingEnforced() {
  return process.env.BILLING_ENFORCE === 'true' || process.env.BILLING_ENFORCE === '1';
}

/** Structured JSON logs for usage research (gateway stdout → log drains). */
export function billingShadowLogEnabled() {
  return process.env.BILLING_SHADOW_LOG === '1' || process.env.BILLING_SHADOW_LOG === 'true';
}

/**
 * Hosted billing defaults (v0). See docs/HOSTED-CREDITS-DESIGN.md.
 * Tune COST_CENTS after shadow metering; start conservative (easier to lower later).
 */

/** Monthly included budget in cents (1 credit = 100 cents). `free` = $0 tier (no Stripe sub). */
export const MONTHLY_INCLUDED_CENTS_BY_TIER = {
  beta: 0,
  free: 3 * 100,
  starter: 12 * 100,
  pro: 30 * 100,
  team: 80 * 100,
};

/**
 * Monthly **indexing** allowance (embedding input tokens). Aligns with docs/HOSTED-CREDITS-DESIGN.md §2 (illustrative).
 * **`beta`:** no cap in UI (`null` effective included); usage is still recorded.
 */
export const MONTHLY_INDEXING_TOKENS_INCLUDED_BY_TIER = {
  free: 5_000_000,
  starter: 36_000_000,
  pro: 100_000_000,
  team: 400_000_000,
};

/** Shown on GET /api/v1/billing/summary and future Hub billing UI. */
export const INDEXING_TOKENS_POLICY =
  'Semantic search is included (fair use). Indexing is measured in embedding input tokens per billing period; add-on token packs roll over when billing is fully enabled.';

/** Stripe Price id → tier (set in env per deploy). */
export function tierFromEnvPriceId(priceId) {
  if (!priceId) return null;
  if (process.env.STRIPE_PRICE_STARTER && priceId === process.env.STRIPE_PRICE_STARTER) return 'starter';
  if (process.env.STRIPE_PRICE_PRO && priceId === process.env.STRIPE_PRICE_PRO) return 'pro';
  if (process.env.STRIPE_PRICE_TEAM && priceId === process.env.STRIPE_PRICE_TEAM) return 'team';
  return null;
}

/** Stripe Price id → add-on credits in cents. */
export function addonCentsFromPackPriceId(priceId) {
  if (!priceId) return null;
  if (process.env.STRIPE_PRICE_PACK_10 && priceId === process.env.STRIPE_PRICE_PACK_10) return 10 * 100;
  if (process.env.STRIPE_PRICE_PACK_25 && priceId === process.env.STRIPE_PRICE_PACK_25) return 25 * 100;
  if (process.env.STRIPE_PRICE_PACK_50 && priceId === process.env.STRIPE_PRICE_PACK_50) return 50 * 100;
  return null;
}

/** Metered operation → cost in cents (placeholders). */
export const COST_CENTS = {
  search: 1,
  index: 50,
  note_write: 2,
  proposal_write: 2,
};

/**
 * User-facing transparency: what we charge per action (v0). Shown in billing summary for Hub UI.
 * cost_usd is a string for display; internal ledger uses cost_cents.
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

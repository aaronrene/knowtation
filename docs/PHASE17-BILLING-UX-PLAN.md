# Phase 17 — Billing UX: Tier Selector, Operation Metering & Storage Strategy

> **Branch:** `feature/phase17-billing-ux`
> **Preceded by:** Phase 16 (Stripe billing scaffold, pack purchases, webhooks)
> **Status:** Planning / in progress

---

## §1 Context — What Phase 16 Left Incomplete

Phase 16 built the full Stripe payment infrastructure (subscriptions, pack purchases, webhooks,
portal). Three gaps remained at the end of Phase 16:

1. **Tier selector missing.** The Hub only shows an "Upgrade to Plus →" button. Users on Free
   have no path to Growth or Pro. Users already on Plus have no path to Growth or Pro. There is
   no plan comparison UI anywhere.

2. **Token metering not wired.** `pack_indexing_tokens_balance` and
   `monthly_indexing_tokens_used` are display-only fields. The billing gate enforces a
   cents-per-operation ledger (`monthly_used_cents` / `addon_cents`), not token counts. The
   usage bar always reads "0 of 36M" regardless of actual activity.

3. **Token metric is wrong for consumers.** Raw embedding token counts (e.g. "20,000,000
   tokens") are meaningless to general users and require canister-side changes to track
   accurately. The canister does not currently return per-job token counts to the gateway.

---

## §2 Decisions Made (April 2026)

### 2.1 Replace token-based metering with operation counts

**Decision:** Drop `monthly_indexing_tokens_used` and `pack_indexing_tokens_balance` as the
primary billing metric displayed to users. Replace with **operation counts**:

- `monthly_searches_used` — incremented each time a search operation passes the billing gate
- `monthly_index_jobs_used` — incremented each time an index operation passes the billing gate

These map directly to what users understand: "I did 47 searches and 3 re-indexes this month."

**Rationale:**
- Operation counts require zero canister changes (the gateway middleware already classifies every
  request as `search`, `index`, `note_write`, or `proposal_write`)
- Tokens vary by vault size, making them hard for users to estimate in advance
- One "index job" = one index job in the user's mind, regardless of note count
- Consumer SaaS best practice: Notion, Dropbox, GitHub all count operations/objects, not bytes
  or internal compute units

**Token tracking deferred (not abandoned):** Accurate per-job token counts require the ICP
canister to return `usage.total_tokens` from the OpenAI embedding API response back through the
gateway. This is technically straightforward but requires a canister deploy cycle. It can be
added as a secondary detail later if power users request it. The `pack_indexing_tokens_balance`
field stays in the DB schema for backward compat; it is just not the primary display metric.

### 2.2 Monthly operation allowances by tier

These are starting values — adjust based on shadow-log data once `BILLING_ENFORCE=true`.

| Tier | Searches/month | Index jobs/month | Notes cap |
|------|---------------|-----------------|-----------|
| Free | 100 | 5 | 200 |
| Plus ($9) | 2,000 | 50 | 2,000 |
| Growth ($17) | 8,000 | 200 | 5,000 |
| Pro ($25) | Unlimited | Unlimited | Unlimited |

> **Note:** These figures are estimates pending shadow-log review. Do not flip
> `BILLING_ENFORCE=true` until at least 2–4 weeks of shadow-log data confirms the averages
> are reasonable for real usage patterns.

### 2.3 Pack cards — add human-readable equivalents

Show token count AND an approximate operation equivalent on each pack card so both technical
and non-technical users have a reference point.

| Pack | Price | Tokens | Human label |
|------|-------|--------|-------------|
| Small | $10 | 20M | ~400 index jobs or ~20,000 searches |
| Medium | $25 | 60M | ~1,200 index jobs or ~60,000 searches |
| Large | $50 | 150M | ~3,000 index jobs or ~150,000 searches |

> Approximations are fine. The key is giving users a mental model for value, not a guarantee.

### 2.4 Do NOT show cents-per-operation in the UI

"1¢ per search, 50¢ per index" is accurate but invites unfavorable math:
`$9/month ÷ $0.50/index = 18 index jobs.` Even if 18 re-indexes is generous for most users,
seeing that ceiling explicitly feels restrictive. Operation count caps communicate the same
reality in terms that feel abundant.

### 2.5 Storage strategy — canister text storage is not a concern

**ICP canister storage cost:** ~$5–6 per GiB per year (~$0.42–0.50/GB/month) for stable memory.

**Per-user footprint estimate (text notes, generous):**
- Average note (text + metadata): ~6 KB
- Plus tier (2,000 notes): ~12 MB/user
- 1,000 users: ~12 GB total → ~$5–6/month canister cost

At any realistic subscriber count, canister storage is under 0.1% of subscription revenue.
**No storage meter needed. No per-user storage quota needed.**

Large files (images, PDFs, attachments) live in the user's own GitHub repo, not in the
canister. Knowtation only stores processed note text. This keeps the footprint permanently
tiny regardless of vault size.

**"Unlimited storage" is accurate and is a selling point**, particularly for Pro:
> *"Unlimited notes, unlimited storage — your entire knowledge base, no caps."*

For Free/Plus/Growth, the note count cap is the practical ceiling. Storage quota is never a
separate concern and should not be surfaced in the UI.

---

## §3 Build Order

### Phase 17A — Tier selector UI (immediate priority)

**Goal:** Any user can see and upgrade to any tier from within the billing panel.

**Changes:**
- `web/hub/index.html`: Replace the single upgrade button with a plan comparison grid showing
  Free / Plus / Growth / Pro with price, key feature highlights, and a CTA button per plan.
  Active plan shows "Current plan" badge (no button). Downgrade path goes to the Stripe portal.
- `web/hub/hub.js`: Wire each plan CTA to `redirectToCheckout({ tier: 'plus'|'growth'|'pro' })`.
- No backend changes needed (the checkout endpoint already handles `tier` in the request body).

**Acceptance:** A Plus subscriber can click "Upgrade to Growth" and complete the checkout.

### Phase 17B — Operation count metering

**Goal:** Track and display searches used + index jobs used per billing period.

**DB schema additions (billing-store, normalizeBillingUser):**
```js
monthly_searches_used:    0,   // incremented by billing gate on each search
monthly_index_jobs_used:  0,   // incremented by billing gate on each index
```

**Billing gate changes (billing-middleware.mjs):**
- After `tryDeduct` succeeds (or when `BILLING_ENFORCE=false` shadow-log path), increment the
  appropriate counter.
- `resetMonthlyTokensIfNeeded` already resets all monthly counters; add the two new fields.

**Billing summary (billing-http.mjs):**
- Include `monthly_searches_used`, `monthly_index_jobs_used`, `monthly_searches_included`,
  `monthly_index_jobs_included` in the GET /api/v1/billing/summary response.

**Hub UI (hub.js, hub.css, index.html):**
- Replace the single token usage bar with two usage rows:
  - Searches: `[███░░░░░░░] 47 / 2,000 this month`
  - Index jobs: `[█░░░░░░░░░] 3 / 50 this month`
- Remove `monthly_indexing_tokens_used` / `pack_indexing_tokens_balance` as primary display.
- Keep pack balance as a secondary note: "Pack balance: 60M tokens (rollover)."

### Phase 17C — Pack card human-readable equivalents

Update the three pack cards in `index.html` to show:
```
20M indexing tokens
≈ 400 index jobs or 20,000 searches
```

Small change, high clarity impact.

### Phase 17D — Token tracking (deferred, future canister work)

Requires the ICP canister to return per-job token counts from OpenAI embedding API responses.
When implemented:
- Gateway reads token count from canister response
- Deducts from `monthly_indexing_tokens_used` first, then `pack_indexing_tokens_balance`
- Displayed as a secondary collapsed detail in the billing panel for power users

**Do not build this until:** (a) power users explicitly request it, or (b) the ICP canister is
being refactored for another reason and the change is low-incremental-cost.

---

## §4 Environment Variable Changes (None for Phase 17)

No new Netlify environment variables are required for Phase 17A–17C. All changes are frontend
and gateway JS only.

---

## §5 Rollout Checklist

- [ ] 17A: Tier selector UI — PR, merge, verify Growth/Pro checkout works in test mode
- [ ] 17B: Operation count metering — shadow-log for 2–4 weeks, verify counts look right
- [ ] 17C: Pack card labels updated
- [ ] Review shadow logs → decide on final operation allowance numbers by tier
- [ ] Flip `BILLING_ENFORCE=true` in Netlify after confirming numbers
- [ ] Switch Stripe keys to live mode (separate checklist item)
- [ ] 17D: Deferred — track as a future ticket

---

## §6 Open Questions

1. **Pack expiry:** Do pack tokens (currently `pack_indexing_tokens_balance`) expire? Phase 16
   plan called them "rollover" with no expiry. Confirm this is the intended behavior before
   communicating it to users publicly.

2. **Downgrade flow:** If a Pro user downgrades to Plus, their note count may exceed the Plus
   cap (2,000). What is the policy? Read-only access to existing notes, or hard block on new
   notes until under cap? Needs a decision before enforcement is live.

3. **Free tier note count:** Free is capped at 200 notes. Is this enforced today (yes, via
   `NOTE_CAP_BY_TIER` when `BILLING_ENFORCE=true`)? Confirm before flipping enforcement.

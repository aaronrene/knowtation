# Hosted billing — design (subscription + included credits + rollover add-ons)

**Product:** **Hosted Knowtation** uses a **Netlify-style hybrid**: **Stripe** credit-card **subscriptions** (paid tiers) with a **monthly included usage budget**, plus **purchasable add-on credits** that **roll over** and are consumed **after** the monthly grant is exhausted. **1 displayed credit = US $1** of **our internal metered price** for an action (ledger uses **integer cents**). Credits are **platform-only**: prepaid balance for Knowtation hosted, **not tradable**, **not redeemable elsewhere**, **not a security** — marketing and Terms should say so plainly.

**Transparency:** We intentionally avoid “10,000 mystery credits.” Users see **dollar-scale numbers** (e.g. **$0.01** per search, **$0.50** per re-index at v0 placeholders) and **labels** tied to **cost drivers** (embeddings, canister, search). **`GET /api/v1/billing/summary`** returns a **`cost_breakdown`** for the Hub to render. **Future (not launch-blocking):** a **usage history** store + **chart** (meter over time by operation) so users see *why* usage moved — few competitors expose this level of clarity.

**Reference (market pattern):** [Netlify — how credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work).

**Related:** [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md), [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) Phase 16, [HUB-API.md](./HUB-API.md). Gateway: `hub/gateway/billing-*.mjs`.

---

## 1. Two balances (consumption order)

| Pool | Behavior | Funded by |
|------|----------|-----------|
| **Monthly included** | **Resets** each billing period (**does not roll** unused portion). Consumed **first**. | Subscription tier (or **Free** tier allowance) |
| **Add-on balance** | **Rolls** while policy allows (typically **active paid** subscription). Consumed **after** monthly included. | Stripe **Checkout** one-time **packs** |

**Deduction:** Monthly first, then add-ons; else **`402`** + `QUOTA_EXHAUSTED` (see HUB-API).

**Beta:** `BILLING_ENFORCE` off (default): **no deduction**; use **`BILLING_SHADOW_LOG=true`** for structured **research logs** (see §8).

---

## 2. v0 default prices (“Early pricing” — revisable)

**Included credits** = USD-equivalent internal budget per month (**100 cents = 1 credit = $1** against our price table).

| Tier | Monthly price (USD) | Included credits / month | Notes |
|------|---------------------|---------------------------|--------|
| **Free** | **$0** | **3** | Light use; upgrade for more. No Stripe subscription (product assigns `tier: free`). |
| **Starter** | **$19** | **12** | Entry paid. |
| **Pro** | **$39** | **30** | Individual power use. |
| **Team** | **$99** (base; seats TBD) | **80** | Pooled — product choice. |

**Add-on packs (par $1 → $1 credit):**

| Pack | Price | Credits added |
|------|-------|----------------|
| Small | **$10** | **10** |
| Medium | **$25** | **25** |
| Large | **$50** | **50** |

---

## 3. What we meter & what users see

| Operation (API key) | User-facing label (v0) | Cost driver | Choke point |
|---------------------|------------------------|-------------|-------------|
| `search` | Semantic search (one request) | Vectors + CPU | Bridge `POST /api/v1/search` |
| `index` | Re-index vault (one job) | Embeddings ($) | Bridge `POST /api/v1/index` |
| `note_write` | Create or update a note | Canister + storage | Gateway → canister |
| `proposal_write` | Create a proposal | Canister + storage | Gateway → canister |

**Implementation:** `hub/gateway/billing-constants.mjs` — `COST_CENTS` + **`COST_BREAKDOWN`** (labels + `cost_usd_display`). Tune after **shadow logs + real invoices**.

**Future:** persist **per-event usage rows** (timestamp, `user_id`, operation, `cost_cents`) for **graphs** and export; not required for first paid slice.

---

## 4. Research & monitoring (implemented)

- **Metering hooks:** Gateway **`runBillingGate`** classifies billable **operations** on search, index, note write, proposal create (same paths as enforcement).
- **Shadow logging:** Set **`BILLING_SHADOW_LOG=true`** (or `1`) on the gateway. Emits one **JSON line per billable request** (with `user_id` when JWT present): `operation`, `cost_cents`, `path`, `billing_enforced`. Ship to your log aggregator to study **distribution and cost per user** before locking **402** enforcement.
- **User-facing prep:** **`GET /api/v1/billing/summary`** returns balances + **`cost_breakdown`** + **`credit_policy`** + **`usage_chart_status`** (roadmap note).

---

## 5. Stripe

- **Stripe Billing:** Starter / Pro / Team; **Customer Portal**. **Free** tier is **not** a Stripe product — assign in product when user has no paid sub.
- **Checkout:** Packs; `metadata.user_id`, optional `metadata.credits_cents`.
- **Webhooks:** `POST /api/v1/billing/webhook` (raw body); idempotent `event.id` store.

**Env price ids:** `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM`, `STRIPE_PRICE_PACK_*`.

---

## 6. Storage

**Gateway:** `data/hosted_billing.json` or Netlify Blob **`gateway-billing`**. Canister mirror per [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md).

---

## 7. API

- **`GET /api/v1/billing/summary`** — JWT; pools, **`monthly_included_effective_cents`** (syncs **Free** tier), **`cost_breakdown`**, **`credit_policy`**, **`usage_chart_status`**.

---

## 8. Hub UX

- **Now:** Show **included / used / add-on**, **tier**, and **“what costs what”** from `cost_breakdown`.
- **Later:** **Usage chart** + history (product differentiator).

---

## 9. Self-hosted

**Unchanged.**

---

## 10. Revision log

| Date | Change |
|------|--------|
| 2026-03-21 | Hybrid monthly + rollover add-ons; gateway module; v0 prices. |
| 2026-03-22 | **Free** tier ($0 / 3 credits); **transparency** (dollar credits, per-action breakdown); **BILLING_SHADOW_LOG**; **credit_policy** / not-a-security; **usage chart** as future goal; summary **`cost_breakdown`**. |

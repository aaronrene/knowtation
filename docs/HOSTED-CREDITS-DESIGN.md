# Hosted billing — design (indexing token quotas + rollover packs)

**Product (target):** Hosted Knowtation bills with **one clear public unit**: **indexing embedding tokens per month** (tokens your vault sends to the **embedding API** when building or updating the semantic index). **Monthly included grant resets** each billing period. **Purchased packs** add **indexing tokens that roll over** (consumed after the monthly grant is exhausted). **Semantic search** is **included** with **fair use** (not a separate sold quota in v1 — query embeddings are tiny next to full-vault re-indexes; we still **log** search volume for ops and abuse).

**Why tokens, not “N re-indexes”:** One re-index can embed 200k tokens or 20M tokens depending on vault size. **Job count** is a poor promise; **tokens** match cost and are **measurable** server-side and **showable** in the Hub.

**Loaded planning cost (internal):** Use **λ ≈ $0.05 per 1 million indexing tokens** as a single round-number **planning** rate (≈2.5× OpenAI’s public **text-embedding-3-small** list price — confirm on [OpenAI pricing](https://platform.openai.com/docs/pricing); tune from **invoices + shadow logs**). **Included tokens per tier** can be derived from **f × subscription price / λ** where **f** is the fraction of revenue you allocate to “worst-case indexing COGS” (e.g. **f = 0.20** = 20% of list price buys tokens at λ if the user maxes indexing that month). **f** is a product knob, not physics.

**Reference (market pattern):** [Netlify — how credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work) (monthly grant + rollover add-ons).

**Related:** [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md), [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) Phase 16, [HUB-API.md](./HUB-API.md), [PRODUCT-DECISIONS-HOSTED-MVP.md](./PRODUCT-DECISIONS-HOSTED-MVP.md). Gateway code: `hub/gateway/billing-*.mjs`. Bridge must **report token counts** for enforcement to match this doc.

---

## 1. Two pools (consumption order)

| Pool | Behavior | Funded by |
|------|----------|-----------|
| **Monthly indexing tokens** | **Resets** each billing period (unused portion **does not** roll). Consumed **first**. | Subscription tier (or **Free** allowance) |
| **Pack indexing tokens** | **Rolls** while policy allows (typically **active paid** subscription). Consumed **after** monthly grant. | Stripe **Checkout** one-time **packs** (sold as **+N million indexing tokens**, exact SKUs TBD) |

**Deduction:** On each index job, add **embedding input tokens** for that job to usage → charge **monthly pool** until exhausted, then **pack pool**; if both insufficient → **`402`** + `QUOTA_EXHAUSTED` (see HUB-API).

**Beta:** `BILLING_ENFORCE` off (default): **no block**; use **`BILLING_SHADOW_LOG=true`** and (once implemented) **token** counts in logs for COGS research.

---

## 2. Target tiers and illustrative included tokens

**Prices** are the current product intent (**psychological anchors**; adjust after data). **Token columns** use **λ = $0.05/M** and **f = 0.20** except **Free** (policy cap).

| Tier | Monthly price (USD) | Illustrative included indexing tokens / month | Notes |
|------|---------------------|-----------------------------------------------|--------|
| **Free** | **$0** | **5M** | Loss-leader cap; set from policy, not f×price. |
| **Plus** | **$9** | **~36M** | \(0.20 × 9 / 0.05\) |
| **Growth** | **$17** | **~68M** | \(0.20 × 17 / 0.05\) |
| **Pro** | **$25** | **~100M** | \(0.20 × 25 / 0.05\) |

**Tune:** After 2–4 weeks of **real `monthly_indexing_tokens_used` per user**, adjust **included M**, **λ**, or **f** — or switch to **f = 0.15** / **0.25** for more/less headroom.

**Team / seats:** Deferred; same token model can **pool** per workspace when defined.

**Add-on packs (product shape):** Sell **fixed +N million indexing tokens** that credit **`pack_indexing_tokens_balance`** (rollover). Dollar price per pack = business choice (volume discounts optional). Stripe **Checkout** one-time; webhook idempotent.

---

## 3. Transparency (user + operator)

- **Hub:** Show **indexing tokens used this period / included**, **pack balance**, **period end**; short copy that **search is included** (fair use).
- **Operator:** Aggregate **tokens per index job**, **per user**, **per vault**; correlate with **OpenAI (or chosen provider) usage** bills.

---

## 4. Implementation status — current code vs target

| Area | Status |
|------|--------|
| **Bridge `POST /api/v1/index`** | **Done:** Response includes **`embedding_input_tokens`** (OpenAI: API `usage.prompt_tokens` per batch; Ollama: char/4 estimate). |
| **Gateway after index** | **Done:** On **200** responses, adds **`embedding_input_tokens`** to **`monthly_indexing_tokens_used`** in the billing store; optional **`BILLING_SHADOW_LOG`** line with `phase: post_index`. |
| **`GET /api/v1/billing/summary`** | **Partial:** Returns **`monthly_indexing_tokens_included`**, **`monthly_indexing_tokens_used`**, **`pack_indexing_tokens_balance`**, **`indexing_tokens_policy`** plus legacy **cents** + **`cost_breakdown`**. |
| **Gateway store + webhooks** | **Partial:** **`monthly_*_cents`**, **`addon_cents`**; **pack indexing tokens** from Checkout **not** wired yet. |
| **`runBillingGate` / `BILLING_ENFORCE`** | **Partial:** Still **fixed cents** per search/index job/writes — **token cap 402** not implemented (needs policy: pre-estimate or post-hoc). |
| **Hub UI** | **Gap:** No **token** usage bar yet. |

**Legacy scaffold:** `hub/gateway/billing-constants.mjs` still defines **$19 / $39 / $99**-style **included credits** and **`COST_CENTS`** (`search`, `index` job, `note_write`, `proposal_write`). Treat as **interim** until Phase 16 aligns **constants**, **summary JSON**, and **middleware** with **§1–2** of this doc.

---

## 5. Interim metering (until token gate ships)

Until the bridge reports token totals end-to-end:

- **`BILLING_SHADOW_LOG`:** Keep logging **operation + cost_cents** for rough mix analysis.
- **`COST_CENTS`:** Remains a **placeholder** internal debit per request type — **do not** treat **50¢/index job** as the long-term user contract; the user contract is **§2** (token caps).

---

## 6. Stripe (target)

- **Stripe Billing:** **Plus / Growth / Pro** (names map to **$9 / $17 / $25** or adjusted prices); **Customer Portal**. **Free** = no Stripe subscription.
- **Stripe Checkout:** **Indexing token packs**; `metadata.user_id`, **`metadata.indexing_tokens`** (or equivalent).
- **Webhooks:** `POST /api/v1/billing/webhook`; idempotent `event.id` store.

**Env price ids (rename when products exist):** e.g. `STRIPE_PRICE_PLUS`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_PACK_*`.

---

## 7. Storage (canister / gateway)

**Gateway:** Authoritative for billing until canister mirrors. See [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md) for reserved fields (**token** balances should mirror **§1** when V1 billing lands on-chain).

---

## 8. API (evolution)

- **`GET /api/v1/billing/summary`** — Today: cents pools + **`cost_breakdown`**. **Target:** add **`monthly_indexing_tokens_included`**, **`monthly_indexing_tokens_used`**, **`pack_indexing_tokens_balance`**, **`period_*`**, **`tier`**, policy blurb (**search included**). Keep or drop **`cost_breakdown`** once token UX replaces per-action cents for index/search.

---

## 9. Self-hosted

**Unchanged** — no hosted token billing.

---

## 10. Revision log

| Date | Change |
|------|--------|
| 2026-03-21 | Hybrid monthly + rollover add-ons; gateway module; v0 **credit** prices. |
| 2026-03-22 | **Free** tier; transparency; **BILLING_SHADOW_LOG**; **`cost_breakdown`**. |
| 2026-03-26 | Linked **PRODUCT-DECISIONS-HOSTED-MVP.md**. |
| 2026-03-25 | **Major:** Indexing-token product model + **§4** updates. **Code:** bridge **`embedding_input_tokens`**; gateway accumulates **`monthly_indexing_tokens_used`**; **`billing/summary`** token fields. Legacy **cent/job** scaffold remains until Stripe/token enforcement ships. |

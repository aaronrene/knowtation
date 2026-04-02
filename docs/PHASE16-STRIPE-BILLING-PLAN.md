# Phase 16 — Stripe Billing Implementation Plan

**Status:** Pre-implementation. All decisions confirmed. Ready to build on `feature/phase16-stripe-billing`.

**Related docs:** [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md) · [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md) · [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) · [PRODUCT-DECISIONS-HOSTED-MVP.md](./PRODUCT-DECISIONS-HOSTED-MVP.md)

**Gateway billing scaffold (already exists):** `hub/gateway/billing-*.mjs` — webhook handler, store, summary endpoint, token recording, middleware gate.

---

## 1. Born Free Communities — Stripe account strategy

### Do you need a separate Stripe business or account?

**No.** You do **not** need to create a new Stripe account or register a new legal entity. You already have Born Free Communities set up as the Stripe business. Knowtation is a product line within that company — it runs on a different domain (`knowtation.store`) but it is the same legal entity billing customers.

Stripe's model is:
- **One account** = one legal business entity (Born Free Communities)
- **Multiple products** = anything you sell (Knowtation Plus, Knowtation Growth, Born Free Store Free, future tools)
- **Statement descriptor suffix** = per-product label on card statements (e.g. `KNOWTATION`)

This is exactly how multi-product SaaS companies operate on Stripe. One account, clean per-product labeling, one payout destination, one tax setup.

### How to handle the different domain clearly

The customer checkout flow will show:
1. **Business name:** Born Free Communities (your Stripe account name — stays)
2. **Product name:** Knowtation Plus (clear per-product label)
3. **Statement descriptor:** `BORNFREE* KNOWTATION` (on bank/card statements)
4. **Checkout page description** (visible during purchase): Add a short line in the product description and on your Hub's billing UI — see §3 below for exact copy.

You do **not** need a new business registration, bank account, EIN, or Stripe account. You just add new Products and Prices under your existing Born Free Communities Stripe account.

---

## 2. Stripe dashboard setup (one-time, by operator)

### 2.1 Account branding (Settings → Business settings)

| Field | Value |
|-------|-------|
| **Public business name** | Born Free Communities |
| **Statement descriptor** | `BORNFREE KNOWTATION` *(max 22 chars; appears on card statements)* |
| **Support email** | your support email |
| **Support website** | `knowtation.store` |
| **Logo / brand** | Upload Knowtation logo for checkout pages |

> **Note:** The statement descriptor `BORNFREE* KNOWTATION` lets customers immediately identify the charge as coming from Born Free, for the Knowtation product. This avoids disputes and confusion.

### 2.2 Customer Portal (Settings → Customer portal)

Enable the following in the portal configuration:

- ✅ Allow customers to cancel subscriptions
- ✅ Allow customers to switch plans (upgrade / downgrade between Plus, Growth, Pro)
- ✅ Allow customers to update payment method
- ✅ Show invoice history
- **Return URL after portal session:** `https://knowtation.store/hub/#settings`

**Custom portal header message** (this is the key Born Free branding placement):

> "Knowtation is a productivity and AI memory tool created by Born Free Communities and shared with the public. Your subscription is billed by Born Free Communities, the parent organization behind Knowtation and Born Free Platform. Learn more at [bornfree.io](https://bornfree.io)."

This message appears at the top of every customer's billing portal session. It:
- Explains who Born Free Communities is
- Tells customers why the billing name looks different from knowtation.store
- Introduces them to the parent project (organic marketing)
- Prevents support tickets asking "what is this charge?"

### 2.3 Webhook endpoint (Developers → Webhooks → Add endpoint)

| Field | Value |
|-------|-------|
| **Endpoint URL** | `https://knowtation-gateway.netlify.app/api/v1/billing/webhook` |
| **Events** | `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded` |

After creating the webhook, copy the **Signing secret** (`whsec_...`) — you'll need it as `STRIPE_WEBHOOK_SECRET` in Netlify.

---

## 3. Products and prices to create in Stripe

### 3.1 Subscription products (recurring)

Create **3 Products** under your existing Born Free Communities account. For each, set the **statement descriptor suffix** to `KNOWTATION` so statements read `BORNFREE* KNOWTATION`.

In each product's **description** field, add the Born Free line (this appears on Stripe-hosted checkout pages and invoices):

> "Billed by Born Free Communities · knowtation.store · Questions? See bornfree.io"

---

**Product 1: Knowtation Plus**

| Field | Value |
|-------|-------|
| Product name | `Knowtation Plus` |
| Description | `36M indexing tokens/mo · 2,000 notes · Semantic search included · Billed by Born Free Communities · knowtation.store` |
| Statement descriptor suffix | `KNOWTATION` |
| Price | $9.00 / month, USD, recurring |
| Billing period | Monthly |
| Tax behavior | Exclusive (add tax on top) |

→ Copy the resulting **Price ID** (`price_...`) → this becomes `STRIPE_PRICE_PLUS` in Netlify.

---

**Product 2: Knowtation Growth**

| Field | Value |
|-------|-------|
| Product name | `Knowtation Growth` |
| Description | `68M indexing tokens/mo · 5,000 notes · Semantic search included · Billed by Born Free Communities · knowtation.store` |
| Statement descriptor suffix | `KNOWTATION` |
| Price | $17.00 / month, USD, recurring |
| Billing period | Monthly |
| Tax behavior | Exclusive |

→ Copy Price ID → `STRIPE_PRICE_GROWTH` in Netlify.

---

**Product 3: Knowtation Pro**

| Field | Value |
|-------|-------|
| Product name | `Knowtation Pro` |
| Description | `Unlimited indexing tokens + notes · Semantic search included · Billed by Born Free Communities · knowtation.store` |
| Statement descriptor suffix | `KNOWTATION` |
| Price | $25.00 / month, USD, recurring |
| Billing period | Monthly |
| Tax behavior | Exclusive |

→ Copy Price ID → `STRIPE_PRICE_PRO` in Netlify.

---

### 3.2 Token pack products (one-time)

Create **1 Product** with **3 Prices** (one-time, not recurring).

**Product: Knowtation Token Pack**

| Field | Value |
|-------|-------|
| Product name | `Knowtation Token Pack` |
| Description | `Additional indexing tokens that roll over. Consumed after your monthly grant. Billed by Born Free Communities · knowtation.store` |
| Statement descriptor suffix | `KNOWTATION` |

Create three prices on this product:

| Price label | Amount | Tokens granted | Env var |
|---|---|---|---|
| Pack Small | $10.00 one-time | +20M indexing tokens | `STRIPE_PRICE_PACK_10` |
| Pack Medium | $25.00 one-time | +60M indexing tokens | `STRIPE_PRICE_PACK_25` |
| Pack Large | $50.00 one-time | +150M indexing tokens | `STRIPE_PRICE_PACK_50` |

Add `metadata` to each pack price (Stripe price metadata):
- `pack_size` = `small` / `medium` / `large`
- `indexing_tokens` = `20000000` / `60000000` / `150000000`

→ Copy all three Price IDs to Netlify env vars.

---

## 4. Confirmed pricing and tier model

### 4.1 Subscription tiers

| Tier | Price | Indexing tokens/mo | Note cap | Proposals | Vault search |
|------|-------|-------------------|----------|-----------|--------------|
| **Free** | $0 | 5M | 200 | 100 | ✅ fair use |
| **Plus** | $9/mo | 36M | 2,000 | 500 | ✅ included |
| **Growth** | $17/mo | 68M | 5,000 | 2,000 | ✅ included |
| **Pro** | $25/mo | Unlimited | Unlimited | Unlimited | ✅ included |

> **What "indexing tokens" means to users:** Each time you rebuild your semantic search index (Re-index), the vault text is sent to an embedding AI. The amount sent is measured in tokens (roughly 4 characters = 1 token). Your monthly grant covers typical vault sizes. A 500-note vault re-indexed once uses ~500K tokens. Running Re-index 5× a month uses ~2.5M.

### 4.2 Token packs (rollover add-ons)

| Pack | Price | Tokens | Best for |
|------|-------|--------|----------|
| Small | $10 | +20M | Extra re-indexes for a mid-size vault |
| Medium | $25 | +60M | Heavy indexing month or large vault |
| Large | $50 | +150M | Agencies, large multi-vault setups |

Packs are consumed **after** the monthly grant is exhausted. They roll over indefinitely as long as the account has an active paid subscription.

### 4.3 Storage model (note count caps — not per-GB)

Storage is **not charged separately**. Per-GB billing creates user anxiety and support burden. Instead, each tier includes a **note count cap** that scales with price and protects against abuse on ICP stable memory.

| Tier | Note cap | Enforcement |
|------|----------|------------|
| Free | 200 | Hard (`402 STORAGE_QUOTA_EXCEEDED` on create) |
| Plus | 2,000 | Hard |
| Growth | 5,000 | Hard |
| Pro | Unlimited | None |

**Why note count and not bytes:** ICP stable memory cost scales roughly with entry count × average size. Note count is simple, user-understandable, and aligns with ICP cost structure. Average note size is ~2–5 KB; at 2,000 notes that's 4–10 MB per user — well within ICP limits for foreseeable scale.

**Rationale for caps:** Most individual users have 50–300 notes. The Free cap of 200 is generous for a free tier. Plus/Growth caps are effectively never reached by normal users. These caps exist to prevent accidental or intentional abuse (e.g., automated bulk writes) while giving legitimate users room to work.

---

## 5. Netlify environment variables

Add all of the following to the **gateway** Netlify site (Settings → Environment variables → Add variable).

### 5.1 Stripe keys and price IDs

```
STRIPE_SECRET_KEY           sk_live_...         Live secret key (from Stripe Developers → API keys)
STRIPE_WEBHOOK_SECRET       whsec_...           Webhook signing secret (from the webhook endpoint)
STRIPE_PRICE_PLUS           price_...           Knowtation Plus — $9/mo
STRIPE_PRICE_GROWTH         price_...           Knowtation Growth — $17/mo
STRIPE_PRICE_PRO            price_...           Knowtation Pro — $25/mo
STRIPE_PRICE_PACK_10        price_...           Token Pack Small — $10 one-time
STRIPE_PRICE_PACK_25        price_...           Token Pack Medium — $25 one-time
STRIPE_PRICE_PACK_50        price_...           Token Pack Large — $50 one-time
```

### 5.2 Billing behavior flags

```
BILLING_SHADOW_LOG          true                Log all metered ops now; analyze before enforcing
BILLING_ENFORCE             false               Keep false until shadow logs confirm correct metering
```

> **Important:** Do **not** set `BILLING_ENFORCE=true` until you have 1–2 weeks of shadow logs confirming that token counts and note counts are accurate. Flip it to `true` with no code changes when ready.

### 5.3 Test mode first (strongly recommended)

Before going live, run the full flow against Stripe **test mode**:

1. Set `STRIPE_SECRET_KEY` to `sk_test_...` (your test secret key)
2. Create the same products/prices in **test mode** in your Stripe dashboard (test and live are separate environments)
3. Use Stripe test card `4242 4242 4242 4242` to complete a checkout
4. Verify the webhook fires and the billing store updates correctly
5. Switch to `sk_live_...` and live price IDs when confirmed

---

## 6. Code changes required (Phase 16 build scope)

This section is the brief for the next session. All work goes on branch `feature/phase16-stripe-billing`.

### 6.1 `hub/gateway/billing-constants.mjs` — update tier names and values

- Rename `starter` → `plus`, `team` → (remove or keep as `team` for future seats)
- Add `growth` tier with 68M tokens
- Add note count caps per tier
- Add `addonTokensFromPackPriceId()` (mirrors existing `addonCentsFromPackPriceId` but returns token count)
- Add `STRIPE_PRICE_GROWTH` lookup in `tierFromEnvPriceId()`
- Add pack token amounts matching §4.2 above

### 6.2 `hub/gateway/server.mjs` — add two new routes

**`POST /api/v1/billing/checkout`**
- Accepts `{ price_id, success_url, cancel_url }` (or `{ tier }` as shorthand)
- Validates `price_id` is one of the known subscription or pack price IDs
- Creates a Stripe Checkout Session (`mode: 'subscription'` for tiers, `mode: 'payment'` for packs)
- Sets `metadata.user_id` on the session
- Sets `client_reference_id` to user ID for webhook correlation
- Returns `{ url }` for the Hub to redirect to

**`POST /api/v1/billing/portal`**
- Looks up or creates a Stripe Customer for the user (stored in billing store as `stripe_customer_id`)
- Creates a Stripe Billing Portal Session
- Returns `{ url }` for the Hub to redirect to

### 6.3 `hub/gateway/billing-stripe.mjs` — wire pack tokens

- In `checkout.session.completed` handler: when `mode === 'payment'`, read `metadata.indexing_tokens` from the line item price metadata and credit `pack_indexing_tokens_balance` in the billing store (currently only subscription mode is handled)
- Add `addonTokensFromPackPriceId()` lookup in the session handler

### 6.4 `hub/gateway/billing-middleware.mjs` — add note count enforcement

- On `POST /api/v1/notes` (note create), fetch current note count via `GET /api/v1/notes?limit=1` count header (or from canister)
- Compare against tier's note cap (`NOTE_CAP_BY_TIER`)
- Return `402 STORAGE_QUOTA_EXCEEDED` when over cap (only when `BILLING_ENFORCE=true`)

### 6.5 `hub/gateway/billing-store.mjs` — period reset

- Add `resetMonthlyTokensIfNeeded(userId)` helper: if `period_end` is in the past, reset `monthly_indexing_tokens_used` to 0 and advance `period_start` / `period_end`
- Call this at the top of `runBillingGate` and `handleBillingSummary`

### 6.6 `web/hub/hub.js` + `hub.css` — Hub billing UI upgrades

The existing billing panel in Settings already shows token usage. Additions:

- **Upgrade button:** If user is on Free or no subscription, show `Upgrade →` button that calls `POST /api/v1/billing/checkout` and redirects to Stripe Checkout
- **Manage billing button:** If user has an active subscription, show `Manage billing →` that calls `POST /api/v1/billing/portal` and redirects to Customer Portal
- **Token usage bar:** Visual progress bar `monthly_indexing_tokens_used / monthly_indexing_tokens_included`
- **Note count display:** `N notes used / N included` (from billing summary + note count)
- **Pack purchase:** Dropdown or card to choose pack size and checkout
- **Born Free blurb:** Short line below billing details — "Knowtation is a Born Free Communities tool. [bornfree.io](https://bornfree.io)"
- **Plan name display:** Show current tier name (Plus / Growth / Pro / Free) with renewal date

### 6.7 `docs/` updates

- Update `HOSTED-CREDITS-DESIGN.md` §2 with final confirmed tier names and token amounts
- Update `billing-constants.mjs` header comment to reflect new tiers

---

## 7. Implementation order within the branch

Build in this sequence to keep each commit testable:

1. **Constants + tier rename** — `billing-constants.mjs`: rename tiers, add growth, add note caps, add pack token amounts
2. **Checkout route** — `server.mjs` + `billing-stripe.mjs`: `POST /api/v1/billing/checkout`; test with curl + Stripe test mode
3. **Portal route** — `server.mjs`: `POST /api/v1/billing/portal`; test that portal URL is returned
4. **Pack token wiring** — `billing-stripe.mjs`: credit `pack_indexing_tokens_balance` from `checkout.session.completed` in payment mode
5. **Period reset** — `billing-store.mjs`: `resetMonthlyTokensIfNeeded`
6. **Note count enforcement** — `billing-middleware.mjs`: storage cap gate on note writes
7. **Hub UI** — `hub.js` + `hub.css`: upgrade button, manage button, usage bar, pack selector, Born Free blurb
8. **Smoke test full flow** in test mode: free → checkout → Plus → re-index → token consumption → portal → cancel
9. **Switch to live keys** + deploy
10. **Set `BILLING_SHADOW_LOG=true`** on Netlify; monitor for 1–2 weeks before flipping `BILLING_ENFORCE=true`

---

## 8. Session starter prompt for next session

> **Start here:** Implement Phase 16 Stripe billing on a new branch `feature/phase16-stripe-billing` from `main`. All decisions are finalized in `docs/PHASE16-STRIPE-BILLING-PLAN.md`. Follow the build order in §7 of that doc. Do not start with the Hub UI — start with `billing-constants.mjs` tier rename and work down the list. Test mode first (`sk_test_...`). The gateway webhook handler, store, summary, and token recording already exist in `hub/gateway/billing-*.mjs` — read those files before writing any code.

---

## 9. Born Free Q&A reference

**Q: Do I need a separate Stripe account or business entity for Knowtation?**
A: No. Knowtation is a product within Born Free Communities. Add it as a set of Products under your existing Stripe account. The legal billing entity remains Born Free Communities. Customers see "Born Free Communities" on their card statement and the Stripe customer portal, with `KNOWTATION` as the statement descriptor suffix.

**Q: Does having a different domain (knowtation.store vs bornfree.io) require a separate Stripe account?**
A: No. Stripe accounts represent legal entities, not websites. One company can operate multiple products on multiple domains under a single Stripe account. This is standard practice. Companies like Automattic (WordPress.com, Akismet, WooCommerce) and Atlassian (Jira, Confluence, Trello) all do this.

**Q: How do customers know the "Born Free Communities" charge is for Knowtation?**
A: Three places make this clear:
1. **Card statement:** `BORNFREE* KNOWTATION` (statement descriptor suffix)
2. **Stripe-hosted checkout page:** Product name `Knowtation Plus` is prominent; product description includes `knowtation.store`
3. **Customer portal:** Custom header message explains Born Free = Knowtation's parent organization, with link to bornfree.io

**Q: Does this also serve as marketing for Born Free?**
A: Yes. Every Knowtation subscriber who visits their billing portal sees the Born Free introduction with the bornfree.io link. Customers who discover Knowtation independently will learn about the broader Born Free platform through their billing experience. This is intentional and costs nothing to implement.

**Q: What about `storefree` under bornfree.io — is that the same pattern?**
A: Yes, exactly the same. StoreFree under bornfree.io/storefree is already a sub-product of Born Free. Knowtation is the same relationship, just on a separate domain. The Stripe account, legal entity, and payout destination remain unified under Born Free Communities for all three (Born Free, StoreFree, Knowtation).

---

*Last updated: 2026-04-02 — Initial plan. Decisions confirmed. Branch not yet created.*

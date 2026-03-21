# Hosted credits — design (usage-based, USD-pegged)

**Product:** Prepaid **platform credits** for **hosted Knowtation only**. **1 credit shown to the user = US $1.00.** The internal ledger uses **integer cents** (e.g. `100` = $1.00) so Stripe and deductions stay exact.

**Properties (product, not legal classification):**

- Credits are **redeemed only** against Knowtation hosted usage (notes, index, search, sync, etc.).
- They are **not transferable** to other users or resold; there is **no secondary market** in this design.
- **Optional top-up** via card (**Stripe**) and, later, **USDC on Avalanche** (or other Born Free–aligned rails) still **credit the same internal balance** after payment is verified.

**Related:** [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md) (where `balanceCents` lives in stable storage), [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) Phase 16, [HUB-API.md](./HUB-API.md) (error codes when implemented).

---

## 1. Same page: what we charge for

We identify **operations that drive real cost** (compute, embeddings, storage, egress, GitHub API) and attach **usage prices** in **cents** (or micro-units) per event. **Nothing is charged until** beta analysis and implementation flip **deductions** on.

| Meter (candidate) | Cost driver | Typical choke point |
|-------------------|-------------|---------------------|
| **Note write / large update** | Canister cycles + storage | Gateway → canister POST note |
| **Re-index** | Embedding API ($) | Bridge `POST /api/v1/index` |
| **Semantic search** | Vectors + CPU | Bridge `POST /api/v1/search` |
| **Backup / vault sync** | Egress + GitHub | Bridge vault sync |
| **Storage footprint (later)** | Ongoing bytes | Periodic aggregate per user |

**Start simple:** meter **index**, **search**, and **note writes** first; add **storage true-up** once sizes are reliable.

---

## 2. Beta period (free) — measure before pricing

1. **Shadow metering:** Log structured events on **gateway** and **bridge** (no balance change): `user_id`, route, approximate bytes, `vault_id` when present. Aggregate from Netlify/logs to see **who** uses **what** and rough **cost per user**.
2. **Set internal unit economics:** Map OpenAI (or other) invoice + ICP cycles + hosting to a **cents per index / search / write** table.
3. **Grandfathering (product decision):** Before turning on paid mode, decide:
   - **Option A:** All users must purchase credits after go-live.
   - **Option B:** **Grandfather** early beta users (e.g. by **account created before** date `T`, or explicit allowlist env `HUB_GRANDFATHER_USER_IDS`) with **free tier** credits or **permanent zero deduction** until revoked.
   - Document the chosen rule in deploy notes and env reference.

---

## 3. Purchase flow (Stripe — primary)

- **Stripe Checkout** or **Payment Links** for fixed packs (e.g. $10 / $25 / $100).
- **Webhook** on **gateway** (or dedicated billing route): on `checkout.session.completed` / `payment_intent.succeeded`, **add** cents to `balanceCents` for the **Stripe customer metadata `user_id`** (or map email → Hub user once).
- **Idempotency:** Persist processed **Stripe event ids**; ignore duplicates.
- **Secrets:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` in gateway (or bridge) env — never in repo.

---

## 4. Optional crypto top-up (USDC AVAX, etc.)

- **v1 manual:** Operator verifies transfer → credits balance (admin tool or script).
- **v2 automated:** Reuse Born Free patterns (listener) → same `credit(userId, cents)` path as Stripe.
- Ledger remains **one**; chain is only **how money arrives**.

---

## 5. Deduction and enforcement

- After beta: **middleware** (gateway and/or bridge) **after JWT**: look up `balanceCents`, subtract **priced** cost for the operation; if balance would go negative, respond **`402`** or **`403`** with body including `code: "INSUFFICIENT_CREDITS"` (document in HUB-API when implemented).
- **Soft limit (optional):** warn but allow one more operation — product choice.

---

## 6. Hub UX and notifications

- **Settings / header:** Show **balance** (dollars = cents / 100).
- **In-app:** Banner or toast when balance crosses **low thresholds** (e.g. below $2 or below 20% of last pack — tune later).
- **Email (Resend):** Same thresholds; **debounce** (e.g. at most one email per user per tier per 24h). Env: `RESEND_API_KEY`, from-address, template ids — Born Free umbrella may share or split subproject keys.

---

## 7. API stubs (when implemented)

- `GET /api/v1/settings` (or `GET /api/v1/billing/summary`): `{ "balance_cents": N, "low_balance": true/false }`.
- Purchase: link to Stripe Checkout (return URL back to Hub).

Reserved error **code** (document in HUB-API): `INSUFFICIENT_CREDITS`.

---

## 8. Self-hosted

- **Unchanged:** This design applies to **hosted** only unless you explicitly add a self-hosted billing mode later.

---

## 9. Revision log

| Date | Change |
|------|--------|
| 2026-03-21 | Initial design: USD-pegged cents ledger, Stripe primary, beta shadow metering, grandfather options, Resend, meter table. |

# Hosted storage and billing — single migration roadmap

**Purpose:** Decide **once** how Motoko stable storage evolves for **Phase 15.1 (multi-vault)** and **Phase 16 (billing)** so we do not reorganize the canister twice. This doc is the **pre-code gate** before changing [hub/icp/src/hub/Migration.mo](../hub/icp/src/hub/Migration.mo) and deploying.

**Related:** [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md) (**indexing token** monthly grant + **rollover token** packs; Stripe), [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md), [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) Phases 15.1 and 16.

**Current Phase 16 scaffold:** Billing **state and webhooks** live in the **gateway** (`hub/gateway/billing-*.mjs`) with **file** (`data/hosted_billing.json`) or **Netlify Blob** persistence. Canister V1 fields below are the **target** when billing is co-located with note data.

---

## 1. Current stable shape (V0)

- `vaultEntries`: `[(userId, [(path, (frontmatter, body))])]` — one logical vault per user on hosted today.
- `proposalEntries`: per-user proposal lists.
- See [Migration.mo](../hub/icp/src/hub/Migration.mo).

---

## 2. Target stable shape (V1) — implement in one upgrade

### 2.1 Notes

- Key notes by **`(userId, vaultId)`** then **`path`**.
- Default vault id: **`default`**. Migrate existing rows into `(userId, "default", path, ...)`.
- Exact Motoko representation: **nested maps** or **composite text keys** — pick one implementation and document here when coded.

### 2.2 Proposals

- If note paths can repeat across vaults, add **`vault_id`** to proposal records (or document that proposals are **default-vault only** on hosted until extended).

### 2.3 Phase 16 — billing fields (reserve in V1; mirror gateway when ready)

Per **`userId`** (or team billing owner), reserve fields aligned with [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md):

| Field (conceptual) | Purpose |
|-------------------|---------|
| **`tier`** | `beta` \| `free` \| `plus` \| `growth` \| `pro` \| `team` (exact enum TBD) |
| **`stripe_customer_id`** | Stripe Customer id |
| **`stripe_subscription_id`** | Active subscription id (if any) |
| **`period_start` / `period_end`** | ISO timestamps for current subscription period |
| **`monthly_indexing_tokens_included`** | Grant this period (e.g. millions of **embedding input** tokens for index builds) |
| **`monthly_indexing_tokens_used`** | Consumed from monthly grant this period |
| **`pack_indexing_tokens_balance`** | Rollover from **purchased** packs (consumed **after** monthly grant) |
| **`monthly_included_cents`** / **`monthly_used_cents`** / **`addon_cents`** | **Legacy gateway scaffold** until token ledger fully replaces cent-based index/search debits |

**Note:** Gateway may ship **tokens** in Blob/JSON **before** the canister adds columns; keep **gateway authoritative** until V1 migration is coded.

**Alternative:** Keep billing **only** in gateway/Blob (current scaffold); canister has **no** billing columns until you need canister-side enforcement without gateway round-trip. If so, document and ensure **all** metered routes pass through gateway.

**Default long-term:** Canister holds note data; **either** replicate billing snapshot for enforcement **or** trust gateway middleware only — pick one when scaling.

### 2.4 Phase 12 (on-chain note fields)

- **No extra canister columns required** if `frontmatter` remains **opaque YAML text**; optional keys (`network`, `wallet_address`, `tx_hash`, `payment_status`) live in frontmatter per [SPEC.md](./SPEC.md) §2.4 and [BLOCKCHAIN-AND-AGENT-PAYMENTS.md](./BLOCKCHAIN-AND-AGENT-PAYMENTS.md).

---

## 3. Payment rails (product, not storage)

- **Stripe Billing:** Subscriptions for **Plus / Growth / Pro** (see HOSTED-CREDITS-DESIGN **§2**); **Customer Portal**; webhooks reset **monthly indexing token** counters and set **`monthly_indexing_tokens_included`** from tier.
- **Stripe Checkout (one-time):** **Indexing token packs** → **`pack_indexing_tokens_balance`** **idempotently** on `checkout.session.completed` (`mode: payment`).
- **Deferred:** Crypto as a funding rail — not in the first slice.

---

## 4. Before `dfx deploy` (checklist)

- [ ] V1 `StableStorage` type and `Migration.mo` upgrade path defined in code.
- [ ] Local replica test: migrate sample V0 → V1; verify notes under `default` vault.
- [ ] HOSTED-CREDITS-DESIGN: hybrid pools + enforcement rules agreed.
- [ ] Production backup / export plan if any real user data exists.

---

## 5. Revision log

| Date | Change |
|------|--------|
| 2026-03-21 | Initial roadmap: V1 notes + vault_id + reserved balance cents + Phase 12 via frontmatter. |
| 2026-03-21 | Billing: subscription-first; `balanceCents` → **addon rollover**; crypto deferred. |
| 2026-03-21 | **Dual pools:** `monthly_included_cents` / `monthly_used_cents` + `addon_cents`; gateway scaffold; V1 field table. |
| 2026-03-22 | Tier list adds **`free`**; aligns with HOSTED-CREDITS-DESIGN. |
| 2026-03-25 | Billing fields: **indexing token** pools + legacy **cents** note; Stripe rails = **token** packs. |

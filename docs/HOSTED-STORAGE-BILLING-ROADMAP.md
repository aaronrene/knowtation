# Hosted storage and billing — single migration roadmap

**Purpose:** Decide **once** how Motoko stable storage evolves for **Phase 15.1 (multi-vault)** and **Phase 16 (usage credits)** so we do not reorganize the canister twice. This doc is the **pre-code gate** before changing [hub/icp/src/hub/Migration.mo](../hub/icp/src/hub/Migration.mo) and deploying.

**Related:** [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md) (metering, Stripe, beta, notifications), [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md), [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) Phases 15.1 and 16.

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

### 2.3 Phase 16 balance (reserve in V1)

- **Recommended:** `userBalanceCents : [(userId, Nat)]` (or equivalent map), **initialized to 0** for all users at migration, even before Stripe or deductions ship.
- **Alternative:** Ledger only on **gateway/bridge** — then the canister **never** holds balance; document that choice explicitly and enforce all paid routes only through components that read the ledger.

**Default recommendation for this repo:** **Canister holds `balanceCents` per user** next to note data so the authoritative store for hosted content and balance stays aligned. Gateway applies Stripe **credit** via a future authenticated admin or canister update path (design in HOSTED-CREDITS-DESIGN).

### 2.4 Phase 12 (on-chain note fields)

- **No extra canister columns required** if `frontmatter` remains **opaque YAML text**; optional keys (`network`, `wallet_address`, `tx_hash`, `payment_status`) live in frontmatter per [SPEC.md](./SPEC.md) §2.4 and [BLOCKCHAIN-AND-AGENT-PAYMENTS.md](./BLOCKCHAIN-AND-AGENT-PAYMENTS.md).

---

## 3. Payment rails (product, not storage)

- **Primary:** Stripe (Checkout or Payment Links) → gateway **webhook** → **idempotent** credit to `balanceCents`.
- **Optional later:** USDC on Avalanche (Born Free stack) or other rails — still credit the **same** internal balance after verification; chain is a **funding** path, not a second ledger.

---

## 4. Before `dfx deploy` (checklist)

- [ ] V1 `StableStorage` type and `Migration.mo` upgrade path defined in code.
- [ ] Local replica test: migrate sample V0 → V1; verify notes under `default` vault.
- [ ] HOSTED-CREDITS-DESIGN: shadow metering / beta / deduction rules agreed for first paid slice.
- [ ] Production backup / export plan if any real user data exists.

---

## 5. Revision log

| Date | Change |
|------|--------|
| 2026-03-21 | Initial roadmap: V1 notes + vault_id + reserved balance cents + Phase 12 via frontmatter. |

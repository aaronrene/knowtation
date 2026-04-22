# Blockchain, Wallets, and Agent Payments

Agents increasingly have access to **wallets** and use **blockchain** for payments, attestation,
and on-chain activity. This document defines the optional frontmatter extensions for **Phase 12**,
now active on `feature/phase12-blockchain-frontmatter`. Core (Phases 1–10) and Hub (Phase 11)
are unchanged. See [PHASE12B-BLOCKCHAIN-REMAINDER.md](./PHASE12B-BLOCKCHAIN-REMAINDER.md) and phase rows in [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md).

**Naming note:** The existing `--chain` flag and frontmatter `causal_chain_id` refer to *causal
chains of notes* (see INTENTION-AND-TEMPORAL). For *blockchain* we use `network` (not `chain`) to
avoid collision.

---

## 1. Optional frontmatter fields

All fields are optional. Notes without them are fully valid. No Motoko schema change is required —
frontmatter is stored as opaque JSON in the canister.

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| `network` | string | `icp`, `ethereum`, `sepolia` | Blockchain network identifier. Enables filter by network. |
| `wallet_address` | string | `rrkah-fqaaa-aaaaa-aaaaq-cai` | Wallet principal, address, or account ID. Enables filter by wallet. |
| `tx_hash` | string | `0xabc123…` | On-chain transaction hash or ICP transaction ID. |
| `payment_status` | string | `pending`, `settled`, `failed` | Status for payment-tracking notes. |
| `amount` | number or string | `1.5`, `"100 ICP"` | Transfer amount. String allows currency suffix. |
| `currency` | string | `ICP`, `ETH`, `USDC` | Token or currency symbol. |
| `direction` | string | `sent`, `received` | Transfer direction from the wallet's perspective. |
| `confirmed_at` | ISO timestamp | `2026-04-02T18:00:00Z` | On-chain confirmation time (may differ from note `date`). |
| `block_height` | integer | `12345678` | Block number when tx was included. |
| `air_id` | string | `air-abc123` | AIR attestation ID when this note has an on-chain attestation. |

### Recommended `payment_status` conventions

| Value | Meaning |
|-------|---------|
| `pending` | Submitted but not yet confirmed |
| `settled` | Confirmed on-chain |
| `failed` | Reverted, rejected, or timed out |
| `cancelled` | Intentionally cancelled before submission |

### Recommended tag conventions

- `payment` — any note about a financial transfer
- `on-chain` — any note referencing on-chain activity
- `attestation` — notes linked to an AIR attestation
- `icp-tx` — ICP-specific transaction notes
- `agent-activity` — notes written by an automated agent

---

## 2. CLI / API filters (implemented in Phase 12)

- `--network <id>` — filter `list-notes` results to a specific blockchain network.
- `--wallet <address>` — filter by wallet address (exact match after normalization).
- `--payment-status <status>` — filter by payment status enum.
- Hub UI: **Network** and **Wallet** dropdowns populated from vault facets. **Payment status**
  Quick chips for `pending`, `settled`, `failed`.

---

## 3. Capture and import

- **On-chain events → vault:** Capture plugins (Phase 5 contract) write notes to the inbox when
  on-chain events occur. Same contract: `path`, `frontmatter` (`source`, `date`, `source_id`),
  plus the new optional fields above. No new core phase required.
- **Import (future):** Optional import source type for "wallet export" or "transaction history"
  that produces vault notes with the reserved frontmatter. Format TBD.

---

## 4. AIR and attestation

AIR (Phases 4, 8) already provides an attestation hook before write/export. Phase 12+ can add an
optional backend where the attestation is recorded on-chain (e.g. signing canister, ICP).
`air_id` in frontmatter is the link back. No change to AIR's interface.

---

## 5. Summary

| Area | Status |
|------|--------|
| Frontmatter fields (`network`, `wallet_address`, `tx_hash`, `payment_status`, `amount`, `currency`, `direction`, `confirmed_at`, `block_height`, `air_id`) | **Implemented — Phase 12** |
| List-notes filters (`--network`, `--wallet`, `--payment-status`) | **Implemented — Phase 12** |
| Hub UI filter dropdowns (Network, Wallet) + Quick chips (payment status) | **Implemented — Phase 12** |
| Hosted facets (`networks`, `wallets` in `/api/v1/notes/facets`) | **Implemented — Phase 12** |
| Keyword search scope (network, wallet_address, tx_hash in match fields) | **Implemented — Phase 12** |
| Capture plugins (on-chain events → inbox) | Phase 5 contract (no code change) |
| Import source (wallet/tx history CSV) | Future |
| AIR on-chain backend | Future |
| MCP tool filter params (`network`, `wallet`) | Follow-on |

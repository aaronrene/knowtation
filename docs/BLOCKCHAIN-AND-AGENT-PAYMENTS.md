# Blockchain, Wallets, and Agent Payments

Agents increasingly have access to **wallets** and use **blockchain** for payments, attestation, and on-chain activity. This document **reserves** optional extensions so Knowtation can support them without backtracking. Nothing here is required for core (Phases 1–10) or for Phase 11 (hub). Implement when needed in **Phase 12** or a follow-on phase.

**Naming note:** The existing `--chain` flag and frontmatter `causal_chain_id` refer to *causal chains of notes* (see INTENTION-AND-TEMPORAL). For *blockchain* we use distinct names below (e.g. `network`, `chain_id` for the blockchain network) to avoid collision.

---

## 1. Reserved optional frontmatter

When Phase 12 (or a later phase) implements blockchain/payment support, the following **optional** frontmatter can be added. Notes remain valid without them.

| Field | Type | Description |
|-------|------|-------------|
| `network` or `chain_id` | string | Blockchain network identifier (e.g. `mainnet`, `sepolia`, `icp`, or chain id). Enables filter by network. |
| `wallet_address` | string | Wallet address associated with the note (e.g. signer, payer, payee). Enables filter by wallet. |
| `tx_hash` | string | Transaction hash (on-chain) when the note references a specific transaction. |
| `payment_status` | string | Optional status (e.g. `pending`, `settled`, `failed`) for notes that track payments. |
| `air_id` or attestation ref | string | Link to AIR attestation; optional on-chain attestation id when AIR is backed by blockchain. |

Same slug-style normalization as other optional fields where applicable. No required new fields; existing notes and all current phases are unchanged.

---

## 2. Reserved CLI / API extensions

- **Filters:** Optional `--network <id>`, `--wallet <address>` (or `--wallet-address`) for `search` and `list-notes` so results can be scoped to a blockchain network or wallet. Implemented when frontmatter above is in use.
- **Commands:** Optional subcommand or tool for “notes by wallet” or “notes by network”; or a dedicated `knowtation payments` (or similar) that lists/filters notes with payment-related frontmatter. Exact command names TBD in Phase 12.
- **Categories / tags:** Users and capture plugins can already use `tags` (e.g. `payment`, `on-chain`, `attestation`). Phase 12 may add **reserved tag conventions** or a small set of suggested tags for payment/blockchain notes; no change to core tag semantics.

---

## 3. Capture and import

- **On-chain events → vault:** Capture plugins (Phase 5 contract) can write notes to the inbox when payments or on-chain events occur (e.g. webhook from a payment provider or indexer). Same contract: path, frontmatter (`source`, `date`, `source_id`), plus optional `network`, `wallet_address`, `tx_hash`, `payment_status`. No new phase required for “capture that happens to be blockchain”; extend the same message-interface contract.
- **Import:** Optional import source type (e.g. “wallet export” or “transaction history”) that produces vault notes with the reserved frontmatter; format TBD in Phase 12.

---

## 4. AIR and attestation

- AIR (Phase 4, 8) already provides an attestation hook before write/export. Phase 12 can add an **optional** backend where the AIR id or attestation is recorded on-chain (e.g. signing canister, ICP). No change to AIR’s interface; blockchain is one possible implementation of the attestation store.

---

## 5. Implementation phase

- **Phase 12 — Blockchain, wallets, and agent payments (optional):** Implement the reserved frontmatter, indexer metadata, CLI filters (`--network`, `--wallet`), and optional capture/import for on-chain events. Document tag conventions and AIR-on-chain if implemented. Depends on Phases 1–4 (and ideally 3.1 for consistent filter pattern); can follow Phase 10 or 11.
- Core (1–10) and Hub (11) do **not** depend on Phase 12. No backtracking to earlier phases.

---

## 6. Summary

| Area | Reserved | Implement in |
|------|----------|--------------|
| Frontmatter (network, wallet_address, tx_hash, payment_status) | Yes | Phase 12 |
| CLI filters (--network, --wallet) | Yes | Phase 12 |
| Capture (on-chain events → inbox) | Same contract as Phase 5 | Phase 12 or plugin |
| Import (wallet/tx history) | Yes | Phase 12 |
| AIR on-chain backend | Optional backend | Phase 12 or later |
| Tags / categories | Conventions optional | Phase 12 |

This keeps the design plan forward-looking for agent wallets and blockchain without changing any existing phase or the current spec.

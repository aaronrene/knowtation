# Phase 12 — Blockchain Frontmatter & Agent Wallet Records

**Branch:** `feature/phase12-blockchain-frontmatter`
**Status:** Active
**Reference:** [BLOCKCHAIN-AND-AGENT-PAYMENTS.md](./BLOCKCHAIN-AND-AGENT-PAYMENTS.md)

---

## 1. What Phase 12 Is (and Is Not)

**Is:** A first-class note metadata layer for blockchain activity. Users and agents can write notes
about on-chain transactions, annotate wallet activity, and filter their vault by network, wallet
address, or payment status. Think: an ICP agent that records every canister call or token transfer
as a note — and the Hub lets you browse and search that history.

**Is not:** A payments integration, a wallet runtime, or anything that makes Knowtation itself
transact on-chain. No keys leave the user's environment. No funds are moved. Knowtation stores the
*record* of what happened on-chain; the chain itself is the source of truth.

---

## 2. Framing: "Agent Wallet Records"

Agents increasingly have wallets and produce on-chain events. A Knowtation vault is the natural
audit trail for that activity:

- An ICP agent records each `transfer` or `approve` call as a note with `network: icp`,
  `wallet_address: <principal>`, `tx_hash: <transaction_id>`, `payment_status: settled`.
- A DeFi agent records pending approvals as `payment_status: pending` and updates to `settled`
  after confirmation.
- A human manually pastes a receipt hash into a note for personal bookkeeping.

The vault becomes a searchable, exportable log of agent and human on-chain activity — independent
of the chain, queryable through Hub, and exportable to other systems via MCP.

---

## 3. Frontmatter Fields (full set)

All fields are **optional**. Notes without them are unchanged.

| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `network` | string | `icp`, `ethereum`, `sepolia`, `base` | Blockchain network identifier. Use common names or chain IDs. |
| `wallet_address` | string | `rrkah-fqaaa-aaaaa-aaaaq-cai` | Wallet principal, address, or account ID of signer/payer/payee. |
| `tx_hash` | string | `0xabc123…` | On-chain transaction hash or ICP transaction ID. |
| `payment_status` | string | `pending`, `settled`, `failed` | Status for payment-tracking notes. Free-form but conventions below. |
| `amount` | number or string | `1.5`, `"100 ICP"` | Transfer amount. String allows currency suffix. |
| `currency` | string | `ICP`, `ETH`, `USDC` | Token or currency symbol. Separate from `amount` for easy filtering. |
| `direction` | string | `sent`, `received` | Disambiguates direction for wallet-centric notes. |
| `confirmed_at` | ISO timestamp | `2026-04-02T18:00:00Z` | On-chain confirmation time (may differ from note `date`). |
| `block_height` | integer | `12345678` | Block number when the tx was included. |
| `air_id` | string | `air-abc123` | AIR attestation ID if this note was attested on-chain. |

**Naming note:** `causal_chain_id` is a *causal chain of notes* (unrelated). The `network` field is
the blockchain network. There is no collision.

### Recommended `payment_status` conventions

| Value | Meaning |
|-------|---------|
| `pending` | Submitted but not yet confirmed |
| `settled` | Confirmed on-chain |
| `failed` | Reverted, rejected, or timed out |
| `cancelled` | Intentionally cancelled before submission |

### Recommended tag conventions

In addition to the structured frontmatter above, the following tags are encouraged for
discoverability:

- `payment` — any note about a financial transfer
- `on-chain` — any note referencing on-chain activity
- `attestation` — notes linked to an AIR attestation
- `icp-tx` — ICP-specific transaction notes
- `agent-activity` — notes written by an automated agent

---

## 4. Build Scope

### 4A — Core filter layer (`lib/list-notes.mjs`)
- Add `network`, `wallet_address`, `payment_status` filter options to `filterNotesByListOptions`.
- Add `networks`, `wallets` to `runFacets` output.

### 4B — Keyword search (`lib/keyword-search.mjs`)
- Propagate `network`, `wallet_address`, `tx_hash`, `payment_status` from frontmatter into the
  note record so keyword search can match against them.
- Respect `network` and `wallet_address` as structural filters (same as 4A).

### 4C — Hosted facets (`hub/gateway/note-facets.mjs`)
- Add `networks` and `wallets` to `deriveFacetsFromCanisterNotes`.

### 4D — Gateway routes (`hub/gateway/server.mjs`)
- Forward `network` and `wallet_address` query params from list/search requests to the bridge.
- Include `networks` and `wallets` in the `/api/v1/notes/facets` response.

### 4E — Hub UI (`web/hub/hub.js` + `web/hub/index.html`)
- Add **Network** dropdown filter (populated from `facets.networks`).
- Add **Wallet** dropdown filter (populated from `facets.wallets`).
- Add **Payment status** Quick chips: `pending`, `settled`, `failed`.
- Include `network`, `wallet_address`, `payment_status` in the bookmark/params object so they
  persist across navigation.

---

## 5. What Is Not in Phase 12

| Out of scope | Reason |
|---|---|
| Writing to the chain | Not a wallet runtime |
| On-chain event webhooks / capture plugin | Phase 5 contract already covers this; implement as a plugin |
| Import from wallet history CSV | Future import source type |
| AIR on-chain backend | Optional backend for Phase 12+ |
| MCP tool filter params (`network`, `wallet`) | Follow-on after core UI ships |
| Canister Motoko changes | Frontmatter is stored as opaque JSON; no Motoko schema change needed |

---

## 6. Ops

- **Self-hosted:** redeploy `hub/` (Node Hub) after `lib/` changes.
- **Hosted:** redeploy **gateway** + **static Hub** (`web/hub`). No canister redeploy needed
  (frontmatter is opaque JSON in canister storage — new fields are stored and retrieved without
  schema changes).

---

## 7. Example Note

```markdown
---
title: ICP token transfer to treasury
date: 2026-04-02
network: icp
wallet_address: rrkah-fqaaa-aaaaa-aaaaq-cai
tx_hash: 8a3c0d…
payment_status: settled
amount: 500
currency: ICP
direction: sent
confirmed_at: 2026-04-02T18:12:44Z
tags: [payment, icp-tx, on-chain]
---

Transferred 500 ICP to treasury canister as part of cycle top-up.
Initiated by the operations agent at block 12,345,678.
```

This note appears in:
- Hub → **Network: icp** filter
- Hub → **Wallet: rrkah-…** filter
- Hub → Payment status **settled** chip
- Semantic search: "ICP treasury transfer"
- Keyword search: "rrkah-fqaaa" or "8a3c0d"

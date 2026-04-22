# Phase 12B — Blockchain Remainder

**Prerequisite:** Phase 12A (`feature/phase12-blockchain-frontmatter`) merged to `main`.
**Branch:** `feature/phase12b-blockchain-remainder`
**Reference:** [BLOCKCHAIN-AND-AGENT-PAYMENTS.md](./BLOCKCHAIN-AND-AGENT-PAYMENTS.md), [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) (Phase 12A / 12B rows)

This document covers the two features deferred from Phase 12A:

1. **Wallet/transaction history CSV import** — a new import source type that converts wallet
   export files into vault notes with blockchain frontmatter.
2. **AIR on-chain backend** — using the ICP attestation canister (see
   [AIR-IMPROVEMENTS-PLAN.md](./AIR-IMPROVEMENTS-PLAN.md) Improvement E) as the storage
   backend for attestation records, linked back to notes via `air_id`.

---

## Part 1 — Wallet/Transaction History CSV Import

### 1.1 What it does

Users export transaction history from a wallet app, exchange, or block explorer as a CSV file.
They import it into Knowtation via `POST /api/v1/import` or the Hub Import UI. Each row in the
CSV becomes one vault note with:

- A title derived from the transaction description or type
- `network`, `wallet_address`, `tx_hash`, `payment_status`, `amount`, `currency`,
  `direction`, `confirmed_at`, `block_height` frontmatter (wherever the CSV provides them)
- `source: wallet-csv-import`, `source_id: <tx_hash or row id>`
- Body containing the raw row data as a human-readable summary

### 1.2 Import source type

Add `wallet-csv` as a new value in `lib/import-source-types.mjs`.

```js
// lib/import-source-types.mjs — add:
'wallet-csv': 'Wallet or exchange transaction history CSV'
```

### 1.3 Column mapping

Different wallets/exchanges use different column names. The importer must handle aliases.
Here is the canonical mapping:

| Canonical field | CSV column aliases (case-insensitive) |
|---|---|
| `tx_hash` | `txhash`, `transaction_hash`, `hash`, `tx id`, `txid`, `transaction id` |
| `date` / `confirmed_at` | `date`, `timestamp`, `time`, `confirmed at`, `block time` |
| `amount` | `amount`, `value`, `quantity` |
| `currency` | `currency`, `asset`, `token`, `coin`, `symbol` |
| `direction` | `type`, `direction`, `side` — map `buy`/`receive`/`in` → `received`; `sell`/`send`/`out` → `sent` |
| `payment_status` | `status` — map `completed`/`success` → `settled`; `pending` → `pending`; `failed`/`error` → `failed` |
| `wallet_address` | `from`, `to`, `address`, `wallet`, `sender`, `recipient` |
| `network` | `network`, `chain`, `blockchain` |
| `block_height` | `block`, `block number`, `block height` |

### 1.4 Note path convention

```
inbox/wallet-import/<YYYY-MM-DD>-<tx_hash_prefix>.md
```

If no `tx_hash`, use a slug from the date + amount + currency:
```
inbox/wallet-import/2026-04-02-500-icp.md
```

### 1.5 Deduplication

Use `source_id` = `tx_hash` (or the computed slug if no hash) as the dedup key. On re-import,
skip notes where a note with `source: wallet-csv-import` and the same `source_id` already exists.

### 1.6 Body template

```markdown
---
title: ICP transfer — 500 ICP sent
date: 2026-04-02
network: icp
wallet_address: rrkah-fqaaa-aaaaa-aaaaq-cai
tx_hash: 8a3c0d…
payment_status: settled
amount: 500
currency: ICP
direction: sent
confirmed_at: 2026-04-02T18:12:44Z
block_height: 12345678
source: wallet-csv-import
source_id: 8a3c0d…
tags: [payment, icp-tx, on-chain]
---

Transaction imported from wallet CSV export.
Amount: 500 ICP | Direction: sent | Status: settled
Block: 12,345,678 | Confirmed: 2026-04-02 18:12:44 UTC
```

### 1.7 Supported CSV formats (v1 target)

Implement parsers for these first, then add others as needed:

| Source | Notes |
|---|---|
| **Generic / custom** | Any CSV with recognized headers per mapping table above |
| **ICP Rosetta export** | Standard Rosetta transaction format |
| **Coinbase** | `Date, Transaction Type, Asset, Quantity Transacted, …` |
| **Coinbase Pro** | `portfolio, type, time, amount, balance, …` |
| **Exodus wallet** | `DATE, TYPE, FROMAMOUNT, FROMCURRENCY, …` |

Generic parser first; named parsers as thin wrappers that normalize column names before
passing to the generic parser.

### 1.8 Files to create/change

| File | Change |
|---|---|
| `lib/import-source-types.mjs` | Add `wallet-csv` entry |
| `lib/importers/wallet-csv.mjs` | **New** — CSV parser + note builder |
| `lib/import.mjs` | Wire `wallet-csv` source type to the new importer |
| `web/hub/index.html` | Add `wallet-csv` option to import source dropdown |
| `docs/IMPORT-SOURCES.md` | Document wallet-csv source type, column mapping, examples |

### 1.9 Self-hosted vs hosted

- **Self-hosted:** CSV upload via `POST /api/v1/import` with `source_type: wallet-csv`.
  The bridge handles it exactly like other import types.
- **Hosted:** Same `POST /api/v1/import` through the gateway → bridge. The bridge already
  handles arbitrary import source types — no gateway change needed.

---

## Part 2 — AIR On-Chain Backend (ICP Attestation Canister)

This is Improvement E from [AIR-IMPROVEMENTS-PLAN.md](./AIR-IMPROVEMENTS-PLAN.md).

**Hard prerequisite:** AIR Improvements A, B, C, and D must be shipped first. Specifically,
the built-in Netlify attestation endpoint (Improvement D) must exist before the ICP canister
can be wired as a durable backing store.

### 2.1 What it does

When the built-in Netlify attestation endpoint (D) processes an attestation request, it
additionally writes the record to an ICP canister. The canister stores attestations in stable
memory with no update or delete operations — making them tamper-evident and verifiable by
third parties without trusting the Knowtation operator.

### 2.2 Canister interface (Motoko)

```motoko
// hub/icp/src/attestation/main.mo

type AttestationRecord = {
  id: Text;
  action: Text;        // "write" | "export"
  path: Text;          // vault-relative path
  timestamp: Int;      // nanoseconds since epoch
  content_hash: ?Text; // optional SHA-256 of note content
  sig: Text;           // HMAC from the gateway (Improvement D)
};

actor Attestation {
  stable var records: [(Text, AttestationRecord)] = [];

  public shared func storeAttestation(r: AttestationRecord): async Text {
    // Append only — no update/delete
    records := Array.append(records, [(r.id, r)]);
    return r.id;
  };

  public query func getAttestation(id: Text): async ?AttestationRecord {
    switch (Array.find(records, func((k, _)) { k == id })) {
      case (?(_, v)) { ?v };
      case null { null };
    }
  };

  public query func listAttestations(limit: Nat, offset: Nat): async [AttestationRecord] {
    // Admin use only — returns paginated records
    let all = Array.map(records, func((_, v): AttestationRecord { v });
    Array.subArray(all, offset, limit);
  };
}
```

### 2.3 Gateway verification endpoint

```
GET /api/v1/attest/:id/verify
```

Response:
```json
{
  "id": "air-abc123",
  "verified": true,
  "sources": ["blobs", "icp"],
  "record": { "action": "write", "path": "...", "timestamp": "...", "sig": "..." },
  "icp_canister_id": "ryjl3-tyaaa-aaaaa-aaaba-cai"
}
```

If the ICP canister returns a matching record, `verified: true` and `sources` includes `"icp"`.
If only Blobs have the record (canister not deployed), `sources = ["blobs"]`.

### 2.4 New frontmatter written back to notes

After successful canister storage, these are injected into the note:

```yaml
air_id: air-abc123
air_canister_id: <deployed canister principal>
air_block_height: <canister sequence number>
```

### 2.5 New Netlify env vars

| Var | Purpose |
|---|---|
| `ATTESTATION_CANISTER_ID` | Principal of the deployed attestation canister |
| `ATTESTATION_CANISTER_HOST` | ICP host (default: `https://ic0.app`) |

### 2.6 Files to create/change

| File | Change |
|---|---|
| `hub/icp/src/attestation/main.mo` | **New** — attestation canister |
| `hub/icp/src/attestation/attestation.did` | **New** — Candid interface |
| `netlify/functions/attest.mjs` | Add ICP write after Blobs write (graceful degradation if canister unreachable) |
| `hub/gateway/server.mjs` | Add `GET /api/v1/attest/:id/verify` route |
| `docs/DEPLOY-HOSTED.md` | Document canister deploy + env var setup |

### 2.7 Ops

1. Deploy attestation canister: `dfx deploy attestation --network ic`
2. Set `ATTESTATION_CANISTER_ID` in Netlify env vars
3. Redeploy gateway (Netlify Function) — no static Hub change needed

---

## Build Order

```
Phase 12A (done) → Phase 12B Part 1 (CSV import) → AIR A+B+C → AIR D → Phase 12B Part 2 (ICP anchor)
```

Do not start Part 2 (ICP anchor) until AIR Improvements A–D are shipped. The ICP canister
is only meaningful when there is a built-in endpoint (D) that populates it.

---

## Next Session Prompt (copy-paste to start)

```
We are implementing Phase 12B — blockchain import and AIR on-chain backend.
Branch: feature/phase12b-blockchain-remainder (create from main after Phase 12A is merged).

Read these files before writing any code:
- docs/PHASE12B-BLOCKCHAIN-REMAINDER.md   (this document)
- docs/IMPLEMENTATION-PLAN.md              (Phase 12A / 12B context)
- docs/AIR-IMPROVEMENTS-PLAN.md           (AIR A–E; Part 2 here depends on D)
- lib/import.mjs                          (existing import pipeline)
- lib/import-source-types.mjs             (where to add 'wallet-csv')
- lib/importers/                          (existing importers for reference pattern)

Session goal: implement Part 1 (wallet CSV import) only.
Do NOT start Part 2 (ICP canister) — that requires AIR A–D to ship first.

Part 1 task order:
1. lib/import-source-types.mjs — add 'wallet-csv' entry
2. lib/importers/wallet-csv.mjs — NEW: CSV parser with generic column mapping + note builder
3. lib/import.mjs — wire wallet-csv to the new importer
4. web/hub/index.html — add wallet-csv option to import source dropdown
5. docs/IMPORT-SOURCES.md — document the new source type with column mapping table
6. Commit, push, open PR

Test: import a small CSV (3–5 rows) with tx_hash, amount, currency, direction columns.
Confirm notes appear in vault with correct frontmatter and are filterable by network in Hub.
```

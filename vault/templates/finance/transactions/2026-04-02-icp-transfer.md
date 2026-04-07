---
title: ICP transfer — treasury to cold staging
project: finance-template
tags:
  - transaction
  - icp
  - blockchain
date: 2026-04-07
network: icp
wallet_address: "2vxsx-fae-aaaa-aaaa-cai"
tx_hash: "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456"
payment_status: confirmed
amount: "12.5"
currency: ICP
direction: outbound
confirmed_at: "2026-04-02T14:22:00Z"
block_height: 12345678
---

# ICP transfer — treasury to cold staging

**Narrative date note:** Frontmatter `date` is the **documentation** date (2026-04-07); on-chain fields reflect the **actual transfer** (2026-04-02). Adjust to match your CSV import conventions.

## Purpose

Move **12.5 ICP** from operational hot wallet to **cold staging** ahead of quarterly rebalance. Not a disposal for tax purposes in this template scenario (same beneficial ownership).

## Counterparty / destination

- Staging principal ID: `aaaaa-aa` (placeholder — use real principal in your vault, never secret material)

## Fees

- Transaction fee deducted in ICP; record exact fee in exchange export row `FEE-2026-04-02-001`.

## Reconciliation & follow-up

Match custodian CSV row `2026-04-02,OUT,ICP,12.5,0.0003,...`; explorer URL = your base + `tx_hash`. After **30 confirmations**, verify cold balance in monthly controls; if `payment_status` stays `pending` >1h, follow custody SOP.

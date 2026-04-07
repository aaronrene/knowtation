# Finance template

This template supports **portfolio tracking, tax documentation, blockchain activity, and audit-friendly narratives**. It pairs human-readable notes with structured frontmatter where imports or tooling expect consistent fields.

## Target audience

- Individuals and small firms reconciling **on-chain and off-chain** positions
- Tax preparers receiving **event summaries** without raw keys or full wallet dumps
- Anyone who wants thesis, positions, transactions, and quarterly reports linked in one vault

## Folder layout

| Folder | Purpose |
|--------|---------|
| `inbox/` | Orientation and quick capture |
| `thesis/` | Investment theses with risks and horizons |
| `positions/` | Allocation snapshots and rebalance notes |
| `transactions/` | Per-tx or per-transfer notes; optional blockchain frontmatter for CSV alignment |
| `reports/` | Quarterly or annual summaries |
| `tax/` | Taxable event trackers by year |

**Security:** Never store seed phrases, private keys, or exchange passwords here. Use `wallet_address` and `tx_hash` as **public** references only. Sample data in this template is fictional.

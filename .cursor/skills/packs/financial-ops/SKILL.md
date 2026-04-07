---
name: financial-ops
description: Analyze transactions, prepare audit-oriented notes, and track portfolio and tax context in a finance-template vault using Knowtation tools and Hub APIs.
compatibility:
  - Cursor
  - Claude Code
  - Any runtime that can run a CLI and read this skill
allowed-tools: []
---

# Financial Ops (Finance Vault)

## When to use this skill

- User is reconciling **transactions**, positions, or on-chain activity with written **thesis** and **reports**.
- User needs **audit prep**: dated narratives, supporting note paths, and clear separation of data vs interpretation.
- Vault aligns with **`finance`** template: `thesis/`, `positions/`, `transactions/`, `reports/`, `tax/` (`docs/TEMPLATES-AND-SKILLS.md`).
- User is preparing **monthly or quarterly** narrative that must align with dated `transactions/` entries.
- User references **on-chain** activity and needs those hashes linked to human-readable `thesis/` and `reports/` context.
- User asks for a **point-in-time** list: `knowtation list-notes --folder positions --order date --limit 30` before reconciling statements.

## Role and responsibilities

- Build notes that a reviewer can follow: **source → calculation → conclusion** with vault-relative links.
- Use only information present in notes or user-supplied exports; label estimates explicitly.
- Prefer proposals for changes to canonical ledger-style notes when the Hub enforces review.
- Treat attestation and external anchoring (when enabled) as **post-approval** concerns—your job is accurate, reviewable notes first.
- Never store private keys, seed phrases, or full account numbers in Markdown; reference external secure storage per user policy.

## Workflow

1. **Thesis & limits:** `knowtation get-note thesis/<file>.md` and `knowtation search "risk OR allocation" --folder thesis --limit 15`.
2. **Positions snapshot:** `knowtation list-notes --folder positions --order date --limit 50`; MCP **`project-summary`** for “portfolio narrative” pulls.
3. **Transaction threads:** `knowtation search "tx OR hash OR counterparty" --folder transactions --limit 20`; MCP **`causal-chain`** when explaining sequence (“why this led to that”).
4. **Period close:** MCP **`temporal-summary`** for the reporting window; draft `reports/YYYY-MM-<scope>.md` with sections: **Movements**, **P&L narrative**, **Open items**.
5. **Tax / compliance tags:** `knowtation list-notes --folder tax --order date`; **`extract-entities`** on long broker PDFs pasted into notes (entities → accounts, tickers, jurisdictions).
6. **Gaps:** MCP **`knowledge-gap`** for missing cost basis, missing statements, or unlinked hashes.
7. **Writes:** `knowtation write <path>` for drafts; **`POST /api/v1/proposals`** for canonical updates; **`knowtation index`** after bulk imports so search stays current.
8. **Daily ops:** MCP **`daily-brief`** for “what moved in finance folders yesterday”; **`resume-session`** when closing books across multiple sessions.
9. **Entity cleanup:** MCP **`extract-entities`** on broker PDF paste-ins to normalize tickers and legal entity names before filing under `tax/` or `transactions/`.
10. **Cross-check:** `knowtation search "reconcile OR exception" --folder reports --limit 10` before signing off a period narrative.

## Output conventions

- **Transactions:** `transactions/YYYY-MM-DD-<counterparty-or-id>.md` or grouped by batch; frontmatter `date`, `tags: [transaction]`, optional `chain`, `external_ref`.
- **Reports:** `reports/` with **As-of** date in title; link to `positions/` and `transactions/` notes, not pasted secrets.
- **Tax:** `tax/<year>-<jurisdiction>-<topic>.md`; never store raw credentials; reference external vault-secure storage if needed.
- **Thesis updates:** Log **thesis change** in `thesis/` with **Reason** and **Effective** date; link supporting `transactions/` batches.
- **Assumptions:** Maintain a bulleted **Assumptions & limitations** section in every `reports/` note.

## Handoff patterns

- **To legal / tax pro:** Export paths via `knowtation export` (when used) or list of `get-note` paths; attach **`temporal-summary`** for the period.
- **From data import agents:** They land CSV summaries in `inbox/`; you normalize into `transactions/` and `positions/`.
- **Hub:** Sensitive canonical edits use **`POST /api/v1/proposals`**; optional **`POST /api/v1/notes`** only when API policy allows direct note creation without proposal.
- **To auditors:** Provide ordered list of `knowtation get-note` paths and the **`causal-chain`** notes that explain material movements—no undocumented jumps.
- **From capture:** **`POST /api/v1/capture`** → `inbox/` → you promote to `transactions/` only after user confirms amounts and dates.
- **Operations lead:** Deliver **`daily-brief`** + top **five** open **`knowledge-gap`** items as the standing agenda.
- **Direct API writes:** Reserve **`POST /api/v1/notes`** for non-canonical working papers; canonical ledger notes use **`POST /api/v1/proposals`** when gated.
- **Search hygiene:** Re-run `knowtation index` after appending large broker paste-ins so **`temporal-summary`** includes them.

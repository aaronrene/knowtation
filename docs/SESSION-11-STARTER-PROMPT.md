# Session 11 — Starter Prompt

Copy the block below as your opening message for the next session.

---

I'm working on the Knowtation project. Here's the current state before we start:

## Branch Status

**Two branches need to be merged to `main` in order:**

1. `feature/daemon-consolidation` — Sessions 1–9, the full self-hosted consolidation daemon
   (memory pointer index, skeptical memory, consolidation engine, stale reference verification,
   relationship discovery, LLM provider support, daemon lifecycle, cost tracking).
   **9 commits ahead of `main`. Must merge FIRST.**

2. `feature/consolidation-ui-testing` — Session 10, the hosted parity + Hub UI layer
   (bridge consolidation endpoints, Netlify scheduler, MCP tools, Hub Settings tab,
   Dashboard card, Billing row, How to Use section, MEMORY-CONSOLIDATION-GUIDE.md).
   **14 commits ahead of `main`. Merge SECOND (after daemon-consolidation is on main).**

**Test suite on `feature/consolidation-ui-testing`: 1077 passing, 0 failing.**

## What Has Already Been Confirmed Done

- **Phase 12A + 12B (Blockchain frontmatter)** — ✅ Fully merged to `main` (PRs #94, #95).
  Includes network/wallet_address/payment_status filters in `lib/list-notes.mjs`,
  `lib/keyword-search.mjs`, hub gateway facets, Hub UI Network/Wallet dropdowns,
  payment_status Quick chips, MCP filter params, and wallet-csv import.
  **The PHASE12-BLOCKCHAIN-PLAN.md doc was not updated to reflect this — it is DONE.**

- All phases 1–18 are on `main` including: Memory Augmentation, MCP Supercharge (D2/D3/F2–F5),
  Phase 18 Media, Phase 17 Billing UX, Phase 16 Stripe, AIR A–E, Phase 12A/12B.

## Merge Order — Step by Step

### Step 1: Push and open PR for `feature/daemon-consolidation`
```bash
git push -u origin feature/daemon-consolidation
```
Then open PR on GitHub: `feature/daemon-consolidation` → `main`
Title: `feat(daemon): Sessions 1–9 — full memory consolidation daemon stack`
Merge it (squash or merge commit — your preference).

### Step 2: Push and open PR for `feature/consolidation-ui-testing`
```bash
git push -u origin feature/consolidation-ui-testing
```
Then open PR: `feature/consolidation-ui-testing` → `main`
Title: `feat(session-10): hosted consolidation parity + Hub UI + docs`
After daemon-consolidation lands, merge this one.

## After Merges: What's Actually Next

All planned phases are done. The remaining work is:

1. **Update `IMPLEMENTATION-PLAN.md`** — Add consolidation (Sessions 1–10) as Done entries;
   confirm Phase 12 section is marked complete.

2. **Update `docs/PHASE12-BLOCKCHAIN-PLAN.md`** — The document currently shows "Status: Implemented
   and merged (PR #94 — Phase 12A; PR #95 — Phase 12B wallet-csv)" at the top but the body text
   is not updated. Verify the status line is accurate and add any missing notes.

3. **MCP Phase C (enhanced tools) — Issue #1** — The remaining backlog item from MCP Supercharge:
   `mcp/tools/phase-c.mjs` — relate, backlinks, capture, transcribe, vault_sync, summarize,
   extract_tasks, cluster, memory_query, tag_suggest. See `docs/BACKLOG-MCP-SUPERCHARGE.md`.

4. **Ops verification** — After merging, redeploy gateway + bridge + static Hub to pick up:
   - Consolidation bridge endpoints (`POST /api/v1/memory/consolidate`, GET status)
   - Netlify scheduled function (`netlify/functions/consolidation-scheduler.mjs`)
   - Updated Hub UI (consolidation settings tab, dashboard card, billing row)
   Run `docs/DEPLOY-HOSTED.md §5` smoke checks.

5. **Muse thin bridge** — Deferred, no concrete partner need yet.

## Reference Files

- `docs/IMPLEMENTATION-PLAN.md` — master plan (all phases)
- `docs/SESSION-10-PLAN.md` — Session 10 detailed spec (all streams)
- `docs/MEMORY-CONSOLIDATION-GUIDE.md` — technical reference for the daemon
- `docs/BACKLOG-MCP-SUPERCHARGE.md` — MCP Phase C backlog
- `docs/DEPLOY-HOSTED.md` — deploy and smoke test checklist

**Test runner:** `node --test` (Node 22). Current passing count: **1077**.

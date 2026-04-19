# Next session: hosted Hub + MCP interlock (G0–G1) and prompts roadmap

This document is the **handoff** for continuing work on **anti-drift** between the **hosted Hub (browser)** and **hosted MCP (Cursor)**, plus the **prompts/resources** program. It captures decisions from the planning conversation (April 2026).

**Branch for this doc pack:** create/use `docs/hosted-hub-mcp-interlock-g0` (or merge to `main` when ready).

---

## Paste this as your next session prompt (Cursor / Composer)

```
You are continuing Knowtation work on hosted Hub + MCP alignment.

Context (read in order):
1. docs/HOSTED-HUB-MCP-INTERLOCK.md — anti-drift program G0–G5, H0–H4 per feature, precautions
2. docs/PARITY-MATRIX-HOSTED.md — G0 capability → Hub → API → MCP table; G1 PR checklist
3. docs/NEXT-SESSION-HOSTED-HUB-MCP.md (this file) — order of work and prompts/resources phasing
4. docs/HOSTED-MCP-TOOL-EXPANSION.md — hosted MCP tools playbook + Track A recipes; gateway is on EC2 (not Netlify for /mcp)
5. docs/AGENT-INTEGRATION.md — Hosted MCP section + OAuth

Facts:
- Hosted MCP today: 17 tools, one resource (knowtation://hosted/vault-info), NO prompts — unlike self-hosted stdio (13 prompts, many resources).
- “Subscriptions” in MCP means resources/subscribe (protocol), NOT Stripe billing.
- Proper practice: one source of truth in canister/bridge/lib; Hub and MCP are thin clients.

Next implementation priority (agreed direction):
1. G0: Build the parity matrix (capability → Hub route → API → MCP tool). Document only.
2. G1: Adopt H0–H4 for every NEW feature that touches BOTH Hub and MCP.
3. Track A (parallel): Hosted MCP “recipes” doc — tool sequences that replace self-hosted prompt intents (no code).
4. Track B (after G0/G1 or in parallel with recipes ONLY if comfortable): Implement 3–5 hosted registerPrompt handlers using same upstreamFetch/canister patterns as existing tools; tests + playbook.

Defer: full 13 prompts, full resource catalog parity, MCP resource notifications on hosted — phased (see § Prompts and resources phasing below).

Do NOT mix this work with the parked branch parked/hosted-voice-import-mcp-billing (voice UI, billing, PWA) unless explicitly merging that program.

Tasks for this session (pick based on scope):
- G0: **Done in repo** — `docs/PARITY-MATRIX-HOSTED.md` (extend when adding Hub/MCP pairs).
- Track A: **Done in repo** — § *Hosted recipes (tools-only)* in `docs/HOSTED-MCP-TOOL-EXPANSION.md`.
- Next: **Track B** — first hosted `registerPrompt` in `hub/gateway/mcp-hosted-server.mjs` + tests (after G0/G1 discipline is routine), or deepen G2 from matrix gaps.

Run before merge: npm run verify:hosted-mcp-checklist, npm test as usual for touched areas.
```

---

## Order of work: what comes before what?

| Step | What | Blocks prompts in code? |
|------|------|---------------------------|
| **G0 + G1** | Parity matrix + team rule (H0–H4) | **Should precede Track B** (implementing hosted prompts) so new prompts do not encode duplicate rules. **Does not** block **Track A** (recipes markdown only). |
| **Track A** | Recipes doc (tools-only flows) | **No dependency** — can run **in parallel** with G0. |
| **Track B** | 3–5 `registerPrompt` on gateway | **Best after G0/G1**; **must** reuse same APIs as tools. |
| **G2** | Refactor hot-spot duplicates | As needed when G0 finds issues. |
| **G4** | Hosted resources | **Separate phase** after Track B proves stable (optional note-read template first). |

**Bottom line:** **Yes — treat G0 + G1 as the next “proper” move before coding hosted prompts (Track B).** You can still publish **Track A recipes** anytime (documentation only).

---

## Prompts and resources: what is reasonable? (recommendation)

**Goal:** Eventually expose **as many as practical** on hosted. **Do not** ship all 13 prompts + full resource surface in one PR — risk, test load, and memory/sampling edge cases compound.

### Self-hosted prompt IDs (all 13)

From [`mcp/prompts/register.mjs`](../mcp/prompts/register.mjs):

`daily-brief`, `search-and-synthesize`, `project-summary`, `write-from-capture`, `temporal-summary`, `extract-entities`, `meeting-notes`, `knowledge-gap`, `causal-chain`, `content-plan`, `memory-context`, `memory-informed-search`, `resume-session`

### Recommended phases (hosted)

| Phase | Prompts (target) | Rationale |
|-------|------------------|-----------|
| **B1 — First coded batch (3–5)** | **`daily-brief`**, **`search-and-synthesize`**, **`project-summary`**, optionally **`temporal-summary`** or **`content-plan`** | Same data patterns as existing tools: `list_notes`, `search`, `get_note`. No hosted memory subsystem required. |
| **B2 — Second batch (4–5)** | **`meeting-notes`**, **`knowledge-gap`**, **`causal-chain`**, **`extract-entities`**, **`write-from-capture`** | More graph/temporal logic; still mostly list/search/get — verify bridge + canister coverage per prompt. |
| **B3 — Memory trio (3)** | **`memory-context`**, **`memory-informed-search`**, **`resume-session`** | **Separate phase:** depends on **hosted memory** semantics matching local (`formatMemoryEventsAsync`, etc.). Do **not** block B1/B2 on these. |

### Resources (hosted)

| Phase | Target | Rationale |
|-------|--------|-----------|
| **R0** | Keep **`knowtation://hosted/vault-info`**; document only | Already shipped. |
| **R1** | **One** `ResourceTemplate` for note read, e.g. `knowtation://hosted/vault/{+path}` backed by same reads as `get_note` | Unlocks resource-oriented clients without full catalog. |
| **R2** | Vault listing resources (subset of local static URIs) | Pagination + caps. |
| **R3+** | Image/video/templates/memory topic templates | **Separate program:** SSRF, bandwidth, metering — mirror local [`mcp/resources/register.mjs`](../mcp/resources/register.mjs) carefully. |

**Cursor “86 resources”** on self-hosted includes **template-expanded** URIs — hosted will not match that count until **R2+**; set expectations in docs.

### Why not “all prompts/resources now”?

- **Test surface:** Each prompt needs `prompts/list` schema safety (`check:mcp-hosted-schema`) and handler tests.
- **Memory prompts** need a **clear hosted memory contract** — wrong assumptions cause silent wrong answers.
- **Resources:** unbounded templates multiply attack and cost surface — phase **R1** first.

---

## Full program map (cross-reference)

| Code | Name |
|------|------|
| G0–G5 | Anti-drift / interlock — [`HOSTED-HUB-MCP-INTERLOCK.md`](HOSTED-HUB-MCP-INTERLOCK.md) |
| H0–H4 | Per-feature Hub + MCP delivery |
| Track A | Hosted recipes (docs) |
| Track B1–B3 | Hosted prompts batches |
| R0–R3+ | Hosted resources |

**Cursor plan file (local):** `.cursor/plans/hosted_mcp_prompts_resources_2303a796.plan.md` — MCP-only phases (Phase 0–3 for prompts pick + recipes + registerPrompt); anti-drift G0–G5 summarized there with link to this repo doc.

---

## Related commits / files (this documentation pack)

- `docs/HOSTED-HUB-MCP-INTERLOCK.md` — main interlock + G0–G5
- `docs/PARITY-MATRIX-HOSTED.md` — G0 matrix + G1 checklist
- `docs/NEXT-SESSION-HOSTED-HUB-MCP.md` — this file
- `docs/HOSTED-MCP-TOOL-EXPANSION.md` — link at top to interlock; Track A recipes
- `docs/AGENT-INTEGRATION.md` — Hosted MCP subsection link

Optional next artifacts to add in later PRs:

- `docs/PARITY-MATRIX-HOSTED.md` — **G0 deliverable (living table)** — added in repo; extend when shipping new Hub/MCP pairs.

---

## Precautions (short)

Identity (`effective_canister_user_id`), import metering, MCP export caps, Zod schema export for `prompts/list` — see [`HOSTED-MCP-TOOL-EXPANSION.md`](HOSTED-MCP-TOOL-EXPANSION.md) and interlock doc.

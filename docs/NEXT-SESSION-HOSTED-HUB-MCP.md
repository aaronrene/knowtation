# Next session: hosted Hub + MCP interlock (G0–G1) and prompts roadmap

This document is the **handoff** for continuing work on **anti-drift** between the **hosted Hub (browser)** and **hosted MCP (Cursor)**, plus the **prompts/resources** program. It captures decisions from the planning conversation (April 2026).

**Repository policy (billing):** Do **not** open a PR to **`main`** that changes **only** files under `docs/`. Handoff and playbook edits ride on the **same PR** as the **code/tests** they document. Cursor rule: [`.cursor/rules/no-docs-only-pr-to-main.mdc`](../.cursor/rules/no-docs-only-pr-to-main.mdc). **PR #176** (docs-only handoff) was **closed unmerged** by request; the latest handoff text may exist on **`feat/hosted-mcp-prompts-b3`** ahead of `main` until it ships inside a feature PR.

**Merged G0 doc pack (parity matrix + Track A):** branch `docs/hosted-hub-mcp-interlock-g0` → merge to `main` via PR.

**Track B1 — merged:** PR **#174** is merged to **`main`** (five hosted prompts + ACL + tests + docs).

**Track B2 — merged:** PR **#175** is merged to **`main`** (five additional prompts: `meeting-notes`, `knowledge-gap`, `causal-chain`, `extract-entities`, `write-from-capture`; ACL `HOSTED_PROMPT_IDS` + **`write-from-capture`** → **editor** minimum; tests + docs). Post-merge: **`prompts/list`** shows **9** prompts for **viewer**, **10** for **editor**/**admin** (confirmed in Cursor when hosted MCP is healthy).

**Track B3 — prep merged; implementation next:** PR **#177** merged to **`main`**: hosted memory **H0** (interlock + parity matrix § Agent memory) and **`test/gateway-memory-bridge-proxy.test.mjs`**. **Remaining work:** implement the three **`registerPrompt`** memory handlers in **`hub/gateway/mcp-hosted-server.mjs`** via **`upstreamFetch`**, ACL + golden tests (**13** prompts when B3 ships). **`POST /api/v1/memory/search`** (memory-store semantic search) stays a **later phase**—see [`NEXT-SESSION-TRACK-B3-MEMORY-IMPLEMENTATION.md`](./NEXT-SESSION-TRACK-B3-MEMORY-IMPLEMENTATION.md) § decided scope; **`memory-informed-search`** parity uses **`GET /api/v1/memory?type=search`** + vault **`POST /api/v1/search`**, not that stub.

**Active workspace branch (implementation):** **`feat/b3-memory-prompts-implementation`** — create from latest **`main`** if missing. **Do not** merge **docs-only** changes to **`main`**; accumulate commits here; **push + one PR** when **code + tests + docs** for B3 are complete. Session handoff for this phase: [`NEXT-SESSION-TRACK-B3-MEMORY-IMPLEMENTATION.md`](./NEXT-SESSION-TRACK-B3-MEMORY-IMPLEMENTATION.md).

**Scope reminder:** All **13** self-hosted prompt IDs from [`mcp/prompts/register.mjs`](../mcp/prompts/register.mjs) map to hosted batches **B1 + B2 + B3**; **B1** shipped **5**, **B2** shipped **5**, **B3** is **3** memory prompts (blocked as above).

**Why a new branch after G0:** Track B changes `hub/gateway/mcp-hosted-server.mjs` and tests; keeping it separate from the docs-only G0 PR preserves a small, reviewable history and avoids mixing documentation approval with gateway behavior changes.

## Workflow (current)

1. **`main`** includes G0 docs + **Track B1** (PR **#174**) + **Track B2** (PR **#175**).
2. `git fetch origin && git checkout main && git pull origin main`.
3. For **B3 implementation**: `git checkout feat/b3-memory-prompts-implementation` (create from **`main`** if missing: `git checkout -b feat/b3-memory-prompts-implementation`).
4. Full pasteable prompt + layman/jargon intro: [`NEXT-SESSION-TRACK-B3-MEMORY-IMPLEMENTATION.md`](./NEXT-SESSION-TRACK-B3-MEMORY-IMPLEMENTATION.md).

---

## Paste this as your next session prompt — Track B3 (hosted MCP memory prompts) — **implementation**

**Prerequisite (done on `main` via PR #177):** H0 memory contract + gateway→bridge proxy tests. **Next:** implementation handoff + full prompt live in [`NEXT-SESSION-TRACK-B3-MEMORY-IMPLEMENTATION.md`](./NEXT-SESSION-TRACK-B3-MEMORY-IMPLEMENTATION.md) (copy the fenced block from that file into a new Cursor session).

---

## Paste this as your next session prompt — Track B2 (hosted MCP prompts) — **completed; reference**

Merged PR **#175** to **`main`**. Historical checklist:

```
Track B2 shipped: meeting-notes, knowledge-gap, causal-chain, extract-entities, write-from-capture.
PR #175; verify:hosted-mcp-checklist + npm test passed before merge.
```

---

## Pasteable prompt — G0 / parity (completed; keep for reference)

```
You are continuing Knowtation work on hosted Hub + MCP alignment.

Context (read in order):
1. docs/HOSTED-HUB-MCP-INTERLOCK.md
2. docs/PARITY-MATRIX-HOSTED.md
3. docs/NEXT-SESSION-HOSTED-HUB-MCP.md
4. docs/HOSTED-MCP-TOOL-EXPANSION.md
5. docs/AGENT-INTEGRATION.md

G0 matrix and Track A recipes are in repo. Track B1 + B2 are on `main` (PRs #174, #175). Next **prompt** code stage is **Track B3** when memory API parity exists (see B3 paste block above).
```

---

## Accomplishments (hosted MCP prompts)

| Milestone | Status | Where |
|-----------|--------|--------|
| **Track B1** — five prompts | **Merged** to `main` (PR **#174**) | `mcp-hosted-server.mjs` + ACL + tests |
| **Track B2** — five prompts | **Merged** to `main` (PR **#175**) | Same; **`prompts/list`** = **9** (viewer) / **10** (editor/admin) |
| **Track B3** — memory trio | **Prep merged** (PR **#177**); **code in progress** on **`feat/b3-memory-prompts-implementation`** | Handoff: [`NEXT-SESSION-TRACK-B3-MEMORY-IMPLEMENTATION.md`](./NEXT-SESSION-TRACK-B3-MEMORY-IMPLEMENTATION.md); H0: interlock + parity matrix § Agent memory; proxy tests: [`test/gateway-memory-bridge-proxy.test.mjs`](../test/gateway-memory-bridge-proxy.test.mjs) |

---

## Track B3 prerequisite — hosted memory “contract” (what it entails)

**Plain language:** The website and the bridge already talk to “memory” over HTTP. Cursor’s hosted MCP does **not** yet. Before we add the three memory **prompts**, we must write down **exactly** which URLs the MCP will call, with which headers, and what each JSON field means — and prove it matches what the Hub uses and what your local CLI expects from memory events. That write-up + tests **is** the “contract.” After that, wiring prompts is mechanical.

**Technical terms:** **H0** (routes + auth + payload schema), **parity** with `hub/gateway/server.mjs` memory proxies and `hub/bridge/server.mjs` handlers, **`upstreamFetch`** from `mcp-hosted-server.mjs` with the same **`bridgeFetchOpts`** / JWT + `X-Vault-Id` model as **`search`**, mapping bridge JSON to prompt text aligned with **`formatMemoryEventsAsync`** in [`mcp/prompts/helpers.mjs`](../mcp/prompts/helpers.mjs).

### Suggested steps (in order)

1. **Inventory (read-only):** List every `app.*('/api/v1/memory` route in `hub/gateway/server.mjs` and the matching handler in `hub/bridge/server.mjs`. Note which require **`requireBridgeEditorOrAdmin`** vs read-only. **Done (2026-04-19):** eight gateway routes ↔ bridge; table in [`PARITY-MATRIX-HOSTED.md`](./PARITY-MATRIX-HOSTED.md) § Agent memory.
2. **H0 doc row:** Add or extend a row in [`HOSTED-HUB-MCP-INTERLOCK.md`](./HOSTED-HUB-MCP-INTERLOCK.md) / [`PARITY-MATRIX-HOSTED.md`](./PARITY-MATRIX-HOSTED.md): Hub action → gateway proxy path → bridge → **future** MCP tool or **prompt** `upstreamFetch` (no second implementation of retention or billing rules in MCP). **Done (2026-04-19):** interlock § Track B3 prep + matrix section.
3. **Shape comparison:** Compare bridge `GET /api/v1/memory` (and `search` body/response) to local `createMemoryManager(config).list(...)` output used by `formatMemoryEventsAsync`. Document field mapping or intentional deltas. **Done in H0 text:** same **`type` / `ts` / `data`** line format; **`POST /memory/search`** stub documented; **`limit`** cap delta (bridge max 100 vs helper max 30) noted in interlock.
4. **Tests first at the boundary:** Prefer tests that hit the bridge contract with mocks (or integration if you have a harness), then add a thin **`registerTool`** optional phase (e.g. `memory_list`) if prompts need shared fetch logic — *only if* that reduces duplication; otherwise prompts call `upstreamFetch` directly like B1/B2.
5. **Implement B3 prompts** on `feat/hosted-mcp-prompts-b3`: `memory-context`, `memory-informed-search`, `resume-session`; extend `HOSTED_PROMPT_IDS`, golden `prompts/list` tests, **`verify:hosted-mcp-checklist`**.
6. **Single PR to `main`:** Ship gateway + tests + doc updates together (no docs-only PR).

### Recommendation

**Steps 1–3** are on **`main`** (PR **#177**). Continue with **steps 4–6** on **`feat/b3-memory-prompts-implementation`**: boundary tests, **`registerPrompt`** wiring, then **one** PR to **`main`** with **code + tests + docs** (no docs-only PR).

---

## Order of work: what comes before what?

| Step | What | Blocks prompts in code? |
|------|------|---------------------------|
| **G0 + G1** | Parity matrix + team rule (H0–H4) | **Should precede Track B** (implementing hosted prompts) so new prompts do not encode duplicate rules. **Does not** block **Track A** (recipes markdown only). |
| **Track A** | Recipes doc (tools-only flows) | **No dependency** — can run **in parallel** with G0. |
| **Track B** | **B1 + B2 merged** (PRs **#174**, **#175**, 10 prompts on editor/admin); **B3** implementation after prep on `main` | **B1–B2** on `main`; **B3 prep** merged (PR **#177**); **B3** = memory trio **`registerPrompt`** + tests. **`POST /api/v1/memory/search`** real implementation = **separate** phase (not required for B3 parity). |
| **G2** | Refactor hot-spot duplicates | As needed when G0 finds issues. |
| **G4** | Hosted resources | **Separate phase** after Track B proves stable (optional note-read template first). |

**Bottom line:** **G0 + Track A + Track B1 + Track B2 + Track B3 prep** are on **`main`** (through PR **#177**). The next **hosted prompts** milestone is **Track B3 implementation** (three memory prompts + golden tests). **`POST /api/v1/memory/search`** beyond the stub is **not** part of that milestone. Use branch **`feat/b3-memory-prompts-implementation`**; handoff [`NEXT-SESSION-TRACK-B3-MEMORY-IMPLEMENTATION.md`](./NEXT-SESSION-TRACK-B3-MEMORY-IMPLEMENTATION.md).

---

## Prompts and resources: what is reasonable? (recommendation)

**Goal:** Eventually expose **as many as practical** on hosted. **Do not** ship all 13 prompts + full resource surface in one PR — risk, test load, and memory/sampling edge cases compound.

### Self-hosted prompt IDs (all 13)

From [`mcp/prompts/register.mjs`](../mcp/prompts/register.mjs):

`daily-brief`, `search-and-synthesize`, `project-summary`, `write-from-capture`, `temporal-summary`, `extract-entities`, `meeting-notes`, `knowledge-gap`, `causal-chain`, `content-plan`, `memory-context`, `memory-informed-search`, `resume-session`

### Recommended phases (hosted)

| Phase | Prompts (target) | Rationale |
|-------|------------------|-----------|
| **B1 — First coded batch** | **`daily-brief`**, **`search-and-synthesize`**, **`project-summary`**, **`temporal-summary`**, **`content-plan`** | **Merged to `main` (PR #174).** Same tools: `list_notes`, `search`, `get_note`. |
| **B2 — Second batch (5)** | **`meeting-notes`**, **`knowledge-gap`**, **`causal-chain`**, **`extract-entities`**, **`write-from-capture`** | **Merged to `main` (PR #175).** Handlers use list/search/get; **`causal-chain`** uses **`POST …/search`** with **`chain`** + canister **`GET …/notes/:path`**. **`write-from-capture`**: no local template file; **editor** ACL minimum. |
| **B3 — Memory trio (3)** | **`memory-context`**, **`memory-informed-search`**, **`resume-session`** | **Prep on `main` (PR #177).** **Implementation:** **`registerPrompt`** + ACL + tests. **`POST /api/v1/memory/search`** (memory-store semantic search) → **later phase**, not B3. |

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
| **B1** | **Done** — merged PR **#174** (`main`). |
| **B2** | **Done** — merged PR **#175** (`main`). Operator smoke: **`prompts/list`** nine (viewer) / ten (editor/admin). |
| **B3 (in progress)** | Memory trio — prep on **`main`** (PR **#177**); **`registerPrompt`** implementation on **`feat/b3-memory-prompts-implementation`**. |
| R0–R3+ | Hosted resources |

**Cursor plan file (local):** `.cursor/plans/hosted_mcp_prompts_resources_2303a796.plan.md` — MCP-only phases (Phase 0–3 for prompts pick + recipes + registerPrompt); anti-drift G0–G5 summarized there with link to this repo doc.

---

## Related commits / files (this documentation pack)

- `docs/HOSTED-HUB-MCP-INTERLOCK.md` — main interlock + G0–G5
- `docs/PARITY-MATRIX-HOSTED.md` — G0 matrix + G1 checklist
- `docs/NEXT-SESSION-HOSTED-HUB-MCP.md` — this file
- `docs/HOSTED-MCP-TOOL-EXPANSION.md` — link at top to interlock; Track A recipes
- `docs/AGENT-INTEGRATION.md` — Hosted MCP subsection link
- **`feat/hosted-mcp-prompts-b2`** — merged via PR **#175** (historical)
- **`feat/b3-memory-prompts-implementation`** — branch for **Track B3** memory **`registerPrompt`** + tests (+ optional bridge search); prep merged via PR **#177**
- **`feat/hosted-mcp-prompts-b1`** — merged via PR **#174** (historical)

---

## Precautions (short)

Identity (`effective_canister_user_id`), import metering, MCP export caps, Zod schema export for `prompts/list` — see [`HOSTED-MCP-TOOL-EXPANSION.md`](HOSTED-MCP-TOOL-EXPANSION.md) and interlock doc.

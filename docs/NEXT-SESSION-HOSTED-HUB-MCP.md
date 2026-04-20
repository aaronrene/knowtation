# Next session: hosted Hub + MCP interlock (G0–G1) and prompts roadmap

This document is the **handoff** for continuing work on **anti-drift** between the **hosted Hub (browser)** and **hosted MCP (Cursor)**, plus the **prompts/resources** program. It captures decisions from the planning conversation (April 2026).

**Repository policy (billing):** Do **not** open a PR to **`main`** that changes **only** files under `docs/`. Handoff and playbook edits ride on the **same PR** as the **code/tests** they document. Cursor rule: [`.cursor/rules/no-docs-only-pr-to-main.mdc`](../.cursor/rules/no-docs-only-pr-to-main.mdc). **PR #176** (docs-only handoff) was **closed unmerged** by request; the latest handoff text may exist on **`feat/hosted-mcp-prompts-b3`** ahead of `main` until it ships inside a feature PR.

**Merged G0 doc pack (parity matrix + Track A):** branch `docs/hosted-hub-mcp-interlock-g0` → merge to `main` via PR.

**Track B1 — merged:** PR **#174** is merged to **`main`** (five hosted prompts + ACL + tests + docs).

**Track B2 — merged:** PR **#175** is merged to **`main`** (five additional prompts: `meeting-notes`, `knowledge-gap`, `causal-chain`, `extract-entities`, `write-from-capture`; ACL `HOSTED_PROMPT_IDS` + **`write-from-capture`** → **editor** minimum; tests + docs). Post-merge: **`prompts/list`** shows **9** prompts for **viewer**, **10** for **editor**/**admin** (confirmed in Cursor when hosted MCP is healthy).

**Track B3 — next coded batch (blocked on *contract clarity*, not on “zero routes”):** The Hub gateway already **proxies** bridge memory routes (e.g. `GET /api/v1/memory`, `GET /api/v1/memory/:key`, `POST /api/v1/memory/store`, `POST /api/v1/memory/search`, `DELETE /api/v1/memory/clear`, consolidation endpoints — see `hub/gateway/server.mjs`). **Hosted MCP** does not call them yet. **Blocker:** document and verify **parity** — same auth headers (`Authorization`, `X-Vault-Id`, effective user), query/body shapes, error cases, and **event JSON** semantics vs local `lib/memory.mjs` / `formatMemoryEventsAsync` — then implement the three **`registerPrompt`** handlers using **`upstreamFetch`** to those URLs (no disk `lib/memory` in the gateway). Until that H0-style spec + tests exist, do **not** ship B3 prompts (wrong or leaking memory is worse than absent prompts).

**Active workspace branch:** **`feat/hosted-mcp-prompts-b3`** — use for **Track B3** (memory prompts + any gateway wiring), **without** a docs-only merge to `main`. Push this branch freely; open a PR to `main` only when the branch contains **worthwhile product/code** (and fold doc updates into that same PR).

**Scope reminder:** All **13** self-hosted prompt IDs from [`mcp/prompts/register.mjs`](../mcp/prompts/register.mjs) map to hosted batches **B1 + B2 + B3**; **B1** shipped **5**, **B2** shipped **5**, **B3** is **3** memory prompts (blocked as above).

**Why a new branch after G0:** Track B changes `hub/gateway/mcp-hosted-server.mjs` and tests; keeping it separate from the docs-only G0 PR preserves a small, reviewable history and avoids mixing documentation approval with gateway behavior changes.

## Workflow (current)

1. **`main`** includes G0 docs + **Track B1** (PR **#174**) + **Track B2** (PR **#175**).
2. `git fetch origin && git checkout main && git pull origin main`.
3. For **B3** or handoff edits: `git checkout feat/hosted-mcp-prompts-b3` (create from **`main`** if missing: `git checkout -b feat/hosted-mcp-prompts-b3`).
4. **Before** landing memory **`registerPrompt`** handlers: confirm hosted **memory HTTP** contract + Hub parity (see B3 paste block below).

---

## Paste this as your next session prompt — Track B3 (hosted MCP memory prompts) — **blocked until memory API**

**Prerequisite:** Hosted gateway (or bridge) exposes **read/list** (and any write rules) for **agent memory** with the **same semantics** the Hub uses for **`/api/v1/memory*`** — document routes, auth, and payload shape in **H0** before coding prompts.

```
You are implementing Track B3 — hosted MCP memory prompts (`registerPrompt`): memory-context, memory-informed-search, resume-session.

Work on branch: feat/hosted-mcp-prompts-b3 (from latest origin/main after PR #175).

Do not start until:
- Hosted memory HTTP contract is specified and matches Hub (parity matrix Hub-only row + playbook).
- mcp/prompts/register.mjs + helpers.mjs — reference only for messages and skeptical-memory wording.

Then (same discipline as B1/B2):
1. hub/gateway/mcp-hosted-server.mjs — upstreamFetch to documented memory routes only; no local lib/memory disk reads.
2. hub/gateway/mcp-tool-acl.mjs — add prompt ids + PROMPT_MIN_ROLE (likely viewer if read-only events).
3. test/mcp-hosted-prompts.test.mjs — extend golden lists (13 total prompts when B3 ships).
4. docs: HOSTED-MCP-TOOL-EXPANSION.md, PARITY-MATRIX-HOSTED.md, HOSTED-HUB-MCP-INTERLOCK.md (H0–H4), this file.

Run before merge: npm run verify:hosted-mcp-checklist, npm test.
```

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
| **Track B3** — memory trio | **Prep in progress** (H0 + gateway proxy tests on branch) | **`registerPrompt` not added** until list/search JSON mapping + tests; see parity matrix § Agent memory + [`test/gateway-memory-bridge-proxy.test.mjs`](../test/gateway-memory-bridge-proxy.test.mjs) |

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

Start with **steps 1–3** on **`feat/hosted-mcp-prompts-b3`** (documentation + matrix + playbook rows **committed on the branch**). When you are ready to ship **step 4+**, keep accumulating commits on the same branch and open **one** PR to `main` that includes both **code** and **docs**.

---

## Order of work: what comes before what?

| Step | What | Blocks prompts in code? |
|------|------|---------------------------|
| **G0 + G1** | Parity matrix + team rule (H0–H4) | **Should precede Track B** (implementing hosted prompts) so new prompts do not encode duplicate rules. **Does not** block **Track A** (recipes markdown only). |
| **Track A** | Recipes doc (tools-only flows) | **No dependency** — can run **in parallel** with G0. |
| **Track B** | **B1 + B2 merged** (PRs **#174**, **#175**, 10 prompts on editor/admin); **B3** after memory API | **B1–B2** on `main`; **B3** = memory trio (**blocked** until hosted **`/api/v1/memory*`** parity with Hub). |
| **G2** | Refactor hot-spot duplicates | As needed when G0 finds issues. |
| **G4** | Hosted resources | **Separate phase** after Track B proves stable (optional note-read template first). |

**Bottom line:** **G0 + Track A + Track B1 + Track B2** are on **`main`** (through PR **#175**). G1 is ongoing discipline (H0–H4). The next **hosted prompts** milestone is **Track B3** (memory trio) **after** the **memory HTTP contract** is real — until then, use **Track A** (recipes docs), **R1** resources, or **gateway memory API** design on focused branches. **`feat/hosted-mcp-prompts-b3`** is the suggested branch name for that line of work.

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
| **B3 — Memory trio (3)** | **`memory-context`**, **`memory-informed-search`**, **`resume-session`** | **Blocked:** hosted **`/api/v1/memory*`** (or equivalent) must match Hub + local `formatMemoryEventsAsync` semantics before **`registerPrompt`** on the gateway. |

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
| **B3 (deferred)** | Memory trio — blocked on hosted **`/api/v1/memory*`** parity with Hub (see matrix Hub-only row). |
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
- **`feat/hosted-mcp-prompts-b3`** — suggested branch for **Track B3** prep / memory-API work (create from `main` after pull)
- **`feat/hosted-mcp-prompts-b1`** — merged via PR **#174** (historical)

---

## Precautions (short)

Identity (`effective_canister_user_id`), import metering, MCP export caps, Zod schema export for `prompts/list` — see [`HOSTED-MCP-TOOL-EXPANSION.md`](HOSTED-MCP-TOOL-EXPANSION.md) and interlock doc.

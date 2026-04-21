# Next session: hosted Hub + MCP interlock (G0–G1) and prompts roadmap

This document is the **handoff** for continuing work on **anti-drift** between the **hosted Hub (browser)** and **hosted MCP (Cursor)**, plus the **prompts/resources** program. It captures decisions from the planning conversation (April 2026).

**Repository policy (billing):** Do **not** open a PR to **`main`** that changes **only** files under `docs/`. Handoff and playbook edits ride on the **same PR** as the **code/tests** they document. Cursor rule: [`.cursor/rules/no-docs-only-pr-to-main.mdc`](../.cursor/rules/no-docs-only-pr-to-main.mdc). **PR #176** (docs-only handoff) was **closed unmerged** by request; the latest handoff text may exist on **`feat/hosted-mcp-prompts-b3`** ahead of `main` until it ships inside a feature PR.

**Merged G0 doc pack (parity matrix + Track A):** branch `docs/hosted-hub-mcp-interlock-g0` → merge to `main` via PR.

**Track B1 — merged:** PR **#174** is merged to **`main`** (five hosted prompts + ACL + tests + docs).

**Track B2 — merged:** PR **#175** is merged to **`main`** (five additional prompts: `meeting-notes`, `knowledge-gap`, `causal-chain`, `extract-entities`, `write-from-capture`; ACL + **`write-from-capture`** → **editor** minimum). After **B2 only**, **`prompts/list`** was **9** (viewer) / **10** (editor/admin). With **B3** merged, counts are **12** / **13** (see accomplishments table below).

**Track B3 — memory `registerPrompt` trio:** **Prep** merged to **`main`** (PR **#177** — H0 docs, parity matrix § Agent memory, **`test/gateway-memory-bridge-proxy.test.mjs`**). **Implementation** (three handlers + ACL + golden **`prompts/list`** **12**/**13**) lives on branch **`feat/b3-memory-prompts-implementation`** until that line merges to **`main`**. **`POST /api/v1/memory/search`** (semantic retrieval **over** the memory event store) remains **Phase B3+** — bridge **stub** today; **not** used by **`memory-informed-search`** (which uses **`GET /api/v1/memory?type=search`** + vault **`POST /api/v1/search`**). Plain-language detail: § *Phase B3+* below; playbook: [`HOSTED-MCP-TOOL-EXPANSION.md`](./HOSTED-MCP-TOOL-EXPANSION.md) § *Phase B3+*; session prompt: [`NEXT-SESSION-TRACK-B3-MEMORY-IMPLEMENTATION.md`](./NEXT-SESSION-TRACK-B3-MEMORY-IMPLEMENTATION.md).

**Active workspace branch (implementation):** **`feat/b3-memory-prompts-implementation`**. **Do not** merge **docs-only** PRs to **`main`**. Open **one** PR to **`main`** when **gateway code + tests + doc updates** for B3 implementation are ready.

**Scope reminder:** All **13** self-hosted prompt IDs from [`mcp/prompts/register.mjs`](../mcp/prompts/register.mjs) map to hosted **`registerPrompt`** entries **B1 + B2 + B3** (**5 + 5 + 3**). **Phase B3+** (`POST …/memory/search` beyond stub) is **optional future work**, not part of the thirteen prompts.

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
| **Track B3** — memory trio | **`registerPrompt` on branch `feat/b3-memory-prompts-implementation`** (merge to `main` when ready) | **`prompts/list`:** **12** (viewer) / **13** (editor/admin). Handoff: [`NEXT-SESSION-TRACK-B3-MEMORY-IMPLEMENTATION.md`](./NEXT-SESSION-TRACK-B3-MEMORY-IMPLEMENTATION.md); prep PR **#177**; tests: `mcp-hosted-prompts.test.mjs`, [`test/gateway-memory-bridge-proxy.test.mjs`](../test/gateway-memory-bridge-proxy.test.mjs) |

---

## Track B3 prerequisite — hosted memory “contract” (what it entails)

**Plain language:** The website and the bridge already talk to “memory” over HTTP. **Prep (PR #177)** wrote down which URLs apply, which headers match the Hub, and added proxy tests — that is the **contract** for calling memory safely. **Implementation** (`registerPrompt` on **`feat/b3-memory-prompts-implementation`**) then wires Cursor’s hosted MCP to **`GET /api/v1/memory`** (and vault **`POST /api/v1/search`** where needed) the same way — still **no** local disk `lib/memory` in the gateway.

**Technical terms:** **H0** (routes + auth + payload schema), **parity** with `hub/gateway/server.mjs` memory proxies and `hub/bridge/server.mjs` handlers, **`upstreamFetch`** from `mcp-hosted-server.mjs` with the same **`bridgeFetchOpts`** / JWT + `X-Vault-Id` model as **`search`**, mapping bridge JSON to prompt text via **`formatMemoryEventsFromBridgeResponse`** in `mcp-hosted-server.mjs` (aligned with self-hosted **`formatMemoryEventsAsync`** in [`mcp/prompts/helpers.mjs`](../mcp/prompts/helpers.mjs)).

### Suggested steps (in order)

1. **Inventory (read-only):** List every `app.*('/api/v1/memory` route in `hub/gateway/server.mjs` and the matching handler in `hub/bridge/server.mjs`. Note which require **`requireBridgeEditorOrAdmin`** vs read-only. **Done (2026-04-19):** eight gateway routes ↔ bridge; table in [`PARITY-MATRIX-HOSTED.md`](./PARITY-MATRIX-HOSTED.md) § Agent memory.
2. **H0 doc row:** Add or extend a row in [`HOSTED-HUB-MCP-INTERLOCK.md`](./HOSTED-HUB-MCP-INTERLOCK.md) / [`PARITY-MATRIX-HOSTED.md`](./PARITY-MATRIX-HOSTED.md): Hub action → gateway proxy path → bridge → **future** MCP tool or **prompt** `upstreamFetch` (no second implementation of retention or billing rules in MCP). **Done (2026-04-19):** interlock § Track B3 prep + matrix section.
3. **Shape comparison:** Compare bridge `GET /api/v1/memory` (and `search` body/response) to local `createMemoryManager(config).list(...)` output used by `formatMemoryEventsAsync`. Document field mapping or intentional deltas. **Done in H0 text:** same **`type` / `ts` / `data`** line format; **`POST /memory/search`** stub documented; **`limit`** cap delta (bridge max 100 vs helper max 30) noted in interlock.
4. **Tests first at the boundary:** Prefer tests that hit the bridge contract with mocks (or integration if you have a harness), then add a thin **`registerTool`** optional phase (e.g. `memory_list`) if prompts need shared fetch logic — *only if* that reduces duplication; otherwise prompts call `upstreamFetch` directly like B1/B2.
5. **Implement B3 prompts** on **`feat/b3-memory-prompts-implementation`** (or latest handoff branch): `memory-context`, `memory-informed-search`, `resume-session`; extend `HOSTED_PROMPT_IDS`, golden `prompts/list` tests, **`verify:hosted-mcp-checklist`**.
6. **Single PR to `main`:** Ship gateway + tests + doc updates together (no docs-only PR).

### Recommendation

**Steps 1–3** are on **`main`** (PR **#177**). Continue with **steps 4–6** on **`feat/b3-memory-prompts-implementation`**: boundary tests, **`registerPrompt`** wiring, then **one** PR to **`main`** with **code + tests + docs** (no docs-only PR).

---

## Order of work: what comes before what?

| Step | What | Blocks prompts in code? |
|------|------|---------------------------|
| **G0 + G1** | Parity matrix + team rule (H0–H4) | **Should precede Track B** (implementing hosted prompts) so new prompts do not encode duplicate rules. **Does not** block **Track A** (recipes markdown only). |
| **Track A** | Recipes doc (tools-only flows) | **No dependency** — can run **in parallel** with G0. |
| **Track B** | **B1 + B2 + B3 prep** on **`main`** (PRs **#174**, **#175**, **#177**); **B3 implementation** on **`feat/b3-memory-prompts-implementation`** until merged — then **12** / **13** `prompts/list` | **`POST /api/v1/memory/search`** beyond stub = **Phase B3+** (separate; not required for B3 prompt parity). |
| **G2** | Refactor hot-spot duplicates | As needed when G0 finds issues. |
| **G4** | Hosted resources | **Separate phase** after Track B proves stable (optional note-read template first). |

**Bottom line:** **G0 + Track A + Track B1 + Track B2 + Track B3 prep** are on **`main`** (through PR **#177**). **Track B3 `registerPrompt` implementation** merges from **`feat/b3-memory-prompts-implementation`** when that PR lands. **`POST /api/v1/memory/search`** beyond the stub is **Phase B3+**, not that milestone. Handoff: [`NEXT-SESSION-TRACK-B3-MEMORY-IMPLEMENTATION.md`](./NEXT-SESSION-TRACK-B3-MEMORY-IMPLEMENTATION.md).

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
| **B3 — Memory trio (3)** | **`memory-context`**, **`memory-informed-search`**, **`resume-session`** | **Prep on `main` (PR #177).** **Implementation:** **`registerPrompt`** + ACL + tests. **`POST /api/v1/memory/search`** (memory-store semantic search) → **Phase B3+** (later), not required for B3 — see subsection below. |

### Phase B3+ (later): what `POST /api/v1/memory/search` is for

**Simple:** B3 prompts use **`GET /api/v1/memory`** (a filtered **list** of past events) plus, for **`memory-informed-search`**, ordinary **vault** semantic search. **`POST /api/v1/memory/search`** is a **different** idea: “find relevant **memory log lines** by similarity,” like vector search but over the **memory** store. The bridge still returns an **empty stub** for that POST. Shipping real behavior means new engineering (indexes, limits, cost). That is **tracked as a future phase** — not a blocker for the three prompts you already validated in Cursor.

**Jargon:** Treat **`POST {bridge}/api/v1/memory/search`** as a **separate H0–H4 deliverable** (embedding-backed retrieval on the memory DB, parity with self-hosted **`memory_search`** MCP tool if desired). Documented as **future** in [`PARITY-MATRIX-HOSTED.md`](./PARITY-MATRIX-HOSTED.md) (§ Agent memory) and **Phase B3+** in [`HOSTED-MCP-TOOL-EXPANSION.md`](./HOSTED-MCP-TOOL-EXPANSION.md).

#### Phase B3+ — what it takes, reuse vs new work, recommendation

**What it takes (facts from code):** The bridge route **`POST /api/v1/memory/search`** in [`hub/bridge/server.mjs`](../hub/bridge/server.mjs) currently returns **`{ results: [], count: 0, note: 'Hosted memory search requires vector provider (future).' }`** — no embeddings, no index. Turning it into real semantic search means: **(1)** defining where vectors for **memory events** live (per hosted user + vault, alongside or separate from vault chunk vectors); **(2)** on **append/list** paths, **embedding** event text (or batches) with the **same** embedding stack the bridge already uses for vault search (`embedWithUsage` / Voyage — **reuse the plumbing**, not “invent a new vendor”); **(3)** **query-time** embed + kNN (sqlite-vec or equivalent) over that memory index; **(4)** **limits**, **auth** (same as `GET /api/v1/memory`), **rate limits / billing** if this becomes a heavy endpoint; **(5)** tests + parity matrix row + optional hosted MCP **`registerTool('memory_search', …)`** mirroring [`mcp/tools/memory.mjs`](../mcp/tools/memory.mjs). Self-hosted **`memory_search`** already requires **`memory.provider: vector` or `mem0`** and calls **`MemoryManager.search()`** → provider **`searchEvents`** ([`lib/memory-provider-vector.mjs`](../lib/memory-provider-vector.mjs), etc.). Hosted **file/blob** memory today follows **`FileMemoryProvider`**, whose **`searchEvents`** is a no-op — so **hosted is not “flip a flag”**; it is **new bridge indexing + handler logic**, reusing **patterns** from vault search and from **`VectorMemoryProvider`**, not a copy-paste of one existing route.

**Recommendation:** **Defer** unless you have a concrete product need (“agents must find old memory lines by meaning at scale”). Reasons: **cost** (embeddings on every memory write or periodic backfill), **complexity** (second vector surface to secure and debug), **overlap** with today’s **`memory-informed-search`** prompt (vault semantic search + **recent search-type memory lines** via **`GET …/memory?type=search`**). **Higher leverage next steps:** **Track A** recipes (docs) or **R1** one note **resource template** — same user-visible “Cursor polish” with less new infra.

---

## Paste this as your next session prompt — Phase B3+ (hosted memory semantic search)

**Only if** you are prioritizing **`POST /api/v1/memory/search`** over recipes / R1 resources.

```
You are implementing Phase B3+ — real semantic search over the hosted memory event log (bridge POST /api/v1/memory/search), optional parity with self-hosted memory_search.

Read first:
1. hub/bridge/server.mjs — POST /api/v1/memory/search stub; GET /api/v1/memory + bridgeMemoryAuth + where events are stored (file vs blobs)
2. lib/memory.mjs + lib/memory-provider-vector.mjs — how self-hosted searchEvents works; mcp/tools/memory.mjs — memory_search tool contract
3. hub/bridge/server.mjs — vault POST /api/v1/search + embed path (reuse embedding client, limits, billing patterns)
4. docs/PARITY-MATRIX-HOSTED.md § Agent memory — extend row when POST returns real results
5. docs/HOSTED-HUB-MCP-INTERLOCK.md — H0–H4 for this endpoint

Deliverables:
- Replace stub with: load events for uid+vault → embed query + candidates (or incremental index) → ranked results JSON { results, count } with stable shape
- Tests (bridge or lib) + rate limits; document billing if embeddings accrue
- Optional: hosted MCP registerTool memory_search + ACL + mcp-hosted-tools-list golden + verify:hosted-mcp-checklist

Ship in a PR that includes code + tests + doc updates (no docs-only PR to main).
```

### Resources (hosted)

| Phase | Target | Rationale |
|-------|--------|-----------|
| **R0** | Keep **`knowtation://hosted/vault-info`**; document only | Already shipped. |
| **R1** | **One** `ResourceTemplate` for note read, e.g. `knowtation://hosted/vault/{+path}` backed by same reads as `get_note` | **Done** on `main` (incl. **`resources/list`** note rows for Cursor). Gateway idle session policy: env **`MCP_SESSION_TTL_MS`**, **`MCP_MAX_SESSIONS_PER_USER`** (`hub/gateway/mcp-proxy.mjs`). |
| **R2** | Vault listing resources (subset of local static URIs) | **Complete:** static **`knowtation://hosted/vault-listing`** (PR **#182**) + **`knowtation://hosted/vault/{+path}`** when the path does **not** end with **`.md`** → JSON folder listing (`GET …/notes?folder=…&limit=100&offset=0`), aligned with self-hosted `knowtation://vault/{+path}` folder branch. **Optional later:** dedicated URIs for paged **`offset>0`** (until then use **`list_notes`**). |
| **R3+** | Templates, **image**-oriented resources (SSRF-safe), memory-topic templates | **Implemented** in gateway (`hub/gateway/mcp-hosted-server.mjs`): **`knowtation://hosted/templates-index`**, **`knowtation://hosted/template/{+name}`**, **`knowtation://hosted/vault-image/{+notePath}/{index}`** (canonical image URI), **`knowtation://hosted/memory/topic/{slug}`**; tests: [`test/mcp-hosted-resources-r3.test.mjs`](../test/mcp-hosted-resources-r3.test.mjs). **Hosted Hub product:** no **video file import** MVP; video in notes = **markdown links / URLs** — **no** hosted MCP **`note-video`**-style binary resource. |

**Cursor “86 resources”** on self-hosted includes **template-expanded** URIs — hosted will not match that count until **R2+**; set expectations in docs.

---

## Paste this as your next session prompt — Track **R3+** (hosted MCP resources)

**Branch:** work on **`feat/hosted-mcp-resources-r3`** (rebase on **`main`** if needed), or continue from this branch after docs merge.

**Product guardrail (hosted):** The hosted Hub does **not** ship **video file upload import**. Video appears in vault notes as **links / embeds** (like images via URL) — already true in live Hub. R3+ MCP resource work must **respect** that: no priority on local-style **binary video import** resource parity; focus **templates**, **SSRF-safe image** patterns, **memory topic** templates, caps, and metering.

**Read first:**

1. [`docs/NEXT-SESSION-HOSTED-HUB-MCP.md`](./NEXT-SESSION-HOSTED-HUB-MCP.md) — R0–R3+ table (this file).
2. [`docs/PRODUCT-DECISIONS-HOSTED-MVP.md`](./PRODUCT-DECISIONS-HOSTED-MVP.md) — § Media in notes (hosted).
3. [`mcp/resources/register.mjs`](../mcp/resources/register.mjs) — which `ResourceTemplate`s map to **bridge/canister** reads vs **local disk only**.
4. [`docs/HOSTED-HUB-MCP-INTERLOCK.md`](./HOSTED-HUB-MCP-INTERLOCK.md) — H0–H4 for new surfaces.

**Deliverables (implementation sessions):** phased PRs with tests; each template handler uses the **same** upstream patterns as **`get_note`** / list APIs; document intentional gaps vs self-hosted stdio. **R3+ first slice:** templates + SSRF-safe images + memory-topic resources + tests + matrix (this repo state on **`feat/hosted-mcp-resources-r3`**).

```
You are implementing Knowtation **hosted MCP R3+** resources (templates, SSRF-safe image-style resources, memory-topic templates — not binary hosted video file import).

Branch: feat/hosted-mcp-resources-r3 (from main). Product: hosted Hub uses video as markdown links/URLs only; mirror that in MCP resource design.

Read: docs/NEXT-SESSION-HOSTED-HUB-MCP.md, docs/PRODUCT-DECISIONS-HOSTED-MVP.md § Media in notes, mcp/resources/register.mjs, hub/gateway/mcp-hosted-server.mjs existing R1/R2 resources, docs/HOSTED-HUB-MCP-INTERLOCK.md.

Ship small PRs: code + tests + matrix/handoff doc updates together (no docs-only PR to main).
```

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
| **B2** | **Done** — merged PR **#175** (`main`). Post-B2 smoke was **`prompts/list`** nine (viewer) / ten (editor/admin); with **B3** see **twelve** / **thirteen**. |
| **B3** | **Done** — memory trio **`registerPrompt`** merged to **`main`** (PR **#178**); prep PR **#177**. |
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
- **`feat/hosted-mcp-resources-r3`** — **Track R3+** hosted MCP resources scoping + implementation handoff (branch; merge with code + tests per policy)

---

## Precautions (short)

Identity (`effective_canister_user_id`), import metering, MCP export caps, Zod schema export for `prompts/list` — see [`HOSTED-MCP-TOOL-EXPANSION.md`](HOSTED-MCP-TOOL-EXPANSION.md) and interlock doc.

# Next session: hosted Hub + MCP interlock (G0–G1) and prompts roadmap

This document is the **handoff** for continuing work on **anti-drift** between the **hosted Hub (browser)** and **hosted MCP (Cursor)**, plus the **prompts/resources** program. It captures decisions from the planning conversation (April 2026).

**Merged G0 doc pack (parity matrix + Track A):** branch `docs/hosted-hub-mcp-interlock-g0` → merge to `main` via PR.

**Track B1 — merged:** PR **#174** is merged to **`main`** (five hosted prompts + ACL + tests + docs).

**Track B2 (active branch):** `feat/hosted-mcp-prompts-b2` — implement the **next** hosted prompts (see paste block and § *Recommended phases*). Open a PR **`feat/hosted-mcp-prompts-b2` → `main`** when ready. **Do not** stack unrelated product work on this branch.

**Scope reminder:** All **13** self-hosted prompt IDs from [`mcp/prompts/register.mjs`](../mcp/prompts/register.mjs) stay in scope across **B1 + B2 + B3**; nothing is intentionally “dropped” except **B3** waits on hosted **`/api/v1/memory*`** parity with Hub. B1 shipped **5**; B2 targets **5** more; B3 is **3** memory prompts.

**Why a new branch after G0:** Track B changes `hub/gateway/mcp-hosted-server.mjs` and tests; keeping it separate from the docs-only G0 PR preserves a small, reviewable history and avoids mixing documentation approval with gateway behavior changes.

## Workflow (current)

1. **`main`** includes G0 docs + Track B1 (PR **#174**).
2. `git fetch origin && git checkout main && git pull origin main && git checkout feat/hosted-mcp-prompts-b2` (or create **`feat/hosted-mcp-prompts-b2`** from `main` if it does not exist yet).
3. Implement Track B2; push; open PR **`feat/hosted-mcp-prompts-b2` → `main`**.

---

## Paste this as your next session prompt — Track B2 (hosted MCP prompts)

Use on branch **`feat/hosted-mcp-prompts-b2`** with **`main`** up to date (includes merged PR **#174**).

```
You are implementing Track B2 — additional hosted MCP prompts (`registerPrompt`) on the gateway.

Work on branch: feat/hosted-mcp-prompts-b2 (from latest origin/main).

Context (read in order):
1. mcp/prompts/register.mjs (+ mcp/prompts/helpers.mjs) — canonical ids, argsSchema, messages for: meeting-notes, knowledge-gap, causal-chain, extract-entities, write-from-capture (reference only; hosted must not read local vault files or local-only templates).
2. hub/gateway/mcp-hosted-server.mjs — follow B1 patterns: upstreamFetch, canisterFetchOpts, bridgeFetchOpts; same HTTP paths as tools (list_notes, search, get_note; plus extract_tasks / capture / write where a prompt’s self-hosted flow used those capabilities).
3. hub/gateway/mcp-tool-acl.mjs — add each new prompt id; set minimum role per prompt (read-only vs any prompt that implies capture/write).
4. docs/HOSTED-MCP-TOOL-EXPANSION.md — prompt inventory row + production verification when first B2 prompt ships; Zod / prompts/list rules unchanged.
5. test/mcp-hosted-prompts.test.mjs — extend PROMPTS_ALL golden list; add getPrompt or fetch-mock tests where wiring is non-trivial.
6. scripts/check-mcp-hosted-schema.mjs — keep mcp-hosted*.mjs free of z.record(z.unknown()) (tools/list and prompts/list JSON Schema export).
7. docs/PARITY-MATRIX-HOSTED.md — new row or “composition only” per prompt.
8. docs/HOSTED-HUB-MCP-INTERLOCK.md — H0–H4 when a prompt should stay aligned with Hub.
9. docs/NEXT-SESSION-HOSTED-HUB-MCP.md — update B2 progress / deferrals.

Facts:
- B1 on main: five prompts (daily-brief, search-and-synthesize, project-summary, temporal-summary, content-plan).
- B2 target batch: meeting-notes, knowledge-gap, causal-chain, extract-entities, write-from-capture — verify per prompt which hosted tools/upstreams replace local graph/filesystem (causal-chain used local graph in stdio; hosted may compose search + get_note until a shared graph HTTP exists).
- B3 (memory trio) stays deferred until hosted memory contract matches Hub.
- “Subscriptions” in MCP means resources/subscribe (protocol), not Stripe.

Do NOT mix with parked/hosted-voice-import-mcp-billing unless explicitly merging that program.

Run before merge: npm run verify:hosted-mcp-checklist, npm test.
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

G0 matrix and Track A recipes are in repo. Track B1 is on `main`; next code stage is Track B2 (see primary paste block in this doc).
```

---

## Order of work: what comes before what?

| Step | What | Blocks prompts in code? |
|------|------|---------------------------|
| **G0 + G1** | Parity matrix + team rule (H0–H4) | **Should precede Track B** (implementing hosted prompts) so new prompts do not encode duplicate rules. **Does not** block **Track A** (recipes markdown only). |
| **Track A** | Recipes doc (tools-only flows) | **No dependency** — can run **in parallel** with G0. |
| **Track B** | **B1 merged** (PR **#174**, 5 prompts); **B2** on `feat/hosted-mcp-prompts-b2`; **B3** after memory API | **B1** on `main`; **B2** reuses same APIs as tools (verify causal-chain vs graph); **B3** = memory trio (blocked on Hub memory parity). |
| **G2** | Refactor hot-spot duplicates | As needed when G0 finds issues. |
| **G4** | Hosted resources | **Separate phase** after Track B proves stable (optional note-read template first). |

**Bottom line:** **G0 + Track A + Track B1** are on **`main`**; G1 is ongoing discipline (H0–H4). The next **code** milestone is **Track B2** (next five `registerPrompt` handlers, tests, playbook rows). You can still extend **Track A** recipes anytime (documentation only).

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
| **B2 — Second batch (4–5)** | **`meeting-notes`**, **`knowledge-gap`**, **`causal-chain`**, **`extract-entities`**, **`write-from-capture`** | **In progress** on **`feat/hosted-mcp-prompts-b2`**. Mostly list/search/get (+ `extract_tasks` / `capture` / `write` where needed). Verify **`causal-chain`** vs local graph: hosted may compose documented APIs until a shared graph HTTP exists. |
| **B3 — Memory trio (3)** | **`memory-context`**, **`memory-informed-search`**, **`resume-session`** | **Separate phase:** depends on **hosted memory** semantics matching local (`formatMemoryEventsAsync`, etc.). Do **not** block B2 on these. |

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
| **B2 (active)** | Branch **`feat/hosted-mcp-prompts-b2`**: `meeting-notes`, `knowledge-gap`, `causal-chain`, `extract-entities`, `write-from-capture` — extend ACL + `mcp-hosted-prompts.test.mjs`. |
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
- **`feat/hosted-mcp-prompts-b2`** — Track B2 implementation branch (create from `main` after pull; open PR → `main` when B2 prompts land)
- **`feat/hosted-mcp-prompts-b1`** — merged via PR **#174** (historical)

---

## Precautions (short)

Identity (`effective_canister_user_id`), import metering, MCP export caps, Zod schema export for `prompts/list` — see [`HOSTED-MCP-TOOL-EXPANSION.md`](HOSTED-MCP-TOOL-EXPANSION.md) and interlock doc.

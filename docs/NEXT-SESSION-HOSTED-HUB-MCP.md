# Next session: hosted Hub + MCP interlock (G0–G1) and prompts roadmap

This document is the **handoff** for continuing work on **anti-drift** between the **hosted Hub (browser)** and **hosted MCP (Cursor)**, plus the **prompts/resources** program. It captures decisions from the planning conversation (April 2026).

**Merged G0 doc pack (parity matrix + Track A):** branch `docs/hosted-hub-mcp-interlock-g0` → merge to `main` via PR.

**Track B1 (hosted `registerPrompt`) — use this branch for code + doc follow-ups:** `feat/hosted-mcp-prompts-b1`. After the G0 PR lands on `main`, run `git fetch origin && git checkout feat/hosted-mcp-prompts-b1 && git rebase origin/main` (resolve conflicts if any), then implement prompts and open a **second** PR `feat/hosted-mcp-prompts-b1` → `main`. **Do not** stack unrelated product work on this branch.

**Why a new branch after G0:** Track B changes `hub/gateway/mcp-hosted-server.mjs` and tests; keeping it separate from the docs-only G0 PR preserves a small, reviewable history and avoids mixing documentation approval with gateway behavior changes.

## Workflow after the G0 PR merges

1. Merge the PR from `docs/hosted-hub-mcp-interlock-g0` into `main`.
2. `git fetch origin && git checkout main && git pull origin main`
3. `git checkout feat/hosted-mcp-prompts-b1 && git rebase origin/main` (use `git merge origin/main` instead if your team avoids rebase on shared branches).
4. Implement Track B1 on `feat/hosted-mcp-prompts-b1`, push, open a **second** PR: `feat/hosted-mcp-prompts-b1` → `main`.

This branch already carries the **Track B handoff** doc commit; rebasing keeps that commit on top of the merged G0 + `main` history.

---

## Paste this as your next session prompt — Track B1 (hosted MCP prompts)

Use **after** step 3 above (G0 on `main`, `feat/hosted-mcp-prompts-b1` rebased onto `origin/main`).

```
You are implementing Track B1 — hosted MCP prompts (`registerPrompt`) on the gateway.

Context (read in order):
1. mcp/prompts/register.mjs (+ mcp/prompts/helpers.mjs) — canonical prompt ids, argsSchema shapes, message patterns for self-hosted stdio (reference only; hosted must not read local vault files).
2. hub/gateway/mcp-hosted-server.mjs — createHostedMcpServer: registerTool + upstreamFetch/canister patterns; add registerPrompt here using the same HTTP paths as tools (list_notes, search, get_note).
3. hub/gateway/mcp-tool-acl.mjs — role gates for tools; decide per-prompt minimum role (likely mirror viewer for read-only prompts).
4. docs/HOSTED-MCP-TOOL-EXPANSION.md — Zod rules, ACL, verify:hosted-mcp-checklist; extend playbook for prompts/list JSON Schema.
5. test/mcp-hosted-tools-list.test.mjs — pattern for golden MCP lists; add prompts/list (and getPrompt if exercised) tests with mocked bridge/canister URLs.
6. scripts/check-mcp-hosted-schema.mjs — today scans hub/gateway/mcp-hosted*.mjs; keep prompt argsSchema free of z.record(z.unknown()) (same failure mode as tools/list).
7. docs/PARITY-MATRIX-HOSTED.md — if a prompt implies a new user-facing capability, add a row or document “composition only.”
8. docs/HOSTED-HUB-MCP-INTERLOCK.md — H0–H4 for any prompt that should stay aligned with Hub.
9. docs/NEXT-SESSION-HOSTED-HUB-MCP.md — B1 batch: daily-brief, search-and-synthesize, project-summary; optional temporal-summary or content-plan.

Facts:
- Hosted MCP today: 17 tools, one resource (knowtation://hosted/vault-info), NO prompts — unlike self-hosted stdio (13 prompts, many resources).
- “Subscriptions” in MCP means resources/subscribe (protocol), NOT Stripe billing.
- Hosted prompts must fetch vault data via bridge/canister like tools; use canisterUserId / hosted-context parity (see playbook § Hosted MCP canister X-User-Id parity).

First implementation batch (B1): implement 3–5 prompts only — start with daily-brief, search-and-synthesize, project-summary (args aligned with self-hosted where sensible). Optional: temporal-summary or content-plan. Defer memory trio (B3) until hosted memory contract matches Hub.

Do NOT mix with parked/hosted-voice-import-mcp-billing unless explicitly merging that program.

Tasks:
- Add registerPrompt handlers; wire prompts/list + getPrompt through existing MCP server factory.
- Tests: prompts list round-trip + schema export; at least one handler test with mocked fetch (pattern from mcp-hosted-* tests).
- Update docs/HOSTED-MCP-TOOL-EXPANSION.md production verification subsection when first prompt ships.

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

G0 matrix and Track A recipes are in repo. Next stage is Track B (see primary paste block in doc).
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

**Bottom line:** **G0 + Track A are done in repo; G1 is ongoing discipline (H0–H4).** The next **code** milestone is **Track B1** (`registerPrompt` on the gateway, tests, playbook updates). You can still extend **Track A** recipes anytime (documentation only).

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
- `feat/hosted-mcp-prompts-b1` — Track B1 implementation branch (rebase onto `main` after the G0 PR merges; carries handoff doc updates until prompts land)

---

## Precautions (short)

Identity (`effective_canister_user_id`), import metering, MCP export caps, Zod schema export for `prompts/list` — see [`HOSTED-MCP-TOOL-EXPANSION.md`](HOSTED-MCP-TOOL-EXPANSION.md) and interlock doc.

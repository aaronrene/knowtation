# Backlog: MCP supercharge (from GitHub Issues #1, #2)

> **Archived — sequencing / issue history.** For **how to use** MCP and the Hub today, start with **[AGENT-INTEGRATION.md](../AGENT-INTEGRATION.md)** and **[AGENT-ORCHESTRATION.md](../AGENT-ORCHESTRATION.md)**. This file remains for the original phase tables and GitHub issue cross-reference.

**Sequencing:** [STATUS-HOSTED-AND-PLANS.md](../STATUS-HOSTED-AND-PLANS.md) · [PARITY-PLAN.md](../PARITY-PLAN.md) — tests → hosted parity → multi-vault → MCP D2/D3.

**What this doc is for:** If you are not deep in MCP jargon, think of it as a **roadmap checklist**: which “superpowers” (browseable resources, reusable prompts, live file updates, HTTP transport, etc.) are already in the Knowtation repo versus still planned. Engineers use it to sequence work; everyone else can skim the tables to see **done vs next**.

This doc tracks the **supercharge MCP** work from [GitHub Issue #1](https://github.com/aaronrene/knowtation/issues/1) and [GitHub Issue #2](https://github.com/aaronrene/knowtation/issues/2). Detailed phase notes and issue exports may live in a maintainer’s local **`development/`** copy (gitignored); this file is the public summary.

**Purpose:** Incorporate into the plan everything that MCP can do that Knowtation doesn't yet use (Resources, Prompts, Subscriptions, Sampling, HTTP transport, Roots, Progress, Logging), plus longer-term **orchestrator + vault** integration ideas (Issue #2).

---

## Strategic sequencing (decision)

**In the simplest terms:** We finish **hosted parity** (live site: bridge, login, env, pre-roll, “does it actually work for users?”) **before** we build **MCP through the Hub with real sign-in (D2/D3)**. The large **Issue #2** program waits.

**Why that order?** **Hub MCP + OAuth** needs a solid picture of **who the user is** and **how requests reach the vault** in production. If we build the gateway **before** that is stable, we risk **building on sand**: wrong URLs, guessed auth, or security holes, then ripping it out when hosted wiring changes. The MCP work **already in the repo** (local stdio, local HTTP, tools, sampling on `summarize`, etc.) is **not** sand for that reason — it mostly runs on **your machine** and does not depend on the live Hub being finished.

**Practical order:**

1. **Merge to `main`** — When the branch is ready, open a PR (or merge) so MCP improvements are not stranded; self-hosted users and Cursor clients benefit immediately.
2. **Hosted parity first** — Follow [PARITY-PLAN.md](../PARITY-PLAN.md), [STATUS-HOSTED-AND-PLANS.md](../STATUS-HOSTED-AND-PLANS.md), and [DEPLOY-HOSTED.md](../DEPLOY-HOSTED.md) §5: bridge deployed, `BRIDGE_URL` on the gateway, pre-roll checklist, redeploys as needed.
2b. **Phase 15.1 — hosted multi-vault** (if product goal is parity with local): canister partitions by `vault_id`; vault list/access on hosted; see [MULTI-VAULT-AND-SCOPED-ACCESS.md](../MULTI-VAULT-AND-SCOPED-ACCESS.md) § Hosted multi-vault — what to build. Early deploys with almost no data: **minimal migration** (redeploy or one-shot default vault) is fine.
3. **Finish Issue #1 leftovers** — **D2/D3** (authenticated MCP via Hub), then **F2–F5** (extra sampling). Intentionally **after** hosted behavior (including multi-vault if shipped) is stable.
4. **Issue #2** — Only **small, explicit slices** after the above; not the full “Infinite Machine Brain” in one go.

**Your understanding is correct:** commit / push / merge the current work, then **hosted parity**, then **come back to Issue #1** for D2/D3 and F2–F5. You are not abandoning Issue #1 — you are **ordering** it so the last pieces sit on **firm ground**.

---

## Issue content (GitHub)

| Issue | Title | Link |
|-------|--------|------|
| **#1** | Supercharge MCP — Resources, Prompts, Streaming Transport, Subscriptions, and Sampling | [github.com/.../issues/1](https://github.com/aaronrene/knowtation/issues/1) |
| **#2** | AgentCeption × Knowtation — The Infinite Machine Brain | [github.com/.../issues/2](https://github.com/aaronrene/knowtation/issues/2) |

---

## Issue #1 — MCP supercharge phases (summary)

| Phase | Theme | In plan? | Code / notes |
|-------|--------|----------|----------------|
| **A** | MCP Resources — vault as browseable knowledge graph (`knowtation://vault/...`, listings, index/stats, tags, graph) | **Done** | `mcp/resources/` |
| **B** | MCP Prompts — reusable agent workflows + 3 memory-aware prompts (memory-context, memory-informed-search, resume-session) | **Done** | `mcp/prompts/` |
| **C** | Enhanced tools — relate, backlinks, capture, transcribe, summarize, cluster, … | **Done (in repo)** | `mcp/tools/phase-c.mjs` |
| **D** | Streamable HTTP transport + Hub as MCP gateway (HTTP+SSE, OAuth 2.1, session pool) | **D1 done** (local HTTP); **D2 done** (gateway proxy); **D3 done** (OAuth 2.1) | `mcp/http-server.mjs`, `hub/gateway/mcp-proxy.mjs`, `hub/gateway/mcp-hosted-server.mjs`, `hub/gateway/mcp-oauth-provider.mjs` |
| **E** | Resource subscriptions + real-time vault watcher | **Done (local vault)** | `mcp/resource-subscriptions.mjs` — hosted N/A |
| **F** | MCP Sampling — delegate LLM work to client | **F1–F5 done** | `mcp/sampling.mjs` (generic helper), `mcp/tools/enrich.mjs` (F2), `mcp/tools/sampling-rerank.mjs` (F4), `mcp/prompts/helpers.mjs` (F5 prefill), `mcp/tools/index-enrich.mjs` (F3) |
| **G** | Roots / scope — `instructions` with `file://` vault + data_dir | **Done** | `mcp/server-instructions.mjs` |
| **H** | Progress notifications + structured logging | **Done (stdio)** | `mcp/tool-telemetry.mjs` |

**Recommended implementation order (from Issue #1):** A → C → E → H → B → D → F → G

**Gap today (from issue):** Base tools ✅ (7) + Phase C tools ✅ (10) + `enrich` (F2); Resources ✅ (Phase A); Prompts ✅ (Phase B + F5 prefill); Resource subscriptions ✅ (Phase E, self-hosted); Progress + logging ✅ (Phase H, stdio); Scope / roots alignment ✅ (Phase G: `instructions` + optional client roots log); local Streamable HTTP ✅ (D1); Hub MCP gateway ✅ (D2: `/mcp` session pool + role ACL); OAuth 2.1 ✅ (D3: `KnowtationOAuthProvider`); Sampling **F1–F5** ✅ (generic `trySampling`, enrich, rerank, prefill, index-enrich). **All Issue #1 phases complete.**

---

## Issue #2 — Infinite Machine Brain phases (summary)

| Phase | Theme | In plan? | When? |
|-------|--------|----------|--------|
| **1** | Agent cognitive identity — persistent mind palaces per tier (CTO/VP/Engineer), onboarding from vault, write-back after run, failure memory | Backlog | After Issue #1 Phase A (vault as resource) |
| **2** | Ambient capture → dispatch — inbox watcher, `#dispatch` / `#build` tags, voice → vault → deploy | Backlog | After Knowtation inbox watcher |
| **3** | Causal intelligence — causal_chain_id/follows on every agent note, pipeline timeline view, semantic diff before planning | Backlog | After Phase 1 (write-backs exist) |
| **4** | Self-improving org — retrospective synthesizer, prompt updates from vault history | Backlog | After 1, 3 (data to retrospect) |
| **5** | Async agent messaging — inter-agent and human↔agent via vault inbox | Backlog | After Phase 2 |
| **6** | Knowtation-indexed codebase — CI indexes external app into vault, pre-implementation codebase search | Backlog | After Phase 2 |
| **7** | Real-time vault broadcast to build dashboard — MCP subscriptions → SSE feed | Backlog | After Issue #1 Phase E (subscriptions) |
| **8** | Infinite machine loop — meta-dispatch, vault as spec for next run, episodic memory | Backlog | After all prior |

**Recommended implementation order (from Issue #2):** 1 → 3 → 5 → 6 → 2 → 7 → 4 → 8

---

## Current state in the repo

- **MCP today (Phase 9):** **Stdio** (default) + **Streamable HTTP** (D1) + **Hub MCP gateway** (D2/D3); base + Phase C tools + `enrich` (F2) + 6 memory tools; Phase A resources + 3 memory resources; Phase B prompts + 3 memory-aware prompts + F5 sampling prefill; Phase E; Phase H; Phase G; Phase **F1–F5** sampling (generic `trySampling`, enrich, search rerank, prompt prefill, index-enrich). **Hub MCP proxy** (`/mcp` endpoint with session pool, JWT auth, role-based ACL) and **OAuth 2.1** (`KnowtationOAuthProvider` with dynamic client registration, PKCE, MCP-scoped JWTs) both implemented.
- **Phase 2 (hosted):** Bridge deploy and pre-roll still in progress. [PARITY-PLAN.md](../PARITY-PLAN.md) says do not start Phase 3 (multi-vault) until Phase 2 is complete.
- **IMPLEMENTATION-PLAN:** References this backlog; suggested prompts for agents is separate optional backlog item.

---

## Recommended timing

- **Now:** All Issue #1 phases **A–H**, **D1–D3**, **F1–F5** are implemented. The MCP supercharge work is complete.
- **Next:** Issue #2 (AgentCeption) depends on external orchestrator + Knowtation MCP features (Resources, Subscriptions); schedule after hosted production is stable.
- **Order:** Hosted Phase 2 (bridge, pre-roll) → **Phase 15.1** hosted multi-vault → Issue #2 slices.

---

## Links

- [IMPLEMENTATION-PLAN.md](../IMPLEMENTATION-PLAN.md) — main plan; Issues #1 and #2 point here.
- [PARITY-PLAN.md](../PARITY-PLAN.md) — Phase 2 (deploy, bridge), Phase 3 (multi-vault).
- [AGENT-ORCHESTRATION.md](../AGENT-ORCHESTRATION.md) — MCP/CLI patterns.
- [Documentation index](../README.md) — all docs.
- Phase 9 (MCP server): IMPLEMENTATION-PLAN § Phase 9 — stdio transport, 7 tools.

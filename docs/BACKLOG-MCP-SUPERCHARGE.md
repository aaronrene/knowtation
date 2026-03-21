# Backlog: MCP supercharge (from GitHub Issues #1, #2)

This doc tracks the **supercharge MCP** work from [GitHub Issue #1](https://github.com/aaronrene/knowtation/issues/1) and [GitHub Issue #2](https://github.com/aaronrene/knowtation/issues/2). Full issue content is stored in the repo so the plan is not blocked on GitHub access.

**Purpose:** Incorporate into the plan everything that MCP can do that Knowtation doesn't yet use (Resources, Prompts, Subscriptions, Sampling, HTTP transport, Roots, Progress, Logging), plus the **Infinite Machine Brain** integration with AgentCeption.

---

## Issue content (in repo)

| Issue | Title | Doc |
|-------|--------|-----|
| **#1** | Supercharge MCP — Resources, Prompts, Streaming Transport, Subscriptions, and Sampling | [docs/issues/issue-1-supercharge-mcp.md](./issues/issue-1-supercharge-mcp.md) |
| **#2** | AgentCeption × Knowtation — The Infinite Machine Brain | [docs/issues/issue-2-infinite-machine-brain.md](./issues/issue-2-infinite-machine-brain.md) |

---

## Issue #1 — MCP supercharge phases (summary)

| Phase | Theme | In plan? | When? |
|-------|--------|----------|--------|
| **A** | MCP Resources — vault as browseable knowledge graph (`knowtation://vault/...`, listings, index/stats, tags, graph) | Backlog | After Phase 2 (hosted) |
| **B** | MCP Prompts — reusable agent workflows (daily-brief, search-and-synthesize, project-summary, write-from-capture, etc.) | **Done** | [MCP-PHASE-B.md](./MCP-PHASE-B.md) |
| **C** | Enhanced tools — relate, backlinks, capture, transcribe, summarize, cluster, extract_tasks, tag-suggest, memory-query, vault-sync | **Done (in repo)** | See [MCP-PHASE-C.md](./MCP-PHASE-C.md) |
| **D** | Streamable HTTP transport + Hub as MCP gateway (HTTP+SSE, OAuth 2.1, session pool) | **D1 done** (local HTTP); **D2/D3** backlog | [MCP-PHASE-D.md](./MCP-PHASE-D.md) |
| **E** | Resource subscriptions + real-time vault watcher (fs.watch → notify clients) | **Done (local vault)** | [MCP-PHASE-E.md](./MCP-PHASE-E.md) — chokidar + subscribe; hosted N/A |
| **F** | MCP Sampling — delegate LLM work to client (summarize, import categorization, rerank, prompt prefilling) | Backlog | After D (sampling over HTTP sessions) |
| **G** | Roots declaration — server declares vault/data_dir scope for clients | Backlog | Anytime |
| **H** | Progress notifications + structured logging (index/import progress; log forwarding) | **Done (stdio)** | [MCP-PHASE-H.md](./MCP-PHASE-H.md) |

**Recommended implementation order (from Issue #1):** A → C → E → H → B → D → F → G

**Gap today (from issue):** Base tools ✅ (7) + Phase C tools ✅ (10); Resources ✅ (Phase A); Prompts ✅ (Phase B); Resource subscriptions ✅ (Phase E, self-hosted); Progress + logging ✅ (Phase H, stdio); Sampling ❌; Roots ❌; HTTP transport ❌ (stdio only); OAuth for MCP ❌.

---

## Issue #2 — Infinite Machine Brain phases (summary)

| Phase | Theme | In plan? | When? |
|-------|--------|----------|--------|
| **1** | Agent cognitive identity — persistent mind palaces per tier (CTO/VP/Engineer), onboarding from vault, write-back after run, failure memory | Backlog | After Issue #1 Phase A (vault as resource) |
| **2** | Ambient capture → dispatch — inbox watcher, `#dispatch` / `#build` tags, AgentCeption `POST /api/build/from-vault`, voice → vault → deploy | Backlog | After Knowtation inbox watcher |
| **3** | Causal intelligence — causal_chain_id/follows on every agent note, pipeline timeline view, semantic diff before planning | Backlog | After Phase 1 (write-backs exist) |
| **4** | Self-improving org — retrospective synthesizer, prompt updates from vault history | Backlog | After 1, 3 (data to retrospect) |
| **5** | Async agent messaging — inter-agent and human↔agent via vault inbox | Backlog | After Phase 2 |
| **6** | Knowtation-indexed codebase — CI indexes AgentCeption into vault, pre-implementation codebase search | Backlog | After Phase 2 |
| **7** | Real-time vault broadcast to build dashboard — MCP subscriptions → SSE feed | Backlog | After Issue #1 Phase E (subscriptions) |
| **8** | Infinite machine loop — meta-dispatch, vault as spec for next AgentCeption, episodic memory | Backlog | After all prior |

**Recommended implementation order (from Issue #2):** 1 → 3 → 5 → 6 → 2 → 7 → 4 → 8

---

## Current state in the repo

- **MCP today (Phase 9):** **Stdio** (default) + **Streamable HTTP** (D1) — [MCP-PHASE-D.md](./MCP-PHASE-D.md); base + Phase C tools; Phase A resources; Phase B prompts; Phase E; Phase H. No Sampling, Roots, Hub MCP proxy, or OAuth for MCP yet.
- **Phase 2 (hosted):** Bridge deploy and pre-roll still in progress. [PARITY-PLAN.md](./PARITY-PLAN.md) says do not start Phase 3 (multi-vault) until Phase 2 is complete.
- **IMPLEMENTATION-PLAN:** References this backlog and [BACKLOG-MCP-SUPERCHARGE](./BACKLOG-MCP-SUPERCHARGE.md); suggested prompts for agents is separate optional backlog item.

---

## Recommended timing

- **Now:** Phases **A–E**, **H**, and **D1** (local Streamable HTTP) are in-repo. Remaining: **D2/D3** (Hub gateway + OAuth), **F**, **G**.
- **After Phase 2 (bridge + pre-roll):** Continue MCP supercharge in that order. Issue #2 (Infinite Machine Brain) depends on AgentCeption + Knowtation MCP features (Resources, Subscriptions); schedule after corresponding Issue #1 phases.
- **Order vs multi-vault:** Finish Phase 2 → then Phase 3 (multi-vault) or remaining Issue #1 items (H, B, D, F, G) by priority.

---

## Links

- [MCP-PHASE-E.md](./MCP-PHASE-E.md) — subscriptions + vault watcher (Phase E).
- [MCP-PHASE-H.md](./MCP-PHASE-H.md) — progress + logging (Phase H).
- [MCP-PHASE-B.md](./MCP-PHASE-B.md) — MCP prompts (Phase B).
- [MCP-PHASE-D.md](./MCP-PHASE-D.md) — Streamable HTTP (D1) and D2/D3 backlog.
- [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) — main plan; "Issues #1 and #2" points here.
- [PARITY-PLAN.md](./PARITY-PLAN.md) — Phase 2 (deploy, bridge), Phase 3 (multi-vault).
- [AGENT-ORCHESTRATION.md](./AGENT-ORCHESTRATION.md) — current MCP/CLI usage.
- Phase 9 (MCP server): IMPLEMENTATION-PLAN § Phase 9 — stdio transport, 7 tools.

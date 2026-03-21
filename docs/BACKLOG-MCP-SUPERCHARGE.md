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
| **B** | MCP Prompts — reusable agent workflows (daily-brief, search-and-synthesize, project-summary, write-from-capture, etc.) | Backlog | After A (embed resources in prompts) |
| **C** | Enhanced tools — relate, backlinks, capture, transcribe, summarize, cluster, extract_tasks, tag-suggest, memory-query, vault-sync | **Done (in repo)** | See [MCP-PHASE-C.md](./MCP-PHASE-C.md) |
| **D** | Streamable HTTP transport + Hub as MCP gateway (HTTP+SSE, OAuth 2.1, session pool) | Backlog | After E (subscriptions need session tracking) |
| **E** | Resource subscriptions + real-time vault watcher (fs.watch → notify clients) | Backlog | After A (resources must exist) |
| **F** | MCP Sampling — delegate LLM work to client (summarize, import categorization, rerank, prompt prefilling) | Backlog | After D (sampling over HTTP sessions) |
| **G** | Roots declaration — server declares vault/data_dir scope for clients | Backlog | Anytime |
| **H** | Progress notifications + structured logging (index/import progress; log forwarding) | Backlog | After Phase 2 |

**Recommended implementation order (from Issue #1):** A → C → E → H → B → D → F → G

**Gap today (from issue):** Base tools ✅ (7) + Phase C tools ✅ (10); Resources ✅ (Phase A); Prompts ❌; Subscriptions ❌; Sampling ❌; Roots ❌; HTTP transport ❌ (stdio only); OAuth for MCP ❌; Progress ❌; Logging ❌.

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

- **MCP today (Phase 9):** Stdio transport only; base tools: search, get_note, list_notes, index, write, export, import. **Issue #1 Phase A (Resources):** `knowtation://` URIs — [MCP-RESOURCES-PHASE-A.md](./MCP-RESOURCES-PHASE-A.md). **Issue #1 Phase C:** enhanced tools — [MCP-PHASE-C.md](./MCP-PHASE-C.md). No Prompts, Subscriptions, Sampling, Roots, HTTP transport, Progress, or Logging yet.
- **Phase 2 (hosted):** Bridge deploy and pre-roll still in progress. [PARITY-PLAN.md](./PARITY-PLAN.md) says do not start Phase 3 (multi-vault) until Phase 2 is complete.
- **IMPLEMENTATION-PLAN:** References this backlog and [BACKLOG-MCP-SUPERCHARGE](./BACKLOG-MCP-SUPERCHARGE.md); suggested prompts for agents is separate optional backlog item.

---

## Recommended timing

- **Now:** Phases **A** and **C** of Issue #1 are implemented in-repo (see MCP-RESOURCES-PHASE-A, MCP-PHASE-C). Remaining Issue #1 order from here: **E → H → B → D → F → G** (A and C done).
- **After Phase 2 (bridge + pre-roll):** Continue MCP supercharge in that order. Issue #2 (Infinite Machine Brain) depends on AgentCeption + Knowtation MCP features (Resources, Subscriptions); schedule after corresponding Issue #1 phases.
- **Order vs multi-vault:** Finish Phase 2 → then choose either Phase 3 (multi-vault) or MCP supercharge (Issue #1 Phase A) next, by priority.

---

## Links

- [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) — main plan; "Issues #1 and #2" points here.
- [PARITY-PLAN.md](./PARITY-PLAN.md) — Phase 2 (deploy, bridge), Phase 3 (multi-vault).
- [AGENT-ORCHESTRATION.md](./AGENT-ORCHESTRATION.md) — current MCP/CLI usage.
- Phase 9 (MCP server): IMPLEMENTATION-PLAN § Phase 9 — stdio transport, 7 tools.

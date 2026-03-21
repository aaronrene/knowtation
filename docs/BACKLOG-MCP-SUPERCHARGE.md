# Backlog: MCP supercharge (from GitHub Issues #1, #2)

**What this doc is for:** If you are not deep in MCP jargon, think of it as a **roadmap checklist**: which “superpowers” (browseable resources, reusable prompts, live file updates, HTTP transport, etc.) are already in the Knowtation repo versus still planned. Engineers use it to sequence work; everyone else can skim the tables to see **done vs next**.

This doc tracks the **supercharge MCP** work from [GitHub Issue #1](https://github.com/aaronrene/knowtation/issues/1) and [GitHub Issue #2](https://github.com/aaronrene/knowtation/issues/2). Full issue content is stored in the repo so the plan is not blocked on GitHub access.

**Purpose:** Incorporate into the plan everything that MCP can do that Knowtation doesn't yet use (Resources, Prompts, Subscriptions, Sampling, HTTP transport, Roots, Progress, Logging), plus the **Infinite Machine Brain** integration with AgentCeption.

---

## Strategic sequencing (decision)

**In the simplest terms:** We finish **hosted parity** (live site: bridge, login, env, pre-roll, “does it actually work for users?”) **before** we build **MCP through the Hub with real sign-in (D2/D3)**. The big **AgentCeption / Issue #2** program waits.

**Why that order?** **Hub MCP + OAuth** needs a solid picture of **who the user is** and **how requests reach the vault** in production. If we build the gateway **before** that is stable, we risk **building on sand**: wrong URLs, guessed auth, or security holes, then ripping it out when hosted wiring changes. The MCP work **already in the repo** (local stdio, local HTTP, tools, sampling on `summarize`, etc.) is **not** sand for that reason — it mostly runs on **your machine** and does not depend on the live Hub being finished.

**Practical order:**

1. **Merge to `main`** — When the branch is ready, open a PR (or merge) so MCP improvements are not stranded; self-hosted users and Cursor clients benefit immediately.
2. **Hosted parity first** — Follow [PARITY-PLAN.md](./PARITY-PLAN.md), [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md), and [EXACT-STATE-PHASE2.md](./EXACT-STATE-PHASE2.md) (if present): bridge deployed, `BRIDGE_URL` on the gateway, pre-roll checklist, redeploys as needed.
3. **Finish Issue #1 leftovers** — **D2/D3** (authenticated MCP via Hub), then **F2–F5** (extra sampling). That **is** finishing Issue #1; it is intentionally **after** step 2 so D2/D3 matches real hosted behavior.
4. **Issue #2** — Only **small, explicit slices** after the above; not the full “Infinite Machine Brain” in one go.

**Your understanding is correct:** commit / push / merge the current work, then **hosted parity**, then **come back to Issue #1** for D2/D3 and F2–F5. You are not abandoning Issue #1 — you are **ordering** it so the last pieces sit on **firm ground**.

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
| **A** | MCP Resources — vault as browseable knowledge graph (`knowtation://vault/...`, listings, index/stats, tags, graph) | **Done** | [MCP-RESOURCES-PHASE-A.md](./MCP-RESOURCES-PHASE-A.md) |
| **B** | MCP Prompts — reusable agent workflows (daily-brief, search-and-synthesize, project-summary, write-from-capture, etc.) | **Done** | [MCP-PHASE-B.md](./MCP-PHASE-B.md) |
| **C** | Enhanced tools — relate, backlinks, capture, transcribe, summarize, cluster, extract_tasks, tag-suggest, memory-query, vault-sync | **Done (in repo)** | See [MCP-PHASE-C.md](./MCP-PHASE-C.md) |
| **D** | Streamable HTTP transport + Hub as MCP gateway (HTTP+SSE, OAuth 2.1, session pool) | **D1 done** (local HTTP); **D2/D3** backlog | [MCP-PHASE-D.md](./MCP-PHASE-D.md) |
| **E** | Resource subscriptions + real-time vault watcher (fs.watch → notify clients) | **Done (local vault)** | [MCP-PHASE-E.md](./MCP-PHASE-E.md) — chokidar + subscribe; hosted N/A |
| **F** | MCP Sampling — delegate LLM work to client | **F1 done** (`summarize`); **F2–F5** backlog | [MCP-PHASE-F.md](./MCP-PHASE-F.md) |
| **G** | Roots / scope — `instructions` with `file://` vault + data_dir; optional client `roots/list` log | **Done** | [MCP-PHASE-G.md](./MCP-PHASE-G.md) |
| **H** | Progress notifications + structured logging (index/import progress; log forwarding) | **Done (stdio)** | [MCP-PHASE-H.md](./MCP-PHASE-H.md) |

**Recommended implementation order (from Issue #1):** A → C → E → H → B → D → F → G

**Gap today (from issue):** Base tools ✅ (7) + Phase C tools ✅ (10); Resources ✅ (Phase A); Prompts ✅ (Phase B); Resource subscriptions ✅ (Phase E, self-hosted); Progress + logging ✅ (Phase H, stdio); Scope / roots alignment ✅ (Phase G: `instructions` + optional client roots log); local Streamable HTTP ✅ (D1); Sampling **F1** ✅ (`summarize` via client when supported); Sampling **F2–F5** ❌; Hub MCP proxy + OAuth ❌ (D2/D3).

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

- **MCP today (Phase 9):** **Stdio** (default) + **Streamable HTTP** (D1) — [MCP-PHASE-D.md](./MCP-PHASE-D.md); base + Phase C tools; Phase A resources; Phase B prompts; Phase E; Phase H; Phase G — [MCP-PHASE-G.md](./MCP-PHASE-G.md); Phase **F1** sampling (`summarize`) — [MCP-PHASE-F.md](./MCP-PHASE-F.md). Hub MCP proxy / OAuth (D2/D3) not implemented; F2–F5 sampling still backlog.
- **Phase 2 (hosted):** Bridge deploy and pre-roll still in progress. [PARITY-PLAN.md](./PARITY-PLAN.md) says do not start Phase 3 (multi-vault) until Phase 2 is complete.
- **IMPLEMENTATION-PLAN:** References this backlog and [BACKLOG-MCP-SUPERCHARGE](./BACKLOG-MCP-SUPERCHARGE.md); suggested prompts for agents is separate optional backlog item.

---

## Recommended timing

- **Now:** Phases **A–E**, **F1**, **G**, **H**, and **D1** (local Streamable HTTP) are in-repo. Remaining: **D2/D3** (Hub gateway + OAuth); **F2–F5** (more sampling use cases).
- **After Phase 2 (bridge + pre-roll):** Continue MCP supercharge in that order. Issue #2 (Infinite Machine Brain) depends on AgentCeption + Knowtation MCP features (Resources, Subscriptions); schedule after corresponding Issue #1 phases.
- **Order vs multi-vault:** Finish hosted Phase 2 (bridge, pre-roll) → then product-prioritized work: multi-vault (IMPLEMENTATION-PLAN Phase 3), Issue #1 leftovers (**D2/D3**, **F2–F5**), or Issue #2 slices.

---

## Links

- [MCP-PHASE-E.md](./MCP-PHASE-E.md) — subscriptions + vault watcher (Phase E).
- [MCP-PHASE-H.md](./MCP-PHASE-H.md) — progress + logging (Phase H).
- [MCP-PHASE-B.md](./MCP-PHASE-B.md) — MCP prompts (Phase B).
- [MCP-PHASE-D.md](./MCP-PHASE-D.md) — Streamable HTTP (D1) and D2/D3 backlog.
- [MCP-PHASE-G.md](./MCP-PHASE-G.md) — scope / roots alignment (Phase G).
- [MCP-PHASE-F.md](./MCP-PHASE-F.md) — sampling (Phase F; F1 shipped).
- [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) — main plan; "Issues #1 and #2" points here.
- [PARITY-PLAN.md](./PARITY-PLAN.md) — Phase 2 (deploy, bridge), Phase 3 (multi-vault).
- [AGENT-ORCHESTRATION.md](./AGENT-ORCHESTRATION.md) — current MCP/CLI usage.
- Phase 9 (MCP server): IMPLEMENTATION-PLAN § Phase 9 — stdio transport, 7 tools.

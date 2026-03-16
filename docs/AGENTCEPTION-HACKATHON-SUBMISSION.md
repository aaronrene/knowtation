# AgentCeption + Knowtation — Hackathon Submission (March 2026)

**One-line:** Knowtation is a token-efficient knowledge layer for [AgentCeption](https://github.com/cgcardona/agentception): one shared vault for precision and cohesion, search by meaning plus a two-step fetch (light results first, then full notes only when needed) so agents get the right slice of context, and write-back so the org’s understanding accumulates over time without blowing context windows or cost.

---

## Problem

AgentCeption turns a brain dump into a PlanSpec, GitHub issues, and an agent org (CTO → coordinators → engineers) that work in worktrees and open PRs. Those agents need **context** (specs, decisions, phase summaries) and **memory** (where to read from and write back). Naive retrieval—dumping full notes or huge result sets into every call—wastes tokens and budget and can hit context limits.

## Solution

**Knowtation** is a personal/team knowledge vault (Markdown, search by meaning, imports, capture). It plugs into AgentCeption as an optional context and memory layer:

- **One shared vault** (`KNOWTATION_VAULT_PATH`) for planner, coordinators, and engineers.
- **CLI** for worktree agents (no MCP): `search`, `list-notes`, `get-note`, `write` with `--json`.
- **MCP** for orchestrator/CTO in Cursor/Claude: same tools in-process.
- **Two-step fetch**: narrow scope → light response first (paths or short snippets) → fetch full content only for the 1–2 notes that matter.

No vendor lock; vault stays in your repo or your infra.

---

## Why it matters: precision, cohesion, and understanding

Cost and token savings are only part of the story. The crucial gains are **precision**, **cohesion**, and **understanding over time**—so the org and its agents stay aligned and answers stay sharp.

- **Precision** — Volume is not the same as relevance. Dumping full history or huge result sets into the context window often *hurts*: word overlap is not real relevance, and the wrong material leads to confident but wrong answers. Knowtation treats **fetching as a core problem**: search by meaning plus scope (project, tag, time, optional causal chain) so agents get a **small, relevant subset** that matches intent. A two-step fetch—paths or snippets first, full content only when needed—keeps answers sharp and avoids noise.

- **Cohesion** — AgentCeption’s planner, coordinators, and engineers all need the same picture: what was decided, what the spec says, what phase we’re in. Without a shared place, each agent (or each run) rebuilds context from different sources and the org drifts. Knowtation gives **one shared vault** and a **single source of truth**: specs, decisions, and phase summaries live in Markdown you control; every agent reads and writes the same notation. That shared, lasting coherence is what makes the org’s output consistent and auditable.

- **Understanding over time** — Agents often lack intention (why something was done) and an **overarching view over time**. Knowtation supports **time-bounded** and **chain-aware** retrieval (`--since`, `--until`, optional `--chain`, `--entity`) so the system can answer “what preceded this?” and “what did we decide about X in this window?” without treating the vault as one undifferentiated pile. Decisions and rationale stay queryable; the org accumulates understanding instead of losing it across phases.

Together: **precise fetch** (right slice, not volume), **cohesive context** (one vault, same understanding across agents), and **time-aware retrieval** (decisions and history queryable) are what make the integration valuable—on top of the token and cost savings below.

---

## How to hook up

### Orchestrator / CTO (MCP)

1. Run `knowtation mcp` or add the Knowtation MCP server to your Cursor/Claude config.
2. Set `KNOWTATION_VAULT_PATH` to the shared vault directory.
3. Use tools: `search`, `get_note`, `list_notes`, `write`, etc.

### Engineer agents (CLI in worktrees)

Install Knowtation where the agent runs; set `KNOWTATION_VAULT_PATH`. Example:

```bash
# Cheap: get paths only, then fetch one note
knowtation search "auth flow decisions" --project myapp --limit 3 --fields path --json
knowtation get-note vault/projects/myapp/decisions/auth.md --json

# Write phase summary back
echo "Phase 1: Implemented auth module." | knowtation write vault/projects/myapp/decisions/phase-1.md --stdin --frontmatter source=agentception project=myapp
```

Bridge script for piping from agent workflows:

```bash
echo "Phase 1 summary: ..." | ./scripts/write-to-vault.sh vault/projects/myapp/decisions/phase-1.md --source agentception --project myapp
```

---

## Cost savings: standard vs refined retrieval

We compare two patterns on the same vault:

| Strategy | What it does | Typical effect |
|----------|--------------|----------------|
| **Standard** | List/search with full metadata (or path+snippet), limit 10; then `get-note` for up to 5 paths. | Large payload: many paths + metadata + 5 full note bodies. |
| **Refined** | List/search with `--fields path`, limit 3; then `get-note` for **1** path only. | Small payload: 3 paths + 1 full note. |

You can reproduce the numbers with the demo script (from repo root, vault at `./vault` or `KNOWTATION_VAULT_PATH`):

```bash
node scripts/retrieval-cost-demo.mjs project
```

**Example output** (this repo’s vault, 7 notes):

```
Retrieval cost demo: Standard vs Refined
Query: "project"

Strategy              | Chars  | Est. tokens (÷4) | Est. cost @ $0.50/1M
----------------------|--------|------------------|----------------------
Standard (10+metadata, 5 get-note) |   2038 |              510 | $0.0003
Refined (3 path, 1 get-note)   |    370 |               93 | $0.0000

Token reduction: 82% (refined vs standard).

Standard = list-notes --limit 10 (path+metadata) + get-note for up to 5 paths.
Refined  = list-notes --limit 3 --fields path + get-note for 1 path.
```

So in this run, **refined retrieval uses ~82% fewer tokens** than the standard pattern. With search-by-meaning (vector index) the same idea applies: `search --limit 5 --fields path` then `get-note` for 1–2 paths keeps cost down as the vault grows.

Token estimate is chars÷4; cost uses $0.50/1M input tokens as a conservative proxy. Your mileage varies with model and vault size; the important point is that **the two-step pattern (paths/snippets first, full fetch only when needed) materially reduces tokens and cost**.

---

## What was built

- **CLI + MCP** — Agents call Knowtation via `knowtation` CLI or MCP tools.
- **Token levers** — `--limit`, `--fields path|path+snippet|full`, `--count-only`, `--snippet-chars`, `--body-only` / `--frontmatter-only` on `get-note`.
- **Write-back** — Phase summaries and decisions written to the vault with frontmatter (`source=agentception`, `project`, etc.) for traceability.
- **Bridge script** — `scripts/write-to-vault.sh` for piping from agent workflows.
- **Retrieval cost demo** — `scripts/retrieval-cost-demo.mjs` compares standard vs refined retrieval and reports chars, estimated tokens, and cost proxy.

For implementation details, integration paths, and references, see [AGENTCEPTION-HACKATHON.md](./AGENTCEPTION-HACKATHON.md) (dev doc).

---

## References

| Doc | Role |
|-----|------|
| [AGENTCEPTION-HACKATHON.md](./AGENTCEPTION-HACKATHON.md) | Full integration guide (MCP, CLI, Hub API, workflow, references) |
| [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md) | Token levers, two-step fetch pattern, CLI options |
| [AgentCeption](https://github.com/cgcardona/agentception) | AgentCeption repo |

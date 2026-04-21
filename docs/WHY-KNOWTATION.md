# Why Knowtation — differentiation, humans + agents, and honest comparisons

**Audience:** Product, marketing, and builders aligning the **public site**, **Hub wizard**, and **docs** with what Knowtation actually ships. **Companion:** implementation checklist [HUB-WIZARD-HOSTED-STORY.md](./HUB-WIZARD-HOSTED-STORY.md).

---

## One-sentence positioning (accurate)

**Vault + retrieval:** Your **owned**, **indexed** notes with optional **time, chains, episodes, and entities**, plus a deep **MCP** surface for assistants that support it — a **root** knowledge stack (**semantic search**, **proposals and review**, **roles and scoped vaults**, **memory and consolidation**, optional **causal / temporal** structure), not only trimming **chat or terminal tokens**.

**Human gate:** **Agents suggest; humans approve** — proposals stay out of the canonical vault until your team applies governance (roles, rubric evaluation, optional review hints).

---

## What sets Knowtation apart (provable, not “nobody else”)

Prefer **“uncommon in one product”** over absolute claims. These capabilities are **documented in this repo**:

| User-visible idea | Technical / product surface | Primary docs |
|-------------------|------------------------------|--------------|
| Decision trails over time | Optional frontmatter: `causal_chain_id`, `follows`, date filters on search/list | [INTENTION-AND-TEMPORAL.md](./INTENTION-AND-TEMPORAL.md) |
| Episodes and entities | `episode_id`, `entity` filters | Same |
| Long-horizon compression | `state_snapshot`, `summarizes`, `summarizes_range` | [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md), [SPEC.md](./SPEC.md) |
| Graph-style agent helpers | MCP tools: `relate`, `backlinks`, `cluster`, `tag_suggest`, `extract_tasks` | [PARITY-MATRIX-HOSTED.md](./PARITY-MATRIX-HOSTED.md), [HOSTED-MCP-TOOL-EXPANSION.md](./HOSTED-MCP-TOOL-EXPANSION.md) |
| Structured agent workflows | Hosted MCP **prompts** (e.g. `temporal-summary`, `causal-chain`, `memory-context`, `resume-session`) | Parity matrix § MCP prompts |
| Team-scoped agent memory | Bridge `/api/v1/memory*`, Hub consolidation, B3-style prompts | Parity matrix § Agent memory |
| Governed writes | **Proposals** lifecycle, evaluation, approve/discard | [PROPOSAL-LIFECYCLE.md](./PROPOSAL-LIFECYCLE.md), [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) §4 |
| Imports from common stacks | OpenAI, Anthropic, OpenClaw, Supabase, … | [IMPORT-SOURCES.md](./IMPORT-SOURCES.md) |

---

## Proposals — simple vs technical

### Plain language

- **What:** A suggested change to a note that is **not** the real vault until someone **approves** it.
- **Where:** Hub **Suggested** / **Activity**, **Propose change** on a note, or **Hub API / MCP** (`POST /api/v1/proposals`).
- **When:** Whenever you want **agent speed** without **silent overwrites** of canonical knowledge.
- **Why orgs care:** **Audit trail**, **roles** (viewer / editor / evaluator / admin), **rubric evaluations**, optional **LLM review hints** (hints assist humans; they are not auto-approval). See [HUB-PROPOSAL-LLM-FEATURES.md](./HUB-PROPOSAL-LLM-FEATURES.md).

### Technical

| Step | Mechanism |
|------|-----------|
| Create | `POST /api/v1/proposals`; policy modules set review metadata ([PROPOSAL-LIFECYCLE.md](./PROPOSAL-LIFECYCLE.md)). |
| Review | `GET /proposals` with filters; `POST /proposals/:id/evaluation` against rubric. |
| Apply | `POST /proposals/:id/approve` writes vault; `discard` rejects. |

**Sample copy (marketing / wizard):**

- *Agents suggest. Humans approve.*
- *Proposals stay out of your canonical vault until your team says yes — with optional rubrics, flags, and review hints.*
- *Same AI speed — with a paper trail and a human gate.*

---

## Two layers of “token savings” (say both honestly)

| Layer | Plain | Knowtation’s role |
|-------|--------|-------------------|
| **Vault / retrieval** | Stop re-pasting; search **snippets** with limits | `search`, filters, `snippet-chars`, MCP discipline — [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md) |
| **Terminal tool output** | Shrink **command logs** before the model reads them | **Not** the core vault product; optional **local** add-ons on the coding host; document, do not imply the canister runs shell hooks |

---

## Glossary / “depth words” on the website

Prefer **tag chips** or a **short two-column glossary** over a dense **word cloud** (accessibility, mobile, translation). **Decorative word-cloud graphics** are optional later polish ([HUB-WIZARD-HOSTED-STORY.md](./HUB-WIZARD-HOSTED-STORY.md)).

**Chip set (keep in sync in `web/index.html` — hero fold + main block):** semantic search, keyword search, causal chain, episode, entity, snapshot, summarises, consolidate, discover, evaluate, propose, approve, MCP prompt, wikilink, memory event, temporal summary, resume session, knowledge gap, capture, import, rubric, scoped access, multi-vault, transcribe, attestation, indexed vault, relate, cluster, tag suggest, enrich, extract tasks.

---

## Messaging order on the landing page

1. **Hero fold** — collapsed `<details>` (“Structured memory…”) under main CTAs so the top stays clean.  
2. **Hero + video + spotlights** — unchanged flow.  
3. **Band A (full)** — same structured-memory content **after Ecosystem visions**, before “Control, customize…”.  
4. **Band B — Easy start** — three steps after the hero and GitHub badge, before deploy headlines on [`web/index.html`](../web/index.html) (note/import → add agents → ask your AI); see [HUB-WIZARD-HOSTED-STORY.md](./HUB-WIZARD-HOSTED-STORY.md).

---

## Related

- [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) — MCP, Hub API, proposals.  
- [AI-ASSISTED-SETUP.md](./AI-ASSISTED-SETUP.md) — phased copy-paste setup (refresh for hosted + wizard links on branch work).  
- [UX-SIMPLICITY-REFERENCE-RESEARCH.md](./UX-SIMPLICITY-REFERENCE-RESEARCH.md) — optional research companion (generic pattern names for tool-output compaction vs session continuity, non-goals).

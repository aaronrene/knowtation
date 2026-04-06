# Token savings — how Knowtation reduces context and API cost

Knowtation’s original design goal is to give agents **the right information with fewer tokens**. This document is the **entry point**; deeper detail lives in linked docs.

## Three levers (use together)

### 1. Compress memory (consolidation)

Activity in your vault is recorded as **memory events**. Over time they pile up. **Consolidation** groups recent events by **topic** and calls the model **once per topic** (for topics with at least two events) to merge duplicates into a short list of **facts**, stored as consolidation events.

- **Consolidate** — merge / dedupe (uses the LLM).
- **Verify** — check paths in events against the vault (filesystem only; **no** extra LLM).
- **Discover** (optional) — after facts exist, **one more LLM call** reads those topic summaries and writes **insight** events (connections, contradictions, open questions across topics).

Defaults: **Consolidate + Verify on**, **Discover off**. See [MEMORY-CONSOLIDATION-GUIDE.md](./MEMORY-CONSOLIDATION-GUIDE.md) and [DAEMON-CONSOLIDATION-SPEC.md](./DAEMON-CONSOLIDATION-SPEC.md).

### 2. Tiered retrieval (search → open one note)

Instead of dumping large context into the model, **search narrowly** (small limit, paths or short snippets), then **`get-note`** only for the one or two paths that matter. CLI flags: `--fields`, `--snippet-chars`, `--count-only`, `--body-only`, etc. See [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md) and [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md).

### 3. Pick the right surface

- **CLI** — full flag set; best for scripts and containers.
- **MCP** — same operations in Cursor / Claude Code; use `fields`, `snippet_chars`, `count_only` on **search** where available.
- **Hub** — hosted consolidation and billing; self-hosted Hub can edit daemon settings into `config/local.yaml`.

## Discover pass — behavior, billing, recommendation

| Question | Answer |
|----------|--------|
| What changes when Discover is on? | You also get **insight** events (cross-topic). With it off, you only get per-topic facts + verify. |
| Hosted default | **Off** (`consolidation_passes.discover` defaults to `false` in billing records). |
| Self-hosted default | **Off** unless `daemon.passes.discover: true` in YAML. |
| Recommendation | **Leave off** unless you want cross-topic synthesis; it adds **one LLM call per run** when consolidate produced topics. |
| Hosted billing | **One** `POST /memory/consolidate` = **one** pass toward your monthly allowance and **one** consolidation line item (`COST_CENTS.consolidation` when billing is enforced). Discover runs **inside** that request — **not** a second pass count. Extra tokens are **infrastructure cost** to the operator. Pricing may be revisited later if usage grows. |

## Advanced consolidation knobs (cost / scope)

These limit how much work each run does:

| Knob | Role | Typical default |
|------|------|-----------------|
| `lookback_hours` | How far back to read events | 24 |
| `max_events_per_pass` | Cap events read | 200 |
| `max_topics_per_pass` | Cap topics sent to the LLM | 10 |
| `daemon.llm.max_tokens` | Cap model output tokens per call | 1024 |

**Self-hosted:** Set in `config/local.yaml` under `daemon:` or via **Hub → Settings → Consolidation → Advanced** (writes YAML through the Hub API).

**Hosted:** Stored on the user record in the billing DB when implemented; the scheduler sends them in the consolidate request body so the bridge applies them.

## Privacy: consolidation and `memory.encrypt`

- **At-rest encryption** protects data on disk when using the encrypted memory provider.
- **Consolidation** still builds **prompts** for the model. When **`memory.encrypt` is true** (self-hosted: `config/local.yaml` → `memory.encrypt: true`; hosted bridge: env **`CONSOLIDATION_MEMORY_ENCRYPT=true`**), Knowtation uses **encrypt-aware consolidate redaction** in `buildConsolidationPrompt` (`lib/memory-consolidate.mjs`): each event line is `[ts] type (event payload omitted — encrypted memory mode)` — **no** `JSON.stringify(data)` is sent. Merge quality may be lower than when snippets are sent.

When encrypt is **false**, prompts include **truncated JSON** from each event’s `data` (up to 300 characters per event). That is **not** your full note files as a single upload, but **may include short text fragments** captured in activity.

**Stronger options:** self-hosted **Ollama**, turn consolidation **off**, or keep **Discover** off to reduce calls.

## Related docs

- [MEMORY-CONSOLIDATION-GUIDE.md](./MEMORY-CONSOLIDATION-GUIDE.md) — daemon config, CLI, passes.
- [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md) — retrieval flags.
- [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) — CLI vs MCP vs Hub.
- [WHITEPAPER.md](./WHITEPAPER.md) — product thesis and tiered retrieval.
- [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md) — hosted metering (overview).

## Implementation phases (repo work)

Work on branch `feature/token-savings` (or main after merge).

| Phase | Scope | Status | Suggested session |
|-------|--------|--------|-------------------|
| **A0** | This doc + [README](../README.md) + [docs/README](./README.md) links | **Done** | — |
| **A1** | Hub copy (How to use, Settings, Integrations) + privacy paragraph | **Done** (Hub `index.html` + `hub.js`; payload `mode` + hosted schedule sync) | — |
| **B** | `buildConsolidationPrompt` encrypt redaction + tests + bridge env `CONSOLIDATION_MEMORY_ENCRYPT` | **Done** | `lib/memory-consolidate.mjs`, `hub/bridge/server.mjs`, `test/memory-consolidate.test.mjs` |
| **C** | Self-hosted Advanced (YAML + GET/POST + UI + `consolidation-ui-logic`) | **Done** | — |
| **D** | Hosted Advanced (billing + gateway + scheduler + bridge body) | Pending | **Dedicated chat; stronger review** |
| **E** | Hosted MCP `search`: POST + parity fields | Pending | Dedicated chat |
| **F** | Pre-launch security/privacy review | Pending | Human or strongest model |

Use a **stronger reasoning model or human review** for **Phase D** (billing correctness), **Phase E** (API contract), and **Phase F** (compliance-style copy).

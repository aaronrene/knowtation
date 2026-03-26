# Intention and Temporal Understanding

Agents often lack **intention** (why something was done) and an **overarching understanding of what’s happening over time** — temporal sequence, causation, and long-horizon context. This document specifies how Knowtation addresses these gaps in a **simple, user-friendly** way using the tech we have, and structures the design **now** so we don’t backtrack later.

---

## 1. Goals (what we’re solving for)

| Goal | Meaning | Why it matters |
|------|--------|----------------|
| **Temporal sequence with causation** | Chains of decisions and events over weeks or months; “A led to B led to C.” | Agents need to answer “what led to this?” and “what happened after that?” |
| **Relational queries across time** | Find notes by entity, project, or causal chain within a date range. | Hybrid of semantic search + structured filters (we already have project/tag; we add time and optional chain/entity). |
| **Structured indexing** | Metadata (path, project, tags, date, optionally entity, causal_chain_id) in the index. | We have path/project/tags; we extend with optional time and causal/entity dimensions. |
| **Entities and causal chains over time** | Track which entities (people, projects, concepts) appear in which notes, and how notes link in a causal chain. | Enables “all decisions about X” or “the chain that led to outcome Y.” |
| **Hierarchical memory at multiple granularity levels** | Chunk → note → episode/session → project. | Agents can reason at the right level (detail vs. summary). |
| **Temporal state tracking** | State at a point in time (snapshot or summary). | Supports “what did we know then?” for long-horizon context. |
| **State space compression** | Summarize or compress old context so we don’t blow context windows. | Optional summary notes or memory-layer compression for long ranges. |
| **Evals** | Way to measure “did we retrieve the right chain?” / “did we preserve causal order?” | No evals today in many systems; we reserve schema and tooling so we can add evals and improve. |

---

## 2. Minimal schema extensions (optional frontmatter)

All of these are **optional**. Notes work without them; when present, they enable temporal and causal features.

| Field | Type | Description |
|-------|------|-------------|
| `date` | ISO 8601 or YYYY-MM-DD | Already in common schema. Used for time-bounded queries. |
| `updated` | ISO 8601 or YYYY-MM-DD | Already in common schema. |
| `follows` | string (path) or string[] | Vault-relative path(s) of note(s) this one follows (causally or sequentially). Enables “chain of decisions.” |
| `causal_chain_id` | string | Optional id grouping notes that belong to the same causal chain. Query by chain. |
| `entity` | string or string[] | Optional entity labels (person, project, concept) for relational queries. |
| `episode_id` | string | Optional id grouping notes into a higher-level “episode” or session (hierarchical memory). |
| `summarizes` | string (path) or string[] | Optional: this note summarizes the given note(s) or time range. For state space compression. |
| `summarizes_range` | string | Optional: e.g. `2025-01/2025-03` for “this note summarizes that range.” |
| `state_snapshot` | boolean | Optional: if true, this note is a state snapshot at a point in time (for temporal state tracking). |

**Normalization:** `entity` and `causal_chain_id` use the same slug rules as project/tag (lowercase, `a-z0-9`, hyphen). No required new fields; existing notes remain valid.

---

## 3. Minimal CLI / API extensions

- **Time-bounded search and list:** `--since <date>`, `--until <date>` (ISO 8601 or YYYY-MM-DD). Filter results to notes within that range. Implemented as metadata filter in vector store or post-filter on `date`/`updated`.
- **Causal chain filter:** `--chain <causal_chain_id>`. Return only notes in that chain. Optional.
- **Entity filter:** `--entity <entity>`. Return only notes that mention or are tagged with that entity. Optional (can be implemented as tag or dedicated field).
- **Ordering:** When returning lists or search results that span time, support `--order date` (default: newest first) or `--order date-asc` so agents can get chronological or reverse-chronological order.

No breaking changes: all new flags are optional. Existing `search` and `list-notes` behave as today when these are omitted.

---

## 4. Hierarchical memory (multiple granularity levels)

- **Chunk level:** Already have (indexer chunks notes). Metadata: path, project, tags, date.
- **Note level:** Already have (get-note, list-notes). One note = one unit.
- **Episode / session level:** Optional. Notes can carry `episode_id` to group them (e.g. “planning session 2025-03” or “project kickoff”). List or search can filter by `--episode <id>` when we add it. No required new folders; episodes are logical groups via frontmatter.
- **Project level:** Already have (project slug, folder, `--project` filter).

So hierarchical memory is: **project → episode (optional) → note → chunk**. We add optional `episode_id` and `--episode` when we implement; spec reserves them.

---

## 5. Temporal state tracking

- **State at a point in time:** A note with `state_snapshot: true` and a `date` (and optional `summarizes` or `summarizes_range`) represents “state at that time” or “summary of that period.” Agents can retrieve the latest state snapshot before a date, or a summary for a range, to get “what did we know then?” without loading every note.
- **Implementation:** Optional. Phase 2 indexer can index these; search can support “return state snapshots” or “return summary for range” as a future filter. Schema is specified now so we don’t retrofit later.

---

## 6. State space compression (long-horizon context)

- **Problem:** Long time horizons blow context windows if we dump every note.
- **Approach:** (1) Optional **summary notes** — a note with `summarizes: [path1, path2]` or `summarizes_range: 2025-01/2025-03` compresses that content. (2) Optional **memory layer** (Mem0, etc.) that does compression; we already have a memory hook. (3) Indexer can optionally build “summary” or “compressed” chunks for long periods.
- **Spec now:** Frontmatter `summarizes` and `summarizes_range` are defined. Implementation (who writes summary notes, or how memory layer compresses) is a later phase; schema is stable.

---

## 7. Evals (evaluations)

- **Goal:** Measure retrieval quality and causal/temporal correctness (e.g. “for this query, we should get this chain of notes in this order”).
- **Reserved:** (1) **Eval set format** — e.g. a file or list of `{ "query": "...", "expected_paths": ["path1", "path2"], "expected_chain_id": "..." }` or similar. (2) **CLI or script** — e.g. `knowtation eval <eval-set>` that runs queries, compares to expected, reports precision/recall or chain accuracy. Exact format and command are TBD; the **concept and a placeholder command** are reserved so we can add evals without redesign.
- **Placeholder in spec:** “Optional: `knowtation eval` — run evaluation set against search/list; report metrics. Eval set format TBD; see docs/INTENTION-AND-TEMPORAL.md.”
- **Import vs retrieval:** Golden tests for importer output (frontmatter/body) are **separate** from retrieval evals; see [IMPORT-EVALS.md](./IMPORT-EVALS.md).

---

## 8. Implementation approach (simple and user-friendly)

- **Phase 1–3 (current):** No change. Foundation, indexer, search with existing metadata (path, project, tags). Add `date` to indexer metadata if not already (for time-bounded filter).
- **Phase 3.1 or 4.1 (small):** Add `--since`, `--until` to search and list-notes. Indexer already stores date when present. Minimal UX: “filter by date range.”
- **Optional phase (temporal/causal):** Add optional frontmatter (`follows`, `causal_chain_id`, `entity`, `episode_id`, `summarizes`, `summarizes_range`, `state_snapshot`) to SPEC; indexer stores them in metadata; search and list-notes get `--chain`, `--entity`, `--episode`, `--order`. Optional summary/state retrieval (e.g. “get latest state_snapshot before date”) can be a later subcommand or filter.
- **Evals:** Reserved command and doc; implementation when we’re ready to add eval sets.

User-facing: **time range** and **optional chain/entity** are the main knobs. Hierarchical memory is “project + optional episode”; state compression is “optional summary notes or memory layer.” No heavy new concepts — just optional fields and filters.

---

## 9. Summary

| Area | Spec now | Implement |
|------|----------|-----------|
| Time-bounded queries | `--since`, `--until` in CLI spec | Phase 3 or 4 |
| Causal chain | Optional `follows`, `causal_chain_id`; `--chain` filter | Optional phase |
| Entity | Optional `entity`; `--entity` filter | Optional phase |
| Hierarchical memory | Optional `episode_id`; `--episode`; project already exists | Optional phase |
| State snapshot | Optional `state_snapshot`, `summarizes`, `summarizes_range` | Optional phase |
| State space compression | Summary notes or memory layer; schema in spec | Optional phase |
| Evals | Reserved `knowtation eval`; eval set format TBD | When ready |

This keeps the core simple, avoids backtracking, and gives agents intention and temporal/causal structure where you opt in.

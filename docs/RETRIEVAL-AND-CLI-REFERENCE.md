# Retrieval, Token Cost, and CLI Reference

This document (1) lists **all CLI commands and optional features**, (2) explains **how they interact** to reduce retrieval scope and token cost, (3) shows **how each feature helps the retrieval bottleneck**, and (4) suggests **expansions** so agents get the right information at the best price token-wise.

---

## 1. The retrieval bottleneck and token cost

**Problem:** Agents that pull in 2000+ tokens for a simple question waste cost and context. The bottleneck is often **over-retrieval** — no way to be specific, so the system returns too much.

**Approach:** Be **specific** about what the agent wants (filters, time, scope) and **control how much** comes back (limit, snippet size, fields only). Then the agent can do **tiered retrieval**: cheap query first (paths or count), then fetch full content only for what’s needed.

---

## 2. All CLI commands (single reference)

| Command | Purpose | Key flags |
|--------|--------|-----------|
| **search** \<query\> | **Semantic** search over the indexed vault (default), or **keyword** search with `--keyword` (literal text: path, body, key frontmatter; no index required). | Same filters as list-notes: `--folder`, `--project`, `--tag`, `--since`, `--until`, `--chain`, `--entity`, `--episode`, `--content-scope` (`all` \| `notes` \| `approval_logs`), `--order`, `--limit` (default 10), `--fields`, `--snippet-chars`, `--count-only`, `--json`. **Keyword-only:** `--keyword`, `--match phrase` \| `all-terms`. JSON may include `"mode": "semantic"` \| `"keyword"`. |
| **list-notes** | List notes with filters (no semantic search). | `--folder`, `--project`, `--tag`, `--limit`, `--offset`, `--since`, `--until`, `--chain`, `--entity`, `--episode`, `--order`, `--fields`, `--count-only`, `--json` |
| **get-note** \<path\> | Return full content of one note (frontmatter + body), or subset. | `--body-only`, `--frontmatter-only`, `--json` |
| **index** | Re-run indexer: vault → chunk → embed → vector store. | (optional: `--json` for machine output) |
| **write** \<path\> [content] | Create or overwrite a note. | `--stdin`, `--frontmatter`, `--append`, `--json` |
| **export** \<path-or-query\> \<output\> | Export note(s) to a format/directory. | `--format`, `--project`, `--json` |
| **import** \<source-type\> \<input\> | Ingest from external platform (ChatGPT, Claude, etc.). | `--project`, `--output-dir`, `--tags`, `--dry-run`, `--json` |
| **doctor** | Check **self-hosted** vault path (config load, disk readable) and optional **Hub** probes (`KNOWTATION_HUB_URL` health; `KNOWTATION_HUB_TOKEN` + `KNOWTATION_HUB_VAULT_ID` → `GET /api/v1/notes?limit=1`). Prints token discipline context from [TOKEN-SAVINGS.md](./TOKEN-SAVINGS.md). | `--json`, `--hub <url>` |

**Global:** All commands support `--json` for machine-readable output.

---

## 3. Add-on / optional features (and where they plug in)

| Feature | Where it plugs in | What it does for retrieval / tokens |
|--------|--------------------|--------------------------------------|
| **Project / tag / folder filters** | `search`, `list-notes` | Shrink scope to one project, tag, or folder → fewer results, fewer tokens. |
| **Time filters** (`--since`, `--until`) | `search`, `list-notes` | Restrict to a date range → only relevant period, fewer tokens. |
| **Causal / entity / episode** (`--chain`, `--entity`, `--episode`) | `search`, `list-notes` | Return only one chain, entity, or episode → precise set, fewer tokens. |
| **Limit and offset** (`--limit`, `--offset`) | `search`, `list-notes` | Cap how many items return; paginate. Direct token control. |
| **Order** (`--order date \| date-asc`) | `search`, `list-notes` | Get “newest first” or “oldest first” without over-fetching. |
| **Optional memory layer** (Mem0, etc.) | After search/export | Store “last query + result set” or provenance; agent can ask memory for “last run” instead of re-querying. Saves repeat retrieval. |
| **Optional AIR** | Before write/export | Attestation only; no direct token impact on retrieval. |
| **Proposals** | Hub / propose flow | Proposals live outside main vault until committed; agent can list/diff proposals without loading full vault. |
| **Summary notes / state snapshots** | Vault content + filters | Notes with `summarizes` or `state_snapshot` compress a range; agent retrieves one summary instead of many notes. Big token saving for long horizons. |
| **Optional hub API** (shared vault / hub) | Same as CLI | Same filters and limits; same token benefits. |

---

## 4. How they work together (interaction)

```
Agent needs an answer
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. NARROW SCOPE (filters)                                        │
│    search / list-notes with --project, --tag, --since, --until,   │
│    --chain, --entity, --episode, --limit                         │
│    → Fewer candidates → fewer tokens in the response.            │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. CHEAP FIRST (paths or count)                                  │
│    list-notes --limit 5 --json  → get 5 paths + metadata only    │
│    or search with --limit 3 --json → get 3 path + snippet        │
│    → Agent decides from paths/snippets whether to fetch full.     │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. FETCH ONLY WHAT’S NEEDED                                      │
│    get-note <path>  only for the 1–2 paths that matter            │
│    → Full body only where necessary → minimal tokens.            │
└─────────────────────────────────────────────────────────────────┘
```

**Typical flows:**

- **“What did we decide about X?”** → `search "decisions about X" --entity X --limit 5 --json` → then `get-note` for the top 1–2 paths. Filters + limit + delayed full fetch = low tokens.
- **“What happened in March?”** → `list-notes --since 2025-03-01 --until 2025-03-31 --limit 20 --json` → then `get-note` for selected paths. Time + limit = bounded tokens.
- **“What’s the chain that led to Y?”** → `search "outcome Y" --chain chain-id --order date-asc --limit 10 --json` → then `get-note` for the chain. One chain, ordered, minimal fetch.

---

## 5. How each feature helps the bottleneck (and token cost)

| Feature | Bottleneck it eases | Token effect |
|--------|---------------------|--------------|
| **--project, --tag, --folder** | Reduces candidate set to a subset of the vault. | Fewer results → smaller JSON → less in context. |
| **--since, --until** | Restricts to a time window; no need to scan all time. | Same as above; especially strong for long-lived vaults. |
| **--chain, --entity, --episode** | Returns only one causal chain, entity, or episode. | One logical set instead of many unrelated notes. |
| **--limit** | Hard cap on number of items returned. | Direct: 5 results ≈ 5× (snippet or path) size; 50 results ≈ 10× more tokens. |
| **--offset** | Pagination; agent can ask for “next page” instead of “everything.” | Avoids one huge response. |
| **--order** | Get “newest” or “oldest” first without fetching extra. | Agent can stop after first page when order is meaningful. |
| **Snippet in search** | Return a short snippet per hit, not full body. | Snippet << full note; agent uses snippet to choose which path to get-note. |
| **list-notes (no body)** | Returns path + metadata only, no body. | Very small per note; agent then get-note only for chosen paths. |
| **Summary notes / state_snapshot** | One note summarizes many or a range. | Retrieve 1 summary instead of N notes → large token saving. |
| **Memory layer** | “Last query + result” or “provenance for export” stored. | Agent can ask memory “what did we last retrieve?” instead of re-running search. |

---

## 6. Token-optimal retrieval (in spec)

The following are **in scope** and specified in SPEC §4.1–4.2.

| Expansion | What it does | Token impact |
|-----------|--------------|--------------|
| **--fields** for search/list-notes | Control what each result contains: `path` only, `path+snippet` (search) or `path+metadata` (list-notes), or `full`. | `--fields path` → minimal payload; agent then get-note only for chosen paths. |
| **--snippet-chars** | Cap snippet length (e.g. 200 chars) for search. | Shorter snippets → smaller search output. |
| **--count-only** for search and list-notes | Return only total count (and optionally first N paths); no snippets or bodies. | Agent asks “how many?” first, then decides whether to run a full search with limit. |
| **Tiered retrieval in SKILL / docs** | Document pattern: (1) list-notes or search with small limit + --json, (2) from paths/snippets pick 1–2, (3) get-note only those. | Teaches agents to use minimal tokens by design. |
| **--body-only / --frontmatter-only** (get-note) | Return only body or only frontmatter for one note. | Saves tokens when the other part is large. |
| **Prefer state_snapshot / summarizes** | When present, search or a dedicated “get summary for range” returns summary notes first. | One summary in context instead of many raw notes (optional/future). |

**Spec (SPEC §4.1–4.2):**

- **search:** `--fields path|path+snippet|full` (default path+snippet). `--snippet-chars <n>`. `--count-only` → `{ "count": n, "query": "..." }`. **`--keyword`** → literal text search; JSON includes `"mode": "keyword"` (and `"mode": "semantic"` when using the default path in Hub/repo CLI).
- **list-notes:** `--fields path|path+metadata|full` (default path+metadata). `--count-only` → `{ "total": number }`.
- **get-note:** `--body-only` or `--frontmatter-only` for a single note; omit both for full content.

---

## 7. Single table: commands + filters + token levers

| Command | Scope filters | Order / limit | Token levers (current) | Token levers (in spec) |
|--------|----------------|---------------|------------------------|--------------------------|
| **search** | folder, project, tag, since, until, chain, entity, episode | limit, order | limit, snippet in JSON | **In spec:** --fields, --snippet-chars, --count-only |
| **list-notes** | folder, project, tag, since, until, chain, entity, episode | limit, offset, order | limit, offset, no body | **In spec:** --fields, --count-only |
| **get-note** | (one path) | — | — | **In spec:** --body-only, --frontmatter-only |
| **index** | — | — | — | — |
| **write** | — | — | — | — |
| **export** | project | — | — | — |
| **import** | project, output-dir, tags | — | — | — |

---

## 8. Summary

- **All commands:** search, list-notes, get-note, index, write, export, import. Filters (project, tag, folder, since, until, chain, entity, episode) and limit/offset/order apply to search and list-notes.
- **Add-ons:** Project/tag/time/chain/entity/episode filters, limit/offset, order, optional memory, summary notes/state snapshots, hub API. Each either narrows scope or reduces payload size.
- **Interaction:** Narrow with filters → cheap first (paths or count) → get-note only for selected paths. That pattern minimizes tokens.
- **Token levers (in spec):** `--fields`, `--snippet-chars`, `--count-only` for search/list-notes; `--body-only`/`--frontmatter-only` for get-note; tiered retrieval documented in SKILL. These give agents the knobs to get the right information at the best price token-wise.

# Knowtation — Full Implementation Plan

This document lays out **all phases** to build Knowtation end-to-end. Nothing is left "for later" as unspecified work: every feature in the [SPEC](./SPEC.md), [ARCHITECTURE](../ARCHITECTURE.md), and [IMPORT-SOURCES](./IMPORT-SOURCES.md) is assigned to a phase and will be implemented. Phases are ordered by dependency; each phase produces testable, shippable increments.

**Reference:** [SPEC.md](./SPEC.md) (data formats, CLI, config), [IMPORT-SOURCES.md](./IMPORT-SOURCES.md) (import source types and formats), [ARCHITECTURE.md](../ARCHITECTURE.md) (high-level design).

**Monetization:** Core is open source. Optional paid layer: hosted “Knowtation Hub” (Phase 11) for users who do not want to self-host; they get shared vault, proposals, and review without running servers. See Phase 11.

**Build status (update at end of each session):** Phase 1 complete (committed). **Phase 2 complete (committed).** Next: Phase 3 (search).

---

## Phase 1 — Foundation: config, vault paths, and read-only CLI

**Goal:** Load config, resolve vault path, and implement read-only note access. No vector store yet.

**Deliverables:**

1. **Config loader** — Read `config/local.yaml`; override with env (`KNOWTATION_VAULT_PATH`, `QDRANT_URL`, `KNOWTATION_DATA_DIR`, etc.). Validate required `vault_path`. Support all keys in SPEC §4.4 (embedding, memory, air).
2. **Vault utilities** — List Markdown files under vault root; respect optional ignore list (e.g. `templates/`, `meta/`). Parse frontmatter (YAML) + body. Normalize project slug and tags (lowercase, `a-z0-9`, hyphen).
3. **CLI: `get-note`** — Read one note by vault-relative path; output raw or `--json` (frontmatter + body). Support `--body-only` and `--frontmatter-only` per SPEC §4.1–4.2. Exit 0/1/2 per SPEC.
4. **CLI: `list-notes`** — List notes with `--folder`, `--project`, `--tag`, `--limit`, `--offset`. Support `--fields path|path+metadata|full` and `--count-only` per SPEC §4.1–4.2. Filter by path and frontmatter. Output table or `--json` per SPEC §4.2. Order: by date (newest first) or path.
5. **CLI: error handling** — Usage errors → exit 1; missing file, invalid path → exit 2. With `--json`, error object `{ "error": "...", "code": "..." }`.

**Acceptance:** `knowtation get-note vault/inbox/foo.md`, `knowtation list-notes --folder vault/inbox --limit 5 --json` work against a test vault. No stubs.

---

## Phase 2 — Indexer: chunk, embed, vector store ✅

**Goal:** Walk vault, chunk Markdown, embed, store in Qdrant or sqlite-vec with metadata (path, project, tags). Idempotent upsert.

**Deliverables:**

1. **Chunking** — Split Markdown by heading or fixed size (e.g. 256–512 tokens); overlap configurable. Attach to each chunk: vault-relative path, project (from path or frontmatter), tags (array), date if present.
2. **Embedding** — Integrate one provider (e.g. Ollama `nomic-embed-text`) from config (`embedding.provider`, `embedding.model`). Optional: OpenAI or other; use env for API keys.
3. **Vector store** — Implement backend for **Qdrant** (collection with metadata filter support) and/or **sqlite-vec**. Store vectors + metadata; stable chunk id (path + chunk index or content hash) for upsert (no duplicates on re-run).
4. **Script / CLI: `index`** — Run indexer from `knowtation index` (or `node scripts/index-vault.mjs`). Read vault and config; write to configured store. Log progress; exit 0 on success, 2 on failure.
5. **Optional ignore** — Config or default ignore patterns (e.g. `templates/`, `meta/`) so those folders are not indexed.

**Acceptance:** After adding/editing notes, `knowtation index` runs without error. Vector store contains chunks with correct metadata. Re-run does not duplicate points.

**Implemented (Phase 2 session):**
- `lib/chunk.mjs`: Split by `##`/`###` then by configurable size/overlap; stable id `path_index`.
- `lib/embedding.mjs`: Ollama (default `nomic-embed-text`) and OpenAI (`OPENAI_API_KEY`); `embeddingDimension()` for collection creation.
- `lib/vector-store.mjs`: Qdrant only (`@qdrant/js-client-rest`); `ensureCollection(dimension)`, `upsert(points)`; point id = hash of chunk id for idempotent upsert.
- `lib/indexer.mjs`: `runIndex()` — list vault (with ignore), chunk, embed in batches, upsert; config `indexer.chunk_size` / `chunk_overlap`, `embedding` defaults in config.
- CLI `knowtation index` and `node scripts/index-vault.mjs` both call `runIndex()`; `--json` outputs `{ ok, notesProcessed, chunksIndexed }`.
- **sqlite-vec:** Not implemented; config `vector_store: qdrant` and `qdrant_url` required. Can be added in a later phase as a second backend.

---

## Phase 3 — Search

**Goal:** Semantic search over the index with filters; JSON output; exit codes.

**Deliverables:**

1. **CLI: `search`** — Query string; embed query with same model as indexer; search vector store. Filters: `--folder`, `--project`, `--tag` (metadata filter or post-filter). `--limit` (default 10). **Retrieval/token levers:** `--fields path|path+snippet|full` (default path+snippet), `--snippet-chars <n>`, `--count-only` per SPEC §4.1–4.2. Output: ranked list (path, snippet, score, project, tags) or reduced payload per `--fields`/`--count-only`. See docs/RETRIEVAL-AND-CLI-REFERENCE.md.
2. **Hybrid (optional)** — Keyword or BM25 alongside vector search; combine scores. Can be Phase 3.1 if time.
3. **JSON and errors** — `--json` outputs exact shape from SPEC §4.2 (including count-only and fields variants). Exit 0/1/2; JSON error object on failure when `--json`.

**Acceptance:** `knowtation search "community building" --project born-free --json` returns valid JSON. Unindexed vault or missing store → clear error and exit 2.

---

## Phase 4 — Write and export

**Goal:** Create/update notes from CLI; export to file or directory; provenance and AIR hook points.

**Deliverables:**

1. **CLI: `write`** — Create or overwrite note at vault-relative path. Options: `--stdin` (body from stdin), `--frontmatter k=v` (merge or set), `--append` (append body). Inbox and non-inbox. If AIR enabled and path outside inbox, call AIR hook before write; log AIR id.
2. **CLI: `export`** — Export one note or a set (by path or by query) to output path or directory. Formats: `md`, `html` (minimal). Record provenance (source_notes) in sidecar or frontmatter. If AIR enabled, attest before export; log AIR id.
3. **Provenance** — When exporting, store which vault paths were used (e.g. in a manifest or in export frontmatter). Optional: write to memory layer (Phase 8).
4. **Error handling** — Write/export failures (e.g. permission, disk full) → exit 2, JSON error when `--json`.

**Acceptance:** `knowtation write vault/inbox/new.md --stdin --frontmatter source=cli date=2026-03-13` creates the note. `knowtation export vault/projects/foo/note.md ./out/ --format md` produces file and provenance.

---

## Phase 5 — Capture: one reference message-interface plugin

**Goal:** Prove the message-interface contract with one working plugin (e.g. Slack or Discord webhook, or file-based ingest). Document contract; plugin writes to vault inbox with required frontmatter.

**Deliverables:**

1. **Contract doc** — Already in SPEC §3 and ARCHITECTURE; add a short **docs/CAPTURE-CONTRACT.md** (or section in SPEC) that plugin authors can follow (path, frontmatter, idempotency with `source_id`).
2. **Reference plugin** — One working plugin (e.g. Slack incoming webhook → HTTP server or script that writes one note per event to `vault/inbox/` or `vault/projects/<project>/inbox/` with `source`, `date`, `source_id`). Delivered as script in `scripts/capture-*` or `plugins/` with README.
3. **Optional: webhook server** — Small HTTP server that receives webhook payloads and writes notes (so user can point Slack/Discord at a URL). Config: port, vault path, optional project/tags.
4. **Docs** — README or docs update: how to run the reference plugin; how to add another (JIRA, Telegram, etc.) using the same contract.

**Acceptance:** Sending a test message to the webhook (or running the script with a test file) creates a note in the vault with correct frontmatter. Re-send with same `source_id` → idempotent (skip or update per design).

---

## Phase 6 — Import from external sources

**Goal:** Implement `knowtation import <source-type> <input>` for the source types in [IMPORT-SOURCES.md](./IMPORT-SOURCES.md). Each importer produces vault notes with our frontmatter.

**Deliverables:**

1. **CLI: `import`** — Subcommand `knowtation import <source-type> <input> [--project] [--output-dir] [--tags] [--dry-run] [--json]`. Exit 0/1/2; JSON summary when `--json`.
2. **Importers (in order of priority):**
   - **markdown** — Generic: path to file or folder; copy or symlink into vault; add `source: markdown`, `date` if missing. Optional frontmatter normalization.
   - **chatgpt-export** — Parse OpenAI export ZIP or folder with `conversations.json`; one note per conversation (or per thread); frontmatter: `source: chatgpt`, `source_id`, `date`, `title`.
   - **claude-export** — Parse Claude export (ZIP or folder); one note per conversation or memory entry; `source: claude`, `source_id`, `date`.
   - **audio** — Path to audio file (or URL if supported); run transcription pipeline (Phase 7); write one note to vault (e.g. `vault/media/audio/` or inbox) with `source: audio`, `source_id`, `date`.
   - **video** — Same as audio; transcribe; `source: video`.
   - **mif** — Path to `.memory.md` or folder; copy into vault; optionally normalize frontmatter to our schema; add `source: mif`.
   - **mem0-export** — Path to Mem0 export JSON (or API + credentials); map each memory to one note; `source: mem0`, `source_id`, etc.
   - **notebooklm** — If feasible: NotebookLM export or API; one note per source. Document Google auth or export flow.
   - **gdrive** — Google Drive folder or file IDs; export Docs to Markdown/text; write notes with `source: gdrive`, `source_id`.
3. **Idempotency** — Where platform gives stable ids (ChatGPT, Claude, Mem0), skip or update existing note with same `source` + `source_id`.
4. **Docs** — IMPORT-SOURCES.md already describes each type; add "How to run" examples (e.g. where to get ChatGPT export ZIP, how to run `knowtation import chatgpt-export ./chatgpt-export.zip`).

**Acceptance:** For each implemented source type, a test input (e.g. sample ZIP or file) produces the expected vault notes. `knowtation list-notes` and `knowtation search` see them after indexing.

---

## Phase 7 — Transcription pipeline

**Goal:** Audio and video files (or URLs) → transcript → one vault note per recording. Reuse or extend for wearable/webhook transcripts.

**Deliverables:**

1. **Transcription** — Integrate one provider (e.g. Whisper via Ollama, or OpenAI Whisper, or Deepgram). Config: provider, model, API key via env. Input: local file or URL (if supported).
2. **Script / `import audio|video`** — `scripts/transcribe.mjs` or equivalent: accept file path (and optional URL); run transcription; write one note to `vault/media/audio/` or `vault/media/video/` (or configurable) with frontmatter `source: audio` or `source: video`, `source_id` (filename or id), `date`, optional `project`/`tags`. Body = transcript text.
3. **Optional: chapters** — For video, optional chapter detection (e.g. timestamps) and store in note structure or frontmatter.
4. **Wearables** — Document that real-time wearable transcripts (e.g. Omi webhook) can be handled by the same message-interface contract: webhook receiver writes transcript to inbox with `source: audio` or `source: wearable`. No separate pipeline; capture plugin suffices.

**Acceptance:** `knowtation import audio ./recording.m4a --project born-free` produces a note in the vault. `knowtation index` then makes it searchable.

---

## Phase 8 — Memory and AIR hooks

**Goal:** Optional memory layer (e.g. Mem0) and AIR (intent attestation) integrated at the spec’s hook points. No new CLI surface beyond config.

**Deliverables:**

1. **Memory** — When `memory.enabled` is true: (1) After search, optionally store "last query + result set" (or hash) in memory backend. (2) After export, store provenance (source_notes → export path) in memory. (3) Optional subcommand `knowtation memory query "last export"` or similar to read from memory. Implement for one backend (e.g. Mem0 API or local).
2. **AIR** — When `air.enabled` is true: Before `write` (non-inbox) and before `export`, call AIR endpoint (or local flow); obtain attestation id; log it (e.g. in log file or in note frontmatter). Inbox writes exempt.
3. **Config** — `memory.enabled`, `memory.provider`, `memory.url`; `air.enabled`, `air.endpoint`. Env overrides where applicable.
4. **Graceful degradation** — If memory or AIR service unavailable, log and either skip (memory) or fail the operation (AIR) per product choice. Document behavior.

**Acceptance:** With memory and AIR configured, running export triggers AIR and stores provenance in memory. With services off, CLI still works (memory optional; AIR can fail the op or be made optional per config).

---

## Phase 9 — MCP server

**Goal:** MCP server that exposes the same operations as the CLI (search, get-note, list-notes, index, write, export, import) with same semantics. For clients that only speak MCP.

**Deliverables:**

1. **MCP server** — Implement MCP server (e.g. stdio or SSE transport). Tools: search, get_note, list_notes, index, write, export, import. Each tool’s inputs map to CLI args; outputs match CLI `--json` shapes. Primary interface for agent runtimes that speak MCP (Cursor, Claude Desktop, AgentCeption-style orchestrators).
2. **CLI in agent environments** — Same operations available via CLI; agents in containers or worktrees (e.g. [AgentCeption](https://github.com/cgcardona/agentception) engineer agents) run `knowtation` with `KNOWTATION_VAULT_PATH` (and config) set. Both MCP and CLI are first-class; orchestrators choose per environment.
3. **Config** — Optional config or env to enable MCP (e.g. for Cursor, Claude Desktop). Document how to run (e.g. `knowtation mcp` or separate entry point).
4. **Single backend** — Server calls the same core logic as the CLI (no duplicate business logic).

**Acceptance:** MCP client (e.g. Cursor with MCP config) can run search, get-note, list-notes, write, export, import and get correct responses. CLI works when invoked from an agent process (e.g. Docker exec) with vault path and config set.

---

## Phase 10 — Polish: SKILL, docs, tests, and packaging

**Goal:** Production-ready: SKILL.md and docs updated, tests for critical paths, and clear install/run instructions.

**Deliverables:**

1. **SKILL.md** — Already documents CLI; add `import` and all retrieval/token flags (`--fields`, `--snippet-chars`, `--count-only`, `--body-only`, `--frontmatter-only`). Document **tiered retrieval pattern**: (1) list-notes or search with small limit + `--fields path` or path+snippet, (2) from paths/snippets pick one or two, (3) get-note only those paths. Ensures agents minimize token use by design. See docs/RETRIEVAL-AND-CLI-REFERENCE.md. Compatibility list and "when to use" include import and write/export.
2. **Agent orchestration guide** — **docs/AGENT-ORCHESTRATION.md**: using Knowtation with agent orchestration systems (e.g. [AgentCeption](https://github.com/cgcardona/agentception)). Option A: MCP (config for Cursor/Claude, tool list). Option B: CLI in agent environment (install, `KNOWTATION_VAULT_PATH`, JSON parsing). Patterns: vault as knowledge backend (search → get-note), write-back (plans/summaries into vault). Optional **bridge script** in `scripts/` that pipes content into `knowtation write` with frontmatter (e.g. phase summary → vault) as a reference for integrators.
3. **Docs** — README: quick start, link to SPEC, IMPORT-SOURCES, IMPLEMENTATION-PLAN, AGENT-ORCHESTRATION. Setup: config, vault, index, capture, import (ChatGPT/Claude, etc.). ARCHITECTURE references SPEC and plan.
4. **Tests** — Unit or integration tests for: config load; vault list/filter; get-note/list-notes; indexer (chunk + metadata); search (mock or real vector store); write; at least one importer (e.g. markdown or chatgpt-export with fixture). Exit codes and JSON output where relevant.
5. **Packaging** — `package.json` scripts: `knowtation`, `index`, optional `transcribe`, `import`. Dependencies pinned. Optional: `npm link` or global install instructions. No secrets in repo; `.gitignore` for `config/local.yaml`, `data/`, `.env`.
6. **Cleanup** — Remove stub outputs from CLI; ensure all commands implement real behavior or fail with clear errors. COPY-TO-REPO and LICENSE if publishing.

**Acceptance:** New user can clone, copy config, run index, run search, run import on a sample export, and run write/export. Tests pass. SKILL and docs are accurate.

---

## Phase 11 — Shared vault / simplified collaboration (optional)

**Goal:** Make agent-to-agent and agent-to-human interaction **simple without requiring GitHub**. Offer an optional “hub” (hosted or self-hosted) where the vault is shared, proposals exist in a review queue, and users/agents interact via API or simple UI — no branches or PRs required.

**Deliverables:**

1. **Vault + proposals API** — REST (or MCP) endpoints: read vault (list notes, get note, search), write note, **create proposal** (variation: proposed note or diff), **list proposals**, **approve** (apply to vault), **discard**. Same semantics as CLI; proposals stored in sidecar or `.proposals/` (see [MUSE-STYLE-EXTENSION.md](./MUSE-STYLE-EXTENSION.md)). Optional: `baseStateId` for optimistic concurrency.
2. **Simple auth** — API key or lightweight auth (e.g. JWT) so agents and users can call the API. No full OAuth required for v1; document how to run behind a reverse proxy with your own auth if needed.
3. **Hub service** — Optional server (or Docker Compose) that: serves the API, stores vault (or syncs from Git), stores proposals, and optionally serves a **minimal web UI**: view vault, search, see review queue (list proposals), approve/discard. Can be self-hosted or offered as a **hosted product**. **Deployment options:** (a) Self-hosted (Docker); (b) Decentralized: ICP canister(s) in Motoko (or Rust) for API + vault/proposal state — see "Website and decentralized hosting" below.
4. **Public website (landing)** — The marketing/landing site in **web/** (intent, open source, what's included, pricing, GitHub link) is part of the phased build. Production-ready and deployable so that when you have a domain, the site can go live without backtracking. See "Website and decentralized hosting" below.
5. **CLI integration** — Optional: `knowtation hub status` or `knowtation propose --hub <url>` that talks to the hub API so CLI users can push proposals to a shared hub without using Git. Document “local vault only” vs “vault + hub” workflows.
6. **Docs** — When to use hub vs Git+PRs; how to run self-hosted hub; how agents and humans use the API (list, search, propose, review). Link to MUSE-STYLE-EXTENSION.

**Acceptance:** With the hub running (local or hosted), a user or agent can create a proposal via API; another user sees it in the review queue and approves or discards; canonical vault updates without touching Git. Core Knowtation (Phases 1–10) remains fully usable without the hub. Landing site (web/) is build-complete and deployable.

**Note:** Phase 11 is **optional**. Teams that prefer Git + PRs can skip it. It is for users who want “shared vault + review” without learning GitHub. Monetization: open source core + optional paid hosted hub (this phase).

---

## Summary: phase order and dependencies

| Phase | Depends on | Delivers |
|-------|------------|----------|
| 1 | — | Config, vault read, get-note, list-notes, errors |
| 2 | 1 | Indexer (chunk, embed, vector store) |
| 3 | 2 | Search with filters, JSON, exit codes |
| 4 | 1 | Write, export, provenance, AIR hook |
| 5 | 1 | One capture plugin, contract doc, optional webhook |
| 6 | 1, 4 | Import (all source types) |
| 7 | 1 | Transcription; import audio/video |
| 8 | 1, 4 | Memory + AIR integration |
| 9 | 1–4, 6 | MCP server |
| 10 | 1–9 | Docs, SKILL, tests, packaging |
| 11 | 1–4, 9 | Shared vault / hub (API, proposals, review queue, optional UI); public landing site (web/); hosted or ICP (Motoko) deployment; agent-to-agent and agent-to-human without GitHub |

**Intention and temporal:** Optional frontmatter and filters (`--since`, `--until`, `--chain`, `--entity`, `--episode`, `--order`) are specified in **docs/INTENTION-AND-TEMPORAL.md** and SPEC §2.3. Implement time-bounded filters in Phase 3 or 4; causal/entity/episode and evals in an optional later phase so we don’t backtrack.

**Estimated order of implementation:** 1 → 2 → 3 (core loop); then 4 (write/export); then 5 (capture); 6 and 7 in parallel after 4; 8 after 4; 9 after core CLI is stable; 10 last; 11 optional after 10. Total scope: core in 1–10; simplified shared collaboration in 11. Monetization: open source core + optional paid hosted hub (Phase 11). Internal planning may live in `development/` (gitignored) when used.

**Commit after each phase.** Each phase is a shippable increment; commit when its acceptance criteria are met so history stays clear and you can revert or branch by phase.

**When to use a separate session** — Use a new session when a phase is large or crosses many files, so context stays manageable and you don’t lose focus:

| Phase | Suggested session | Why |
|-------|-------------------|-----|
| **1** | Single session | Foundation only; already done in one pass. |
| **2** | **New session** | Indexer: chunking, embedding, vector store (Qdrant/sqlite-vec). Multiple backends and config; good to start fresh with full context. |
| **3** | Same as 2, or new | Search builds on 2. Can do 2+3 in one “core loop” session, or 3 alone if 2 was done earlier. |
| **4** | Single or new | Write + export + provenance + AIR hooks. Medium; new session if 2+3 was long. |
| **5** | Single | One capture plugin + contract doc; focused. |
| **6** | **New session** | Many importers (markdown, chatgpt, claude, mem0, audio, video, mif, …). Big; split 6a (first 2–3) and 6b (rest) if needed. |
| **7** | **New session** | Transcription pipeline (Whisper/Deepgram, etc.); external deps and config. |
| **8** | **New session** | Memory + AIR; integration with external services. |
| **9** | **New session** | MCP server; different surface (protocol, tools). |
| **10** | **New session** | Polish: SKILL, docs, tests, packaging; broad. |
| **11** | **New session(s)** | Hub, landing, hosting; can split “Hub API + UI” and “deploy + 4Everland/ICP” if useful. |

Rule of thumb: start a **new session** at the start of Phase 2, 6, 7, 8, 9, 10, and 11 (and optionally after 3 or 4). Commit at the end of every phase.

**Update this plan at the end of each session.** Before committing (or when you commit the next phase), update IMPLEMENTATION-PLAN.md to reflect the session: e.g. mark the phase(s) completed, add a short “Last session” or “Status” line (what was done, what’s next), or bump a “Current phase” pointer. That keeps the plan the single place to see where the build stands. Commit those plan updates together with the phase commit (e.g. Phase 2 commit can include both the Phase 2 code and the updated plan from the end of session 1).

---

## What we're not forgetting

- **Any audio:** Smart glasses, wearables, past blogs/videos → Phase 7 + message-interface for real-time (Phase 5).
- **Any knowledge base / LLM export:** ChatGPT, Claude, Mem0, NotebookLM, Google Drive, MIF, generic Markdown → Phase 6.
- **Multi-project, tags, filters:** Phase 1 (list-notes), Phase 2 (indexer metadata), Phase 3 (search filters).
- **Retrieval and token cost:** All retrieval levers are in scope: `--fields`, `--snippet-chars`, `--count-only` (search, list-notes), `--body-only`/`--frontmatter-only` (get-note). Tiered retrieval (narrow → cheap first → get-note only for chosen paths) documented in SKILL and [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md).
- **Agents and business use:** Phases 1–4 and 9 (CLI + MCP); write, export, provenance, AIR (Phase 4, 8). Content creation (blogs, podcasts, videos, marketing, analysis) uses search + get-note + write + export.
- **Agent orchestration (e.g. AgentCeption):** Knowtation is a first-class **knowledge backend** for multi-agent orchestration. Orchestrators and their agents use **both** CLI and MCP: MCP when the runtime speaks MCP (Cursor, Claude); CLI when agents run in containers/worktrees (e.g. engineer agents). Vault = org brain (read for context, write-back plans/summaries). See **docs/AGENT-ORCHESTRATION.md**.
- **Extensibility:** Phase 5 proves the capture contract; Phase 6 proves import; both documented so others can add plugins and new import types.
- **Simple agent-to-agent and agent-to-human:** Phase 11 (shared vault / hub) — API, proposals, review queue, optional UI — so people who are unfamiliar with or adverse to GitHub can still share a vault and review proposals. Optional; core remains usable without it. See [MUSE-STYLE-EXTENSION.md](./MUSE-STYLE-EXTENSION.md).
- **Website and hosted option:** Public landing site (web/) and the hosted Hub offering are part of the plan so we don't backtrack. Landing is deployable (e.g. 4Everland); Hub can be self-hosted or deployed on ICP (Motoko canisters). See below.
- **bornfree-hub reference:** Existing platform ([bornfree-hub](https://github.com/aaronrene/bornfree-hub)) uses five canisters (Signing, Documents, Identity, Assets, Encryption) with Netlify + 4Everland. Reuse those patterns when implementing the Knowtation Hub on ICP (Phase 11) to avoid redoing work.

---

## Website and decentralized hosting (4Everland / ICP)

**Landing site (web/)** — The marketing site is in the repo and part of the build. You can host it on **[4Everland](https://www.4everland.org/hosting/)** (decentralized) in several ways:

- **4Everland → IPFS or Arweave:** Deploy the static `web/` build; 4Everland gives you a URL and supports [custom domains](https://docs.4everland.org/hositng/guides/domain-management). No canister required.
- **4Everland → Internet Computer (ICP):** 4Everland’s [IC Hosting](https://docs.4everland.org/hositng/what-is-hosting/internet-computer-hosting) creates a **front-end canister** for your site automatically (connect repo, build, deploy). Custom domain and SSL supported. So: **you do not need to create a canister yourself for the landing page** — 4Everland creates and manages it.

**Hosted Hub (API + service)** — The Hub is a dynamic service (API, vault/proposal storage, auth). For **decentralized** hosting you have two parts:

1. **Hub API + storage** — This needs a **backend canister** (or canisters) on ICP. 4Everland’s IC Hosting is aimed at front-end/static sites; it does not run your Node/Python server. So for the Hub on ICP you **do need canister(s)** you build and deploy (e.g. with `dfx`). **Motoko is practical here:** you already use it; canisters can expose HTTP, store vault metadata and proposals, and call out to your indexer/search if needed (or replicate minimal logic in-canister). Design the Hub API so it can be implemented as (a) a traditional server (Phase 11 self-hosted) or (b) a Motoko canister backend for ICP.
2. **Hub web UI** — The minimal UI (view vault, search, review queue) can be a static front-end. That can be deployed via **4Everland to ICP** (they create the front-end canister) or served from the same backend when self-hosted. The UI then calls your Hub API (self-hosted URL or canister URL on ICP).

**Summary**

| What | 4Everland? | Canister needed? |
|------|------------|------------------|
| **Landing site** | Yes — deploy `web/` to 4Everland (IPFS, Arweave, or IC). On IC, 4Everland creates the canister for you. | No (4Everland creates it on IC). |
| **Hub API / service** | 4Everland does not run your backend. | **Yes** — build Hub API + storage as Motoko (or Rust) canister(s); deploy with dfx. |
| **Hub web UI** | Yes — deploy the Hub UI as a static site to 4Everland (IC canister) if you want; it talks to your API canister. | Optional (4Everland can create the UI canister on IC). |

**Domain:** Get your domain and attach it in 4Everland’s [domain management](https://docs.4everland.org/hositng/guides/domain-management) for the landing (and optionally the Hub UI). For the API canister, you’d use the canister URL (e.g. `https://<canister-id>.ic0.app`) or route via your domain if you set up a gateway.

**Practical path:** (1) Build landing (web/) and Hub as in Phase 11. (2) Deploy landing to 4Everland (IC or IPFS) and point your domain at it. (3) For hosted Hub: either self-host (Docker) first, or implement a Motoko canister backend for the Hub API and deploy to ICP; then deploy the Hub UI (e.g. via 4Everland to IC) so it calls that canister. No backtracking — the plan explicitly includes the website and the hosting option, with a decentralized path (4Everland + ICP canisters) documented.

**Reference: bornfree-hub (existing canister + Netlify + 4Everland platform)** — When we cross the bridge to Hub-on-ICP, reuse patterns from the existing **[bornfree-hub](https://github.com/aaronrene/bornfree-hub)** platform so we don’t redo work. That repo uses five canisters (Signing, Documents, Identity, Assets, Encryption) and deploys with **Netlify** and **4Everland**. Same deployment and canister-architecture patterns may apply to the Knowtation Hub (e.g. Identity for auth, Documents/Assets for vault and proposals, Signing/Encryption if we need attestation or encrypted storage). Note this here; detailed alignment when we reach Phase 11 Hub implementation.

---

## Other considerations / Before first release

- **Security:** Core CLI has no auth (local vault). Validate vault-relative paths for get-note/write so paths cannot escape the vault (e.g. `../` outside root). Hub (Phase 11): simple auth; document running behind reverse proxy for production.
- **Observability:** Optional logging and metrics (e.g. search latency, result count) for self-hosted or hub; can be an extension point or Phase 11. No telemetry in core without opt-in.
- **Evals:** SPEC §12 and INTENTION-AND-TEMPORAL reserve `knowtation eval` and eval set format. After core retrieval is stable, an optional Evals phase (golden set, accuracy/grounding) can be added; not blocking for first release.
- **Open source hygiene:** LICENSE (e.g. MIT), CONTRIBUTING (how to run tests, PR expectations), optional code-of-conduct and issue/PR templates. Phase 10 mentions COPY-TO-REPO and LICENSE; ensure no secrets or credentials in repo (user rule).
- **Performance:** Index size and search latency depend on vault size and vector store. Document when to re-index (after bulk import, after model change); optional "Operational notes" in docs if needed.

You can implement phases in sequence (1 → 2 → … → 11) or parallelize 5, 6, 7 after 4. Phase 11 is optional. This plan ensures the full product is built with no scope left unspecified.

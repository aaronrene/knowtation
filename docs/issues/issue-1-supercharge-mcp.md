feat: Supercharge MCP — Resources, Prompts, Streaming Transport, Subscriptions, and Sampling

# Supercharge Knowtation's MCP Integration

> **The vision:** Make Knowtation the gold-standard reference implementation of a personal knowledge MCP server — leveraging every primitive the protocol offers: **Tools**, **Resources**, **Prompts**, **Subscriptions**, **Sampling**, **Roots**, and an authenticated **HTTP transport** alongside the existing stdio path.

Knowtation already has a solid Phase 9 MCP server with 7 tools (`search`, `get_note`, `list_notes`, `index`, `write`, `export`, `import`). But the MCP protocol is much richer than tools alone. Today we use ~15% of what MCP can do. This issue is a complete plan to get to 100%.

---

## What MCP can do that Knowtation doesn't yet use

| MCP Primitive | Current Status | Gap |
|---|---|---|
| **Tools** | ✅ 7 tools | Missing: relate, backlinks, capture, transcribe, summarize, cluster, extract_tasks |
| **Resources** | ❌ Not implemented | Full vault not browseable; no structured data resources |
| **Prompts** | ❌ Not implemented | No reusable prompt templates for agents to invoke |
| **Resource Subscriptions** | ❌ Not implemented | Clients can't receive live vault change notifications |
| **Sampling** | ❌ Not implemented | Server can't delegate LLM calls back to client |
| **Roots** | ❌ Not implemented | Client doesn't know what filesystem scope the server operates in |
| **HTTP+SSE Transport** | ❌ stdio only | No remote/browser/mobile access; no multi-client support |
| **OAuth 2.1 Auth** | ❌ Not implemented | Hub has JWT but MCP layer is unprotected |
| **Progress notifications** | ❌ Not implemented | Long index runs are silent |
| **Logging** | ❌ Not implemented | No structured log forwarding to MCP client |

---

## Phase A — MCP Resources: The Vault as a Browseable Knowledge Graph

Resources give agents *declarative read access* to data without burning a tool call. The vault's entire structure should be navigable as a resource tree. Clients (Cursor, Claude Desktop) show resources in their UI and can attach them as context automatically.

### A1. Note resources (`knowtation://vault/{path}`)

Every note in the vault becomes a first-class MCP resource:

```
knowtation://vault/inbox/2025-03-15-standup.md     → full note (frontmatter + body)
knowtation://vault/projects/born-free/README.md    → project README
knowtation://vault/areas/health/2025-q1-review.md  → area note
```

- **MIME type:** `text/markdown`
- **Handler:** `server.resource('knowtation://vault/{path}', ...)` — reads from `lib/vault.mjs` (`readNote`)
- **Resource templates:** register a URI template so the full `{path}` space is discoverable
- Each resource **name** = note title from frontmatter (falls back to filename)
- Each resource **description** = first 160 chars of body

### A2. Vault listing resources

```
knowtation://vault/                            → list of all notes (path + title + date + tags)
knowtation://vault/inbox                       → inbox listing
knowtation://vault/projects/{slug}             → project listing
knowtation://vault/captures                    → captures listing
knowtation://vault/imports                     → imports listing
knowtation://vault/media/audio                 → audio media listing
knowtation://vault/media/video                 → video media listing
```

- **MIME type:** `application/json`
- **Handler:** wrap `lib/list-notes.mjs` (`runListNotes`) with a config-scoped filter

### A3. Structured metadata resources

```
knowtation://index/stats     → { notes_indexed, chunks_indexed, last_indexed, vector_store, embedding_provider }
knowtation://tags            → { tags: [{ name, count, projects }] } — all tags with usage counts
knowtation://projects        → { projects: [{ slug, note_count, last_updated }] } — project manifest
knowtation://config          → redacted config snapshot (vault_path, vector_store, embedding.provider; strip secrets)
knowtation://memory/last_search  → last search query + result paths (from lib/memory.mjs)
knowtation://memory/last_export  → last export provenance
knowtation://air/log         → last N AIR attestation records
```

### A4. Template resources

```
knowtation://vault/templates/{name}   → note templates agents can read before write
```

Agents can fetch a template, fill it, and call `write` — zero prompt engineering needed.

### A5. Knowledge graph resource

```
knowtation://index/graph   → { nodes: [{path, title, tags, project}], edges: [{from, to, type}] }
```

`type` = `wikilink` | `causal_chain` | `follows` | `summarizes`. Build by scanning frontmatter (`follows`, `causal_chain_id`, `summarizes`) and wikilink syntax (`[[...]]`) in note bodies. This is the raw knowledge graph of the entire vault, consumable by any graph-aware client or agent.

**Implementation notes:**
- All resource handlers go in `mcp/resources/` (new folder)
- Register all resources and URI templates in `mcp/server.mjs` after the tool registrations
- Resources are read-only; mutations go through Tools
- Listing resources should paginate at ≥500 results to avoid response size issues

---

## Phase B — MCP Prompts: Reusable Agent Workflows Baked Into the Server

Prompts are server-defined, parameterized templates that agents invoke *by name* from a menu. The client sends arguments; the server returns a fully-constructed multi-turn message array with system instructions, embedded vault content, and optional tool call suggestions. This eliminates repeated prompt engineering across every agent that uses Knowtation.

### B1. `daily-brief`

**Arguments:** `date` (optional, ISO date, defaults to today), `project` (optional)

**What the server does:**
1. Calls `runListNotes` for notes since `date` (or last 24h)
2. For each note, reads title + snippet
3. Returns a message array:
   - `system`: "You are a personal knowledge assistant. Below are notes captured today."
   - `user`: embedded notes formatted as a numbered list with titles, dates, snippets
   - `assistant` (prefill): "Here is your daily brief:"

**Use case:** Agent or human opens Cursor → invokes `daily-brief` → instantly gets today's captures summarized without writing a single prompt.

### B2. `search-and-synthesize`

**Arguments:** `query` (string), `project` (optional), `limit` (optional, default 10)

**What the server does:**
1. Runs `runSearch` with the query
2. Fetches full content of top results via `readNote`
3. Returns: system prompt instructing synthesis + user message with embedded notes

**Use case:** "Search for my notes on product-market fit and synthesize them" → one prompt invocation, no tool call boilerplate.

### B3. `project-summary`

**Arguments:** `project` (slug), `since` (optional), `format` (optional: `brief` | `detailed` | `stakeholder`)

**What the server does:**
1. Lists all notes in the project
2. Fetches content of most recent N notes
3. Returns a structured prompt asking for an executive summary in the chosen format
4. Embeds notes as resources in the prompt response

### B4. `write-from-capture`

**Arguments:** `raw_text` (string), `source` (string — telegram, whatsapp, email, etc.), `project` (optional)

**What the server does:**
1. Fetches the `capture` template from `knowtation://vault/templates/capture`
2. Returns a prompt asking the LLM to format `raw_text` into a proper vault note with correct frontmatter (`source`, `date`, `project`, `tags`) and clean body

**Use case:** Pipe a Telegram message in and get a correctly-formatted note out — with the right frontmatter fields, not just a text dump.

### B5. `temporal-summary`

**Arguments:** `since` (date), `until` (date), `topic` (optional), `project` (optional)

**What the server does:**
1. Queries notes in the time range
2. Optionally filters by topic via semantic search
3. Returns a prompt for temporal synthesis: "What happened between X and Y? What decisions were made? What changed?"

### B6. `extract-entities`

**Arguments:** `folder` (optional), `project` (optional), `entity_types` (optional: `people` | `places` | `decisions` | `goals` | `all`)

**What the server does:**
1. Lists and fetches notes in scope
2. Returns a structured extraction prompt with clear output schema (JSON): `{ people: [], places: [], decisions: [], goals: [] }`

### B7. `meeting-notes`

**Arguments:** `transcript` (string), `attendees` (optional array), `project` (optional), `date` (optional)

**What the server does:**
1. Returns a prompt to convert raw transcript to structured meeting note
2. Includes instructions for: title, frontmatter (date, attendees, project, tags), agenda items, decisions, action items, follow-ups
3. Prefills the path for the resulting `write` tool call

### B8. `knowledge-gap`

**Arguments:** `query` (string), `project` (optional)

**What the server does:**
1. Runs search for the query
2. Returns a prompt that says: "Given these search results from my vault, what is missing? What questions remain unanswered? What should I capture next?"

### B9. `causal-chain`

**Arguments:** `chain_id` (string), `include_summaries` (optional boolean)

**What the server does:**
1. Queries `knowtation://index/graph` for all nodes in the chain
2. Fetches full content of each node in causal order (via `follows` frontmatter)
3. Returns a prompt to trace and narrate the causal sequence

### B10. `content-plan`

**Arguments:** `project` (slug), `format` (optional: `blog` | `podcast` | `newsletter` | `thread`), `tone` (optional)

**What the server does:**
1. Fetches project notes
2. Returns a prompt to generate a content plan: topics to cover, order of publication, content angles, what to write next

**Implementation notes:**
- All prompts go in `mcp/prompts/` (new folder)
- Each prompt is a module that exports `{ name, description, arguments, handler }` 
- Register all prompts in `mcp/server.mjs` using `server.prompt(name, schema, handler)`
- Prompts that embed vault content return `EmbeddedResource` elements in their message arrays — this is the key link between Prompts and Resources

---

## Phase C — Enhanced Tool Surface

Expand the tool set to cover the operations agents need that aren't currently possible.

### C1. `relate` — Find semantically related notes

```
Inputs: path (vault-relative), limit (default 5), project (optional)
Output: { path, related: [{ path, score, title, snippet }] }
```

Embeds the source note's content and queries the vector store for nearest neighbors. Excludes the note itself. Enables agents to surface connections they didn't know to search for.

### C2. `backlinks` — Reverse wikilink index

```
Inputs: path (vault-relative)
Output: { path, backlinks: [{ path, title, context }] }
```

Scans the vault for `[[target]]` wikilinks pointing to `path`. Returns each linking note with the surrounding sentence as context. No vector store needed — pure text scan with file caching.

### C3. `capture` — Fast inbox write

```
Inputs: text (string), source (optional string), project (optional), tags (optional array)
Output: { path, written: true }
```

Simplified `write` for inbox captures. Auto-generates filename (`YYYY-MM-DD-HHMMSS-{slug}.md`), injects required inbox frontmatter (`source`, `date`, `inbox: true`), and writes to `vault/inbox/` (or `vault/projects/{project}/inbox/`). No AIR check (inbox is always exempt).

### C4. `transcribe` — Audio/video → vault

```
Inputs: path (absolute path to audio/video file), project (optional), tags (optional), output_dir (optional)
Output: { vault_path, transcript_length, written: true }
```

Wraps `lib/transcribe.mjs`. Transcribes via Whisper/OpenAI, writes to vault. Exposes existing CLI capability through MCP.

### C5. `vault_sync` — Git sync

```
Inputs: message (optional commit message)
Output: { ok, committed, pushed, sha }
```

Wraps `lib/vault-git-sync.mjs`. Agents can commit and push vault changes after a write session. Essential for vault-under-git workflows.

### C6. `summarize` — LLM-powered note summarization

```
Inputs: path (or paths array), style (optional: brief | detailed | bullets), max_words (optional)
Output: { summary, source_paths }
```

Fetches note(s), calls the configured LLM (OpenAI/Ollama), returns a summary. If `sampling` is enabled (Phase F), delegates to the client LLM instead of calling its own — cleaner architecture.

### C7. `extract_tasks` — Pull todos from notes

```
Inputs: folder (optional), project (optional), tag (optional), since (optional), status (optional: open | done | all)
Output: { tasks: [{ text, path, line, status }] }
```

Scans notes for Markdown task syntax (`- [ ] ...`, `- [x] ...`). Returns tasks with their source path and line number for traceability.

### C8. `cluster` — Semantic clustering

```
Inputs: project (optional), folder (optional), n_clusters (default 5)
Output: { clusters: [{ label, centroid_snippet, paths }] }
```

Fetches all chunk embeddings from the vector store, runs k-means clustering, returns cluster descriptions. Lets an agent understand the thematic structure of a project without reading every note.

### C9. `memory_query` — Read from memory store

```
Inputs: key (string)
Output: { key, value, updated_at }
```

### C10. `tag_suggest` — Suggest tags for a note

```
Inputs: path (vault-relative, or body for inline suggestion)
Output: { suggested_tags: string[], existing_tags: string[] }
```

Embeds the note, finds semantically similar notes, extracts their tags, returns the most common tags not already on the note.

---

## Phase D — Streamable HTTP Transport + Hub as MCP Gateway

Today the MCP server only runs over stdio, which means one client per server process, no remote access, no browser support, and no authentication. The 2025-11 MCP spec introduced **Streamable HTTP** transport which solves all of this.

### D1. HTTP+SSE transport

Add an HTTP server alongside the existing stdio path:

```
GET  /mcp          → SSE stream (server → client notifications)
POST /mcp          → JSON-RPC requests (client → server)
DELETE /mcp        → session teardown
```

- **Port:** configurable via `mcp.http_port` in config (default: `3334`)
- **Session management:** session ID in `Mcp-Session-Id` header; each client gets an independent session
- **Startup:** detect `MCP_TRANSPORT=http` env var (or config flag); default stays stdio for backward compatibility

### D2. Hub as authenticated MCP gateway

The Hub already has JWT auth, roles, and rate limiting. Promote it to an MCP reverse proxy:

```
Hub (port 3333) → MCP session pool → per-session MCP server instances
```

- Each Hub user gets their own MCP session scoped to their vault access level
- Role-based tool access: `reader` role can call `search`/`get_note`/`list_notes`; `writer` role adds `write`/`capture`; `admin` adds `index`/`export`/`import`
- `hub/gateway/mcp-proxy.mjs` — new file; proxies `POST /mcp` from authenticated Hub sessions to the MCP session pool

### D3. OAuth 2.1 for remote MCP clients

For clients outside the local machine (Claude Desktop on mobile, Cursor on a remote dev box):

```
GET  /.well-known/oauth-authorization-server  → OAuth metadata
POST /oauth/token                              → token endpoint (client_credentials + Hub JWT exchange)
```

- Hub JWT token → scoped MCP access token
- Token carries: `vault_path`, `allowed_roles`, `exp`
- MCP server validates token on every request

---

## Phase E — Resource Subscriptions + Real-Time Vault Watcher

Resources become truly live when the server can notify clients of changes. This turns Knowtation from a pull-based query system into a reactive knowledge stream.

### E1. Vault file watcher

Use `fs.watch` (or `chokidar` for cross-platform reliability) on `vault_path`:

```js
// In mcp/watcher.mjs
const watcher = chokidar.watch(config.vault_path, { ignoreInitial: true });

watcher.on('add',    path => notifyResourceUpdated(`knowtation://vault/${rel(path)}`));
watcher.on('change', path => notifyResourceUpdated(`knowtation://vault/${rel(path)}`));
watcher.on('unlink', path => notifyResourceListUpdated());
```

### E2. Subscription protocol

When a client sends `resources/subscribe` for a URI:
- Add to subscription map: `uri → Set<sessionId>`
- On file change: send `notifications/resources/updated` to all subscribed sessions
- On file delete: send `notifications/resources/list_changed` to all sessions

### E3. Index freshness notifications

After `index` tool completes (or on a background auto-index timer):
- Send `notifications/resources/updated` for `knowtation://index/stats`
- Send `notifications/resources/updated` for affected `knowtation://vault/{path}` resources

### E4. Inbox notification

Any write to `vault/inbox/` also sends `notifications/resources/updated` for `knowtation://vault/inbox` — clients always see fresh inbox content without polling.

---

## Phase F — MCP Sampling: Delegate LLM Work to the Client

Sampling lets the MCP *server* request an LLM completion from the *client* (e.g. Claude Desktop or Cursor). This is architecturally powerful: Knowtation doesn't need to manage API keys for AI features — it asks the already-authenticated client to do the inference.

### F1. Client-delegated summarization

When `summarize` tool is called and sampling is available:

```js
const result = await server.createMessage({
  messages: [{ role: 'user', content: { type: 'text', text: `Summarize: ${noteBody}` } }],
  maxTokens: 512,
  includeContext: 'none',
});
```

Fall back to local Ollama/OpenAI call if sampling is not available (graceful degradation).

### F2. Smart import categorization

When `import` tool processes a new file, use sampling to:
- Suggest the best project and tags
- Generate a proper note title
- Clean up formatting artifacts from source exports

### F3. Auto-index enrichment

After indexing, use sampling to:
- Generate a human-readable summary of each new note (stored in vector store metadata as `summary`)
- Improve search result quality by having richer metadata

### F4. Search result reranking

After vector search returns candidates, use sampling to rerank based on semantic relevance to the query — zero-shot cross-encoder pattern without any extra model.

### F5. Prompt completion prefilling

When serving a Prompt (Phase B), optionally use sampling to pre-fill the assistant turn with a draft response that the user can refine. This turns Knowtation prompts into *interactive drafts* rather than blank-slate prompts.

---

## Phase G — Roots Declaration

**Spec note:** In MCP, **roots are listed by the client** (`roots/list`); the server can *request* them after init. The server does not push `setRoots` in the Node SDK.

**Shipped (Knowtation):**

- **Initialize `instructions`:** Plain-language description plus `file://` URIs for `vault_path`, `data_dir`, and (when present) each entry in `vaultList`. See [`docs/MCP-PHASE-G.md`](../MCP-PHASE-G.md) and [`mcp/server-instructions.mjs`](../../mcp/server-instructions.mjs).
- **After `initialized`:** If the client advertises `roots`, call `roots/list` once and log structured `client_roots` via `notifications/message` (diagnostic).

**Future / Hub:**

- **Scoped roots for Hub users:** Hub MCP gateway (D2/D3) can limit what each session sees; client roots should match the user’s allowed vault paths.
- **Change notification:** If `vault_path` or hub mapping changes at runtime, hosts that support `listChanged` may send `notifications/roots/list_changed`; the server can re-fetch `roots/list` if we add a handler later.

---

## Phase H — Progress Notifications + Structured Logging

### H1. Progress for long operations

`index` and `import` can take 10–60 seconds on large vaults. Today they're silent. Add progress:

```js
server.sendProgress({ progressToken, progress: notesProcessed, total: totalNotes });
```

Report every 10 notes or 5 seconds, whichever is sooner.

### H2. Structured logging to client

```js
server.sendLoggingMessage({ level: 'info', data: { event: 'index_complete', notes: 142, chunks: 891 } });
```

- `info` for completions
- `warning` for missing frontmatter fields
- `error` for failed embeddings or AIR rejections

Clients that support logging display these inline — no more silent failures.

---

## Implementation Sequence

| Phase | Effort | Value | Dependencies |
|---|---|---|---|
| **A** — Resources | Medium | Very High | none |
| **B** — Prompts | Medium | Very High | Phase A (embed resources in prompts) |
| **C** — Enhanced Tools | Medium | High | none |
| **E** — Subscriptions | Small | High | Phase A (resources must exist first) |
| **H** — Progress + Logging | Small | Medium | none |
| **D** — HTTP Transport | Large | High | Phase E (subscriptions need session tracking) |
| **F** — Sampling | Medium | High | Phase D (sampling works best over HTTP sessions) |
| **G** — Roots | Small | Low | none (can land anytime) |

**Recommended order:** A → C → E → H → B → D → F → G

---

## File Layout After All Phases

```
mcp/
  server.mjs           ← existing; register resources, prompts, enhanced tools
  watcher.mjs          ← Phase E: vault file watcher + subscription dispatcher
  http.mjs             ← Phase D: Streamable HTTP transport setup
  oauth.mjs            ← Phase D: OAuth 2.1 token endpoints
  resources/
    note.mjs           ← Phase A: individual note resource handler
    listing.mjs        ← Phase A: vault listing resource handlers
    metadata.mjs       ← Phase A: stats, tags, projects, config, memory, AIR
    graph.mjs          ← Phase A: knowledge graph resource
  prompts/
    daily-brief.mjs    ← Phase B
    search-and-synthesize.mjs
    project-summary.mjs
    write-from-capture.mjs
    temporal-summary.mjs
    extract-entities.mjs
    meeting-notes.mjs
    knowledge-gap.mjs
    causal-chain.mjs
    content-plan.mjs
  tools/               ← Phase C: enhanced tools as modules
    relate.mjs
    backlinks.mjs
    capture.mjs
    transcribe.mjs
    vault-sync.mjs
    summarize.mjs
    extract-tasks.mjs
    cluster.mjs
    memory-query.mjs
    tag-suggest.mjs
hub/
  gateway/
    mcp-proxy.mjs      ← Phase D: Hub as authenticated MCP gateway
```

---

## Why This Makes Knowtation the Shining Light of MCP Integrations

1. **Every MCP primitive used** — Tools, Resources, Prompts, Subscriptions, Sampling, Roots, Progress, Logging. No other personal knowledge system does this.
2. **Resources make the vault browseable** — Cursor and Claude Desktop users can see their entire vault in the sidebar without running a single query.
3. **Prompts eliminate prompt engineering** — Agents invoke named workflows (`daily-brief`, `project-summary`, `meeting-notes`) rather than constructing prompts from scratch.
4. **Subscriptions make it reactive** — Clients update in real time as notes are added/changed, turning Knowtation from a query system into a live knowledge stream.
5. **Sampling removes API key friction** — Agents use the host LLM (already authenticated in the client) for enrichment — no separate key, no cost duplication.
6. **HTTP transport opens remote access** — Browser extensions, mobile Cursor, team Hub users — all can connect to the same running Knowtation instance.
7. **Hub as gateway enables multi-user** — One vault instance serves many agents with role-scoped access, making Knowtation viable for teams.

Knowtation was designed from day one to be *the* knowledge layer for multi-agent systems. This plan makes the MCP surface match that ambition.


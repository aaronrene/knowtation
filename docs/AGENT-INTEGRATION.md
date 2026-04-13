# Agent integration — one page

**What this page is:** Knowtation is your **note vault + search index**. This page explains the three ways software—including AI assistants—can talk to it: **command line**, **MCP** (a standard plug-in protocol many IDEs use), and **Hub REST API**. You do not need to understand all three; pick the one your tool supports.

Integrate Knowtation with any agent (OpenAI, Claude, LangChain, LlamaIndex, custom runners). **Precise retrieval = fewer tokens:** use filters and limits so agents fetch only what they need; see [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md) for token levers. Three entry points: **CLI**, **MCP**, **Hub API**.

**Coming from Supabase?** Start with [**Migrating from Supabase → Knowtation**](#migrating-from-supabase--knowtation) below, then wire agents using sections 2–3.

---

## Migrating from Supabase → Knowtation

Many teams store AI memories, chat snippets, or app content in **Supabase (Postgres)**. Knowtation’s model is **Markdown files you own** plus an optional **search index** and **structured memory**. This section is the supported path to **move table rows into your vault** and then use the same agent surfaces (CLI, MCP, Hub API) as everyone else.

### What you can migrate

| Source in Supabase | What Knowtation does | Mechanism |
|--------------------|----------------------|-----------|
| A table of text blobs (e.g. `memories`, `messages`, custom name) | One **vault note per row** with `source: supabase`, `source_id`, `date` | **`supabase-memory` import** ([`lib/importers/supabase-memory.mjs`](../lib/importers/supabase-memory.mjs)) |
| New operational memory after cutover | Optional: keep events in **Postgres** via Knowtation’s Supabase memory provider | `memory.provider: supabase` + [`scripts/supabase-memory-migration.sql`](../scripts/supabase-memory-migration.sql) |

General **Postgres → Markdown** flows that are not row-per-memory (e.g. arbitrary schemas) are not a single CLI flag; use SQL **views** that expose the column names this importer expects, or export to CSV and use another importer where applicable ([IMPORT-SOURCES.md](./IMPORT-SOURCES.md)).

### Step 1 — Import table rows into the vault

Run the **`supabase-memory`** importer. From the **repo root**, `knowtation` resolves to `cli/index.mjs` via `npm install` / `npx`; you can also call `node cli/index.mjs import …` explicitly.

```bash
# Dry run first (no writes)
knowtation import supabase-memory '{"url":"'"$SUPABASE_URL"'","key":"'"$SUPABASE_SERVICE_ROLE_KEY"'","table":"memories"}' --dry-run --json

# Write notes under the vault (default: one .md per row)
knowtation import supabase-memory '{"url":"'"$SUPABASE_URL"'","key":"'"$SUPABASE_SERVICE_ROLE_KEY"'","table":"memories"}' --project migrated-from-supabase --json
```

You can pass a **path to a JSON file** instead of inline JSON (keep that file **out of git**; it contains secrets):

```json
{
  "url": "https://YOUR_PROJECT.supabase.co",
  "key": "YOUR_SERVICE_ROLE_KEY",
  "table": "memories",
  "vault_notes": true
}
```

```bash
knowtation import supabase-memory ./config/supabase-import.secret.json --dry-run --json
```

**Config fields**

| Field | Required | Default | Meaning |
|-------|----------|---------|---------|
| `url` | Yes | — | Project URL (`https://xxx.supabase.co`) |
| `key` | Yes | — | API key with read access to the table (service role for full reads) |
| `table` | No | `memories` | Table name |
| `vault_notes` | No | `true` | If `false`, skips writing `.md` files (memory callback only, advanced) |

**Row → note mapping (current importer behavior)**

- **Body:** first of `memory`, `content`, `text`; otherwise JSON of the whole row.
- **`source_id`:** `id` or `memory_id`, else a generated id.
- **`date`:** `created_at` or `updated_at` (supports ISO strings or numeric epoch seconds).

If your columns use different names, create a **SQL view** in Supabase that aliases them to `memory`/`content`/`text`, `id`, and `created_at`, then set `"table": "your_view_name"`.

**Dependency:** `@supabase/supabase-js` (see repo `package.json`). After import, run **`knowtation index`** / `npm run index` so search sees new notes.

### Step 2 — Point agents at Knowtation (not at raw Supabase for vault reads)

After migration, agents should use **MCP** or **Hub API** for **search / get-note / write / propose** so retrieval goes through Knowtation’s filters and token levers ([§2 MCP](#2-mcp-cursor-claude-code-etc), [§3 Hub API](#3-hub-api-rest)).

You may still run a **second MCP server** (e.g. generic SQL or an internal Supabase tool) alongside Knowtation for legacy queries during transition — see [Dual MCP (interop)](#dual-mcp-interop-knowtation--another-server) under §2.

### Step 3 — (Optional) Keep new memory events in Supabase

If you want **semantic memory** stored in Postgres while the vault stays canonical Markdown:

1. Run [`scripts/supabase-memory-migration.sql`](../scripts/supabase-memory-migration.sql) in the Supabase SQL editor (creates `knowtation_memory_events` + `match_memory_events`).
2. Set in `config/local.yaml` (or env):

```yaml
memory:
  enabled: true
  provider: supabase
  supabase_url: https://YOUR_PROJECT.supabase.co
  supabase_key: YOUR_KEY   # prefer KNOWTATION_SUPABASE_URL / KNOWTATION_SUPABASE_KEY in env
```

Details and event model: [MEMORY-AUGMENTATION-PLAN.md](./MEMORY-AUGMENTATION-PLAN.md).

This is **not** required to use the vault or MCP; it is an optional backend for `memory_*` tools.

---

## 1. CLI (agents in containers / worktrees)

- **Binary:** `knowtation` (Node; run from repo or install globally).
- **Env:** `KNOWTATION_VAULT_PATH` (required), optional `KNOWTATION_DATA_DIR`, embedding keys (e.g. `OPENAI_API_KEY`).
- **Config:** `config/local.yaml` (vault_path, embedding, vector_store). No secrets in config; use env.

**Read vault:**

```bash
knowtation search "query" --limit 5 --json
knowtation search "exact phrase" --keyword --limit 5 --json
knowtation list-notes --project my-project --limit 20 --json
knowtation get-note "path/to/note.md" --json
```

**Write vault:**

```bash
knowtation write "inbox/capture.md" --body "content" --json
```

**Propose (review-before-commit via Hub):**

```bash
knowtation propose "path/to/note.md" --hub https://hub.example.com --intent "Add summary" --json
```

**Token levers:** `--limit`, `--fields path` or `path+snippet`, `--count-only`, `--body-only`, `--frontmatter-only`, `--snippet-chars`, **`--keyword`** / **`--match`** for literal text search (no index required). See [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md).

**JSON shapes:** [CLI-JSON-SCHEMA.md](./CLI-JSON-SCHEMA.md) and [SPEC.md](./SPEC.md) §4.2.

---

## 2. MCP (Cursor, Claude Code, etc.)

- **Start:** `knowtation mcp` (stdio transport) or `MCP_TRANSPORT=http knowtation mcp` (Streamable HTTP, default port 3334).
- **Tools:** Same operations as CLI — search, get-note, list-notes, index, write, export, import. Same filters and JSON shapes. The **`search`** tool accepts **`mode`: `semantic` (default) or `keyword`** plus optional **`match`** (`phrase` \| `all_terms`) for keyword mode, aligned with `POST /api/v1/search`. The search tool also supports **`rerank`** (Phase F4) — when the client supports sampling, results are reranked by the client LLM for better relevance.
- **Enrich (Phase F2):** The **`enrich`** tool auto-categorizes a note: suggests project slug, tags, and title via sampling (client LLM) or server-side LLM fallback. Use `apply: true` to write suggestions to frontmatter.
- **Index enrichment (Phase F3):** The **`index`** tool accepts `enrich: true` to generate per-note AI summaries after indexing (opt-in, expensive). Summaries are stored in `ai_summary` frontmatter.
- **Scope hint:** On connect, the server sends MCP **`instructions`** naming your vault and data directory as `file://` URIs (Phase G). Add those folders as workspace roots in your MCP host when supported so the assistant's context matches Knowtation.
- **Sampling:** Tools that benefit from LLM intelligence (`summarize`, `enrich`, `search` rerank) delegate to the host's LLM when the client supports **sampling**; otherwise they use Ollama/OpenAI on the server. Prompts (`search-and-synthesize`, `project-summary`, `knowledge-gap`) may include a sampling-based assistant prefill. Code: `mcp/sampling.mjs` and tool modules under `mcp/tools/`.
- **Use case:** When the agent runtime speaks MCP; no need to shell out to CLI.

See [AGENT-ORCHESTRATION.md](./AGENT-ORCHESTRATION.md).

### Hosted MCP (Phase D2/D3)

Remote MCP clients (Claude Desktop, Cursor, custom agents) can connect to the Hub's MCP endpoint:

- **Endpoint:** `POST /mcp` on the Hub gateway (e.g. `https://hub.example.com/mcp`).
- **Auth:** OAuth 2.1 (Phase D3) via dynamic client registration + PKCE flow. Discovery: `GET /.well-known/oauth-authorization-server`. Or pass a Hub JWT as `Authorization: Bearer <token>`.
- **Session management:** Each authenticated user gets an isolated MCP session with role-based tool access (viewer: read-only; editor: + write; admin: + index/export/import). Sessions auto-expire after 30 min inactivity. Max 5 per user.
- **Rate limiting:** 60 requests/min per user on the `/mcp` endpoint.
- **Vault isolation:** Each session is scoped to the user's allowed vaults via `getHostedAccessContext()`.
- **Files:** `hub/gateway/mcp-proxy.mjs`, `hub/gateway/mcp-hosted-server.mjs`, `hub/gateway/mcp-tool-acl.mjs`, `hub/gateway/mcp-oauth-provider.mjs`.

### Cursor + hosted Knowtation MCP (step-by-step)

**What you are doing:** telling Cursor to open a **remote** MCP connection to your **gateway’s** `/mcp` URL, using the same **token** and **vault id** you copied from **Settings → Integrations → Hub API** (not the local `node … mcp` + disk vault path).

**Where to put it in Cursor**

1. **Option A — Settings UI:** **Cursor** → **Settings** (`Cmd` + `,` on macOS, `Ctrl` + `,` on Windows/Linux) → search **MCP** → open **MCP / Tools & MCP** (wording varies by Cursor version) → **Add server** or **Edit in `mcp.json`**. Cursor opens or creates the JSON file it uses for MCP.
2. **Option B — File directly (same result):** edit one of:
   - **All projects:** `~/.cursor/mcp.json` on your machine  
   - **This repo only:** `.cursor/mcp.json` at the **git root** of the project you opened in Cursor  

   Official overview: [Model Context Protocol (MCP) — Cursor Docs](https://cursor.com/docs/mcp).

**What to paste (shape only — use your real values from the Hub copy button; do not commit secrets)**

The Hub copy gives you `KNOWTATION_HUB_URL` (gateway base, **no** `/mcp` suffix). The MCP endpoint is **`{KNOWTATION_HUB_URL}/mcp`**.

```json
{
  "mcpServers": {
    "knowtation-hosted": {
      "url": "https://YOUR-GATEWAY-HOST/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_HUB_TOKEN_FROM_COPY_BUTTON",
        "X-Vault-Id": "YOUR_VAULT_ID_FROM_COPY_BUTTON"
      }
    }
  }
}
```

**Safer pattern (recommended):** put the token in a **shell / OS env var** and reference it so the JSON file does not contain the raw JWT:

```json
{
  "mcpServers": {
    "knowtation-hosted": {
      "url": "https://YOUR-GATEWAY-HOST/mcp",
      "headers": {
        "Authorization": "Bearer ${env:KNOWTATION_HUB_TOKEN}",
        "X-Vault-Id": "${env:KNOWTATION_HUB_VAULT_ID}"
      }
    }
  }
}
```

Then export `KNOWTATION_HUB_TOKEN` and `KNOWTATION_HUB_VAULT_ID` in the environment from which you launch Cursor (or use your OS secret store if your Cursor build documents another interpolation syntax).

**After saving**

1. **Reload MCP** (Cursor usually has a refresh on the MCP screen, or restart Cursor).  
2. Open **View → Output** (or **Output** panel) → choose **MCP** / **Cursor MCP** in the dropdown if logs do not appear — see [Cursor MCP docs](https://cursor.com/docs/mcp) for troubleshooting.  
3. In chat, try a tiny vault action (e.g. ask the agent to **list_notes** or **search** with a low limit).

**If Cursor ignores `headers`:** some MCP hosts prefer **OAuth** when the server advertises discovery (`GET /.well-known/oauth-authorization-server`). Your gateway supports OAuth for MCP (see **Hosted MCP (Phase D2/D3)** above). In that case use Cursor’s **OAuth / Sign in** flow for that MCP server instead of static Bearer headers, if the UI offers it.

### Dual MCP (interop): Knowtation + another server

Cursor, Claude Desktop, and other MCP hosts can load **multiple MCP servers** in one app. A common pattern during or after a **Supabase → Knowtation** migration:

- **Knowtation MCP** — vault search, notes, proposals, memory tools, imports (canonical knowledge).
- **A second MCP** — legacy Postgres/Supabase dashboards, internal tools, or another “second brain” product.

**Cursor** (`.cursor/mcp.json`): use a top-level `mcpServers` object with **two entries** (names are arbitrary):

```json
{
  "mcpServers": {
    "knowtation": {
      "command": "node",
      "args": ["/ABS/PATH/TO/knowtation/cli/index.mjs", "mcp"],
      "env": {
        "KNOWTATION_VAULT_PATH": "/ABS/PATH/TO/your-vault"
      }
    },
    "other": {
      "command": "npx",
      "args": ["-y", "some-other-mcp-package"]
    }
  }
}
```

**Claude Desktop:** merge a second server into `mcpServers` in `claude_desktop_config.json` the same way (OS-specific path — see [AGENT-ORCHESTRATION.md](./AGENT-ORCHESTRATION.md)).

**Operational tips**

- Give servers **distinct names** so the model can choose `knowtation`-scoped tools vs the other package.
- **Secrets:** put Supabase **service role** keys in env vars or host-specific secret stores, not in committed JSON.
- Hosted Knowtation MCP uses **OAuth or Hub JWT** against your gateway URL instead of a local `node … mcp` command — same dual-server idea: one config block for Knowtation hosted, one for the other tool.

---

## 3. Hub API (REST)

- **Base URL:** e.g. `https://hub.example.com` (REST paths are under `/api/v1/...`).
- **Auth:** JWT via OAuth (Google/GitHub). Header on every protected request: `Authorization: Bearer <token>`.
- **Vault:** For vault-scoped routes, send header `X-Vault-Id` (e.g. `default` or the id shown in the Hub header). Match the vault you intend to act on.
- **Obtain URL + token + vault (no DevTools):** In the Hub, open **Settings → Integrations → Hub API** and click **Copy Hub URL, token & vault**. That copies `KNOWTATION_HUB_URL`, `KNOWTATION_HUB_TOKEN`, and `KNOWTATION_HUB_VAULT_ID` as lines you can paste into a shell or agent config. **Treat that block as a secret** (do not post it in Slack, tickets, or chat). **Why it stops working sometimes:** the token is a time-limited “API password” (default **24 hours** on the hosted gateway unless your deployment sets `HUB_JWT_EXPIRY`). When it runs out, tools may see **401**—that is normal, not a bug. **Fix:** open the Hub in the browser (you stay signed in the usual way), go back to **Copy Hub URL, token & vault**, and paste the **new** lines into your agent or secret store. You are **not** expected to re-sign in to the website every few minutes; only **refresh the copied API block** when automations that rely on it start failing.
- **Not the same button:** **Settings → Agents → Copy embedding env** copies only embedding-related lines (e.g. Ollama URL / model comment) so local indexers match the Hub—it does **not** copy the Hub JWT.

**Example `curl` (create proposal):** `.env` alone does not attach headers; you must pass the bearer token explicitly.

```bash
curl -sS -X POST "${KNOWTATION_HUB_URL}/api/v1/proposals" \
  -H "Authorization: Bearer ${KNOWTATION_HUB_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "X-Vault-Id: ${KNOWTATION_HUB_VAULT_ID:-default}" \
  -d '{"path":"inbox/example.md","body":"# Proposed content","intent":"optional"}'
```

**Endpoints (same contract as CLI where applicable):**

| Action        | Method | Path              | Body/query |
|---------------|--------|-------------------|------------|
| List notes    | GET    | /notes            | folder, project, tag, limit, offset, order, fields, count_only |
| Get note      | GET    | /notes/{path}     | —          |
| Write note    | POST   | /notes            | path, body?, frontmatter?, append? |
| Search        | POST   | /search           | query, mode? (semantic\|keyword), match? (phrase\|all_terms), folder?, project?, tag?, limit?, order?, fields?, content_scope?, … |
| List proposals| GET    | /proposals        | status, limit, offset |
| Get proposal  | GET    | /proposals/:id    | —          |
| Create proposal | POST | /proposals        | path?, body?, frontmatter?, intent?, base_state_id? |
| Approve       | POST   | /proposals/:id/approve | base_state_id?, waiver_reason?, external_ref? |
| Discard       | POST   | /proposals/:id/discard | —    |
| Capture       | POST   | /capture          | body, source_id?, source?, project?, tags? (optional X-Webhook-Secret) |

**Machine-readable spec:** [openapi.yaml](./openapi.yaml). Use it for OpenAPI-based tool definitions (e.g. OpenAI function calling, LangChain tools).

**Human-readable contract:** [HUB-API.md](./HUB-API.md).

---

## 4. Proposals (review-before-commit)

- **Create:** CLI `knowtation propose`, Hub `POST /api/v1/proposals`, or the Hub UI (**Suggested → New proposal**, or open a note and **Propose change**). Agents use the same API contract.
- **Review:** In Hub UI: **Suggested** = proposals to review; **Discarded** = rejected; **Activity** = timeline.
- **Apply:** Approve in Hub (or API `POST /proposals/:id/approve`); content is written to vault.

**Metadata you can rely on:** Proposals support **`intent`** (why the change exists), **`base_state_id`** (optimistic concurrency against a known vault snapshot), and optional **`external_ref`** (stable id in another system after approve). Same fields in REST and MCP; full shapes in [HUB-API.md](./HUB-API.md) and [PROPOSAL-LIFECYCLE.md](./PROPOSAL-LIFECYCLE.md).

### Optional external lineage ([Muse](https://github.com/cgcardona/muse))

**Not required** for sign-in, search, or normal proposal workflows. The vault and Hub stay canonical.

Some teams run [Muse](https://github.com/cgcardona/muse) alongside Knowtation for **structural / Git-replayed history** (read-only lineage queries). If you do, keep Muse on **operator-controlled** credentials—never on an unauthenticated public URL for end users. When you **approve** a proposal, you may set **`external_ref`** to a Muse commit or branch id so the approved change is traceable across systems.

A **full Knowtation domain plugin inside Muse** (variations stored in Muse’s DAG, merge engine owned by Muse) is **not** a supported product path unless a concrete partner or deployment needs it. Long-form background for maintainers: [archive/MUSE-STYLE-EXTENSION.md](./archive/MUSE-STYLE-EXTENSION.md).

---

## 5. Capture (ingest into vault)

- **Hub:** `POST /api/v1/capture` with `{ "body": "...", "source_id?", "source?", "project?", "tags?" }`. Optional `X-Webhook-Secret` if configured.
- **Standalone webhook:** Use `scripts/capture-webhook.mjs` or adapters (Slack, Discord). See [MESSAGING-INTEGRATION.md](./MESSAGING-INTEGRATION.md) and [CAPTURE-CONTRACT.md](./CAPTURE-CONTRACT.md).

---

## 6. Function-calling / tool definitions

- **OpenAPI:** Use `docs/openapi.yaml` to generate client or tool schemas for Hub endpoints.
- **CLI:** Use [CLI-JSON-SCHEMA.md](./CLI-JSON-SCHEMA.md) for request/response shapes of `search`, `list-notes`, `get-note`, `write`, `propose`.
- **MCP:** MCP server exposes tools with the same semantics; schema can be derived from CLI/SPEC.

---

## References

| Doc | Role |
|-----|------|
| [SPEC.md](./SPEC.md) | Data format, CLI contract, §4.2 JSON shapes |
| [HUB-API.md](./HUB-API.md) | Hub REST and auth |
| [openapi.yaml](./openapi.yaml) | Hub OpenAPI 3.0 spec |
| [CLI-JSON-SCHEMA.md](./CLI-JSON-SCHEMA.md) | CLI JSON output for agents |
| [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md) | Token levers, retrieval options |
| [AGENT-ORCHESTRATION.md](./AGENT-ORCHESTRATION.md) | MCP, multi-agent usage |
| [MESSAGING-INTEGRATION.md](./MESSAGING-INTEGRATION.md) | Slack, Discord, capture adapters |
| [MEMORY-AUGMENTATION-PLAN.md](./MEMORY-AUGMENTATION-PLAN.md) | Memory providers, optional Supabase backend |
| [IMPORT-SOURCES.md](./IMPORT-SOURCES.md) | All import types and formats |
| [`scripts/supabase-memory-migration.sql`](../scripts/supabase-memory-migration.sql) | SQL for `knowtation_memory_events` + pgvector RPC |

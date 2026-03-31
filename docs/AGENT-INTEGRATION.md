# Agent integration — one page

**What this page is:** Knowtation is your **note vault + search index**. This page explains the three ways software—including AI assistants—can talk to it: **command line**, **MCP** (a standard plug-in protocol many IDEs use), and **Hub REST API**. You do not need to understand all three; pick the one your tool supports.

Integrate Knowtation with any agent (OpenAI, Claude, LangChain, LlamaIndex, custom runners). **Precise retrieval = fewer tokens:** use filters and limits so agents fetch only what they need; see [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md) for token levers. Three entry points: **CLI**, **MCP**, **Hub API**.

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

- **Start:** `knowtation mcp` (stdio transport).
- **Tools:** Same operations as CLI — search, get-note, list-notes, index, write, export, import. Same filters and JSON shapes. The **`search`** tool accepts **`mode`: `semantic` (default) or `keyword`** plus optional **`match`** (`phrase` \| `all_terms`) for keyword mode, aligned with `POST /api/v1/search`.
- **Scope hint:** On connect, the server sends MCP **`instructions`** naming your vault and data directory as `file://` URIs (Phase G). Add those folders as workspace roots in your MCP host when supported so the assistant’s context matches Knowtation.
- **Summarize (Phase F1):** The **`summarize`** tool uses the host’s LLM when the client supports **sampling**; otherwise it uses Ollama/OpenAI on the machine running Knowtation. See [MCP-PHASE-F.md](./MCP-PHASE-F.md).
- **Use case:** When the agent runtime speaks MCP; no need to shell out to CLI.

See [AGENT-ORCHESTRATION.md](./AGENT-ORCHESTRATION.md).

---

## 3. Hub API (REST)

- **Base URL:** e.g. `https://hub.example.com` (REST paths are under `/api/v1/...`).
- **Auth:** JWT via OAuth (Google/GitHub). Header on every protected request: `Authorization: Bearer <token>`.
- **Vault:** For vault-scoped routes, send header `X-Vault-Id` (e.g. `default` or the id shown in the Hub header). Match the vault you intend to act on.
- **Obtain URL + token + vault (no DevTools):** In the Hub, open **Settings → Integrations → Hub API** and click **Copy Hub URL, token & vault**. That copies `KNOWTATION_HUB_URL`, `KNOWTATION_HUB_TOKEN`, and `KNOWTATION_HUB_VAULT_ID` as lines you can paste into a shell or agent config. The JWT expires; re-login and re-copy when the API returns 401.
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
| Approve       | POST   | /proposals/:id/approve | base_state_id? |
| Discard       | POST   | /proposals/:id/discard | —    |
| Capture       | POST   | /capture          | body, source_id?, source?, project?, tags? (optional X-Webhook-Secret) |

**Machine-readable spec:** [openapi.yaml](./openapi.yaml). Use it for OpenAPI-based tool definitions (e.g. OpenAI function calling, LangChain tools).

**Human-readable contract:** [HUB-API.md](./HUB-API.md).

---

## 4. Proposals (review-before-commit)

- **Create:** CLI `knowtation propose`, Hub `POST /api/v1/proposals`, or the Hub UI (**Suggested → New proposal**, or open a note and **Propose change**). Agents use the same API contract.
- **Review:** In Hub UI: **Suggested** = proposals to review; **Discarded** = rejected; **Activity** = timeline.
- **Apply:** Approve in Hub (or API `POST /proposals/:id/approve`); content is written to vault.

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

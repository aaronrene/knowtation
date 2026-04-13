# Knowtation — Architecture

**Canonical spec:** Data formats, CLI surface, and contracts are defined in **[docs/SPEC.md](./docs/SPEC.md)**. The **[Whitepaper](./docs/WHITEPAPER.md)** covers the product thesis in depth including an architecture diagram (§15). This file is the structural overview.

---

## High-level system map

```
Sources (14 importers + 4 capture channels)
  ChatGPT, Claude, Mem0, Notion, Jira, Linear, NotebookLM, GDrive,
  MIF, Supabase, Markdown, Audio (Whisper), Video (Whisper), Wallet CSV
  + file/stdin, HTTP webhook, Slack/Discord/Telegram adapters
          │
          ▼
  Vault (Markdown + YAML frontmatter) ← source of truth, editor-agnostic
          │
          ├── Index: chunk → embed → vector store (Qdrant or sqlite-vec)
          │
          ├── Memory: event log + semantic recall + consolidation (5 providers)
          │
          └── Trust pipeline: proposals → review → attestation → ICP canister
          │
          ▼
  Agent surface
    CLI    — 25+ commands, JSON output, all filters and token levers
    MCP    — 33 tools, 23 resources, 13 prompts (stdio or HTTP)
    Hub    — REST API + web UI (self-hosted or hosted at knowtation.store)
```

---

## Deployment modes

### Self-hosted

Clone the repo, `npm install`, configure `config/local.yaml` (vault path, embedding provider, vector backend), run `npm run index` and optionally `npm run hub`. The vault, index, and memory data stay on your machine. Full control; no external dependencies beyond your chosen embedding provider.

### Hosted (knowtation.store)

Three services run on Netlify and the Internet Computer:

| Service | Technology | Role |
|---------|-----------|------|
| **Gateway** (`hub/gateway/`) | Node.js / Netlify Functions | OAuth (Google + GitHub), JWT auth, billing (Stripe), image proxy, MCP OAuth 2.1, rate limiting, request routing |
| **Bridge** (`hub/bridge/`) | Node.js / Netlify Functions | Vault operations, GitHub integration (backup/sync), team roles, import, memory consolidation |
| **Canister** (`hub/icp/`) | Motoko / Internet Computer | Vault note storage, attestation anchoring, admin functions, gateway-auth-gated API |

```
Browser / Agent
      │  HTTPS
      ▼
  Gateway (Netlify)  ──JWT──▶  Bridge (Netlify)
      │                               │
      │  X-Gateway-Auth               │  X-Gateway-Auth
      ▼                               ▼
  ICP Canister                   GitHub API
  (rsovz-byaaa-aaaaa-qgira-cai)  (vault backup)
```

The gateway and bridge communicate with the ICP canister using an `X-Gateway-Auth` shared secret. The browser never talks to the canister directly; all canister access is proxied through the gateway.

---

## Core components

### Vault

- **Format:** Markdown + YAML frontmatter. Editor-agnostic (Obsidian, SilverBullet, Foam, VS Code, or any text editor).
- **Layout:** `vault/inbox/`, `vault/captures/`, `vault/projects/<slug>/`, `vault/areas/`, `vault/archive/`, `vault/media/audio|video/`, `vault/templates/`, `vault/meta/`.
- **Portability:** The vault is a folder of files. Migrate by copying it. Version with Git for history and rollback.

### Index

Chunks vault notes by heading or size, embeds them, and upserts into the vector store. Metadata includes path, project, tags, dates, entity, episode, and causal chain fields. Supports:
- **sqlite-vec** — zero-server local SQLite file (default for self-hosted)
- **Qdrant** — separate vector database for production deployments

### Memory (5 providers)

| Provider | Storage | Semantic search |
|----------|---------|-----------------|
| file | Append-only JSONL + state.json | No |
| vector | File + embeddings in vector store | Yes |
| mem0 | File + Mem0 REST API dual-write | Yes |
| supabase | File + pgvector table | Yes |
| encrypted | AES-256-GCM at rest (scrypt key) | No |

Fifteen event types; three-pass consolidation (consolidate / verify / discover); session summaries; retention enforcement; cross-vault or per-vault scope.

### CLI

Primary interface. All commands output JSON with `--json`. Key subcommands: `search`, `get-note`, `list-notes`, `write`, `export`, `import`, `memory`, `propose`, `capture`, `transcribe`, `index`, `daemon`.

### MCP Server

33 tools, 23 resources, 13 prompts over stdio or HTTP transports. Wraps the same backend as the CLI. Hosted MCP adds OAuth 2.1 and role-gated access (viewer / editor / admin). Configure with `npm run mcp` or `npm run mcp:http`.

### Hub

Web UI and REST API. Features: Google/GitHub OAuth, proposals with LLM enrichment and rubric scoring, team roles (viewer/editor/admin/evaluator), invite-by-link, multi-vault, GitHub backup, image upload/proxy, Stripe billing, settings.

### Attestation and ICP anchoring

AIR (Attestation Integrity Records) records intent before writes and exports. HMAC-signed records can be dual-written to the ICP attestation canister (`dejku-syaaa-aaaaa-qgy3q-cai`) for immutable, decentralized audit trails. Pending records are anchored in batch via `POST /api/v1/attest/anchor-pending`.

### Billing (hosted)

Stripe-backed tiers (Free, Plus, Growth, Pro). Operations classified as: search, index, consolidation, note write, proposal write. Enforced when `BILLING_ENFORCE=true`; shadow mode logs usage without blocking. Token packs provide additional indexing capacity.

---

## Security

The codebase completed a 4-phase pre-launch security audit (Phases 0–3, April 2026). Key controls:
- `X-Gateway-Auth` shared secret gates all canister and bridge access
- JWT expiry: 24h (gateway), 1h (self-hosted)
- OAuth redirect token delivered via URL fragment (`#token=`), not query param
- Short-lived HMAC-signed image proxy tokens (5 min TTL)
- CORS locked to gateway origin on ICP canister when secret is set
- Role-based access control on all bridge write routes

See [`docs/SECURITY-AUDIT-PLAN.md`](./docs/SECURITY-AUDIT-PLAN.md) for the full remediation record.

---

## Interface contracts

- **CLI → Agent:** `--json` flag on all commands; error shape `{ "error": "...", "code": "..." }`; exit codes 0/1/2
- **MCP:** Tools mirror CLI semantics exactly; MCP is transport only
- **Hub REST API:** JWT bearer auth; documented in [`docs/HUB-API.md`](./docs/HUB-API.md)
- **Capture plugins:** Write Markdown to `vault/inbox/` with `source`, `date`, `source_id` frontmatter; contract in [`docs/CAPTURE-CONTRACT.md`](./docs/CAPTURE-CONTRACT.md)
- **Vault format:** Frontmatter schema in [`docs/SPEC.md`](./docs/SPEC.md)

---

## Key documentation

| Document | What it covers |
|----------|---------------|
| [docs/WHITEPAPER.md](./docs/WHITEPAPER.md) | Product thesis, architecture diagram, full feature inventory |
| [docs/SPEC.md](./docs/SPEC.md) | Frontmatter, CLI commands, config, MCP, contracts |
| [docs/HUB-API.md](./docs/HUB-API.md) | Hub REST API and auth |
| [docs/AGENT-ORCHESTRATION.md](./docs/AGENT-ORCHESTRATION.md) | Multi-agent setup |
| [docs/MEMORY-CONSOLIDATION-GUIDE.md](./docs/MEMORY-CONSOLIDATION-GUIDE.md) | Consolidation daemon |
| [docs/IMPORT-SOURCES.md](./docs/IMPORT-SOURCES.md) | All 14 importers |
| [docs/SECURITY-AUDIT-PLAN.md](./docs/SECURITY-AUDIT-PLAN.md) | Security audit phases and controls |

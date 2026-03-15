# Phase 11 Next: Complete Build Plan — All Gaps, Security, Messaging, UI

**Status:** Comprehensive plan. Nothing deferred. Execute in order; split into sessions if needed (Phase 11A core, 11B extended). Whitepaper and AgentCeption hackathon doc updates for this weekend.

---

## 1. Single data contract (human + agent)

Hub API, CLI, and MCP return **identical JSON shapes**. Agents and Hub UI consume the same note format. One contract; no separate "agent format."

---

## 2. Hub UI enhancements

| Item | Description | Files |
|------|-------------|-------|
| **Facets API** | `GET /api/v1/notes/facets` returns `{ projects, tags, folders }` for filter dropdowns | hub/server.mjs |
| **Title in list** | Add `title: n.frontmatter?.title ?? null` to path+metadata in list-notes | lib/list-notes.mjs |
| **Richer list rows** | Show title (or path), project chip, tag pills, date | web/hub/hub.js, hub.css |
| **Activity tab** | Proposal timeline: created → approved/discard with dates | web/hub/index.html, hub.js, hub.css |

---

## 3. Vault Git (user-friendly config)

**Config keys** (add to config schema and `local.example.yaml`):

| Key | Description |
|-----|-------------|
| `vault.git.enabled` | Turn Git sync on/off |
| `vault.git.remote` | Remote URL (e.g. `https://github.com/user/repo.git`) |
| `vault.git.auto_push` | Optional: auto-push after write/approve |
| `vault.git.auto_commit` | Optional: auto-commit on changes |

**CLI:** Optional `knowtation vault sync` — commit + push from vault root when enabled.

**Scope:** Abstraction only. No GitHub PR creation; proposals remain Hub-only. Vault in Git = backup and version history.

---

## 4. Whitepaper updates

| Section | Additions |
|---------|-----------|
| §4 Token minimization | Table of levers: `--limit`, `--fields`, `--count-only`, `--snippet-chars`, `--body-only`, `--frontmatter-only`; link RETRIEVAL-AND-CLI-REFERENCE |
| §6 Agent integration | Hub as agent backend (`KNOWTATION_HUB_TOKEN`); `knowtation propose --hub <url>` for review-before-commit |
| §7 or new | **Vault under Git:** config keys, optional sync; link PROVENANCE-AND-GIT |
| §7 or new | **Messaging integration:** Slack, Discord, Telegram → vault via Hub capture; link MESSAGING-INTEGRATION |
| §10 Roadmap | AgentCeption hackathon; link AGENTCEPTION-HACKATHON |
| References | AGENTCEPTION-HACKATHON, MESSAGING-INTEGRATION |

---

## 5. AgentCeption hackathon doc updates

| Section | Additions |
|---------|-----------|
| **Token and cost savings** | New section: table of levers, tiered retrieval, example flows |
| **Option C: Hub API** | Agents use `KNOWTATION_HUB_TOKEN` + Hub REST API; `propose` for review-before-commit |
| **Vault Git** | Bullet: vault in repo, push to GitHub; optional `vault.git.*` config |
| **Messaging integration** | Slack/Discord/Telegram → Hub capture → vault; adapters and MESSAGING-INTEGRATION |
| **What was built** | Token levers, Hub API for agents, vault Git config, messaging adapters |
| References | PROVENANCE-AND-GIT, HUB-API, MESSAGING-INTEGRATION |

---

## 6. LLM and agent compatibility (included)

| Item | Deliverable |
|------|-------------|
| **OpenAPI/Swagger spec for Hub** | `docs/openapi.yaml` or `hub/openapi.json` — machine-readable schema for Hub API |
| **JSON Schema for CLI outputs** | `docs/CLI-JSON-SCHEMA.md` — exact schema of search/list/get-note JSON per SPEC §4.2 |
| **Agent integration one-pager** | `docs/AGENT-INTEGRATION.md` — "Integrate Knowtation with any agent": CLI, MCP, Hub API; env vars; `curl` and `knowtation` examples |
| **Function-calling schemas** | Extract request/response schemas from OpenAPI and CLI-JSON-SCHEMA for OpenAI/LangChain/LlamaIndex tool definitions |
| **Content-Type** | Hub returns `Content-Type: application/json`; accept `Accept: application/json` where relevant |

---

## 7. Phase 12 groundwork (blockchain and agent payments)

**Phase 12 is a separate implementation.** Per [BLOCKCHAIN-AND-AGENT-PAYMENTS.md](./BLOCKCHAIN-AND-AGENT-PAYMENTS.md), the schema and CLI extensions are **reserved**, not implemented. No backtracking needed.

**What to do now (minimal groundwork):**

| Action | Why |
|--------|-----|
| **Add reserved frontmatter to SPEC** | Optional §2.4 "Reserved for Phase 12": `network`, `wallet_address`, `tx_hash`, `payment_status`. Notes remain valid without them. |
| **Add note in config schema** | "Reserved: Phase 12 may add `blockchain` or payment-related config." No keys now. |
| **Ensure filter extensibility** | list-notes and search already accept arbitrary query params; Hub passes them through. When Phase 12 adds `--network`, `--wallet`, we add parsing. No change now. |
| **Do NOT implement** | Indexer metadata for blockchain fields, CLI filters, capture plugins — Phase 12. |

**Summary:** Add a short "Reserved for Phase 12" subsection to SPEC listing the optional frontmatter fields. That's the only groundwork. Phase 12 is fully separate; no structural changes required.

---

## 8. Security review and recommendations

**User approved: yes to all security recommendations below.**

### 8.1 Current state (what exists)

| Area | Status |
|------|--------|
| **Path escape** | `resolveVaultRelativePath` in vault.mjs blocks `../`; write.mjs and readNote use it |
| **XSS** | Hub UI uses `escapeHtml()` for dynamic content |
| **Secrets** | .env, config/local.yaml gitignored |
| **JWT** | Bearer token, verified with secret |

### 8.2 Gaps and recommendations (all approved)

| Issue | Risk | Recommendation |
|-------|------|----------------|
| **JWT_SECRET fallback** | `'change-me-in-production'` if unset — weak default | Fail startup if `HUB_JWT_SECRET` missing and `NODE_ENV=production` |
| **CORS `origin: true`** | Accepts any origin — fine for local, risky if Hub is public | Add `HUB_CORS_ORIGIN` env; restrict in production to known origins |
| **Rate limiting** | No protection against brute force or API abuse | Add rate limit (express-rate-limit) for /api/v1/auth/login (5/min) and write/propose (100/15min per IP) |
| **Token in URL** | OAuth redirect puts JWT in `?token=...` — can leak via Referer, logs | Short-lived; consider `POST` callback with token in body or httpOnly cookie for production |
| **Proposals store** | hub_proposals.json is plaintext | Acceptable for MVP; document that sensitive proposals should not contain secrets; future: optional encryption at rest |
| **HTTPS** | Hub serves HTTP by default | Document: run behind reverse proxy (nginx, Caddy) with TLS in production |
| **Input validation** | Query params (limit, offset) parsed with parseInt | Add bounds: max limit 100; reject negative offset |
| **Audit log** | No log of who approved/discarded | **Required:** Append to `data/hub_audit.log` (user id, action, proposal_id, timestamp) on approve/discard |

### 8.3 Encryption

| Data | At rest | In transit |
|------|---------|------------|
| Vault notes | User responsibility (disk encryption, encrypted fs) | TLS via reverse proxy |
| Proposals | Plain JSON file | TLS via reverse proxy |
| JWT | Not stored | TLS recommended |
| OAuth secrets | In .env (gitignored) | OAuth uses HTTPS |

**Scope:** No application-level encryption of vault/proposals. Rely on TLS for transit; document disk encryption for sensitive deployments in `docs/DEPLOYMENT.md` or setup.

---

## 9. Performance recommendations

| Item | Recommendation |
|------|----------------|
| **Query bounds** | Cap `limit` at 100; reject negative `offset`. Already in security; enforce in Hub and CLI. |
| **Rate limiting** | Already in security. Use express-rate-limit (e.g. 100 req/15min per IP for API; 5/min for login). |
| **Facets caching** | Facets endpoint scans vault; cache result for 60s or invalidate on write to avoid rescan on every filter load. |
| **Search latency** | Document: re-index after bulk import; vector store (Qdrant/sqlite-vec) choice affects scale. |
| **Connection pooling** | Qdrant client: use default; sqlite-vec: single connection per process is fine. |
| **Large response bodies** | `--fields path` and `--limit` already control payload size; document for agents. |

---

## 10. Messaging systems integration (included)

| Item | Deliverable |
|------|-------------|
| **Hub capture endpoint** | `POST /api/v1/capture` — same contract as capture-webhook; optional JWT or `CAPTURE_WEBHOOK_SECRET` header; writes to vault via writeNote |
| **MESSAGING-INTEGRATION.md** | Doc: how to connect Slack, Discord, Telegram; expected POST body; example curl; Zapier/n8n flow; platform-specific webhook URLs |
| **Slack adapter** | `scripts/capture-slack-adapter.mjs` — receives Slack event format, transforms to our contract, POSTs to capture-webhook or writes directly |
| **Discord adapter** | `scripts/capture-discord-adapter.mjs` — receives Discord webhook, transforms, writes to vault |
| **Capture webhook auth** | Optional `CAPTURE_WEBHOOK_SECRET` env; if set, require `X-Webhook-Secret: <secret>` header; document in CAPTURE-CONTRACT |
| **Docs update** | CAPTURE-CONTRACT: add "Hub capture endpoint" and "Messaging integration" sections; link MESSAGING-INTEGRATION |

---

## 11. Easy wins and features (included)

| Item | Deliverable |
|------|-------------|
| **Refresh / re-index button** | Hub UI: button that calls `GET /api/v1/health` + triggers index (add `POST /api/v1/index` or CLI spawn) |
| **Keyboard shortcuts** | `j/k` list navigation, `/` focus search, `Esc` close detail |
| **Loading states** | Spinner or skeleton for list/search |
| **Empty states** | "No notes yet" / "No proposals" with link to import or propose |
| **Date range picker** | Hub UI: `--since` / `--until` as date inputs |
| **Export from Hub** | "Export selected" or "Export search results" — call export API or guide user to CLI |
| **Dark/light toggle** | `prefers-color-scheme` or toggle in Hub |
| **Responsive layout** | Stack filters on narrow screens; collapsible detail panel on mobile |
| **Copy path button** | One-click copy note path in detail panel |

---

## 12. UI recommendations (human-readable, agent-aligned)

- **List rows:** Title (or path), project chip, tag pills, date. Same fields agents see in API.
- **Detail panel:** Full content + metadata; show `project`, `tags`, `date`, `intention` when present.
- **Activity tab:** Proposal timeline (Muse-style "changes over time"); color by status (proposed/approved/discarded).
- **Search bar:** Keep prominent; add "Search in project" when project filter is set.
- **Consistency:** Use same field names (project, tags, path) in UI labels as in API and SPEC.

---

## 13. Deployment and operations

| Item | Deliverable |
|------|-------------|
| **HTTPS / reverse proxy** | `docs/DEPLOYMENT.md` or section in setup: run Hub behind nginx/Caddy with TLS; document env for production |
| **Disk encryption** | Document: for sensitive vaults, use disk encryption (LUKS, FileVault) or encrypted volume |
| **Production checklist** | `docs/DEPLOYMENT.md`: HUB_JWT_SECRET, CORS, rate limit, TLS, vault backup (Git) |

---

## 14. Implementation order (nothing deferred)

Execute in this order. Split into Phase 11A (core) and 11B (extended) if needed across sessions.

**Phase 11A — Core (security, Hub UI, audit, messaging):**

1. **Security** — JWT secret check in prod; `HUB_CORS_ORIGIN`; rate limit (express-rate-limit); input bounds (max limit 100, reject negative offset)
2. **Audit log** — Append to `data/hub_audit.log` on approve/discard (user id, action, proposal_id, timestamp)
3. **Facets + title** — `GET /api/v1/notes/facets`; add title to list-notes output; populate filter dropdowns in Hub UI
4. **Richer list rows** — Title (or path), project chip, tag pills, date in Hub UI
5. **Activity tab** — Proposal timeline in Hub UI
6. **Hub capture endpoint** — `POST /api/v1/capture`; same contract as capture-webhook; optional `CAPTURE_WEBHOOK_SECRET`; document in HUB-API

**Phase 11B — Messaging, LLM, docs, polish:**

7. **Messaging integration** — `docs/MESSAGING-INTEGRATION.md`; Slack adapter (`scripts/capture-slack-adapter.mjs`); Discord adapter (`scripts/capture-discord-adapter.mjs`); update CAPTURE-CONTRACT
8. **Phase 12 groundwork** — SPEC §2.4 reserved frontmatter (`network`, `wallet_address`, `tx_hash`, `payment_status`); config note
9. **Vault Git config** — `vault.git.enabled`, `vault.git.remote`, etc. in config; `knowtation vault sync` command
10. **Performance** — Query bounds (Hub + CLI); facets cache (60s); document re-index guidance
11. **LLM compatibility** — OpenAPI spec for Hub; `docs/CLI-JSON-SCHEMA.md`; `docs/AGENT-INTEGRATION.md`
12. **Whitepaper + hackathon doc** — Token tools, Hub, Vault Git, Phase 12 reserved, messaging integration
13. **DEPLOYMENT.md** — HTTPS, reverse proxy, production checklist
14. **Easy wins** — Loading/empty states, keyboard shortcuts, re-index button, copy path, date range picker, responsive layout

---

## 15. Future phases / backlog

Items to add to a future phase or fix as we find them:

| Item | Notes |
|------|--------|
| **Re-index from Hub** | Button or `POST /api/v1/index` to trigger indexer so search reflects new notes without running CLI. |
| **OpenAPI / AGENT-INTEGRATION** | ✅ OpenAPI: `docs/openapi.yaml`; `docs/CLI-JSON-SCHEMA.md`; `docs/AGENT-INTEGRATION.md`. |
| **Whitepaper + hackathon doc** | Content listed in §4–§5; update WHITEPAPER.md and AGENTCEPTION-HACKATHON.md when ready. |
| **Keyboard shortcuts** | j/k nav, / focus search, Esc close modals; document in How to use or UI. |
| **Date range picker** | ✅ Since/until date inputs in Hub filter bar; presets save/restore them. |
| **Responsive layout** | Hub usable on smaller screens; optional mobile-friendly tweaks. |
| **Vault sync automation** | ✅ `lib/vault-git-sync.mjs`: auto_commit/auto_push after Hub write, capture, approve. |
| **Settings / repo setup UX** | ✅ Hub **Settings** modal: vault + Git backup status, "How to set repository" instructions, **Back up now** (POST /vault/sync). GET /api/v1/settings, POST /api/v1/vault/sync. Repo still set in config; UI shows status and triggers sync. |
| **Hosted plug-and-play** | Plan: [HOSTED-PLUG-AND-PLAY.md](./HOSTED-PLUG-AND-PLAY.md). Paid users; we host; zero config, no YAML; “Connect GitHub” and “Connect an agent” wizards. |
| **Connect GitHub + Setup wizard** | ✅ Implemented. B: Setup wizard (GET/POST /setup, data/hub_setup.yaml, merge in config). A (self-hosted): Connect GitHub OAuth (github-connect, callback, token in data/github_connection.json); vault sync uses token for push. See [NEXT-STAGES-AND-RECOMMENDATIONS.md](./NEXT-STAGES-AND-RECOMMENDATIONS.md). |

---

## 16. References

| Document | Role |
|----------|------|
| [HUB-API.md](./HUB-API.md) | API contract |
| [MUSE-STYLE-EXTENSION.md](./MUSE-STYLE-EXTENSION.md) | Proposals, review, Muse pattern |
| [AGENT-ORCHESTRATION.md](./AGENT-ORCHESTRATION.md) | MCP, CLI, AgentCeption |
| [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md) | Token levers |
| [PROVENANCE-AND-GIT.md](./PROVENANCE-AND-GIT.md) | Vault under Git |
| [WHITEPAPER.md](./WHITEPAPER.md) | Product narrative |
| [AGENTCEPTION-HACKATHON.md](./AGENTCEPTION-HACKATHON.md) | Hackathon integration |
| [BLOCKCHAIN-AND-AGENT-PAYMENTS.md](./BLOCKCHAIN-AND-AGENT-PAYMENTS.md) | Phase 12 reserved schema |
| [CAPTURE-CONTRACT.md](./CAPTURE-CONTRACT.md) | Capture plugin contract |
| [MESSAGING-INTEGRATION.md](./MESSAGING-INTEGRATION.md) | Slack, Discord, Telegram integration |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Production deployment, HTTPS, checklist |
| [HOSTED-PLUG-AND-PLAY.md](./HOSTED-PLUG-AND-PLAY.md) | Plan for hosted paid product (zero config, we maintain) |
| [NEXT-PHASE-SETUP-OPTIONS.md](./NEXT-PHASE-SETUP-OPTIONS.md) | Simple explanation: Connect GitHub (hosted) vs Setup wizard (self-hosted); doing both |
| [NEXT-STAGES-AND-RECOMMENDATIONS.md](./NEXT-STAGES-AND-RECOMMENDATIONS.md) | What was built (Setup + Connect GitHub); what remains; recommended next steps |

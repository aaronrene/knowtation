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

**Hosted:** Stored on the billing user record (`consolidation_lookback_hours`, `consolidation_max_events_per_pass`, `consolidation_max_topics_per_pass`, `consolidation_llm_max_tokens`); the gateway merges them into `GET /api/v1/settings` (`daemon.*`) and into proxied `POST /api/v1/memory/consolidate`; the scheduler includes them in the JSON body to the bridge; the bridge merges any missing fields with the same billing record before running `consolidateMemory`.

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
| **D** | Hosted Advanced (billing + gateway + scheduler + bridge body) | **Done** | `lib/hosted-consolidation-advanced.mjs`, `hub/gateway/billing-logic.mjs`, `hub/gateway/server.mjs`, `netlify/functions/consolidation-scheduler.mjs`, `hub/bridge/server.mjs`, tests |
| **E** | Hosted MCP `search`: POST + parity fields | **Done** | `hub/gateway/mcp-hosted-server.mjs`, `test/mcp-hosted-search.test.mjs` |
| **F** | Pre-launch security/privacy review | **Done** | Opus-class model |

Use a **stronger reasoning model or human review** for **Phase D** (billing correctness), **Phase E** (API contract), and **Phase F** (compliance-style copy).

## Phase F — Pre-launch security & privacy checklist

Audited on branch `feature/token-savings` by strongest-model review. Each row: risk area, current behavior (with code reference), gap assessment, and fix status.

### 1. Subprocessors & LLM data flow

| Risk | Current behavior | Gap | Fix |
|------|-----------------|-----|-----|
| Consolidation prompts send event data to third-party LLM | `buildConsolidationPrompt` (`lib/memory-consolidate.mjs:38-47`) sends `JSON.stringify(e.data).slice(0,300)` per event when `encrypt` is false. When `encrypt` is true, only `[ts] type (event payload omitted)` is sent. | No gap — matches docs. | OK |
| Discover pass sends topic facts to LLM | `buildDiscoverPrompt` (`lib/memory-consolidate.mjs:101-114`) sends fact text when encrypt is false; topic names only when encrypt is true. | Consistent with consolidation. | OK |
| Bridge search uses embedding API | `getBridgeEmbeddingConfig` (`hub/bridge/server.mjs:86-119`) — OpenAI or Ollama. Search queries are embedded; no note body sent for search. | Documented; inherent to semantic search. | OK |
| MCP hosted server proxies to bridge/canister | `mcp-hosted-server.mjs` — search → bridge, notes → canister. Auth token is the user's own JWT. | Not leaked to third parties. | OK |

### 2. Tokens & secrets

| Risk | Current behavior | Gap | Fix |
|------|-----------------|-----|-----|
| GitHub tokens encrypted at rest | `encrypt`/`decrypt` (`hub/bridge/server.mjs:166-181`) use AES-256-GCM with `scryptSync(secret, 'salt', 32)` | Static salt `'salt'` reduces brute-force resistance. Acceptable when SESSION_SECRET is strong (≥32 chars). | LOW — recommend per-record random salt in future pass (requires migration). |
| JWT signing | Gateway and self-hosted hub sign with SESSION_SECRET / HUB_JWT_SECRET. Both require the secret in production. | Gateway default expiry is `7d`; self-hosted is `1h`. 7d is long for a bearer token. | LOW — acceptable for hosted OAuth flow; configurable via `HUB_JWT_EXPIRY`. |
| No API keys logged | Verified: `console.log` calls never include `api_key`, `access_token`, `secret`, or JWT values. Bridge embedding log explicitly logs `openai_key_set: Boolean(…)` — never the key itself. | No gap found. | OK |
| LLM API key in bridge env | `CONSOLIDATION_LLM_API_KEY` / `OPENAI_API_KEY` read from env only, never stored to disk or returned in responses. | No gap. | OK |

### 3. Data retention & privacy claims

| Risk | Current behavior | Gap | Fix |
|------|-----------------|-----|-----|
| Memory events capped | Blob-backed hosted: `blobsSetMemoryEvents` caps at 500 events. | Adequate for current scale. | OK |
| Consolidation cost record | Per-user JSON stores `last_pass`, `cost_today_usd`, `pass_count_month` — no note content. | No sensitive data. | OK |
| Privacy copy matches code | TOKEN-SAVINGS.md §Privacy: encrypt=false → truncated JSON (≤300 chars); encrypt=true → type+timestamp only. `buildConsolidationPrompt` matches exactly. Hub index.html updated in Phase A1. | Matches. | OK |
| Consolidation does not send full note files | Prompts are built from `event.data`, not note bodies. Fragments of user text in `event.data` are possible (search queries captured as events). Documented honestly. | Matches claim. | OK |

### 4. Logging redaction

| Risk | Current behavior | Gap | Fix |
|------|-----------------|-----|-----|
| Error responses expose `e.message` to clients | Bridge returns `e.message` in ~25 error handlers. Gateway unhandled error handler returns `err.message` to client. | MEDIUM — internal error messages could leak file paths or DB errors to clients. | FIX APPLIED — unhandled error handlers now return generic message to client while keeping detailed server log. |
| Billing shadow log | `billing-middleware.mjs:83-95` logs `user_id`, `operation`, `path`, `cost_cents` — no note body or JWT. | Acceptable operational data. | OK |

### 5. Auth boundaries

| Risk | Current behavior | Gap | Fix |
|------|-----------------|-----|-----|
| Bridge auth | `requireBridgeAuth` verifies JWT → uid for all mutation routes. | Consistent. | OK |
| Gateway auth | `getUserId` extracts sub from JWT for all `/api/v1` routes. Catch-all returns 401 if no uid. | Consistent. | OK |
| Self-hosted hub auth | `jwtAuth` on all API routes. Login rate limited (5/min). API rate limited (100/15min). | Strong. | OK |
| Vault isolation (hosted) | `resolveHostedBridgeContext` checks `allowedVaultIds` before every data op; 403 if not allowed. Vault ID sanitized. | Consistent. | OK |
| MCP tool ACL | `isToolAllowed` filters tools by role (viewer/editor/admin). | Consistent. | OK |

### 6. XSS & injection (Hub browser)

| Risk | Current behavior | Gap | Fix |
|------|-----------------|-----|-----|
| Note body rendering | `renderNoteMarkdownHtml` uses `marked.parse` + `DOMPurify.sanitize` with `SANITIZE_OPTS_NOTE` (forbids event handlers; allows only `https:`, `mailto:`, `ftp:` URIs). Falls back to `escapeHtml`. | Strong. DOMPurify v3.0.8. | OK |
| Search results / facet dropdowns | Use `escapeHtml(p)` for user-controlled strings throughout. | Consistent. | OK |
| Consolidation history table | Test confirms `<script>` is escaped to `&lt;script&gt;`. | Tested. | OK |
| No Content-Security-Policy | Neither gateway nor bridge set a CSP header. | LOW — DOMPurify mitigates most XSS; CSP would add defense-in-depth. | Recommended for future; not blocking for launch. |
| No `eval()` or `document.write` | Grep confirmed zero calls in hub.js. | OK | OK |

### 7. API abuse & cost limits

| Risk | Current behavior | Gap | Fix |
|------|-----------------|-----|-----|
| Consolidation cooldown | 30-min server-side cooldown in bridge. Returns 429 with `retry_after_minutes`. | Strong. | OK |
| Billing gate | `runBillingGate` enforces tier-based caps when `BILLING_ENFORCE=true`. Shadow log when false. | Comprehensive. | OK |
| Body size limits | Bridge: 1MB. Gateway: 10MB (import proxy). Self-hosted: configurable, default 5MB. | Reasonable. | OK |
| Self-hosted rate limits | Login: 5/min. API: 100/15min. Image upload: separate limiter. | Strong. | OK |
| Gateway rate limits | No `express-rate-limit`. Relies on Netlify Lambda concurrency + billing gate. | LOW — acceptable for serverless; add rate limiting if moved to VPS. | Documented. |
| MCP rate limit | `mcp-proxy.mjs` implements per-user sliding-window rate limiter. | OK | OK |

### 8. SSRF / proxy safety

| Risk | Current behavior | Gap | Fix |
|------|-----------------|-----|-----|
| Image proxy URL validation | Bridge and gateway restrict to `raw.githubusercontent.com` URLs via regex. Prevents SSRF to internal services. | Strong. | OK |
| Bridge CORS | `HUB_CORS_ORIGIN \|\| '*'`. Wildcard without credentials is acceptable. Production should set `HUB_CORS_ORIGIN`. | Documented. | OK |
| Gateway CORS | `cors-middleware.mjs` echoes allowed origin from `HUB_CORS_ORIGIN` list, or `*` with no credentials. | Correct. | OK |

### Summary

- **High severity issues found:** 0
- **Medium severity issues found:** 1 (error message leakage in unhandled error handlers — fixed)
- **Low severity / recommended improvements:** 3 (static scrypt salt, no CSP, no gateway rate-limit outside Netlify)
- **Privacy claims vs code:** All match after Phase B encrypt-redaction.

### Manual checks still needed

- [ ] Smoke-test staged Hub (hosted) — login, search, consolidation dry-run, note CRUD
- [ ] Smoke-test self-hosted Hub — same operations with local Ollama
- [ ] Verify `.env` is in `.gitignore`
- [ ] Confirm DOMPurify CDN version (3.0.8) has no known CVEs at release time
- [ ] Review Netlify function logs post-deploy for any unexpected data in log output

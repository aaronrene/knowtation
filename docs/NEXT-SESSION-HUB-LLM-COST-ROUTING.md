# Next session: Hub LLM cost routing (**hosted Hub only**)

> ## Decision: DeepInfra single-provider — 2026-04-30 — **SHIPPED & STABLE in production**
>
> **Status (2026-05-01):** ✅ DeepInfra is live in production for both chat **and** embeddings on the hosted Hub. Production flip happened with PR #201 (`feat(hub): DeepInfra chat + embeddings, enrich audit, Paperclip deploy pack`). The post-flip indexing scalability cleanup is also complete (see "Indexing scalability initiative" section below). **Next session focus shifts to the Paperclip-on-AWS work in `docs/marketing-internal/RUNBOOK-VIDEO-FACTORY-2026-04-30.md` Steps 7–9.**
>
> Production-state evidence (May 1 2026 bridge logs, Business vault re-index):
> - `[bridge] embedding (no secrets): {"provider":"deepinfra","model":"BAAI/bge-large-en-v1.5",...}`
> - `chunks_indexed:251, chunks_skipped_cached:251, mode:"sync", total_ms:1371`
> - "Last indexed: N minutes ago" UI line confirmed working end-to-end after PR #207.
>
> **What was decided:** Replace per-feature LLM providers (OpenAI primary, Anthropic fallback, separate Voyage / OpenAI embeddings, juggling ElevenLabs / image-gen keys) with a **single DeepInfra OpenAI-compatible key** (`DEEPINFRA_API_KEY`). The same key drives:
> - hosted Hub chat (review hints + Enrich) via `lib/llm-complete.mjs` when `KNOWTATION_CHAT_PROVIDER=deepinfra`.
> - hosted bridge embeddings via `EMBEDDING_PROVIDER=deepinfra`.
> - OpenClaw 4.27 orchestration (chat, embeddings, image gen, TTS, audio understanding) — same key.
>
> **Why this and not Groq / OpenRouter / self-hosted Ollama:** Groq had rate limits / capability gaps that bit prior research; OpenRouter adds another middleman; self-hosted Ollama needs a $15–20/mo VPS reachable from Netlify. DeepInfra: one key, OpenAI wire format (drops into existing `lib/llm-complete.mjs` with one new branch), Qwen 2.5 / Llama 3.x / Mistral chat models, BGE / Qwen embedding models, **and** OpenClaw 4.27 made it a first-class bundled provider — so the OpenClaw conveyor belt and hosted Hub share one bill, one rotation, one place to watch spend.
>
> **Backward compatibility (verified by 17 unit tests in `test/llm-complete-deepinfra.test.mjs`):**
> 1. `KNOWTATION_CHAT_PROVIDER=deepinfra` → DeepInfra wins, with OpenAI / Anthropic as automatic fallback if their keys are still set.
> 2. `KNOWTATION_CHAT_PROVIDER=openai|anthropic` → explicit lock to that provider (no fallback).
> 3. **Implicit DeepInfra:** only fires when `DEEPINFRA_API_KEY` is set AND neither `OPENAI_API_KEY` nor `ANTHROPIC_API_KEY` is set. Existing OpenAI deploys are NOT silently flipped by adding a DeepInfra key for OpenClaw.
> 4. Otherwise: existing OpenAI → Anthropic → Ollama default order is preserved (and `KNOWTATION_CHAT_PREFER_ANTHROPIC=1` still flips OpenAI/Anthropic order when both are set).
>
> **Required gates before production flip on Netlify (do NOT skip):**
> - Run `node scripts/validate-deepinfra-enrich.mjs` with `KNOWTATION_CHAT_PROVIDER=deepinfra` on a staging Netlify deploy. Pass condition: 10/10 of the built-in Enrich samples must return `parseOk=true` and produce only allow-list frontmatter keys. If <10/10, do **not** flip — try a stronger model (`Qwen/Qwen2.5-72B-Instruct` is the default; for cheap review hints set `DEEPINFRA_CHAT_MODEL=meta-llama/Meta-Llama-3.1-8B-Instruct` only after validating the chosen model still passes Enrich).
> - Re-index a non-production vault on `EMBEDDING_PROVIDER=deepinfra` + `EMBEDDING_MODEL=BAAI/bge-large-en-v1.5` and verify Meaning search returns the same top-3 notes for 10 known queries. Embedding-dimension change requires a full vault re-index (1024 dim by default; see `embeddingDimension` in `lib/embedding.mjs`).
>
> **Production flip:** On the **gateway** Netlify site: `DEEPINFRA_API_KEY`, `KNOWTATION_CHAT_PROVIDER=deepinfra`, optionally `DEEPINFRA_CHAT_MODEL`. Keep `OPENAI_API_KEY` set for fallback. On the **bridge** Netlify site (when separate): `DEEPINFRA_API_KEY`, `EMBEDDING_PROVIDER=deepinfra`, `EMBEDDING_MODEL=BAAI/bge-large-en-v1.5`, then re-index. Watch `proposal-review-hints-async` + `proposal-enrich-hosted` logs for 24h. Roll back by removing `KNOWTATION_CHAT_PROVIDER` (chat falls back to OpenAI) and switching `EMBEDDING_PROVIDER` back on the bridge (then re-index on the prior model).
>
> **What this supersedes from the original options table below:** the "Groq via OpenAI-compat", "Remote Ollama on small VPS", and "Hybrid" rows. The DeepInfra row is the answer for our scale and time budget. The remaining Groq / Ollama notes stay only as historical alternatives in case DeepInfra has an outage longer than fallback can absorb.
>
> **Owner:** repo author (this branch).
> **Reviewers:** none required for code (all tests green); operator must run the staging validation script before flipping production env vars.
>
> ---

## Indexing scalability initiative — COMPLETE (2026-05-01, PRs #202–#207)

> **Why this section exists:** the DeepInfra production flip surfaced an unrelated cluster of indexing-path bugs (Netlify timeouts, no incremental cache, dimension-mismatch crash on provider switch, no observability for long-running re-indexes). This was solved in a single 2-hour session via 6 chained PRs. **Future agents picking up next-session work should not re-investigate any of these symptoms — they are fixed and tested.**

| PR | Branch | What it shipped | Tests added |
|---|---|---|---|
| **#202** | `fix/index-timing-and-timeout-audit` | Per-step structured timing logs (`knowtation_index_step` / `knowtation_index_done`); raised Netlify function timeouts gateway+bridge 26→60 s | ~6 |
| **#203** | `feat/bridge-embed-hash-cache` | Content-hash incremental cache (skip unchanged chunks); bounded parallel embed (`runWithConcurrency`, default N=5, batch=50); 429 backoff respecting `Retry-After`. Effect: full 251-chunk re-index 65 s → 10–15 s; cache hits ~1.4 s. Frontend `noRetry: true` on `POST /api/v1/index` | ~30 |
| **#204** | `fix/bridge-vector-store-dim-and-hash-model-binding` | Bridge `allow_dimension_migration: true` flag (auto drop+recreate vec0 table on dim mismatch); content hash now includes provider+model (`v1:<provider>:<model>:<32-hex>`) so same-dim model swaps invalidate cache instead of silently corrupting | ~12 |
| **#205** | `feat/bridge-index-auto-routing` | Auto-routing: large/first-time/dim-migration jobs → `bridge-index-background` Netlify Background Function (15-min cap, HMAC-signed kickoff); small jobs stay sync. Job lock (16-min TTL, overwrite-on-stale), last-indexed sidecar in Netlify Blobs, passive "Last indexed: N ago" UI line, `GET /api/v1/index/status` endpoint | ~30 |
| **#206** | `hotfix/bridge-index-background-kickoff-routing` | Defense-in-depth: `assertBackgroundKickoffOk(response)` validates the kickoff fetch returned HTTP 202 (Netlify background-fn signal). Any non-202 → throws → catch handler releases lock + returns 502 with diagnostic body. Also documented Netlify's auto-exemption of `/.netlify/...` paths from user redirects (a misdiagnosed earlier hotfix attempted to add a `from = "/.netlify/functions/*"` rule which Netlify rejects at deploy time) | ~11 |
| **#207** | `hotfix/gateway-index-status-proxy` | Gateway proxy for `GET /api/v1/index/status` (the missing companion to the bridge route from #205). Deliberately runs WITHOUT the billing gate — sidecar reads on every Hub page load must stay free | ~2 |

**Production failure modes that are now impossible** (each backed by tests in `test/bridge-*.test.mjs`, `test/gateway-index-status-proxy.test.mjs`, `test/parallel-embed-pool.test.mjs`, `test/chunk-content-hash.test.mjs`, `test/embedding-deepinfra-429-backoff.test.mjs`):

1. ❌ Silent timeout-then-double-bill on retry
2. ❌ Re-index loops re-embedding unchanged chunks
3. ❌ Dimension-mismatch crash on provider swap
4. ❌ Silent corruption on same-dimension model swap (e.g., BGE-large → BGE-m3)
5. ❌ 30–60 s sync timeout on large vaults
6. ❌ Concurrent background jobs double-billing the same vault
7. ❌ Silent kickoff failure showing false "Large re-index started" toast
8. ❌ Empty UI status line after successful index

**Net architectural state:** the indexing path is now observable (per-step JSON logs), self-healing (overwrite-on-stale lock, automatic dim migration), cache-efficient (provider+model-bound content hash), defense-in-depth at every kickoff boundary, and scalable to 15-minute background jobs without UX impact for the 99 % cache-hit case.

**Total tests in the project after this initiative: 1895 / 1894 pass / 0 fail / 1 skipped.**

---

## Next session focus (2026-05-02 onwards): Paperclip on AWS

The DeepInfra+indexing chain is ready to feed the Paperclip video factory. Open work, in order, lives in `docs/marketing-internal/RUNBOOK-VIDEO-FACTORY-2026-04-30.md`:

- **Step 6** (your hands): Pair ElevenLabs voice into HeyGen avatar, render 30-sec sample.
- **Step 7b** (agent supplies): Terraform at `deploy/paperclip/terraform/` for AWS t3.medium + IAM + SSM Parameter Store namespace + Tailscale join URL output. **This is the next coding task on `feat/paperclip-aws-terraform`.**
- **Step 8** (agent supplies): `deploy/paperclip/install.sh`, `push-secrets.sh`, `hello-world-test.sh`, `wire-knowtation-mcp.sh`, `load-skills-and-agents.sh`.
- **Step 8c** (agent supplies): 5 reusable Knowtation skills + 18 conveyor-belt agents (6 × 3 projects) + 1 controller agent + 3 render bridges (HeyGen, ElevenLabs, Descript).
- **Step 9** (your hands): First parallel run for all 3 projects, review, approve, upload.

**Starting branch:** `feat/paperclip-aws-terraform` (this branch).

---


## Scope (read first)

| In scope for this plan | Out of scope (not the target of “save money” here) |
|------------------------|------------------------------------------------------|
| **Hosted Knowtation Hub**: the app backed by **`hub/gateway`** on **Netlify** (or any serverless/long-lived cloud deploy of the same gateway), including **Netlify environment variables** that drive chat for production users | **Local development**: your laptop’s default LLM, local **`npm run hub`**, local **CLI / daemon** (`daemon-llm.mjs`, `config/local.yaml`) — those may *benefit from the same code changes later* but are **not** what this document is optimizing for cost |
| Dollar impact: **OpenAI / Anthropic bills** triggered by **hosted** traffic (proposal review hints, proposal Enrich, hosted MCP paths that call `completeChat`, etc.) | “I want cheaper models when I run knowtation at home” — separate conversation; localhost **Ollama already works** locally without this plan |

**Summary:** This document is about **cloud / hosted Hub spend** (API keys and URLs on the **gateway’s deploy**, e.g. Netlify), **not** about replacing your local dev setup.

---

Use this document to **plan research and implementation** for reducing or eliminating **OpenAI API** spend on Knowtation **hosted Hub** features that call `completeChat()` (`lib/llm-complete.mjs`), especially:

- **Proposal review hints** (`hub/gateway/proposal-review-hints-async.mjs`)
- **Proposal Enrich** (`hub/gateway/proposal-enrich-hosted.mjs`)
- **MCP summarize**, **hosted MCP**, or other **gateway** paths that import `completeChat` in the same deploy

**Embeddings** (indexing / Meaning search on the **hosted bridge**) are a **separate** configuration (`EMBEDDING_PROVIDER`, bridge env, `embedding.*` in config). This session focuses on **chat** completions for the **gateway** unless you explicitly decide to align bridge + gateway secrets in one pass.

---

## Current behavior (facts from repo)

1. **`completeChat`** provider order: **`OPENAI_API_KEY` set → OpenAI**; else **`ANTHROPIC_API_KEY` → Anthropic**; else **Ollama** at `OLLAMA_URL` + `/api/chat` with `OLLAMA_CHAT_MODEL` / `OLLAMA_MODEL` (default `llama3.2`).
2. **Optional** `KNOWTATION_CHAT_PREFER_ANTHROPIC=1` when **both** OpenAI and Anthropic keys exist.
3. **Hosted Netlify** cannot reach `http://localhost:11434`. On **hosted** Hub, Ollama only works if `OLLAMA_URL` points to a **publicly reachable** host (your VPS, Fly.io, etc.).
4. **`daemon-llm.mjs`** already supports **OpenAI-compatible** endpoints (`callOpenAiCompat`, custom `base_url`) for **local daemon** flows; **hosted proposal jobs** use `completeChat` directly today, not `daemonLlm`.
5. **BornFree** (`bornfree-hub`) uses **Groq** (OpenAI-compatible `…/v1/chat/completions`) with env keys and a provider fallback chain — a proven pattern for low/zero marginal cost **hosted** chat.

---

## Problem statement

- **Goal:** On **hosted Hub**, keep **review hints**, **Enrich**, **MCP summarize**, and related **gateway** LLM features **functionally equivalent** (quality acceptable for internal/advisory use) while **avoiding per-token OpenAI bills** where possible.
- **Constraint:** Prefer **no** new always-on server only if a **managed API** (Groq, Together, OpenRouter, etc.) is sufficient for **Netlify-side** calls; accept a **small VPS + Ollama/vLLM** ($15–20/mo) if traffic, privacy, or rate limits require it.

---

## Research checklist (assign owners / dates)

### A. Volume and cost (hosted)

- [ ] Export **Netlify / gateway logs** or billing: approximate **chat calls per day** (hints + enrich + MCP summarize + hosted MCP).
- [ ] Estimate **tokens per call** (hints/enrich caps in code: e.g. `maxTokens: 400`, body slices ~12k chars).
- [ ] Price **OpenAI `gpt-4o-mini`** vs **Groq** vs **OpenRouter** small models at that volume.

### B. Provider capabilities

- [ ] **Groq:** rate limits, free tier caps, model list (Llama 3.x), JSON reliability for **Enrich** (structured JSON output).
- [ ] **Together / Fireworks / other:** OpenAI-compat URL, pricing, EU data residency if needed.
- [ ] **Self-hosted Ollama or vLLM** (reachable from Netlify): GPU RAM for chosen model, cold start, TLS, auth in front of `/api/chat`.

### C. Code touchpoints

- [ ] Single place to extend: **`lib/llm-complete.mjs`** (add optional `OPENAI_COMPAT_BASE_URL` + key env, or `KNOWTATION_CHAT_PROVIDER=groq`) vs duplicating in each gateway module.
- [ ] **Tests:** mock `fetch` for chat URL; assert provider selection order when env combinations change.
- [ ] **Docs:** `.env.example`, `docs/HUB-PROPOSAL-LLM-FEATURES.md`, **Netlify** deploy notes (explicit: “set on hosted site, not only in local `.env`”).

### D. Risk

- [ ] **Enrich** prompts require **valid JSON**; smaller/weaker models may break `validateAndNormalizeEnrichResult` — need eval samples or stricter repair prompt.
- [ ] **Hints** are plain text; lower risk.
- [ ] **Secrets:** never commit keys; document `GROQ_API_KEY` or compat vars in **Netlify** UI only.

---

## Implementation options (high level)

| Option | New server? | Marginal API cost | Notes |
|--------|-------------|-------------------|--------|
| **Groq (or OpenRouter) via OpenAI-compat** in `completeChat` | No | Low / free tier | Align with BornFree; one env block on **Netlify**. |
| **Remote Ollama** on small VPS | Yes (~$15–20/mo) | Electricity + VPS | Full control; set **`OLLAMA_URL`** on Netlify to that host; not localhost. |
| **Hybrid** | Optional | Embeddings on Voyage/OpenAI, chat on Groq/Ollama | Already conceptually split in docs. |

---

## Suggested decision flow

1. If **hosted** call volume is low and **Groq free tier** covers it → implement **OpenAI-compat base URL** in `completeChat`, point at Groq on **Netlify**, **unset `OPENAI_API_KEY`** for chat (or add explicit “chat provider” override so embeddings can keep OpenAI if desired).
2. If **rate limits or JSON quality** bite → try **paid Groq** or **OpenRouter** mid model before self-hosting.
3. If **data must not leave your infra** → **VPS + Ollama** reachable from Netlify; keep embeddings on current provider or run `nomic-embed-text` etc. on same box.

---

## Deliverables for the PR that implements routing

- [ ] Env vars documented and **backward compatible** (default unchanged if only `OPENAI_API_KEY` set on hosted).
- [ ] Unit tests for provider selection.
- [ ] **Staging Netlify** deploy: run **create proposal** + confirm **review hints** and **Enrich** end-to-end.

---

## Related files

- `lib/llm-complete.mjs` — chat routing (shared; **hosted gateway** loads this)
- `lib/daemon-llm.mjs` — `callOpenAiCompat` reference (**local daemon**; useful pattern for hosted `completeChat`)
- `hub/gateway/proposal-review-hints-async.mjs`, `proposal-enrich-hosted.mjs`
- `docs/HUB-PROPOSAL-LLM-FEATURES.md`
- `bornfree-hub/api/lib/llm.js` — Groq-first pattern (cross-repo reference)

---

## Hint timeout context (fixed separately)

On **hosted** Hub, hints run inside a **18s** race after `POST /proposals`. Merging **client `body`** into the hints job avoids an extra canister **GET** and reduces timeouts; see PR introducing `proposal-hints-create-context.mjs` (merged via `fix/review-hints-merge-client-body`).

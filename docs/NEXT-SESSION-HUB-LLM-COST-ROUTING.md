# Next session: Hub LLM cost routing (**hosted Hub only**)

> ## Decision: DeepInfra single-provider — 2026-04-30
>
> **Status:** code on `feat/hosted-mcp-hub-create-proposal`; staging validation pending; production flip pending.
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

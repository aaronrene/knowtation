# Proposal LLM (Enrich + review hints) — shipped checklist

Handoff for future work (e.g. regenerate hints). Core **Plan A + Plan B** are implemented in-repo.

---

## Implemented (verify after deploy)

| Area | What shipped |
|------|----------------|
| **Plan A — UX + self-hosted API** | [web/hub/hub.js](../web/hub/hub.js): **Enrich** for **`canEvaluate`** with **`hubUserMayEnrichProposal()`** (evaluators are not blocked by `hubUserCanWriteNotes()`). [hub/server.mjs](../hub/server.mjs): **`POST …/enrich`** allows **`evaluator`** alongside editor/admin. |
| **Plan B — hosted Enrich** | [hub/icp/src/hub/Migration.mo](../hub/icp/src/hub/Migration.mo): stable **V4** enrich fields (`assistant_*`, `suggested_labels_json`). [hub/icp/src/hub/main.mo](../hub/icp/src/hub/main.mo): **`POST …/enrich`**, GET proposal JSON includes enrich + **`suggested_labels`**. [hub/gateway/proposal-enrich-hosted.mjs](../hub/gateway/proposal-enrich-hosted.mjs) + [hub/gateway/server.mjs](../hub/gateway/server.mjs): gateway handles **`POST /api/v1/proposals/:id/enrich`**. |
| **Chat backends** | [lib/llm-complete.mjs](../lib/llm-complete.mjs): **OpenAI** → **Anthropic** (`ANTHROPIC_API_KEY`) → **Ollama**. [hub/gateway/proposal-review-hints-async.mjs](../hub/gateway/proposal-review-hints-async.mjs): model label includes Anthropic. |

**Operators:** Deploy **hub canister** before relying on hosted Enrich (migration from pre-V4 storage). Set **`KNOWTATION_HUB_PROPOSAL_ENRICH=1`** on the gateway with a reachable chat API. See [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md), [hub/gateway/README.md](../hub/gateway/README.md), [HUB-PROPOSAL-LLM-FEATURES.md](./HUB-PROPOSAL-LLM-FEATURES.md).

---

## Optional follow-ups

- **Regenerate review hints** — `POST` + UI + rate limits (not implemented).
- **Per-user / team caps** on LLM calls (cost/abuse).

---

## Documents and code

| Topic | Path |
|--------|------|
| Feature overview | [HUB-PROPOSAL-LLM-FEATURES.md](./HUB-PROPOSAL-LLM-FEATURES.md) |
| API | [HUB-API.md](./HUB-API.md) (`POST /proposals/:id/enrich`) |
| Gateway | `hub/gateway/server.mjs`, `proposal-review-hints-async.mjs`, `proposal-enrich-hosted.mjs` |
| Self-hosted Enrich | `hub/server.mjs` |
| Canister | `hub/icp/src/hub/main.mo`, `Migration.mo` |

---

## Security and ops (unchanged)

- **LLM output is not authorization** — hints and Enrich are **advisory**; humans still approve/discard.
- **PII and secrets** — proposal **body** may be sent to the model; avoid logging full bodies in production; disclose in policy if needed.
- **Cost and abuse** — cloud API calls cost money; consider **per-user caps** or **admin-only** Enrich on large teams.
- **Timeouts** — serverless gateways have tight limits; long models may need **async jobs** + polling (hints already fire-and-forget with `setImmediate`).
- **Never commit** `.env`, API keys, or private URLs; verify before push.

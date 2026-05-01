# Hub: proposal review hints vs Enrich (LLM)

Two **optional** features use a **chat**-capable model for **proposals only** (not the same subsystem as **Meaning search embeddings**). Neither is a merge gate; humans still approve or discard.

### Embeddings vs chat (operators)

| Lane | Purpose | Typical env / config |
|------|---------|----------------------|
| **Embeddings** | Indexer + **Meaning** search vectors | `embedding.provider`: `ollama`, `openai`, or `voyage`; keys `OPENAI_API_KEY` (OpenAI), `VOYAGE_API_KEY` (Voyage), or local Ollama. **Anthropic does not expose a public embeddings API** — use another provider for vectors. |
| **Chat** | Review hints + **Enrich** (`completeChat` in [`lib/llm-complete.mjs`](../lib/llm-complete.mjs)) | See **chat provider selection** below. Default unchanged: `OPENAI_API_KEY` → `ANTHROPIC_API_KEY` → Ollama. |

Hosted **bridge** index/search uses **`EMBEDDING_PROVIDER`** / **`EMBEDDING_MODEL`** (see [`hub/bridge/README.md`](../hub/bridge/README.md)); **`voyage`** is supported the same way as `openai` with **`VOYAGE_API_KEY`**.

### Chat provider selection (`completeChat`)

Resolved in this order (first match wins):

1. **`KNOWTATION_CHAT_PROVIDER=deepinfra`** + `DEEPINFRA_API_KEY` → **DeepInfra** (OpenAI-compatible). Falls back to OpenAI then Anthropic if their keys are set and DeepInfra returns an error.
2. **`KNOWTATION_CHAT_PROVIDER=openai`** → OpenAI only (no fallback). Requires `OPENAI_API_KEY`.
3. **`KNOWTATION_CHAT_PROVIDER=anthropic`** → Anthropic only (no fallback). Requires `ANTHROPIC_API_KEY`.
4. **Implicit DeepInfra:** `DEEPINFRA_API_KEY` set **and** neither `OPENAI_API_KEY` nor `ANTHROPIC_API_KEY` set → DeepInfra. (Backward compatible — never preempts an existing OpenAI/Anthropic deployment.)
5. **`KNOWTATION_CHAT_PREFER_ANTHROPIC=1`** with both OpenAI and Anthropic keys → Anthropic first, OpenAI fallback.
6. **Default:** OpenAI → Anthropic → Ollama.

**DeepInfra notes (hosted Hub cost lane):**

- One OpenAI-compatible API key (`DEEPINFRA_API_KEY`) covers chat (Qwen 2.5, Llama 3.x, Mistral), embeddings, image generation, and TTS — the same key works for OpenClaw orchestration.
- Default chat model is `Qwen/Qwen2.5-72B-Instruct`; override with `DEEPINFRA_CHAT_MODEL`. For the cheap **review hints** path, set `DEEPINFRA_CHAT_MODEL=meta-llama/Meta-Llama-3.1-8B-Instruct` (or pass `config.llm.deepinfra_chat_model` per-call).
- **Enrich JSON validation:** before flipping production, run the saved Enrich prompts through `validateAndNormalizeEnrichResult` against your chosen DeepInfra model and confirm 10/10 of your known-good samples still parse. Smaller models may need a stricter system prompt.
- **Netlify production:** set `DEEPINFRA_API_KEY` and `KNOWTATION_CHAT_PROVIDER=deepinfra` in the gateway site's deploy env (not just `.env` locally). Keep `OPENAI_API_KEY` as fallback if you want automatic recovery on DeepInfra outages.

## Review hints (plain text for reviewers)

**What it does:** After a proposal is created, an async job asks the model for **2–6 short lines** of informal reminders (risks, unclear scope, things to verify). The model is instructed **not** to say pass/fail/approve. Output is stored as plain text on the proposal and shown in the Hub **proposal detail** panel (Activity → open a proposal) under a **Review hints** block when `review_hints` is non-empty.

**Implementation:** `lib/hub-proposal-review-hints-job.mjs` → `completeChat()` (`lib/llm-complete.mjs`).

**Self-hosted (Node Hub):**

1. Set **`KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS=1`** in the environment where **`npm run hub`** runs.
2. Configure **chat** the same way as other LLM features: **OpenAI** (`OPENAI_API_KEY`, optional `OPENAI_CHAT_MODEL`), **Anthropic** (`ANTHROPIC_API_KEY`, optional `ANTHROPIC_CHAT_MODEL`), and/or **Ollama** (`OLLAMA_URL`, `OLLAMA_CHAT_MODEL`). Optional **`KNOWTATION_CHAT_PREFER_ANTHROPIC=1`** when both OpenAI and Anthropic keys exist. See `lib/llm-complete.mjs` and `config/local.yaml` / env used by the Hub process. (**Meaning search** still follows `embedding.*` / `EMBEDDING_PROVIDER`, not these chat keys.)
3. Creating a proposal via **`POST /api/v1/proposals`** on that Hub triggers `setImmediate(() => runProposalReviewHintsJob(...))` in `hub/server.mjs`. Hints are written to **`data/hub_proposals.json`** (local file store).
4. Refresh the proposal in the UI after a few seconds; hints are not a modal—they appear **inline** in the drawer when present.

**Hosted (gateway + canister):**

- The **canister** stores hints when **`POST /api/v1/proposals/:proposal_id/review-hints`** is called with JSON body `{"review_hints":"...","review_hints_model":"..."}` (see `hub/icp/src/hub/main.mo`).
- The **gateway** runs an **async** job after a **successful** **`POST /api/v1/proposals`**: when **`KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS=1`** on the gateway process, it calls `maybeScheduleHostedProposalReviewHints` (`hub/gateway/proposal-review-hints-async.mjs`), which fetches the new proposal, runs **`completeChat()`** (`lib/llm-complete.mjs`) with the same Ollama/OpenAI env as self-hosted, then **POST**s hints to the canister. Hints appear in the Hub drawer after a short delay (refresh if needed).
- **Deploy requirement:** The **Netlify (or other) function** that runs the gateway must have a **reachable** chat backend (typically **OpenAI** in production; localhost **Ollama** is not reachable from Netlify). If the env flag is on but the model call fails, hints simply stay empty—check gateway logs.

**JSON / import shaping:** Review hints are **not** JSON schema for notes or imports. They do not pre-fill frontmatter or tags.

---

## Enrich (summary + suggested labels)

**What it does:** On demand, **`POST /api/v1/proposals/:id/enrich`** asks the model for **JSON**: `{"summary":"...","suggested_labels":["tag",...]}`. The Hub stores `assistant_notes`, `assistant_model`, and suggested labels on the proposal record. The UI shows an **Enrich (AI)** button on proposed items when the feature is enabled (`web/hub/hub.js`).

**Roadmap — richer metadata:** We plan to extend Enrich so the model also recommends **vault-aligned frontmatter** (e.g. `project`, `title`, `causal_chain_id`, `entity`, `episode_id`, `follows`, and other fields from [SPEC.md](./SPEC.md) §2), not only summary and tags. That work is specified in **[PROPOSAL-ENRICH-EXTENSION-PLAN.md](./PROPOSAL-ENRICH-EXTENSION-PLAN.md)** (storage, validation, Hub UI, canister/gateway parity). Until that ships, Enrich remains summary + `suggested_labels` only.

**Self-hosted:** Set **`KNOWTATION_HUB_PROPOSAL_ENRICH=1`** on the Node Hub; same Ollama/OpenAI chat config as above. Route is implemented in **`hub/server.mjs`**.

**Hosted:** The **gateway** implements **`POST /api/v1/proposals/:id/enrich`** when **`KNOWTATION_HUB_PROPOSAL_ENRICH=1`**: it runs **`completeChat()`** ([lib/llm-complete.mjs](../lib/llm-complete.mjs)) and **POST**s `assistant_notes`, `assistant_model`, and **`suggested_labels_json`** (JSON array string) to the **canister** at the same path. The canister stores fields on the proposal; **deploy the hub canister** from this repo so stable storage includes enrich columns (V4 migration). **Chat env** on the gateway: typically **OpenAI** or **Anthropic** on Netlify (localhost **Ollama** is not reachable from serverless).

### Privacy (operators)

Proposal **body** (and path/intent) are sent to the configured chat API when hints or Enrich run. That content **leaves your deployment** to the provider unless you use **local Ollama** on self-hosted with no cloud API keys. There is no way to get cloud-model quality with zero data egress to the vendor; disabling **`KNOWTATION_HUB_PROPOSAL_*`** env flags avoids LLM calls entirely.

---

## Settings rows (Backup tab)

| Row | Meaning |
|-----|--------|
| **Review hints (LLM)** | `KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS === '1'` on the process answering **`GET /api/v1/settings`** (Node Hub or gateway). On **hosted**, the **gateway** must also have a working **chat** env (e.g. OpenAI) or async hint generation will no-op/fail silently. |
| **Proposal evaluation gate** | Policy/triggers for requiring human evaluation before approve; separate from LLM hints. |

---

## Related (not Enrich v1)

**New note / import assistants** that pre-fill Markdown for arbitrary captures are a **separate** product path from proposal Enrich. **Enrich** stays **proposal-scoped**; the **extended Enrich** plan still targets the **proposal review** surface and approved-note metadata alignment — see [PROPOSAL-ENRICH-EXTENSION-PLAN.md](./PROPOSAL-ENRICH-EXTENSION-PLAN.md).

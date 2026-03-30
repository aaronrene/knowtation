# Hub: proposal review hints vs Enrich (LLM)

Two **optional** features use a chat-capable model (Ollama or OpenAI) for **proposals only**. Neither is a merge gate; humans still approve or discard.

## Review hints (plain text for reviewers)

**What it does:** After a proposal is created, an async job asks the model for **2–6 short lines** of informal reminders (risks, unclear scope, things to verify). The model is instructed **not** to say pass/fail/approve. Output is stored as plain text on the proposal and shown in the Hub **proposal detail** panel (Activity → open a proposal) under a **Review hints** block when `review_hints` is non-empty.

**Implementation:** `lib/hub-proposal-review-hints-job.mjs` → `completeChat()` (`lib/llm-complete.mjs`).

**Self-hosted (Node Hub):**

1. Set **`KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS=1`** in the environment where **`npm run hub`** runs.
2. Configure chat the same way as other LLM features: **Ollama** (e.g. `OLLAMA_URL`, `OLLAMA_CHAT_MODEL`) and/or **OpenAI** (`OPENAI_API_KEY`, optional `OPENAI_CHAT_MODEL`). See `lib/llm-complete.mjs` and `config/local.yaml` / env used by the Hub process.
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

## Future: “every interaction” JSON pre-fill for notes

That would be a **different** product path (e.g. import pipeline or **New note** assistant), not the current review-hints or enrich flows. Today, **Enrich** is the only built-in JSON-shaped LLM output for proposals (`summary` + `suggested_labels`), and it is **proposal-scoped**, not global.

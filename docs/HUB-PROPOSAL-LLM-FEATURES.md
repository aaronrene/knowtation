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

- The **canister** can **store** hints: **`POST /api/v1/proposals/:proposal_id/review-hints`** with JSON body `{"review_hints":"...","review_hints_model":"..."}` (see `hub/icp/src/hub/main.mo`).
- The **gateway does not** run the review-hints job today. **`POST /api/v1/proposals`** on hosted goes to the canister only; there is no Netlify/Node step that calls `runProposalReviewHintsJob` and then POSTs hints back.
- If **`KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS=1`** is set on the **gateway**, Settings shows **Review hints (LLM): On**, but **hints will not appear** until some **operator-owned worker** (e.g. bridge scheduled job, serverless function) implements: create proposal hook → LLM → canister `review-hints` POST. That worker is **not** shipped in this repo yet.

**JSON / import shaping:** Review hints are **not** JSON schema for notes or imports. They do not pre-fill frontmatter or tags.

---

## Enrich (summary + suggested labels)

**What it does:** On demand, **`POST /api/v1/proposals/:id/enrich`** asks the model for **JSON**: `{"summary":"...","suggested_labels":["tag",...]}`. The Hub stores `assistant_notes`, `assistant_model`, and suggested labels on the proposal record. The UI shows an **Enrich (AI)** button on proposed items when the feature is enabled (`web/hub/hub.js`).

**Self-hosted:** Set **`KNOWTATION_HUB_PROPOSAL_ENRICH=1`** on the Node Hub; same Ollama/OpenAI chat config as above. Route is implemented in **`hub/server.mjs`**.

**Hosted:** The **canister has no `/enrich` route**. If the UI calls enrich against the gateway, the proxied request will **not** succeed until enrich is implemented for hosted (e.g. gateway handler that calls LLM then updates canister fields—**not** present today).

---

## Settings rows (Backup tab)

| Row | Meaning |
|-----|--------|
| **Review hints (LLM)** | `KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS === '1'` on the process answering **`GET /api/v1/settings`** (Node Hub or gateway). Does not prove hints are generated on hosted. |
| **Proposal evaluation gate** | Policy/triggers for requiring human evaluation before approve; separate from LLM hints. |

---

## Future: “every interaction” JSON pre-fill for notes

That would be a **different** product path (e.g. import pipeline or **New note** assistant), not the current review-hints or enrich flows. Today, **Enrich** is the only built-in JSON-shaped LLM output for proposals (`summary` + `suggested_labels`), and it is **proposal-scoped**, not global.

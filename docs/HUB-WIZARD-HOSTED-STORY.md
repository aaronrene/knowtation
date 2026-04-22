# Hub wizard + hosted story — implementation checklist

**Branch:** `feature/hub-wizard-hosted-story`  
**North star doc:** [WHY-KNOWTATION.md](./WHY-KNOWTATION.md) (positioning, proposals, glossary guidance).  
**Purpose:** Track **UI + copy + small product** work so marketing, Hub onboarding, and MCP story stay aligned.

---

## Phase 1 — Shipped on branch (initial)

- [x] **Landing structured-memory block** on [web/index.html](../web/index.html): differentiation, proposals, expanded glossary chips, `<details>` for technical depth + links to docs. **Layout:** collapsed **hero** `<details>` under main CTAs; **full** section after **Ecosystem visions**, before **Control, customize…**. Doc links use high-contrast blue.
- [x] **WHY-KNOWTATION.md** (this repo) — canonical differentiation and proposal copy.
- [x] **This checklist** — execution backlog for follow-on PRs.

---

## Phase 2 — Homepage + marketing

**Status:** **Complete** on branch `feature/hub-wizard-hosted-story` (Band B + meta description + tests). Optional UX research below remains open until someone writes it.

- [x] **Band B** on `web/index.html`: explicit **1 · 2 · 3** (note/import → add agents → ask your AI) directly under Band A; link hosted Hub + self-host quick start (step 1) and related docs in steps 2–3.
- [x] **Meta description** refresh to mention proposals / human gate if character budget allows.
- [ ] Optional **`docs/UX-SIMPLICITY-REFERENCE-RESEARCH.md`** — long-form research (generic pattern names, ecosystem compaction as optional local add-on).

---

## Phase 3 — Hub wizard (`web/hub/`)

- [x] **Step 0 / hero**: memory home + honest two-line token story (vault-side vs terminal-side).
- [x] **Path picker**: “Bring my stuff in” vs “Connect my AI first”.
- [x] **Embed Integrations** (copy MCP + future prime) inside wizard.
- [x] **Per-platform import cards** (OpenAI, Anthropic, OpenClaw) + **LLM self-help export prompt** (copyable).
- [x] **Proposals** line: where Suggested lives; link [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) §4.
- [x] **Empty-vault strip** if wizard dismissed (same 1-2-3 + link to Getting started).
- [x] **“Power tools for agents”** panel: MCP prompts / tools bullets → AGENT-INTEGRATION.

---

## Phase 4 — MCP + CLI bolt-ons

- [ ] **`knowtation://…` bootstrap MCP resource** + Hub **Copy prime**.
- [ ] **`knowtation doctor`** (hosted vs self-hosted checks per [WHY-KNOWTATION.md](./WHY-KNOWTATION.md) token section).
- [ ] **Evaluate:** MCP tool **summarize pasted blob** (hosted parity: auth, rate, billing).
- [ ] **Surface MCP prompts** in docs/wizard (`temporal-summary`, `resume-session`, …) per [PARITY-MATRIX-HOSTED.md](./PARITY-MATRIX-HOSTED.md).

---

## Phase 5 — Docs polish

- [ ] Refresh [AI-ASSISTED-SETUP.md](./AI-ASSISTED-SETUP.md) for **hosted** path + prime placeholder + wizard deep links.
- [ ] **Hub proposals discoverability** (nav or empty-state CTA) — engineering task in `web/hub/hub.js` + `index.html`.
- [ ] **Hub Settings + How to use — hosted-first UX** — fold self-hosted-only and heavy technical blocks behind **Self-hosted** / **How?** / **Technical details** (`<details>`); consistent icon/label for self-hosted. Handoff: [HUB-SETTINGS-HOSTED-UX-PASS.md](./HUB-SETTINGS-HOSTED-UX-PASS.md).

---

## Non-goals (unchanged)

- Do not claim **canister-side terminal hooks** for log compaction.
- Do not use unprovable **“nobody else”** marketing; use **documented differentiators** from this repo.

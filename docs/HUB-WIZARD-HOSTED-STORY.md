# Hub wizard + hosted story — implementation checklist

**Branch:** `feature/hub-wizard-hosted-story`  
**North star docs:** [WHITEPAPER.md](./WHITEPAPER.md) (thesis), [TOKEN-SAVINGS.md](./TOKEN-SAVINGS.md) (retrieval vs cost), [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) (proposals §4).  
**Purpose:** Track **UI + copy + small product** work so marketing, Hub onboarding, and MCP story stay aligned.

---

## Phase 1 — Shipped on branch (initial)

- [x] **Landing structured-memory block** on [web/index.html](../web/index.html): differentiation, proposals, expanded glossary chips, `<details>` for technical depth + links to docs. **Layout:** collapsed **hero** `<details>` under main CTAs; **full** section after **Ecosystem visions**, before **Control, customize…**. Doc links use high-contrast blue.
- [x] **WHITEPAPER.md** + **TOKEN-SAVINGS.md** — differentiation and token discipline copy.
- [x] **This checklist** — execution backlog for follow-on PRs.

---

## Phase 2 — Homepage + marketing

**Status:** **Complete** on branch `feature/hub-wizard-hosted-story` (Band B + meta description + tests). Optional UX research below remains open until someone writes it.

- [x] **Band B** on `web/index.html`: explicit **1 · 2 · 3** (note/import → add agents → ask your AI) directly under Band A; link hosted Hub + self-host quick start (step 1) and related docs in steps 2–3.
- [x] **Meta description** refresh to mention proposals / human gate if character budget allows.
- [ ] Optional **UX simplicity research** — capture in a local notes folder if needed (not shipped in this repo).

---

## Phase 3 — Hub wizard (`web/hub/`)

**Status:** **Complete** on branch `feature/hub-wizard-hosted-story` — nine-step hosted wizard (memory + token story, path picker, Integrations copy, import platforms + copyable LLM export prompt, proposals + §4 link, first note/backup, power tools), empty-vault strip after “Skip for now”, Settings/Integrations follow-ups (Hub API order, buttons, inline **How?** on Integrations lede), landing hero CTA accent borders, Band B links borderless. Phase 5 continues **hosted vs self-hosted** clarity work.

- [x] **Step 0 / hero**: memory home + honest two-line token story (vault-side vs terminal-side).
- [x] **Path picker**: “Bring my stuff in” vs “Connect my AI first”.
- [x] **Embed Integrations** (copy MCP + future prime) inside wizard.
- [x] **Per-platform import cards** (OpenAI, Anthropic, OpenClaw) + **LLM self-help export prompt** (copyable).
- [x] **Proposals** line: where Suggested lives; link [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) §4.
- [x] **Empty-vault strip** if wizard dismissed (same 1-2-3 + link to Getting started).
- [x] **“Power tools for agents”** panel: MCP prompts / tools bullets → AGENT-INTEGRATION.

---

## Phase 4 — MCP + CLI bolt-ons

**Status:** **Complete** on branch `feature/hub-wizard-hosted-story` (prime resources, Hub Copy prime, `knowtation doctor`, blob-summarize evaluation no-ship, prompts surfaced in docs + wizard + How to use → Knowledge & agents).

- [x] **`knowtation://…` bootstrap MCP resource** + Hub **Copy prime**.
- [x] **`knowtation doctor`** (hosted vs self-hosted checks per [TOKEN-SAVINGS.md](./TOKEN-SAVINGS.md)).
- [x] **Evaluate:** MCP tool **summarize pasted blob** (hosted parity: auth, rate, billing) — **no ship**; see [MCP-BLOB-SUMMARIZE-EVALUATION.md](./MCP-BLOB-SUMMARIZE-EVALUATION.md).
- [x] **Surface MCP prompts** in docs/wizard (`temporal-summary`, `resume-session`, …) per [PARITY-MATRIX-HOSTED.md](./PARITY-MATRIX-HOSTED.md).

---

## Phase 5 — Docs polish + hosted-first clarity

**Docs polish:** Continue from [AI-ASSISTED-SETUP.md](./AI-ASSISTED-SETUP.md) and [HUB-SETTINGS-HOSTED-UX-PASS.md](./HUB-SETTINGS-HOSTED-UX-PASS.md); keep session prompts in a **local `development/`** tree if you use Cursor handoffs.

- [x] Refresh [AI-ASSISTED-SETUP.md](./AI-ASSISTED-SETUP.md) for **hosted** path + **Copy prime** placeholder (after Phase 4) + wizard deep links.
- [x] **Hub proposals discoverability** (nav or empty-state CTA) — engineering task in `web/hub/hub.js` + `index.html`.
- [x] **Hub Settings + How to use — hosted-first UX** — `web/hub/index.html` + `hub.css`: hosted callout on **How to use → Setup**; full install steps under **Self-hosted** `<details>`; Knowledge/Media/Consolidation/Token tabs tightened; **Settings → Backup**/**Integrations** leads and technical env paths under `details` / `settings-json-details`. [HUB-SETTINGS-HOSTED-UX-PASS.md](./HUB-SETTINGS-HOSTED-UX-PASS.md) checkboxes updated.
  - **Layman first, technical tucked away (same pattern as Phase 4 tail):** For **each** major **How to use** tab/section and **Settings** blocks where it helps, put a **short plain-English** lead in the main column; move env var names, URI schemes, code fences, OAuth/JWT/MCP depth, and self-hosted-only paths under a **`<details class="how-to-details">`** (summary e.g. **Technical details** or **Self-hosted details**). **Precedent in repo:** How to use → **Knowledge & agents** → **Hosted MCP: secrets vs “prime” bootstrap** in `web/hub/index.html` (committed on this branch). **Also:** Integrations tab inline **How?** for Hub API (`settings-integ-how-inline` in `hub.css`).
  - **Default surface:** plain language for what a hosted user needs first; no walls of env vars, ports, or disk paths in the primary column.
  - **Self-hosted:** any block that only applies to disk vault, `config/local.yaml`, `ffmpeg`, `git init`, local adapters, etc. → fold under a clearly labeled **Self-hosted** section (same icon/label everywhere — pick one and document it in the handoff doc).
  - [x] **Wizard (optional):** second pass so hosted wizard lines do not dump self-hosted jargon; mirror the same layman / `<details>` pattern where easy.
  - **Per-tab execution checklist:** [HUB-SETTINGS-HOSTED-UX-PASS.md](./HUB-SETTINGS-HOSTED-UX-PASS.md).

---

## Non-goals (unchanged)

- Do not claim **canister-side terminal hooks** for log compaction.
- Do not use unprovable **“nobody else”** marketing; use **documented differentiators** from this repo.

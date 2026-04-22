# Hub Settings + “How to use” — hosted-first UX pass (handoff)

**Goal:** Hosted users see **simple, non-intimidating** copy first. Anything that only applies to **self-hosted** (paths, YAML, env vars, `ffmpeg`, Git on disk, …) or deep **technical** detail is folded behind clear affordances: **Self-hosted** (with a consistent icon/label), **How?**, **Technical details**, or `<details>` blocks. Cross-path concepts (JWT, MCP) can use **How?** / shared “technical” disclosure when both audiences need the same footnote.

**Checklist parent:** [HUB-WIZARD-HOSTED-STORY.md](./HUB-WIZARD-HOSTED-STORY.md) **Phase 5**.

**Precedents shipped on branch `feature/hub-wizard-hosted-story`:**

- Settings → **Integrations** lede: inline **How?** `<details>` for Hub API (`web/hub/index.html`, `web/hub/hub.css` — search `settings-integ-how-inline`).
- How to use → **Knowledge & agents** → **Hosted MCP: secrets vs “prime” bootstrap:** layman-first paragraphs, then **`<details class="how-to-details">`** for URIs, env names, MCP `readResource` / `prompts/list`, and `knowtation doctor` (`web/hub/index.html`). **Phase 5 extends this pattern to all How to use tabs and Settings blocks** (see [NEXT-SESSION-PHASE-5-HOSTED-DOCS.md](./NEXT-SESSION-PHASE-5-HOSTED-DOCS.md)).
- **Self-hosted label in UI** — use plain-English **`<summary>`** lines (e.g. `Self-hosted setup — …`); no separate icon asset required. Hosted-first lead: **`how-to-hosted-lead`** in `hub.css`.

**Session prompt:** Use the fenced block in [NEXT-SESSION-PHASE-5-HOSTED-DOCS.md](./NEXT-SESSION-PHASE-5-HOSTED-DOCS.md) (“Session prompt (paste into Cursor)”) — not the duplicate block below unless you want a shorter reminder.

**Scope:** `web/hub/index.html` (Settings modals), How to use panels in the same file, and any linked copy in `web/hub/hub.js` that injects settings strings.

**Non-goals:** Do not remove documented behavior from the repo; **relocate and label**, do not delete safety text.

---

## ~~Copy-paste prompt~~ → use NEXT-SESSION-PHASE-5-HOSTED-DOCS.md

The **canonical** Phase 5 session prompt (includes layman + `<details>` pattern for **all** sections) lives in **[NEXT-SESSION-PHASE-5-HOSTED-DOCS.md](./NEXT-SESSION-PHASE-5-HOSTED-DOCS.md)** under **Session prompt (paste into Cursor)**.

Quick reminder (subset of that prompt):

```text
Hosted-first Settings + How to use: layman lead; technical + self-hosted under <details>.
Precedent: Knowledge & agents → Hosted MCP prime section in web/hub/index.html.
Check off tabs in this file’s checklist as you go.
```

---

## Checklist (execute in the session above)

- [x] **Backup** — Hosted-first intro + Status context; self-hosted `hub_roles` / heavy proposal explainer → **Technical details** / `details` (`web/hub/index.html`); Danger zone & Configure backup still contain operator-level detail (relocated where noted).
- [x] **Integrations** — Capture/Import lede; tiles plain-English; ports/API/ffmpeg → **details** blocks.
- [x] **How to use** — **Setup:** hosted callout + self-hosted in `<details>`; **Getting started**, **Knowledge & agents**, **Media**, **Memory consolidation** (privacy), **Token savings** updated for layman + technical fold-outs.
- [x] **Icons** — Summaries use text **“Self-hosted”**; no new SVG (documented here).

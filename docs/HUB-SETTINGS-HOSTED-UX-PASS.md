# Hub Settings + “How to use” — hosted-first UX pass (handoff)

**Goal:** Hosted users see **simple, non-intimidating** copy first. Anything that only applies to **self-hosted** (paths, YAML, env vars, `ffmpeg`, Git on disk, …) or deep **technical** detail is folded behind clear affordances: **Self-hosted** (with a consistent icon/label), **How?**, **Technical details**, or `<details>` blocks. Cross-path concepts (JWT, MCP) can use **How?** / shared “technical” disclosure when both audiences need the same footnote.

**Checklist parent:** [HUB-WIZARD-HOSTED-STORY.md](./HUB-WIZARD-HOSTED-STORY.md) **Phase 5**. **Precedent shipped on branch:** Settings → **Integrations** lede uses an inline **How?** `<details>` for Hub API context (`web/hub/index.html`, styles in `web/hub/hub.css` — search `settings-integ-how-inline`).

**Scope:** `web/hub/index.html` (Settings modals), How to use panels in the same file, and any linked copy in `web/hub/hub.js` that injects settings strings.

**Non-goals:** Do not remove documented behavior from the repo; **relocate and label**, do not delete safety text.

---

## Copy-paste prompt for a focused session

Use on branch `feature/hub-wizard-hosted-story` (or main after merge). Adjust file paths if your clone differs.

```text
Knowtation Hub — hosted-first Settings + How to use pass

Read docs/HUB-SETTINGS-HOSTED-UX-PASS.md and docs/HUB-WIZARD-HOSTED-STORY.md Phase 5.

Task: In web/hub/index.html (Settings + How to use), reduce cognitive load for hosted users:
1. Detect or infer “hosted-only” vs “self-hosted-only” vs “both” per paragraph/block (use vault_path_display / canister patterns already in hub.js where needed).
2. Default visible copy = hosted-relevant plain language. Move self-hosted-only content under a <details> or labeled section titled “Self-hosted” with a consistent icon (same icon everywhere).
3. Shared technical depth (JWT, headers, MCP) → “How?” inline <details> or “Technical details” <details>, not wall-of-code in the main column.
4. Keep AGENT-INTEGRATION / IMPORT-SOURCES links; prefer “Open doc” buttons or one line + link instead of long inline code fences in the primary column.
5. Match existing hub.css variables (--accent, --border). Bump hub.css ?v= when changing styles.
6. Run npm test. Commit with message scoped to this UX pass; do not merge to main unless asked.

Deliver: incremental PR-sized edits; list each Settings tab + How to use tab touched in the commit message body.
```

---

## Checklist (execute in the session above)

- [ ] **Backup** — Hosted: repo field + Connect + Back up first; self-hosted: vault path, `git init`, YAML mentions → under **Self-hosted**.
- [ ] **Integrations** — Capture/Import first; Hub API; fold ports/env adapter lists where possible.
- [ ] **How to use** — Mirror the same pattern per tab (Getting started, Setup, …).
- [ ] **Icons** — Pick one SVG or emoji for “Self-hosted” and reuse (document choice in commit).

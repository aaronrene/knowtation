# Next session — Phase 5 (hosted-first docs + Hub polish)

**Branch:** `feature/hub-wizard-hosted-story` (unless you merge first).  
**Checklist parent:** [HUB-WIZARD-HOSTED-STORY.md](./HUB-WIZARD-HOSTED-STORY.md) **Phase 5**.  
**Per-tab checklist:** [HUB-SETTINGS-HOSTED-UX-PASS.md](./HUB-SETTINGS-HOSTED-UX-PASS.md).

---

## Session prompt (paste into Cursor)

Copy everything inside the fence below **including** the opening/closing lines (some clients paste better if you omit the fences—then paste only the inner text).

```text
Repository: knowtation (local path as opened in Cursor).
Work branch: feature/hub-wizard-hosted-story (checkout unless told otherwise).

Authoritative plan: docs/HUB-WIZARD-HOSTED-STORY.md — § Phase 5 ONLY.
Per-tab checklist: docs/HUB-SETTINGS-HOSTED-UX-PASS.md (check off rows as you finish).
North star: docs/WHY-KNOWTATION.md — token story, proposals / human gate.

## Copy pattern (apply everywhere it fits — same as Phase 4 tail)

Precedent in web/hub/index.html: How to use modal → tab “Knowledge & agents” → section
“Hosted MCP: secrets vs ‘prime’ bootstrap” — short layman paragraphs in the main column;
deep copy (env names, URIs, MCP verbs, CLI flags, repo doc paths) under
<details class="how-to-details"><summary>Technical details (…)</summary>…</details>.

For Phase 5, do the SAME for:
- Every major “How to use” tab/panel (Getting started, Setup steps, Knowledge & agents
  remaining sections, Media, …): lead with plain English; fold jargon under
  “Technical details” and/or a labeled “Self-hosted” <details> block.
- Settings modals / tabs (Backup, Integrations, Agents, …): hosted-first primary column;
  self-hosted-only and wall-of-config under consistent “Self-hosted” + <details>.

Also ship checklist items:
1. Refresh docs/AI-ASSISTED-SETUP.md — hosted path, Copy prime, wizard / How to use deep links.
2. Hub proposals discoverability — nav or empty-state CTA (web/hub/hub.js + index.html).

Constraints: Do not delete safety text — relocate. Match hub.css variables; bump hub.css ?v=
in index.html if styles change.

Verification: npm test. Commit in logical chunks; do not merge to main unless the user asks.
Update docs/HUB-SETTINGS-HOSTED-UX-PASS.md checklist checkboxes for tabs you complete.
```

---

## (Deprecated) Short prompt

The block above supersedes the shorter prompt that used to live here alone—keep this file as the **single** paste source for Phase 5.

---

## Optional follow-ups (not Phase 5 blockers)

- Phase 2 optional: `docs/UX-SIMPLICITY-REFERENCE-RESEARCH.md`.
- Hosted MCP production smoke after gateway deploy (see `npm run verify:hosted-mcp-checklist` footer).

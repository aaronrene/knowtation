# Next session — Phase 5 (hosted-first docs + Hub polish)

**Branch:** `feature/hub-wizard-hosted-story` (unless you merge first).  
**Checklist parent:** [HUB-WIZARD-HOSTED-STORY.md](./HUB-WIZARD-HOSTED-STORY.md) **Phase 5**.  
**UX handoff:** [HUB-SETTINGS-HOSTED-UX-PASS.md](./HUB-SETTINGS-HOSTED-UX-PASS.md) (per-tab checklist + patterns).

---

## Copy-paste prompt for the implementing agent

```text
Repository: knowtation (local path as opened in Cursor).
Work branch: feature/hub-wizard-hosted-story (checkout unless told otherwise).

Authoritative plan: docs/HUB-WIZARD-HOSTED-STORY.md — § Phase 5 ONLY.
Also follow: docs/HUB-SETTINGS-HOSTED-UX-PASS.md (hosted-first Settings + How to use).
North star: docs/WHY-KNOWTATION.md — token story, proposals / human gate.

Phase 5 goals (from checklist):
1. Refresh docs/AI-ASSISTED-SETUP.md for the hosted path: Copy prime, wizard deep links, and where Integrations + How to use point readers.
2. Hub proposals discoverability: nav or empty-state CTA in web/hub/hub.js + web/hub/index.html (clear path to Suggested / proposals for new users).
3. Hub Settings + How to use — hosted-first UX: default column = plain language for hosted users; fold self-hosted-only blocks (disk paths, config/local.yaml, ffmpeg, git init, …) under a single consistent “Self-hosted” label + icon; shared technical depth (JWT, MCP headers, OAuth) in inline <details> or “Open doc” links. Optional wizard second pass to reduce self-hosted jargon in hosted steps.
4. Bump web/hub/hub.css ?v= if styles change.

Verification: npm test. Commit in logical chunks; do not merge to main unless the user asks.
```

---

## Optional follow-ups (not Phase 5 blockers)

- Phase 2 optional: `docs/UX-SIMPLICITY-REFERENCE-RESEARCH.md`.
- Hosted MCP production smoke after gateway deploy (see `npm run verify:hosted-mcp-checklist` footer).

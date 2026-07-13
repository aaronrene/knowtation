# Overseer Handover — Knowtation

**Cross-repo note:** Scooling is the orchestration layer. **Primary handover lives in
`scooling/docs/OVERSEER-HANDOVER.md`** — copy the NEXT SESSION block from there for
Scooling-tracked phases.

Knowtation-specific history → this file's change log below.

---

## NEXT SESSION — Phase C scoped agent credentials (Thinking → Auto) **or** MCP gateway deploy of Phase B

**Date:** 2026-07-13  
**Branch just built:** `feat/connect-cloud-agent-device-code` (Phase B device auth + honesty docs/UI)  
**Read first:**
- [`docs/DURABLE-AGENT-AUTH-SPEC.md`](./DURABLE-AGENT-AUTH-SPEC.md) §5–7, §12
- [`docs/DURABLE-AGENT-AUTH-ROADMAP.md`](./DURABLE-AGENT-AUTH-ROADMAP.md) Phase B **DONE** · Phase C next
- Evidence: [`docs/evidence/durable-agent-auth/hermes-hostinger-mcp-remote-2026-07-13.md`](./evidence/durable-agent-auth/hermes-hostinger-mcp-remote-2026-07-13.md)

**Model tier (RULE #8):** Phase C Thinking (token shape / OpenAPI) on a thinking model → freeze → Auto Build.  
**Operator alternative:** Deploy persistent MCP gateway with Phase B routes so Hub Connect cloud agent hits live `mcp.knowtation.store`.

### Shared context (prepend to phase prompt)

You are extending Knowtation durable agent auth. Phase A (MCP OAuth durable refresh) and Phase B (RFC 8628 device connect + Hub UI) are done. Hostinger Hermes works today via documented mcp-remote interim; device endpoints ship in this branch pending gateway deploy.  
Guardrails: no long-lived god JWTs; no secrets in logs; do not teach Netlify `/mcp`; no docs-only PR to main; update Spec/Roadmap/this handover in the same PR as code.  
Tests: seven tiers for new auth surfaces.

### Phase C prompt (draft)

```
Build Phase C — Scoped agent credentials (REST) + Hub mint/list/revoke.

Goal: REST-only runners (Paperclip, cron) get vault-bound, rotatable, Hub-revocable
credentials (prefer propose-only option). Amend HUB-API.md “no API-key-only path”.

Frozen: Roadmap Phase C after Thinking freeze (token shape kt_agent_ / JWT typ).
Reuse refresh-token-core / strong store patterns from Phase A/B. No Composio for vault auth.

DoD + tests: Roadmap Phase C. Ship docs + Hub UI with code. No docs-only PR to main.
```

### Interim ops (Born Free)

Knowtation is SoT. Hermes↔Knowtation connected via **mcp-remote interim** (evidence 2026-07-13). Prefer Hub **Connect cloud agent** once MCP gateway is deployed with Phase B. Never paste session JWT into `/data/.env`.

---

## Knowtation status

| | |
| --- | --- |
| **Phase 1D** | **LIVE (gate on)** — KN-INF-3a 2026-07-07 |
| **Hosted calendar blobs** | **INF-KN-3b** (#266) + **INF-KN-3c** (#267) strong read-after-write |
| **INF-3 connect** | **PASS** 2026-07-08 (`connect=ok` + source calendars) |
| **API** | **`api.knowtation.store` live** |
| **MCP public** | **`mcp.knowtation.store/mcp`** (`web/hub/config.js`) |
| **Durable remote-agent auth** | **Phase A DONE** · **Phase B DONE** (2026-07-13) — device code + Hub UI + Hostinger mcp-remote interim documented · Phase C next |

---

## Change log (recent)

| Date | Event |
| --- | --- |
| 2026-07-13 | **Phase B Build DONE** — RFC 8628 `/api/v1/auth/device/*`, Hub Connect cloud agent UI, session-token honesty, Hermes import tile, AGENT-INTEGRATION Hostinger recipe, evidence + Composio future note; tests `device-oauth-*.test.mjs` |
| 2026-07-12 | **Phase A Build DONE** — durable MCP refresh + scope REST guard + offline-lock; Hermes spike partial + Rank swap |
| 2026-07-12 | **Durable agent auth** freeze **revised after adversarial security/identity review** |
| 2026-07-12 | **Durable agent auth** Thinking freeze — Spec + ROADMAP |
| 2026-07-08 | **INF-3** operator connect smoke PASS after #267 deploy |
| 2026-07-08 | **INF-KN-3c** — calendar store blob hydrate `consistency: 'strong'` — [KN #267](https://github.com/aaronrene/knowtation/pull/267) |
| 2026-07-07 | **INF-KN-3b** — calendar store + OAuth token blobs — [KN #266](https://github.com/aaronrene/knowtation/pull/266) |
| 2026-07-07 | **KN-INF-3a** — `CALENDAR_OAUTH_GOOGLE_AUTHORIZED=true` — [KN #265](https://github.com/aaronrene/knowtation/pull/265) |
| 2026-07-05 | Calendar step **11b MERGED** — Google OAuth connector (1D) |

---

## Legacy detail (2026-07-03 snapshot — reference only)

Media write surfaces (2F-b-d-kn): gates on dev/staging via `data/hub_media_write_policy.json`;
`node --test test/media-write-*.test.mjs` — 22/22; live smoke 7/7. Scooling consumer:
`MEDIA_*_AUTHORIZED` all live on `main`. Superseded prompts archived in git history @ `bd73698`.

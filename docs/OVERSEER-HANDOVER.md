# Overseer Handover — Knowtation

**Cross-repo note:** Scooling is the orchestration layer. **Primary handover lives in
`scooling/docs/OVERSEER-HANDOVER.md`** — copy the NEXT SESSION block from there for
Scooling-tracked phases.

Knowtation-specific history → this file's change log below.

---

## NEXT SESSION — Durable agent auth Phase B (Thinking → Auto)

**Date:** 2026-07-12  
**Branch to start from:** `main` (after Phase A merge) → `feat/connect-cloud-agent-device-code`  
**Read first:**
- [`docs/DURABLE-AGENT-AUTH-SPEC.md`](./DURABLE-AGENT-AUTH-SPEC.md) §5–6 (Rank swap)
- [`docs/DURABLE-AGENT-AUTH-ROADMAP.md`](./DURABLE-AGENT-AUTH-ROADMAP.md) Phase B
- Spike: [`docs/evidence/durable-agent-auth/hermes-oauth-spike-2026-07-12.md`](./evidence/durable-agent-auth/hermes-oauth-spike-2026-07-12.md)

**Why B is primary:** Hermes Hostinger spike was **partial** → Rank 1↔2 swap. Device authorization (RFC 8628) is the critical path for headless Hostinger; durable MCP OAuth (Phase A) remains for Cursor / OAuth-capable clients.

**Model tier (RULE #8):** Phase B Thinking (UX: device-code vs guided OAuth wireframes) on a thinking model → freeze → Auto Build.

### Shared context (prepend to phase prompt)

You are building Knowtation Hub “Connect cloud agent” for remote always-on agents.  
Read: Spec §5–7, Roadmap Phase B, Phase A durable refresh (already on persistent MCP host), `web/hub` Integrations UI.  
Guardrails: no long-lived god JWTs; no secrets in logs; do not teach Netlify `/mcp`; update Spec/Roadmap/this handover + open PR when done; no commit/push without explicit consent.  
Tests: unit + integration + e2e + security minimum for Phase B DoD.

### Phase B prompt (draft)

```
Build Phase B — Hub Connect cloud agent (device authorization primary).

Goal: Non-SSH user connects a cloud agent to their vault in one Hub flow (RFC 8628
user_code + verification URL), issuing a refreshable credential; revoke from same panel.

Frozen: Roadmap Phase B after Rank 1↔2 swap. Prefer device code when loopback/paste-back
is unreliable (Hostinger). May deep-link Hermes MCP OAuth when spike follow-up confirms
Managed Hermes OAuth.

DoD + tests: Roadmap Phase B. Update ROADMAP, this OVERSEER-HANDOVER, Hub copy +
AGENT-INTEGRATION in the same PR as code. No docs-only PR to main.
```

### Interim ops (Born Free)

See Spec §12 — Cursor MCP OAuth / Hub propose until Phase B ships; Phase A durable refresh is live on MCP host after merge.

---

## Knowtation status

| | |
| --- | --- |
| **Phase 1D** | **LIVE (gate on)** — KN-INF-3a 2026-07-07 |
| **Hosted calendar blobs** | **INF-KN-3b** (#266) + **INF-KN-3c** (#267) strong read-after-write |
| **INF-3 connect** | **PASS** 2026-07-08 (`connect=ok` + source calendars) |
| **API** | **`api.knowtation.store` live** |
| **MCP public** | **`mcp.knowtation.store/mcp`** (`web/hub/config.js`) |
| **Durable remote-agent auth** | **Phase A DONE** 2026-07-12 — durable MCP refresh + scope REST guard + offline-lock assert; Hermes spike **partial** → Phase B device code **primary** |

---

## Change log (recent)

| Date | Event |
| --- | --- |
| 2026-07-12 | **Phase A Build DONE** — `KnowtationOAuthProvider` → `createGatewayRefreshStore({ consistency: 'strong' })`; agent meta; `mcp_access` scope REST guard; offline-lock; Hermes spike partial + Rank swap; tests `durable-mcp-oauth-*.test.mjs`; docs AGENT-INTEGRATION always-on |
| 2026-07-12 | **Durable agent auth** freeze **revised after adversarial security/identity review**: Spec §1/§5/§8/§14 + Roadmap Phase A |
| 2026-07-12 | **Durable agent auth** Thinking freeze — Spec + ROADMAP; branch `feat/durable-agent-mcp-auth-thinking` |
| 2026-07-08 | **INF-3** operator connect smoke PASS after #267 deploy |
| 2026-07-08 | **INF-KN-3c** — calendar store blob hydrate `consistency: 'strong'` + merge pending OAuth — [KN #267](https://github.com/aaronrene/knowtation/pull/267) |
| 2026-07-07 | **INF-KN-3b** — calendar store + OAuth token blobs; gateway `redirect: 'manual'` — [KN #266](https://github.com/aaronrene/knowtation/pull/266) |
| 2026-07-07 | **KN-INF-3a** — `CALENDAR_OAUTH_GOOGLE_AUTHORIZED=true` — [KN #265](https://github.com/aaronrene/knowtation/pull/265) |
| 2026-07-05 | Calendar step **11b MERGED** — Google OAuth connector (1D) |

---

## Legacy detail (2026-07-03 snapshot — reference only)

Media write surfaces (2F-b-d-kn): gates on dev/staging via `data/hub_media_write_policy.json`;
`node --test test/media-write-*.test.mjs` — 22/22; live smoke 7/7. Scooling consumer:
`MEDIA_*_AUTHORIZED` all live on `main`. Superseded prompts archived in git history @ `bd73698`.

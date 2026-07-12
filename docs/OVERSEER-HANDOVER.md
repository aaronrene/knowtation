# Overseer Handover — Knowtation

**Cross-repo note:** Scooling is the orchestration layer. **Primary handover lives in
`scooling/docs/OVERSEER-HANDOVER.md`** — copy the NEXT SESSION block from there for
Scooling-tracked phases.

Knowtation-specific history → this file's change log below.

---

## NEXT SESSION — Durable agent auth Phase A (Build)

**Date:** 2026-07-12  
**Branch to start from:** `main` (after Spec approval) → `feat/durable-mcp-oauth-refresh`  
**Thinking freeze (read first):**
- [`docs/DURABLE-AGENT-AUTH-SPEC.md`](./DURABLE-AGENT-AUTH-SPEC.md)
- [`docs/DURABLE-AGENT-AUTH-ROADMAP.md`](./DURABLE-AGENT-AUTH-ROADMAP.md)

**Gate:** Do **not** start Auto Build until Aaron approves Spec §2 Verdict + §5 Recommended architecture.

**Model tier (RULE #8):** Phase A is **two steps with two tiers** —
1. **Hermes spike → Thinking model.** The spike is a decision gate (Hermes `auth: oauth` support → Rank 1↔2 swap); it involves judgement and must be run on a **thinking** model before any Build.
2. **Build → Auto model.** Once the spike result is recorded and the frozen interfaces in Roadmap Phase A are confirmed unchanged, implement **mechanically on a cheap/auto model** against that frozen spec — no architecture decisions during Build.

If the spike forces the Rank 1↔2 swap (device code becomes primary), **stop and re-freeze on a thinking model** before Auto Build; do not let an auto session redesign the approach.

Per-phase tiers (mirror of Roadmap routing table):

| Phase | Spike/Design tier | Build tier |
| --- | --- | --- |
| A Durable MCP OAuth refresh | Thinking (spike, hard gate) | **Auto** |
| B Connect cloud agent UX | Thinking (device-code vs guided OAuth wireframes) | **Auto** |
| C Scoped agent credentials | Thinking (token shape / `aud` split) | **Auto** |
| D Propose-only + path prefix | Thinking (scope-guard design) | **Auto** |
| E Marketing/docs honesty | — | **Auto** (with A/B/C code PR) |

### Shared context (prepend to phase prompt)

You are building Knowtation hosted gateway durable auth for remote agents.  
Read: Spec (incl. revised §1, §5, §8, §14) + Roadmap Phase A, `hub/gateway/mcp-oauth-provider.mjs`, `hub/gateway/refresh-token-store.mjs`, `hub/lib/refresh-token-core.mjs`, `hub/gateway/server.mjs` (MCP mount + Netlify guard + `verifyToken`), `web/hub/config.js`.  
Guardrails: no long-lived god JWTs; no secrets in logs; prefer standards (MCP OAuth); do not teach Netlify `/mcp`; **reuse the existing `createGatewayRefreshStore()` — do NOT build a second refresh store**; update Spec/Roadmap/this handover + open PR when done; no commit/push without explicit consent.  
Tests: unit + integration + e2e + security + data-integrity + security-stress minimum for Phase A DoD (credential surface — Aaron RULE #0).

### Phase A prompt (self-contained — revised after review)

```
Build Phase A — Durable MCP OAuth refresh (Knowtation).

Goal: Always-on MCP clients (e.g. Hermes auth: oauth → https://mcp.knowtation.store/mcp)
survive gateway restarts and get ~30d refresh / ~90d family cap with rotation + reuse revoke.

Frozen interfaces: see docs/DURABLE-AGENT-AUTH-ROADMAP.md Phase A (revised).
Implement: wire KnowtationOAuthProvider into the EXISTING createGatewayRefreshStore()
(hub/gateway/refresh-token-store.mjs, refresh-token-core backing) already used by native
OAuth at server.mjs:355,670 — do NOT build a new store. Strong-consistency (file/DB on the
persistent MCP host) only; the eventual-consistency Netlify blob backend is prohibited for
MCP refresh. Keep MCP OAuth 2.1 discovery/token compatible; do not break Cursor OAuth Sign-in.
Add an agent label to the refresh record meta for multi-Hermes revoke.

Security gates (must have tests):
- reuse → family revoke; revoked refresh rejected; no secrets in logs.
- confused deputy: an mcp_access token minted vault:read only MUST NOT write over REST
  (server.mjs verifyToken currently returns sub only and ignores scopes — prove the guard).
- offline-lock (server.mjs:629): agent-auth endpoints unmounted; document + assert.

Spike (HARD GATE): Hostinger Managed Hermes auth: oauth / token cache / headless paste-back.
If not a clean pass → Rank 1↔2 swap: Phase B device authorization (RFC 8628) becomes primary.
Write spike notes into docs/evidence/durable-agent-auth/ — no secrets.

DoD + tests: Roadmap Phase A (revised). Update ROADMAP status, this OVERSEER-HANDOVER,
and include docs/AGENT-INTEGRATION.md always-on section in the same PR as code.
Do not mark DONE without green tests. Do not open docs-only PR to main.
```

### Interim ops (Born Free)

See Spec §12 — promote via Cursor MCP OAuth / Hub propose until Phase A+B ship.

---

## Knowtation status

| | |
| --- | --- |
| **Phase 1D** | **LIVE (gate on)** — KN-INF-3a 2026-07-07 |
| **Hosted calendar blobs** | **INF-KN-3b** (#266) + **INF-KN-3c** (#267) strong read-after-write |
| **INF-3 connect** | **PASS** 2026-07-08 (`connect=ok` + source calendars) |
| **API** | **`api.knowtation.store` live** |
| **MCP public** | **`mcp.knowtation.store/mcp`** (`web/hub/config.js`) |
| **Durable remote-agent auth** | **Thinking freeze 2026-07-12, revised post-review** — Spec §1/§5/§8/§14 + Roadmap Phase A updated (reuse existing store, strong-consistency, scope-elevation guard, offline-lock, spike hard-gate); Build Phase A gated on approve |

---

## Change log (recent)

| Date | Event |
| --- | --- |
| 2026-07-12 | **Durable agent auth** freeze **revised after adversarial security/identity review**: Spec §1 (reuse existing `refresh-token-store.mjs`; MCP refresh is in-memory plaintext today; REST ignores token scopes), §5 (strong-consistency, no blob), §8 (scope-elevation via confused deputy), new §14 (offline-lock); Roadmap Phase A (reuse store, spike hard-gate + Rank 1↔2 swap, data-integrity/stress tests, offline-lock assert), Phase D scope-guard dependency |
| 2026-07-12 | **Durable agent auth** Thinking freeze — `docs/DURABLE-AGENT-AUTH-SPEC.md` + `ROADMAP.md`; branch `feat/durable-agent-mcp-auth-thinking` |
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

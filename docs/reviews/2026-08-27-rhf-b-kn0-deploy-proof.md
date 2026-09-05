# RHF-b-KN0 deploy proof — hosted bridge

**Date:** 2026-08-27  
**Verdict:** **PASS** (session lane)  
**Operator:** Aaron Carvajal  
**Target:** `POST https://api.knowtation.store/api/v1/delegation/grants`  
**Script:** `node scripts/verify-rhf-kn0-deploy-proof.mjs` (exit 0)

## Probes

| Probe | HTTP | JSON `code` | Result |
| --- | ---: | --- | --- |
| `type:session` | 403 | `DELEGATION_HELPER_ACTOR_DENIED` | **PASS** |
| `legacy_session` | — | — | **SKIP** — `KNOWTATION_SESSION_SECRET` not set locally |

## Notes

- KN0 gate live on hosted bridge after land/deploy (prior FINDINGS: pre-KN0 `@e9300f2`, expired JWT).
- Session auth: operator `hub_token` saved to `~/.config/knowtation/hub_session` via `hub-session-refresh.mjs --save-access-token` (never committed).
- `legacy_session` probe optional for script verdict; re-run after adding local `KNOWTATION_SESSION_SECRET` copied from **knowtation-gateway** Netlify `SESSION_SECRET` (not Scooling).
- No authority marker, consent, grant mint, or Codex turns.

## Unblocks

**RHF-b-KN1** — separate chat per `docs/KNOWTATION-OVERSEER-HANDOVER.md`.

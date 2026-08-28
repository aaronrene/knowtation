# RHF-b-KN1 land — SD-21

**Date:** 2026-08-27  
**Authority:** SD-21 (BV round 3 `pass`; no live posture/env flip, secrets, real money, or Delegation write env; **no** production marker activation)  
**Branch:** `feat/retail-helper-finish-b-kn1` → Muse `main` → `muse-mirror` → GitHub `main`

## Steps completed

| Step | Result |
| --- | --- |
| 1. Muse FF merge | `feat/retail-helper-finish-b-kn1` → Muse `main` at `sha256:354ec7b79252…` |
| 2. muse-bridge-deploy | Exported; PR [#313](https://github.com/aaronrene/knowtation/pull/313) |
| 3. GitHub merge | `muse-mirror` → `main` merge commit `8df71bcb3469951a0b80cc13a3a8a1809193040d` (merge commit; required `test (20)` + TruffleHog green after flake re-run) |
| 4. Redeploy | Netlify **knowtation-gateway** + **knowtation-bridge** production ready on `8df71bc…` |
| 5. Marker | **Not** set: `RHF_AUTHORITY_MARKER_AUTHORIZED` unset; no `activateMarker` |

## Live spot-check (no session)

| Route | HTTP | code |
| --- | ---: | --- |
| `POST /api/v1/delegation/grants/renew-personal` | 401 | `DELEGATION_SESSION_REQUIRED` |
| `GET /api/v1/delegation/helper-access?actor_agent_id=agent_codex_retail` | 401 | `DELEGATION_SESSION_REQUIRED` |

Schema: `knowtation.delegation_error/v1`. No JWTs/bearers in evidence.

## Explicitly not done

- Production authority marker / cutover activation (Tier 3)
- Consent / grant mint / Codex turns
- Scooling RHF-b-SC (separate chat)

## Next

Scooling **RHF-b-SC** — paste from `~/scooling/docs/OVERSEER-HANDOVER.md` (now unblocked).

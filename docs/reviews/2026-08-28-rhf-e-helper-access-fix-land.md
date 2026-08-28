# RHF-e helper-access fix — SD-21 land (2026-08-28)

**Authority:** SD-21 (BV round 1 `pass`; no live posture/env flip, secrets, real money, or Delegation write env)  
**Branch:** `feat/rhf-e-helper-access-fix` → Muse `main` → `muse-mirror` → GitHub `main`

## Steps completed

| Step | Result |
| --- | --- |
| 1. Muse FF merge | `feat/rhf-e-helper-access-fix` → Muse `main` at `sha256:78979467f43a…` |
| 2. muse-bridge-deploy | Exported; PR [#316](https://github.com/aaronrene/knowtation/pull/316) |
| 3. GitHub merge | `muse-mirror` → `main` merge commit `e878b878ab133fb43bd9ecd0507b280a693d8d20` |
| 4. Redeploy | Netlify **knowtation-gateway** + **knowtation-bridge** production **ready** on `e878b878…` |
| 5. Prod confirm | Authenticated `GET …/helper-access?actor_agent_id=agent_codex_retail` → **200** `state: renewable` |

## Live spot-check

| Route | HTTP | Result |
| --- | ---: | --- |
| Unauth helper-access | 401 | `DELEGATION_SESSION_REQUIRED` |
| Session helper-access (vault Business) | **200** | `knowtation.helper_access/v1` / `state: renewable` / `actor_agent_id: agent_codex_retail` |
| Session grants list | 200 | OK (unchanged) |

No JWTs/bearers in evidence. Spend still **0/5**. **No** RHF-e DONE.

## Explicitly not done

- Browser smoke pass (checks 2–7, 9) — resume on Scooling
- RHF-f2 closeout
- Codex spend

## Next

Scooling **RHF-e resume** — Settings fold ≠ `unavailable`; finish smoke.

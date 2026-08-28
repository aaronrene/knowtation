# RHF-e unblock — authenticated helper-access fix (2026-08-28)

**Verdict:** code **DONE** + BV **pass** — land SD-21; redeploy bridge; resume Scooling smoke.  
**Not** RHF-e DONE. Spend still **0/5**.

## Root cause

`lib/agent/delegation-authority-store.mjs` always passed Netlify Blobs
`consistency: 'strong'` on authority reads. Under Lambda `connectLambda` that throws
`BlobsConsistencyError` → `GET /api/v1/delegation/helper-access` → **503** → Scooling
`helperAccessState: unavailable`. Legacy `GET /api/v1/delegation/grants` uses eventual
`get` and still succeeded. Business marker/envelope blobs were valid
(`lineage_lymik9fcy353fuo`).

## Fix

`authorityBlobGetOpts()` — eventual on `NETLIFY` / `AWS_LAMBDA_FUNCTION_NAME`; strong on
persistent hosts. Same pattern as gateway-auth (`hub/gateway/server.mjs`).

## Evidence

| Item | Result |
| --- | --- |
| Seven-tier `test/rhf-b-kn1-delegation-retail.test.mjs` | **25/25** |
| BV round 1 | **pass** — `docs/reviews/2026-08-28-rhf-e-helper-access-fix-bv-round1.md` |
| Smoke authority | `~/scooling/docs/reviews/2026-08-27-retail-helper-finish-smoke-pass.md` |

## Explicitly not done

- Browser smoke pass (RHF-e)
- RHF-f2 closeout
- Codex spend

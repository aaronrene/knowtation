# KN-AUTH-LANE-D propose-path hotfix SD-21 land — 2026-08-24

**Verdict:** land **DONE**. No live env flip. No production credential revoke.

## Problem

Live smoke after KN #306: `POST /api/v1/proposals` with valid `agent_access` JWT (propose + vault:read, vault Business) returned **401 UNAUTHORIZED** while exchange, vault read, and notes read passed.

**Root cause:** `getUserId()` passed Express mount suffix `req.path` (`/proposals`) to `agentScopesPermitMethod`; allowlist expects `api/v1/proposals`. GET reads unaffected (path not checked for safe methods).

## Fix

`hub/gateway/server.mjs` — `getUserId()` uses `effectiveRequestPath(req)` (same as `proxyToCanister`). Regression test in `test/agent-credentials-unit.test.mjs`.

## SD-21 land hygiene

| Check | Result |
| --- | --- |
| Tests | seven-tier agent-credentials **37/37** |
| Live posture / env flip in diff | **No** |
| Secrets / real money / Delegation write env | **No** |

Muse fast-forward `feat/kn-auth-lane-d-propose-path-fix` → Muse `main`:

| Muse SHA | Note |
| --- | --- |
| `9625657f…` | fix(gateway): agent propose auth uses effectiveRequestPath |
| `c2c048ac…` | tip after docs touch; **Muse `main` HEAD after FF** |

## SD-14 GitHub path

| Step | Evidence |
| --- | --- |
| muse-bridge-deploy | `origin/muse-mirror` `5c8eb46` = `mirror: muse sha256:e5754b62860a10a6e1281438b927060ede916f7d8b730ce9c5beddda22fdb966` |
| PR | [#307](https://github.com/aaronrene/knowtation/pull/307) `muse-mirror` → `main` only |
| Required checks | `test (20)` SUCCESS; `Secret scanning (TruffleHog)` SUCCESS |
| Merge | merge commit `697242221d52b0b0da7c4f9c9293d2f8ac23b416` (2026-08-24T13:02:26Z) |
| Never | `git push origin main`; feature→GitHub-`main` |

## Notes

- Follow-on to KN-AUTH-LANE-D-b [KN #306](https://github.com/aaronrene/knowtation/pull/306). Not Scooling.
- After deploy: trend agent re-run step 4 (`POST /api/v1/proposals`) — expect 200/201.

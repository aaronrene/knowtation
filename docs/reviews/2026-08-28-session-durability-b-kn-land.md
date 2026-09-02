# SESSION-DURABILITY-b-KN — land + production health blocker

**Date:** 2026-08-28  
**Branch lineage:** `feat/session-durability-b-kn` → Muse `main` → `muse-mirror` → GitHub `main`  
**BV:** round 2 **pass** — `docs/reviews/2026-08-28-session-durability-b-kn-bv-round2-pass.md`

## Land

| Step | Result |
| --- | --- |
| Muse `main` | `sha256:88ceb7f49f46190415f3aada716c44ba7448e10fa23e8bee3d2867c45224443f` (feat tip `9e4aeb3b…` + CI JWT assertion fix) |
| GitHub | [PR #318](https://github.com/aaronrene/knowtation/pull/318) merged; `main` `@97dbd85689316c7f8a8725e21b5115df2e4d7cf6` |
| Netlify `knowtation-gateway` | published `97dbd85…` ready `2026-08-28T22:26:26.828Z` |

## Production health (blocker)

`GET https://api.knowtation.store/health` → **HTTP 502** with:

`HUB_JWT_EXPIRY must resolve to an integer in [10800, 86400] seconds (3h–24h)`

Fail-closed boot from SESSION-DURABILITY-b-KN. Production env value is outside the 3h–24h band.
Changing `HUB_JWT_EXPIRY` is **Tier 3** (freeze `tier3_gates`). Recommend set to **`24h`** /
**`86400`**, redeploy, then restore Business consent (`scripts/verify-rhf-d-catalog-consent.mjs`).

MCP `https://mcp.knowtation.store/health` still `{"ok":true}` this probe.

## Not done

- Env flip
- Consent restore
- RHF-e / Codex spend / production marker

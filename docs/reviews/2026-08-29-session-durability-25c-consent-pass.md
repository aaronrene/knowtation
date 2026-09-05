# SESSION-DURABILITY-25c — Knowtation gateway HUB_JWT_EXPIRY + consent

**Date:** 2026-08-29  
**Site:** `knowtation-gateway` / `api.knowtation.store`

## Health

| Check | Result |
| --- | --- |
| `HUB_JWT_EXPIRY` | production **`24h`** (was out-of-band; `24hr` rejected by parser) |
| Redeploy | clear-cache; published `97dbd85…` ready `2026-08-29T06:06:26.356Z` |
| `GET /health` | **200** `{"ok":true}` |

## Consent (Business / `agent_codex_retail`)

`verify-rhf-d-catalog-consent.mjs` → **PASS 7/7**

| Field | Value |
| --- | --- |
| `consent_id` | `dcons_beubs3bja1fqz5rtug6myq` |
| `scope` / `status` | `personal` / `active` |
| helper-access | `renewable` |
| grant mint / marker | none |

Cross-repo evidence: `~/scooling/docs/reviews/2026-08-29-session-durability-25c-consent-pass.md`.

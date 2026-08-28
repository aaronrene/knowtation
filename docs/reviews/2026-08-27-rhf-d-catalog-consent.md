# RHF-d — catalog actor + smoke consent (CODEX-HUB-ACTOR)

**Date:** 2026-08-28  
**Authority:** `~/scooling/docs/reviews/2026-08-27-retail-helper-finish.md` § RHF-d  
**Branch:** `feat/retail-helper-finish-d`  
**Deployed Knowtation SHA:** GitHub `main` `@8df71bc` (KN1 land [PR #313](https://github.com/aaronrene/knowtation/pull/313))

## Verdict

**PASS** — catalog verified on production; active personal consent established for Business vault smoke account through reviewed proposal workflow. No grant mint. No production authority marker.

## 1. Immutable catalog (deployed)

Probe: `GET /api/v1/agents/identities?kind=external_provider&status=active` on `https://api.knowtation.store` with session + `X-Vault-Id: Business`.

| Check | Result |
| --- | --- |
| Active `external_provider` count | **1** (exactly) |
| Retail actor present | `agent_codex_retail` |
| `kind` | `external_provider` |
| `provider` | `codex` |
| `scope_ceiling` | `personal` |
| `status` | `active` |
| `registry_scope` | `global` |
| `created` / `updated` | `2026-08-27T00:00:00.000Z` (both) |

Matches freeze §B1 literals in `lib/agent/trusted-external-provider-catalog.mjs`.

## 2. Personal consent (reviewed workflow)

Established via hosted Hub REST (no terminal grant mint):

| Step | HTTP | Notes |
| --- | ---: | --- |
| `POST /api/v1/delegation/consents` | 201 | `delegate_agent_id=agent_codex_retail`, `scope=personal` |
| `POST /api/v1/proposals/{id}/evaluation` | 200 | Rubric checklist pass |
| `POST /api/v1/proposals/{id}/approve` | 200 | Admin approve (evaluation passed) |
| `POST /api/v1/delegation/proposals/{id}/apply-approved` | 200 | Legacy consent index apply |

### Record (redacted — no JWT/bearer)

| Field | Value |
| --- | --- |
| `actor_agent_id` | `agent_codex_retail` |
| `consent_id` | `dcons_1y5zhkxeb610mqsu3aia` (primary; verified by re-run script idempotency) |
| `scope` | `personal` |
| `status` | `active` |
| `created` | `2026-08-28T02:25:29.824Z` |
| `expires_at` | *(none — no expiry)* |
| `proposal_id` | `prop-1787883930621143706` |
| `vault_id` | `Business` |

## 3. Pre-marker helper-access (expected)

`GET /api/v1/delegation/helper-access?actor_agent_id=agent_codex_retail` → **503** `DELEGATION_AUTHORITY_UNAVAILABLE`.

This is **expected** until Tier-3 production authority marker cutover. Consent lives in legacy delegation index; envelope reader routes remain inactive without marker.

## Explicitly not done

- No `renew-personal` / generic grant mint / terminal grant
- No `RHF_AUTHORITY_MARKER_AUTHORIZED` / production marker activation
- No `MY_WORK_CODEX_ENABLED` flip (Scooling RHF-e gate)
- No Codex turns / real spend

## Re-run

```bash
node scripts/hub-session-refresh.mjs
KNOWTATION_HUB_VAULT_ID=Business node scripts/verify-rhf-d-catalog-consent.mjs
```

Script: `scripts/verify-rhf-d-catalog-consent.mjs`

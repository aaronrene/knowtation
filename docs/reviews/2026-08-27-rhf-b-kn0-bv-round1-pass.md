# Build verification — RHF-b-KN0 round 1

**Verdict:** pass  
**Frozen spec:** `~/scooling/docs/reviews/2026-08-27-retail-helper-finish.md` (§B1 compatibility deploy, §B5)  
**Branch:** `feat/retail-helper-finish-b-kn0`  
**Reviewer mode:** independent verifier (thinking-high posture)

## Scope checked

KN0 compatibility slice only — no KN1 renewal/cutover, candidate/marker creation, consent, grant mint
in production, deploy, or env flip.

## Findings

| ID | Sev | path:line | Claim vs reality |
| --- | --- | --- | --- |
| — | — | — | No actionable gaps |

## Checklist

| # | Check | Evidence |
| --- | --- | --- |
| V1 | Deliverables exist | `lib/agent/trusted-external-provider-catalog.mjs`; `lib/agent/delegation-authority-compat.mjs`; wired in `lib/agent/delegation.mjs`, `hub/bridge/delegation-routes.mjs`, `hub/bridge/delegation-blob-store.mjs`; `test/rhf-b-kn0-compatibility.test.mjs` |
| V2 | Bridge generic mint rejects human session before vault/mint | `hub/bridge/delegation-routes.mjs` — `humanSessionTokenFromReq` returns 403 `DELEGATION_HELPER_ACTOR_DENIED` before `vaultContext` / `handleDelegationGrantMintRequest` |
| V2 | Catalog `agent_codex_retail` exact | `trusted-external-provider-catalog.mjs:13-27` matches freeze §B1 JSON literals |
| V2 | Marker-aware reads fail closed | `delegation-authority-compat.mjs` — absent marker → legacy; invalid/missing envelope → `DELEGATION_AUTHORITY_UNAVAILABLE`; `resolveDelegationReadContext` surfaces 503 in handlers |
| V2 | Reserved id cannot shadow catalog | `getAgentIdentity` checks catalog first; propose/precheck return 409 `AGENT_IDENTITY_RESERVED` |
| V3 | Seven-tier tests | `test/rhf-b-kn0-compatibility.test.mjs` **17/17**; legacy comparator `legacyBridgeGrantMintWouldAcceptSession` vs new gate |
| V4 | No KN1 scope | No renew-personal, validate, helper-access, DelegationAuthorityStore mutations, marker/candidate writers |
| V5 | No silent requirement deletion | All six operator-required items present |
| V6 | Governance | ROADMAP + OVERSEER-HANDOVER updated together this session |
| V7 | No secrets | Catalog is public metadata; no bearer/JWT persistence added |

### Evidence

| type | sha256 | ref | notes |
| --- | --- | --- | --- |
| test_output | `1955887c90bc180f53e8b96efca9d3d38525e9ae8f7c3564ba2fce96143a568d` | `test/rhf-b-kn0-compatibility.test.mjs` 17/17 | KN0 suite |
| test_output | (combined) | KN0 + SEC-KN-4/5 + delegation-hosted-proposal-l1b | **79/79** green in session |

## Verdict rationale

Implementation matches the passed freeze’s KN0 compatibility deploy: session-bound generic Bridge
mint is denied before catalog/store resolution; immutable reserved Codex retail catalog resolves
first and cannot be shadowed; marker-aware reader follows validated active marker else legacy with
503 fail-closed on mismatch. Tests include explicit legacy comparator and all seven tiers.

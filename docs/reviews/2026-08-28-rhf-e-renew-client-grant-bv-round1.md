# BV — RHF-e renew-client-grant (round 1)

**Verdict:** **pass**  
**Date:** 2026-08-28  
**Branch:** `feat/rhf-e-renew-client-grant`  
**Scope:** `grantForClient` omits authority audit counters from client/mint grant views so Scooling strict `knowtation.delegation_grant_mint/v0` parse succeeds.

## Spec vs diff

| Claim | Evidence |
| --- | --- |
| Client grant omits `grant_bearer_hash` | unchanged + still tested |
| Client grant omits `audit_sequence`, `pending_audit_count`, `last_materialized_audit_sequence` | `lib/agent/delegation.mjs` `grantForClient`; unit + KN1 renew assertion |
| Envelope storage still keeps audit fields | data-integrity test reads envelope grant counters |

## Tests

```text
node --test test/agent-delegation-unit.test.mjs test/rhf-b-kn1-delegation-retail.test.mjs
→ 32 + 7 pass (KN1 suite 32; unit 7)
```

## Escalation

None (no secrets, no live posture flip, no real money).

**Land:** SD-21 Muse-first → muse-mirror → GitHub main.

---
step: SESSION-DURABILITY-b-KN
model: Auto
date: 2026-08-28
branch: feat/session-durability-b-kn
bv_verdict: pass
bv_round: 2
---

# SESSION-DURABILITY-b-KN — build verification pass

**Frozen spec:** `~/scooling/docs/reviews/2026-08-28-session-durability.md` (§§4, 6, 7)  
**Freeze Muse revision:** `sha256:2ca4f221375666abf174c8a09de11e109d53f38150039610e841d8b55534ef47`  
**Freeze artifact SHA-256:** `0294db66e399d72024ec41d33b9e48aaecb2f1cce9dc225da4472cdd8ef12f9f`

## Verdict

Independent BV **round 2 = pass** (thinking-high). Round 1 findings BV1–BV4 fixed and re-verified.

## Tests

```
node --test \
  test/session-durability-b-kn.test.mjs \
  test/auth-establish-refresh.test.mjs \
  test/hub-api-no-retry-flag.test.mjs \
  test/gateway-session-introspection.test.mjs \
  test/gateway-auth-refresh-wiring.test.mjs \
  test/auth-session.test.mjs \
  test/auth-refresh-wiring.test.mjs
```

**93/93 pass.** test_output sha256:
`1ea413828a3eaef640a1b755954dfca1b4ba984bf638736698fbddf51690dd02`

## Shipped (KN boundary only)

- `hub/lib/human-session-admission.mjs` — type:session + iat/exp + 3h–24h; SESSION_EXPIRED vs SESSION_INVALID; HUB_JWT_EXPIRY parser; Origin allowlist; CLI Accept helper
- Hosted gateway introspection + integer JWT expiry + establish-refresh browser/CLI split
- Hub UI durable bootstrap warning, `ensureFreshHumanSession`, `hubApiResponse`, copy + agent credential paths
- CLI `hub-session-auth.mjs` vendor Accept + mode-0600 preserved
- Gateway README documents the delivery modes

## Explicitly not done here

- No Scooling SESSION-DURABILITY-b implementation
- No production env/auth deploy, secrets, consent apply, main merge, or feature→GitHub-main PR

# KN-APPLE Operator T1 — complete — 2026-08-10

**Verdict:** **T1 COMPLETE** — land + `APPLE_CLIENT_ID` configured + live
`providers.apple: true`. Product PRIMARY may advance to Scooling **APPLE-4-live**.

## Prior (same day)

Land + route-only evidence: `docs/reviews/2026-08-10-kn-apple-land-t1-partial.md`
(at that time `apple:false` / `503 NOT_CONFIGURED`).

## Operator T1 env + client registration

| Check | Result |
| --- | --- |
| Apple Developer App ID | **Scooling Apple** = `com.scooling.apple` registered |
| Netlify `knowtation-gateway` `APPLE_CLIENT_ID` | Set to `com.scooling.apple` (production context) |
| Redeploy | Production rebuild after env set |
| Xcode signing | Team Aaron Carvajal; auto-manage; Bundle ID `com.scooling.apple`; Ready |
| Xcode Display Name | `Scooling` (not “Apple”) |
| Xcode capability | **Sign in with Apple** present on target |

## Live probes (`api.knowtation.store`)

Observed after env redeploy (2026-08-10T14:42Z UTC):

| Probe | Result |
| --- | --- |
| `GET /api/v1/auth/providers` | `{"google":true,"github":true,"apple":true}` |
| `POST /api/v1/auth/native-apple-exchange` with forged `identity_token` | **HTTP 401** `APPLE_ASSERTION_INVALID` (not `NOT_CONFIGURED`) |

## Explicit non-claims

- CapabilityGates in `scooling-apple` remain hard-`false` (no Auto flip)
- No vault-write authorize; no APPLE-6; no App Store submit
- Forged probe ≠ successful SIWA login; live AuthenticationServices authorize is
  **APPLE-4-live** (T1+T2+T15 package on the Scooling/Apple client side)

## NEXT

Scooling product PRIMARY → **APPLE-4-live** Operator tip: authorize
**T1+T2+T15 together** only with written evidence (or DEFER again).

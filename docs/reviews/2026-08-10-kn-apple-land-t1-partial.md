# KN-APPLE land + Operator T1 (partial) — 2026-08-10

**Verdict:** land **DONE**; live route **YES**; `APPLE_CLIENT_ID` **NOT SET** (`providers.apple: false`).

## SD-21 land hygiene

| Check | Result |
| --- | --- |
| Live posture / CapabilityGate / vault-write / REAL_NETWORK flip in land diff | **No** |
| Secrets / Team IDs / `.p8` / prod JWTs committed | **No** (placeholders only in `.env.example`) |
| Real money | **No** |
| BV prior | `docs/reviews/2026-08-09-kn-apple-b-bv-round1-pass.md` **pass**; suite 13/13 |

Landed Muse commits (fast-forward `feat/kn-apple-native-hosted-exchange` → Muse `main`, plus audit pins):

| Muse SHA | Note |
| --- | --- |
| `1094bf25…` | docs PRIMARY = KN-APPLE Thinking |
| `d1e0b057…` | freeze KN-APPLE-a |
| `789db7e7…` | KN-APPLE-b Auto impl |
| `55930e9c…` | root `@netlify/dev-utils@3.1.1` override (image-size audit) |
| `e2bbdbfa…` | hub/bridge same override (CI audit) |

## SD-14 GitHub path

| Step | Evidence |
| --- | --- |
| muse-bridge-deploy | mirror tip `e2dacbb…` = Muse `e2bbdbfa…` |
| PR | [#295](https://github.com/aaronrene/knowtation/pull/295) `muse-mirror` → `main` only |
| Merge | merge commit `c2a77b1c24fd89e56fc1064e6fcdfee113cb7fa1` (2026-08-10T12:30:21Z) |
| Prod Netlify gateway deploy | `knowtation-gateway` production **ready** at `c2a77b1` |

## Live readiness probes (`api.knowtation.store`)

Observed 2026-08-10T12:31:26Z (after production deploy):

| Probe | Result |
| --- | --- |
| `GET /api/v1/auth/providers` | `{"google":true,"github":true,"apple":false}` |
| `POST /api/v1/auth/native-apple-exchange` body `{"identity_token":"probe"}` | **HTTP 503** `{"error":"Apple native exchange is not configured","code":"NOT_CONFIGURED"}` |

Interpretation: **code readiness is live** (route mounted; fails closed without env). **T15 production “configured” evidence is not complete** until Operator sets `APPLE_CLIENT_ID` on Netlify site **knowtation-gateway** and redeploys so `providers.apple` becomes `true`.

## Remaining Operator T1 (env)

1. Obtain Apple **App ID Bundle Identifier** (not Apple login email) from Apple Developer → Identifiers, or Xcode → Signing & Capabilities.
2. Netlify → site **knowtation-gateway** (`api.knowtation.store`) → Environment variables → set `APPLE_CLIENT_ID` = that Bundle ID (or Services ID if using web SIWA audience).
3. Trigger production redeploy of **knowtation-gateway**.
4. Re-probe: expect `providers.apple: true` and exchange no longer `NOT_CONFIGURED` for a real Apple `identity_token` (forged probe still `APPLE_ASSERTION_INVALID`).

Do **not** put this value on Scooling Netlify, knowtation-bridge, or into git.

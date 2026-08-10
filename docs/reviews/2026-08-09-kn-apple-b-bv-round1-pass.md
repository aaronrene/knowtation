# Build verification — KN-APPLE-NATIVE-HOSTED-EXCHANGE-b round 1

**Verdict:** pass  
**Frozen spec:** `docs/KN-APPLE-NATIVE-HOSTED-EXCHANGE-FREEZE.md` (`frozen: true`; freeze-review pass; digest `sha256:4ec695738daf8e582923a6a6971d607bc5649eff35493d27dcd2de6303bd4dfa`)  
**Diff scope:** `hub/gateway/apple-identity-token.mjs` (new); `hub/gateway/server.mjs` (route + providers.apple + `APPLE_CLIENT_ID` boot capture); `test/kn-apple-native-hosted-exchange.test.mjs` (new); `.env.example`; `hub/gateway/README.md`; `docs/HUB-API.md`; `docs/openapi.yaml`; governance docs  
**Branch:** `feat/kn-apple-native-hosted-exchange`  
**Reviewed:** 2026-08-09 (Auto build session; independent BV checklist)

### Evidence

| type | sha256 | ref | notes |
| --- | --- | --- | --- |
| test_output | `d419cfb27538234d8cac0f5fba12bfa2b10a5435afaa5febec1b3843bff4de77` | `node --test test/kn-apple-native-hosted-exchange.test.mjs` | **13/13 pass** (unit + integration + e2e + stress + data-integrity + performance + security) |

### Checklist

| # | Check | Evidence |
| --- | --- | --- |
| V1 | Deliverables D1–D9 at freeze paths | D1 route `POST /api/v1/auth/native-apple-exchange` in `hub/gateway/server.mjs:497+`; D2 `hub/gateway/apple-identity-token.mjs`; D3 `issueToken` mint `provider:'apple'` + existing `type:'session'` (`server.mjs:253`); D4 C7 unchanged (`GET /api/v1/auth/session`); D5 `providers.apple`; D6 error codes in route; D7 `.env.example` placeholders only; D8 suite path matches §KNA.6; D9 README + HUB-API + OpenAPI |
| V2 | Public API matches freeze | Request allowlist / forbidden fields / success body / HTTP codes match §KNA.3.2–3.4; no `scooling_uid` / no refresh cookie on this route |
| V3 | Seven-tier matrix exercised | Suite covers all §KNA.6 tiers; security discriminator rejects unverified stub acceptance |
| V4 | No scope creep | No CapabilityGate flips; no vault write; no APPLE-6; no Passport/PKCE equated to SIWA |
| V5 | No silent deletion of freeze requirements | Bootstrap §KNA.1: working Muse tree has `issueToken` `type:'session'`; Mint uses `issueToken` |
| V6 | Governance honest | ROADMAP/HANDOVER updated this session to mark KN-APPLE-b DONE + NEXT = land/deploy Operator T1 |
| V7 | Secrets / safe defaults | No Team IDs / PEM / prod JWTs in diff; gitleaks not required for BV pass claim beyond fixture bans in suite |
| V8 | Claims ↔ git/test | Tests green with digest above; route present in source; code readiness ≠ live T15 production evidence (Operator T1 still required) |

### Findings

_None._

### Honest summary

Knowtation gateway now accepts a verified Apple `identity_token`, mints a hosted session JWT of the same class as browser login (`provider: apple`, Layer-1 `apple:<sub>`, `type: session`), and advertises `providers.apple` when `APPLE_CLIENT_ID` is configured. Layer-2 `scooling_uid` is not returned. This is **code readiness** on the feature branch — production Apple env + deploy (Operator T1) and Scooling APPLE-4-live authorize remain separate.

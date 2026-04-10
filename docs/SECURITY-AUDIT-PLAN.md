# Security Audit Remediation Plan

Pre-launch security hardening derived from dual-audit cross-reconciliation (April 2026).
Each phase commits at completion. Model recommendations reflect task complexity.

---

## Phase 0 — Emergency (Ship-Stoppers) ✅ COMPLETE
**Commit:** `6749166`
**Model:** claude-4.6-sonnet-medium-thinking (Opus-class for architectural decisions)
**Deployed:** Canister V6→V7 migration live on IC mainnet. Gateway auth secret active.

| # | Item | Status |
|---|------|--------|
| 0.1 | Canister gateway auth (`X-Gateway-Auth`) — Motoko + all gateway callers | ✅ |
| 0.2 | Remove `X-Test-User` from canister; update CORS allowed headers | ✅ |
| 0.3 | Timing-safe comparisons for HMAC/secret checks (`verifyState`) | ✅ |
| 0.4 | `captureAuth` fail-closed when `CAPTURE_WEBHOOK_SECRET` unset | ✅ |
| 0.5 | `POST /api/v1/attest` requires JWT authentication | ✅ |
| 0.6 | MCP hosted server canister calls include `X-User-Id` + `X-Gateway-Auth` | ✅ |
| — | 23 new unit tests; 1270 existing tests passing | ✅ |

**Post-deploy verification:**
- `curl https://rsovz-byaaa-aaaaa-qgira-cai.raw.icp0.io/api/v1/notes -H "X-User-Id: test"` → `GATEWAY_AUTH_REQUIRED` ✅
- `curl https://rsovz-byaaa-aaaaa-qgira-cai.raw.icp0.io/health` → `{"ok":true}` ✅

---

## Phase 1 — High Priority (Same Release Train)
**Model:** claude-sonnet (fast model — well-scoped, no architectural decisions)
**Branch:** new branch off `feature/landing-overview-video-ui` or off main after merge

| # | Item | File(s) | Status |
|---|------|---------|--------|
| 1.1 | Trust proxy for Express rate limiting — real client IPs behind Netlify CDN | `hub/gateway/server.mjs`, `hub/server.mjs` | ⬜ |
| 1.2 | Zip-slip protection — validate each AdmZip entry stays under extract dir | `hub/bridge/server.mjs` | ⬜ |
| 1.3 | Self-hosted default-admin startup warning when `roleMap.size === 0` in production | `hub/server.mjs` | ⬜ |
| 1.4 | Header allowlist for `proxyToCanister` and `proxyTo` — replace `...req.headers` spread | `hub/gateway/server.mjs` | ⬜ |
| 1.5 | Billing enforcement startup warning when `BILLING_ENFORCE` unset in hosted mode | `hub/gateway/billing-constants.mjs`, `hub/gateway/server.mjs` | ⬜ |
| — | Tests for all Phase 1 changes | `test/phase1-security.test.mjs` | ⬜ |

---

## Phase 2 — CI/CD & Infrastructure
**Model:** claude-sonnet (mechanical, well-defined tasks)

| # | Item | File(s) | Status |
|---|------|---------|--------|
| 2.1 | Add `npm audit` gate to CI — fail on high/critical CVEs | `.github/workflows/ci.yml` | ⬜ |
| 2.2 | Add secret scanning to CI (gitleaks or trufflehog action) | `.github/workflows/ci.yml` | ⬜ |
| 2.3 | Add dependency review action on PRs (`actions/dependency-review-action`) | `.github/workflows/` | ⬜ |
| 2.4 | Dockerfile: non-root user, pinned image tag, `npm ci` instead of `npm install` | `hub/Dockerfile` | ⬜ |
| 2.5 | Fix GitHub token encryption salt — replace hardcoded `'salt'` with random per-token salt | `hub/bridge/server.mjs` | ⬜ |
| 2.6 | Upgrade/replace deprecated `multer@1.x`; validate `file.originalname` before disk use | `hub/bridge/server.mjs` | ⬜ |
| — | Tests for all Phase 2 changes | `test/phase2-security.test.mjs` | ⬜ |

---

## Phase 3 — Defense in Depth
**Model:** claude-sonnet (incremental hardening)

| # | Item | File(s) | Status |
|---|------|---------|--------|
| 3.1 | JWT token-in-URL: move OAuth redirect token to cookie or fragment; shorten expiry from `7d` | `hub/gateway/server.mjs`, `hub/server.mjs` | ⬜ |
| 3.2 | Image proxy `?token=` query param — replace with short-lived signed URL or cookie auth | `hub/bridge/server.mjs`, `hub/gateway/server.mjs` | ⬜ |
| 3.3 | Bridge write routes missing `requireBridgeEditorOrAdmin` — viewer role can mutate | `hub/bridge/server.mjs` | ⬜ |
| 3.4 | MCP in-memory refresh token store — add periodic sweep for expired entries | `hub/gateway/mcp-oauth-provider.mjs` | ⬜ |
| 3.5 | CORS on canister: lock `Access-Control-Allow-Origin` to gateway origin when secret is set | `hub/icp/src/hub/main.mo` | ⬜ |
| 3.6 | Resolve high-severity `path-to-regexp` ReDoS CVE — upgrade or replace | `hub/package.json`, `hub/gateway/package.json` | ⬜ |
| — | Tests for all Phase 3 changes | `test/phase3-security.test.mjs` | ⬜ |

---

## Deployment steps for each canister-touching phase

After any Motoko change:
```bash
# 1. Export backup first (safety)
npm run canister:export-backup

# 2. Deploy
cd hub/icp && dfx deploy hub --network ic

# 3. If new admin functions added, call them
dfx canister call hub <function_name> '("<secret>")' --network ic

# 4. Verify
curl -s https://rsovz-byaaa-aaaaa-qgira-cai.raw.icp0.io/health
```

---

## Open verification items (resolve before public launch)

- [ ] Production canister URL confirmed as `raw.icp0.io` in all Netlify env vars ✅
- [ ] `CANISTER_AUTH_SECRET` set in Netlify gateway env ✅
- [ ] `admin_set_gateway_auth_secret` called on IC mainnet canister ✅
- [ ] Netlify function IAM and blob access policies reviewed (not visible in code)
- [ ] Content Security Policy and cookie flags for Hub static hosting
- [ ] Log pipeline confirmed — no `Authorization` or `?token=` values logged
- [ ] Stripe live-mode webhook endpoint idempotency under replay confirmed
- [ ] `BILLING_ENFORCE` decision explicit for production

---

## Canister IDs
- Hub: `rsovz-byaaa-aaaaa-qgira-cai`
- Attestation: `dejku-syaaa-aaaaa-qgy3q-cai`

## Key commits
- Phase 0: `6749166` — canister gateway auth, timing-safe secrets, fail-closed webhook, attest auth

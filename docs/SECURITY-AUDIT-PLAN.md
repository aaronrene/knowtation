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

## Phase 1 — High Priority (Same Release Train) ✅ COMPLETE
**Model:** claude-4.6-sonnet-medium-thinking
**Branch:** `feature/landing-overview-video-ui`

| # | Item | File(s) | Status |
|---|------|---------|--------|
| 1.1 | Trust proxy for Express rate limiting — real client IPs behind Netlify CDN | `hub/gateway/server.mjs`, `hub/server.mjs` | ✅ |
| 1.2 | Zip-slip protection — validate each AdmZip entry stays under extract dir | `hub/bridge/server.mjs`, `hub/server.mjs` | ✅ |
| 1.3 | Self-hosted default-admin startup warning when `roleMap.size === 0` in production | `hub/server.mjs` | ✅ |
| 1.4 | Header allowlist for `proxyToCanister` and `proxyTo` — replace `...req.headers` spread | `hub/gateway/server.mjs` | ✅ |
| 1.5 | Billing enforcement startup warning when `BILLING_ENFORCE` unset in hosted mode | `hub/gateway/billing-constants.mjs`, `hub/gateway/server.mjs` | ✅ |
| — | 36 new unit tests; 1306 total tests passing | `test/phase1-security.test.mjs` | ✅ |

---

## Phase 2 — CI/CD & Infrastructure ✅ COMPLETE
**Model:** claude-4.6-sonnet-medium-thinking
**Branch:** `feature/landing-overview-video-ui`

| # | Item | File(s) | Status |
|---|------|---------|--------|
| 2.1 | Add `npm audit` gate to CI — fail on high/critical CVEs | `.github/workflows/ci.yml` | ✅ |
| 2.2 | Add secret scanning to CI (TruffleHog action) | `.github/workflows/ci.yml` | ✅ |
| 2.3 | Add dependency review action on PRs (`actions/dependency-review-action`) | `.github/workflows/dependency-review.yml` | ✅ |
| 2.4 | Dockerfile: non-root user (`knowtation`), pinned tag (`node:20.19.0-alpine3.21`), `npm ci` | `hub/Dockerfile` | ✅ |
| 2.5 | Fix GitHub token encryption salt — random 16-byte per-token salt embedded in ciphertext; v1 tokens gracefully fall back to reconnect | `hub/bridge/server.mjs` | ✅ |
| 2.6 | Upgraded `multer@1.x` → `multer@2.1.1`; added `sanitizeUploadFilename()` — strips path traversal, replaces unsafe chars, truncates to 200 chars | `hub/bridge/server.mjs`, `package.json` | ✅ |
| — | 41 new unit tests; 1347 total tests passing | `test/phase2-security.test.mjs` | ✅ |

---

## Phase 3 — Defense in Depth ✅ COMPLETE
**Model:** claude-4.6-opus-high-thinking
**Branch:** `feature/security-audit`
**Deployed:** Canister V7→V8 migration live on IC mainnet. CORS origin locked to gateway.

| # | Item | File(s) | Status |
|---|------|---------|--------|
| 3.1 | JWT token-in-URL: OAuth redirect uses URL fragment `#token=`; gateway JWT expiry shortened from `7d` → `24h` | `hub/gateway/server.mjs`, `hub/server.mjs` | ✅ |
| 3.2 | Image proxy `?token=` — short-lived HMAC-signed image token (5 min TTL) replaces full JWT in query param; new `/api/v1/vault/image-proxy-token` endpoint | `hub/gateway/server.mjs`, `hub/server.mjs` | ✅ |
| 3.3 | Bridge write routes: `requireBridgeEditorOrAdmin` added to `/vault/sync`, `/index`, `/memory/store`, `/memory/clear`, `/memory/consolidate` — viewer role can no longer mutate | `hub/bridge/server.mjs` | ✅ |
| 3.4 | MCP in-memory refresh token store: periodic sweep every 10 min deletes expired entries; `destroy()` cleans up timer | `hub/gateway/mcp-oauth-provider.mjs` | ✅ |
| 3.5 | CORS on canister: `corsHeaders()` locks `Access-Control-Allow-Origin` to stored origin when `gateway_auth_secret` + `cors_allowed_origin` are both set; new `admin_set_cors_origin` function; V7→V8 migration | `hub/icp/src/hub/main.mo`, `hub/icp/src/hub/Migration.mo` | ✅ |
| 3.6 | `path-to-regexp` ReDoS CVE resolved: `npm audit fix` upgraded `0.1.12` → `0.1.13` in all three lock files | `hub/package-lock.json`, `hub/gateway/package-lock.json`, `package-lock.json` | ✅ |
| — | 33 new unit tests; 1380 total tests passing | `test/phase3-security.test.mjs` | ✅ |

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

- [x] Production canister URL confirmed as `raw.icp0.io` in all Netlify env vars
- [x] `CANISTER_AUTH_SECRET` set in Netlify gateway env
- [x] `admin_set_gateway_auth_secret` called on IC mainnet canister
- [x] `admin_set_cors_origin` called on IC mainnet canister (Phase 3.5 — locked to `https://knowtation-gateway.netlify.app`)
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
- Phase 1: `9b37569` — trust proxy, zip-slip, default-admin warning, header allowlist, billing warning
- Phase 2: (see commit on `feature/landing-overview-video-ui`) — npm audit CI gate, TruffleHog, dependency review, Dockerfile hardening, per-token salt, multer@2
- Phase 3: `9a362e5` — token-in-URL fragment, image proxy signed token, bridge RBAC, MCP token sweep, canister CORS lock, path-to-regexp fix

**All four audit phases complete. Remaining items above are operational verification, not code changes.**

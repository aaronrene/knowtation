---
title: SEC-KN-P6-ROTATE-b — R1 EC2 deploy + R2 role-cap probe evidence
date: 2026-08-01
step: SEC-KN-P6-ROTATE-b
model: Operator + Auto
authority: knowtation
posture: R1 (Tier 3 / T1) executed with operator authorization from the paste-ready prompt;
  R2 non-destructive probe per freeze §5.1. No secret rotation / env write (T2) in this slice.
consumes: docs/SEC-KN-P6-ROTATE-FREEZE.md (frozen: true, review pass sha256:958c8add…)
---

# R1 — EC2 MCP host deployed to current main (T1)

| Fact | Evidence (this session) |
| --- | --- |
| Instance | `i-025679d93cf47aeab` (`knowtation-mcp-gateway`, us-east-2, `18.221.120.124` = `mcp.knowtation.store`) |
| Runtime layout | PM2 app `knowtation-gateway` (fork, user `ubuntu`), script `/opt/knowtation/hub/gateway/server.mjs`, created 2026-07-13; second stale checkout at `~/knowtation` untouched |
| Pre-deploy SHA | `257ef705b84db56966a4a2a1d9c2c5319331c053` (main, clean tree) — `mayApplyAdminAllowlistOverride` **absent** (grep count 0) → pre-SEC-KN-3, matches freeze §2.1 |
| Deploy target | GitHub `origin/main` tip `15fba5f5d8976621eff7008b05fb5df90825c908` (muse-mirror PR #287 merge); contains SEC-KN-3 marker (grep count 3); `257ef705` verified ancestor → fast-forward only |
| Deploy actions | `git fetch` + `git merge --ff-only FETCH_HEAD` → `15fba5f5`; `npm ci` exit 0 (Node v20.20.2); `pm2 restart knowtation-gateway` → online, `/mcp` + Phase C + device OAuth routes mounted |
| Rollback point | `git checkout 257ef705 && npm ci && pm2 restart knowtation-gateway` |

# R2 — role-cap probe (freeze §5.1) — **PASS**

Script: `scripts/archive/2026-08-01-p6-rotate-r2-role-cap-probe.mjs` (token never printed;
scopes asserted exactly `["propose","vault:read"]`).

| Call | Gateway (`api.knowtation.store`) | MCP (`mcp.knowtation.store`) | Expected |
| --- | --- | --- | --- |
| Session introspection (control) | **200** | **200** | 200/200 — share still holds during window |
| Garbage token session (control) | — | **401** | 401 — route mounted + verifying |
| `GET` nonexistent proposal (control) | **404** | **404** | 404/404 — fake id backs no real row |
| `POST` discard nonexistent id (probe) | **401 UNAUTHORIZED** | **401 UNAUTHORIZED** | gw 401; MCP 401/403, **never 2xx** |

**Verdict:** MCP now matches the gateway refuse class (`401` vs the pre-deploy `200`).
Per freeze §4, the live P6 elevation path is **closed by deploy**. Rotation (R4–R5) is still
required for shared-secret hygiene (VERIFIED-SHARED blast radius).

# R3 note — G10 sweep confirmation

`rg "jwt.verify"` across `hub/ web/ cli/ lib/ netlify/` matched exactly the nine frozen G10
sites plus `hub/server.mjs:384/:424/:438` — the **local self-hosted server** keyed by
`JWT_SECRET`, which is not one of the three signing-domain hosts and is outside the frozen
G10 list (not wired; recorded here, not improvised into scope).

# Access-path notes (operator)

- SSH: `ubuntu@18.221.120.124` with key pair `bornfree-discord-code` (local `.pem` had 0644
  permissions — tightened to 0600 this session).
- AWS CLI (`aaron-admin`) can locate the instance; SSM agent not registered (no
  `ssm:DescribeInstanceInformation` entry), so SSH is the deploy path.
- `/opt/knowtation/.env` holds `SESSION_SECRET` (dated Apr 19) — the T2 rotation target on
  this host. Not read, not printed.

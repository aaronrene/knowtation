---
title: SEC-KN-P6-VERIFY — MCP host / gateway SESSION_SECRET share verification
date: 2026-08-01
step: SEC-KN-P6-VERIFY
model: Operator + Auto
authority: knowtation
posture: read-only evidence session (no posture/env flips; F7 AWS-parked)
frozen: true
outcome: B — SHARED (secret is common across gateway + MCP host)
verdict: VERIFIED-SHARED
---

# SEC-KN-P6-VERIFY — is `SESSION_SECRET` shared between the Netlify gateway and the persistent MCP host?

## Question (from the board)

P6 (`PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md`) capped `mcp_access` role elevation in
`resolveHostedActorRole`, and noted the exploit path is **not mounted on Netlify** — so
"exploitability depends on the MCP host sharing `SESSION_SECRET`." That share has been
**UNVERIFIED** since 2026-07-26. This evidence-only session resolves it.

## Hosts under test (distinct — proven, not assumed)

| Host | DNS / infra | Server header | CORS `Allow-Origin` on `/health` |
| --- | --- | --- | --- |
| Gateway | `api.knowtation.store` → CNAME `knowtation-gateway.netlify.app` (`13.52.188.95`, `52.52.192.191`) | `server: Netlify` + `x-nf-request-id` + `cache-status: "Netlify …"` | `https://knowtation.store` |
| MCP host | `mcp.knowtation.store` → `18.221.120.124` (EC2) | `Server: nginx/1.24.0 (Ubuntu)`, HTTP/1.1, `Connection: keep-alive` | `https://knowtation-gateway.netlify.app` |

The two hosts return **different** CORS `Allow-Origin` values and different `Server`
identities for the same `/health` request. That rules out the one benign alternative to a
shared secret — namely that `mcp.knowtation.store` blindly reverse-proxies `/api/v1/*` back
to Netlify. It computes its own CORS, so it is a **separate Node instance** (nginx → Node),
and its `/api/v1/auth/session` verifies JWTs against its **own** local `SESSION_SECRET`.

## Method — signed-token cross-acceptance probe (read-only)

`GET /api/v1/auth/session` verifies purely by JWT signature
(`hub/gateway/server.mjs` → `decodeVerifiedToken` → `jwt.verify(token, SESSION_SECRET)`,
`server.mjs:260-265,480-500`) with **no DB call**. So presenting one **gateway-signed** JWT
to both hosts isolates the signing-key question:

- 200 on the MCP host → it verified the gateway's HS256 signature → **secret shared**.
- 401 on the MCP host → signature rejected → **secret isolated**.

Token minted via the Phase C credential exchange
(`POST /api/v1/auth/agent/token`, credential from `~/.config/knowtation/agent_cred`;
never printed). Probe script: `scripts/archive/2026-08-01-p6-cross-acceptance-probe.mjs`.

## Evidence (this session, 2026-08-01 ~13:59 UTC)

```
health gateway  status=200 body={"ok":true}
health mcp-host status=200 body={"ok":true}
exchange OK type=agent_access scopes=["propose","vault:read"] exp_in_s=900
control-A gateway/session status=200  (token accepted by its issuer — token is valid)
PROBE     mcp/session     status=200  (SAME gateway-signed token accepted by the MCP host)
control-B mcp/session garbage-token status=401 (route is actually verifying, not blindly 200)
control-C mcp/session no-auth       status=401 (route mounted; not a 404)
```

Control A (200 on issuer) proves the token is validly signed; control B/C (401) prove the
MCP host's session route is mounted and genuinely checking signatures. Against that, the
PROBE returning 200 is decisive.

## Verdict — Outcome B: **SHARED** → `VERIFIED-SHARED`

The persistent MCP host (`mcp.knowtation.store`, EC2) verifies JWTs signed with the same
`SESSION_SECRET` as the Netlify gateway. HS256 verification succeeds **iff** the secret is
identical, and the two hosts are proven to be distinct instances. Therefore the secret is
shared.

Per the frozen instruction, **no fix is improvised in this session**. Rotating/splitting the
secret is Tier 3 (secrets) and requires a `SEC-KN` Thinking freeze first — see NEXT.

## Why this matters (risk, stated honestly)

- A shared JWT signing domain across gateway + bridge is **partly by design** — the gateway
  README (§Post-deploy verification #3) requires the **bridge** to share `SESSION_SECRET` so
  JWTs verify across `/api/v1/vault/*`. The new fact is that the **MCP host** is in that same
  signing domain.
- The specific P6 hazard is that the MCP host mounts the full stateful `/mcp` router **and**
  `SEC-KN-3` (`resolveHostedActorRole` capping `mcp_access` role by scopes, never the admin
  allowlist) is recorded **DONE but not merged to `main`** (`docs/ROADMAP.md` SEC-KN-3 row).
  If the code running on the EC2 MCP host predates SEC-KN-3, an `mcp_access` token minted for
  an admin `sub` — now verifiable there because the secret is shared — could still resolve
  `role: admin`. **UNVERIFIED and intentionally not probed here**, because confirming it would
  require an active elevation attempt (mint admin-`sub` `mcp_access` token, attempt
  approve/discard), which exceeds this read-only mandate. This is the top input to the freeze.

## Optional sidecar — live proposal `created_by` populated (CONFIRMED)

Authenticated read of `GET /api/v1/proposals?limit=5` (agent token, `X-Vault-Id: default`):
64 proposals returned; **7 most-recent carry a non-empty server-derived `created_by`**
(`google:…`, len 28), including `prop-1785500300353491755` (the 2026-07-31
FLOW-CAPTURE-LIVE-SMOKE proposal). The 57 older proposals have an **empty** `created_by`,
consistent with the field being populated only for proposals created after the SEC-KN-4
server-only binding deployed. This closes the last **UNVERIFIED** `created_by` row:
the binding is live and populating on new proposals.
Probe script: `scripts/archive/2026-08-01-created-by-probe.mjs`.

## Hard-stops honored

Read-only probes only. No posture/env flip. No secret printed (tokens/subs redacted). No
`dfx deploy`. No secret rotation. F7 AWS-parked. No GitHub PR opened.

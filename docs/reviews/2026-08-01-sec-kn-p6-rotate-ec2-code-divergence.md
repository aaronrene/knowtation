---
title: SEC-KN-P6-ROTATE — EC2 MCP host code divergence (top freeze input)
date: 2026-08-01
step: SEC-KN-P6-ROTATE-a
model: Thinking
authority: knowtation
posture: Thinking session probes only — no secret rotation, no env/posture flip, no deploy
frozen_input_for: docs/SEC-KN-P6-ROTATE-FREEZE.md
---

# EC2 MCP host runs pre-current-main code (source SEC-KN-3 is on main)

## Board correction

SEC-KN-3 tip `5954c433…` is an **ancestor of Muse `main`**. GitHub `origin/main` contains
the SEC-KN-3 `resolveHostedActorRole` markers (first mirrored at git `69a7673`, 2026-07-27).
The ROADMAP wording "SEC-KN-3 … not merged to main" was **stale**.

## Live probe (same `agent_access` JWT on both hosts)

| Call | Gateway (`api.knowtation.store`) | MCP (`mcp.knowtation.store`) |
| --- | --- | --- |
| `GET` health | 200 Netlify | 200 nginx/1.24.0 |
| `GET` session introspection | 200 | 200 (shared secret still holds) |
| `POST` discard nonexistent `prop-p6-rotate-probe-nonexistent-0000` | **401 UNAUTHORIZED** | **200** (empty body) |
| `GET` same nonexistent id | 404 NOT_FOUND | 404 NOT_FOUND |

Token scopes were exactly `propose` + `vault:read` (no write/admin). On current main,
Phase C `agentScopesPermitMethod` refuses discard create-path → `getUserId` null → **401**
(`hub/lib/agent-credential-core.mjs:366-388`; `hub/gateway/server.mjs:1628-1634`).
MCP returning **200** means that refuse path is **absent** on EC2 → runtime ≠ current main.

## Frozen consequence

Deploy current main to EC2 **before** any `SESSION_SECRET` rotation
(`docs/SEC-KN-P6-ROTATE-FREEZE.md` D2). The 200 is **not** treated as a completed
admin-elevation proof (real approve not run); it is enough to gate deploy-first.

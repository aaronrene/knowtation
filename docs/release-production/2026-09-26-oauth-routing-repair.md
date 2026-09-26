# OAuth routing repair — production deployment record

Date: 2026-09-26
Scope: Knowtation persistent MCP gateway routing startup order
Qualification boundary: operational deployment evidence only; this record does not qualify a client, close W4, advance W5, or revise any sealed evidence packet.

## Problem and repair

The native and device OAuth routers were registered inside asynchronous import callbacks. Express registered the terminal `/api/v1` fallback first, so native and device discovery requests reached the authenticated fallback and returned `401` before their public routers could run.

The repair imports and constructs the existing MCP OAuth, native OAuth, device OAuth, REST agent credential and MCP transport routers before the fallback and listener. Required-router import or construction failures now stop startup. The terminal `/api/v1` fallback follows all specific API routes. Provider behavior, scopes, credential formats and durable stores are unchanged.

## Production inventory and version comparison

- AWS region: `us-east-2`
- EC2 instance: `i-025679d93cf47aeab` (`knowtation-mcp-gateway`)
- Application directory: `/opt/knowtation`
- PM2 process: `knowtation-gateway`, one online process in `fork_mode`
- PM2 script: `/opt/knowtation/hub/gateway/server.mjs`
- Deployed repository revision used as the adaptation baseline: `d48fb11c98310bb100e0a93a0ce4f2f8479742e6`
- Deployed baseline `server.mjs` SHA-256: `dbb589a989bc1c7d3490f4c8988cfe26f590d0661143df65a66c85f9f87c8551`
- Production-adapted candidate SHA-256: `507549af9f4bf78a2c9d2acb0f116c126b316b0f3151e6559770b7cb9de89629`
- Current-source pre-repair SHA-256: `64a9f73686be541942c44b7eeb64f8a84700eefab8611b59bcfb48e23316b14a`
- Current-source candidate SHA-256: `80c76c761aaf8ca4684b3e4c0b37c6f23c3b763f8b6cf28b071986a7b5fda39b`

The production baseline differed from the newer current source, so the current-source file was not copied over it. The same minimal routing repair was adapted to the exact deployed revision and validated separately. Source and lockfile hashes for the deployed OAuth providers and dependencies matched revision `d48fb11c98310bb100e0a93a0ce4f2f8479742e6`. Installed production versions included Node `20.20.2`, root Express `4.22.2`, gateway Express `4.22.1`, MCP SDK `1.30.0` and jsonwebtoken `9.0.3`.

Nginx used a general `location /` proxy to `127.0.0.1:3340` for `mcp.knowtation.store`; no nginx authentication or path-specific interception applied to `/mcp`, `/.well-known` or `/api/v1/auth/*`. Durable agent authentication was enabled through the existing session configuration, with offline-locked and Netlify modes inactive.

## Validation

The current-source candidate passed:

- focused gateway bootstrap: 14 passed, 0 failed;
- narrow OAuth/CORS/MCP suite: 192 passed, 0 failed;
- broader gateway/auth suite: 1,433 passed, 0 failed;
- complete tracked suite: 4,641 passed, 0 failed, 0 skipped.

The production-adapted candidate passed 193 relevant tests with 0 failures, including the 14 real gateway startup and routing checks with production's installed Express `4.22.1`.

## Deployment and observed result

The deployment replaced only `/opt/knowtation/hub/gateway/server.mjs` and restarted only `knowtation-gateway`. It installed no dependency, changed no lockfile or authentication data, and made no nginx, DNS, CORS or persistent AWS configuration change. The guarded deployment verified both source hashes, preserved the previous file, and would have restored it automatically if local checks failed.

The PM2 process returned online after one restart. Checks on `127.0.0.1:3340` and through `https://mcp.knowtation.store` produced the same results:

| Request | Result |
| --- | ---: |
| `GET /health` | 200 |
| `GET /.well-known/oauth-authorization-server` | 200 |
| `GET /api/v1/auth/native/.well-known/oauth-authorization-server` | 200 |
| `GET /api/v1/auth/device/.well-known/oauth-authorization-server` | 200 |
| unauthenticated `GET /mcp` | 401 |

The initial loopback connection attempts during restart were refused until PM2 reopened the listener; the guarded check then passed. Active in-memory MCP transports may have disconnected during that restart. Durable authentication records were retained.

## Rollback

Verified production backup:

`/home/ubuntu/knowtation-deploy-backups/server.mjs-dbb589a989bc1c7d3490f4c8988cfe26f590d0661143df65a66c85f9f87c8551.bak`

The guarded rollback restores that exact file, verifies its SHA-256, restarts only `knowtation-gateway`, and checks `/health`. No rollback was required.

## Separate follow-ups

- The application CORS allowlist remains configured for the historical Netlify origin rather than the apex and `www` production origins. That did not cause the no-Origin discovery failure and was intentionally excluded from this deployment.
- A real production identity-provider sign-in or device approval with an authorized test account was not performed. Public discovery and authentication enforcement were verified; no production registration or authorization record was created for this deployment check.
- The current-source repair and regression tests still require canonical Muse integration and the mandatory GitHub `muse-mirror` PR. This operational deployment did not commit, push, merge or open a PR.

---
frozen: false
phase: AIP-b
verdict: pass
round: 1
date: 2026-08-24
frozen_spec: docs/AUTOMATION-INGEST-POLICY-FREEZE.md
frozen_digest: sha256:9fded978386543865225f5cc2bc0f04f09e777f8de96a56ef5d516c995a2793c
reviewer_mode: agent
reviewer_model: thinking-high
---

## Build verification — AIP-b round 1

**Verdict:** pass  
**Frozen spec:** `docs/AUTOMATION-INGEST-POLICY-FREEZE.md`  
**Diff scope:** §18 file list + §15–16 tests/docs (`lib/automation-ingest-policy.mjs`, `hub/gateway/automation-ingest-store.mjs`, `hub/automation-ingest-rules-default.json`, `hub/lib/agent-credential-core.mjs`, `hub/gateway/server.mjs`, `hub/gateway/billing-middleware.mjs`, `hub/server.mjs`, `lib/list-notes.mjs`, `web/hub/index.html`, `web/hub/hub.js`, `netlify/functions/gateway.mjs`, `scripts/verify-automation-ingest-smoke.mjs`, `docs/openapi.yaml`, `docs/AGENT-INTEGRATION.md`, `docs/PROPOSAL-LIFECYCLE.md`, `docs/HUB-API.md`, `test/automation-ingest-*.test.mjs`)

### Findings

None. Implementation matches freeze D1–D27 and §9–§16. `hub/gateway/access-token-authz.mjs` and `hub/audit-log.mjs` were not edited. `lib/hub-proposal-personal-self-apply.mjs` was not edited. Scooling was not edited.

### Evidence

| type | sha256 | ref | notes |
| --- | --- | --- | --- |
| test_output | sha256:250daf41bd930d4a6f7ded0cb3a75205b73a0f27a1b2a7c078519bd66f1ed0ea | `node --test test/automation-ingest-*.test.mjs` | 26/26 pass, seven-tier |

### Checklist

| # | Check | Result |
| --- | --- | --- |
| V1 | Deliverables at frozen paths | pass — policy, store, pack JSON, ingest+CRUD routes, UI, smoke, docs |
| V2 | APIs match D1–D27 | pass — first-match router; `ingest:automation` additive not default; ingest path allowlist; D8 agent-only hook; D9/D10 rewrites; D23 gateway approve without agent Bearer; D24 `opts.operation`; D25 frontmatter `content_class`; D27 two dedicated blobs |
| V3 | Tests cover §16 matrix | pass — 26 tests across seven `test/automation-ingest-*.test.mjs` files |
| V4 | No scope creep | pass — no Scooling, no MCP ingest tool, no pack enable, no vault:write on default mint, no E1/T5 edits |
| V5 | No silent requirement deletion | pass |
| V6 | Governance truthful after sync | pass (this review + ROADMAP/handover update) |
| V7 | No secrets / unsafe defaults | pass — smoke redacts JWTs and refuses `kt_agent_` on argv |
| V8 | Claims match verifiable state | pass — test hash cited; no production-smoke claim |

### Honest summary

AIP-b shipped the ingest router, `POST api/v1/automation/ingest`, session CRUD for ingest rules, a disabled Born Free template pack, `content_class` list filter + Research UI, and an agent-only D8 hook on `POST api/v1/proposals`. Cron mint can add `ingest:automation` without `vault:write`. Session proposal create is unchanged. Production ingest smoke remains Operator T2.

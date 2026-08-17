# Build verification — KN-DOCS-SYNC-b round 1

**Verdict:** pass  
**Frozen spec:** `docs/KN-DOCS-SYNC-FREEZE.md` (`frozen: true`, freeze-review pass digest `sha256:cebd3d9d…`)  
**Diff scope:** Muse `feat/kn-docs-sync-b` — library commit `724639df…` + route/docs/security tip (this session)  
**Reviewer posture:** independent checklist vs freeze D1–D17 + §4–§11 (not redesign)

### Evidence

| type | sha256 | ref | notes |
| --- | --- | --- | --- |
| test_output | `41713d8836326d162a44ba361378fcc223e39e5212a63bcc459e4ddb5e7f7441` | `node --test test/docs-oauth-connector-*.test.mjs` | **12/12** pass |

### Checklist

| # | Check | Evidence |
| --- | --- | --- |
| V1 | Deliverables at frozen paths | `lib/docs/**`, `hub/bridge/docs-blob-store.mjs`, `hub/bridge/docs-routes.mjs`, hub/gateway/server mounts, importer helper exports, seven-tier tests, HUB-API / OpenAPI / PROPOSAL-LIFECYCLE |
| V2 | APIs match §4.2 | Unified begin/list; Drive callback; files/import/sync/DELETE; 501 when gates false |
| V3 | Test matrix | unit/integration/e2e/stress/data-integrity/performance/security all present; security covers gate, PKCE S256, allowlist, q/id injection, no writeNote, docs_oauth≠calendar_oauth, no T5 fingerprint |
| V4 | No scope creep | No Scooling edits; no gdrive importer behavior change; no calendar writes; no Notion OAuth; gates false |
| V5 | Requirements held | D1–D17; Review-before-write only; revoke keeps notes; sync_cursor Knowtation-only |
| V6 | Governance truthful | ROADMAP → DONE only after this pass; handover NEXT → Scooling CONNECT-DRIVE-READY / operator Tier 3 |
| V7 | Secrets / injection | `.env.example` names only; secrets omitted from client projection; list `q` regex locked |
| V8 | Claims ↔ evidence | Seven-tier hash above; gates `= false` in source |

### Findings

_None._

### Honest summary

Knowtation now exposes inert Drive (readonly OAuth + `docs_oauth` vault) and Notion (process-wide Hub key) connector routes that list metadata and create `docs-sync` Review proposals only. Compile-time gates remain hard-coded false. Folder `gdrive` import and Calendar OAuth are untouched. No Scooling Ready flip.

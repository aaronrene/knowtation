# Build verification — KN-WORK-PATH-LIST-b round 1

**Verdict:** pass  
**Frozen spec:** `docs/KN-WORK-PATH-LIST-FREEZE.md` (`frozen: true`, freeze-review pass digest `sha256:1354ed45531fc4dac329e989727deb9f9f4eb1ed17936a5d65c83b25cb8a1506`)  
**Diff scope:** Muse `feat/kn-work-path-list-b` — `lib/path/**`, hub list/get/propose/approve wire, blob `learning_paths` mergeById, seven-tier `test/path-list-*.test.mjs`, HUB-API / OpenAPI / PROPOSAL-LIFECYCLE / `.env.example`  
**Reviewer posture:** independent checklist vs freeze D1–D12 + §3–§5 + §7 + §9 (not redesign)

### Evidence

| type | sha256 | ref | notes |
| --- | --- | --- | --- |
| test_output | `a733bb9fe7c66f7d20821519c656fd39c04ac0928f3f8add74d2b4e1a09dcd98` | `node --test test/path-list-*.test.mjs` | **44/44** pass |

### Checklist

| # | Check | Evidence |
| --- | --- | --- |
| V1 | Deliverables at frozen paths | `lib/path/path-store.mjs`, `path-write.mjs`, `path-handlers.mjs`, `path-hosted-proposal.mjs`; `hub/gateway/path-approve-hosted.mjs`; `hub/bridge/path-routes.mjs`; seven-tier tests; HUB-API §3.4.1; OpenAPI LearningPaths; PROPOSAL-LIFECYCLE learning-path row |
| V2 | APIs match §4 | `GET api/v1/learning-paths` + `GET :path_id`; gated `POST …/proposals`; hosted `POST …/apply-approved`; self-hosted approve precheck/reconcile on `PATH_PROPOSAL_SOURCE` next to the task pair (`hub/server.mjs`); gateway hook after task/media |
| V3 | Test matrix | unit/integration/e2e/stress/data-integrity/performance/security present; security pre-fix stubs (a)(b)(c) fail the contract; real impl covers 404-not-leak, gate off, no T5 admit, no `writeNote` from path modules |
| V4 | No scope creep | No `~/scooling/` edits this Auto; `lib/task/task-write.mjs` untouched; `orchestrator_graphs` merge not rewritten; no MCP/CLI/Hub wizard; no production Path seed |
| V5 | Requirements held | D1 `learning_paths[]` on `hub_flow_store.json`; D2 server mint `path_`+16 hex; D3 `getPathWritesEnabled` in `path-write.mjs` only; D4 T5 refused; D7 empty list honest; D11 archive keep-row; D12 last-`updated` wins, no `base_state_id` |
| V6 | Governance truthful | ROADMAP → DONE only after this pass; handover NEXT → Scooling HOME-BIND Thinking (this repo does not edit Scooling) |
| V7 | Secrets / injection | `.env.example` `# PATH_WRITES_ENABLED=` name only (not `1`/`true`); path kinds off `ADMITTED_*`; `note_path` rejects `../` and URLs; control chars → `PATH_TEXT_INVALID` |
| V8 | Claims ↔ evidence | Seven-tier hash above; `PATH_WRITES_ENABLED` unset in source; honesty ledger N/A (`honesty.enabled` absent) |

### Findings

_None._

### Honest summary

Knowtation now stores structured learning paths in the existing `hub_flow_store.json` vault bucket as `learning_paths[]`, lists and gets them over Hub REST, and persists only through Review-before-write proposals (`path_create` \| `path_update` \| `path_archive`) with `PATH_WRITES_ENABLED` default off. Hosted apply copies the task approve hook. Path kinds stay off T5 self-apply. Scooling harvest, Home bind, Live, and BRAIN-PAIR-b were not started.

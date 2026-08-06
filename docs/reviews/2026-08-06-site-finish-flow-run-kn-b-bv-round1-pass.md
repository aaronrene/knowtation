# Build verification — SITE-FINISH-FLOW-RUN-KN-b round 1

**Verdict:** pass  
**Frozen spec:** `~/scooling/docs/SITE-FINISH-FLOW-RUN-FREEZE.md` (`frozen: true`, review_stamp `pass`, digest `sha256:24f10167ca4ebbc564df61c985058aa1509cbe83afb22930e34bfe1952245e50`)  
**Diff scope:** Knowtation `feat/site-finish-flow-run-kn-b` — NEW `hub/bridge/flow-run-routes.mjs`, `test/site-finish-flow-run-kn-b.test.mjs`; MOD `hub/gateway/server.mjs` (run/consent proxies), `hub/bridge/server.mjs` (`registerBridgeFlowRunRoutes`), `lib/flow/flow-execution.mjs` (async `handleFlowRunSubmitReviewRequest` + `handleFlowRunMcpRequest`), callers (`hub/server.mjs`, `cli/index.mjs`, `mcp/tools/flow.mjs`, related tests), `hub/bridge/flow-routes.mjs` comment, `test/gateway-flow-authoring-proxy.test.mjs` (run proxies coexist)  
**Reviewer posture:** independent verifier against §FR.0.4 / §FR.9; not redesign

### Evidence

| type | sha256 | ref | notes |
| --- | --- | --- | --- |
| test_output | `0f6d17ac1e1dc990b44adc3e0a8cea12bb3f44b19f66adef2123e19197a7a8f8` | `node --test test/site-finish-flow-run-kn-b.test.mjs` | **10/10** pass (7 suites) |
| test_file | `fcb27c9ec695e093cf269201da81ce8f6475fab5748b0b687aacda5a64dca54f` | `test/site-finish-flow-run-kn-b.test.mjs` | Seven-tier source |

### Checklist

| # | Check | Evidence |
| --- | --- | --- |
| V1 | Frozen deliverables exist | Gateway proxies in `hub/gateway/server.mjs` for all §FR.0.4 routes; `hub/bridge/flow-run-routes.mjs` + `registerBridgeFlowRunRoutes` in `hub/bridge/server.mjs` |
| V2 | APIs match freeze | `POST …/runs`, `…/advance`, `…/evidence`, `…/execute-automatable`, `…/submit-review`, `…/consent`; `GET …/runs` + `GET …/flow-runs/:run_id`; env gates unchanged (default off) |
| V3 | Seven-tier matrix | unit/integration/e2e/stress/data-integrity/performance/security — **10/10** |
| V4 | No scope creep | No SC product/posture; no KN env ON; no consent-ledger blob expansion; no projection/Delegation/WEB-FINISH/Apple/F7 |
| V5 | No silent deletion | Authoring + capture proxies retained; authoring unit assertion updated to require coexistence |
| V6 | Governance truthful after this pass | ROADMAP/HANDOVER updated in closing commit with DONE + NEXT = SITE-FINISH-FLOW-RUN-flip (product relay) |
| V7 | No secrets / unsafe defaults | Envs default off (runtime assert `{run:false, auto:false}`); security tier source-scans; no SESSION_SECRET / SCOOLING flips |
| V8 | Claims match evidence | Tests green with digests above; §FR.0.4 family covered by integration (8 routes → mock bridge) |

### Findings

None.

### Honest summary

Knowtation SITE-FINISH-FLOW-RUN-KN-b ships gateway→bridge proxies for the Hub run/consent
family (§FR.0.4) and bridge handlers that call existing `flow-execution.mjs` facades with
`hub_flow_store.json` blob sync for runs. `FLOW_RUN_WRITES_ENABLED` and
`FLOW_AUTOMATABLE_EXECUTION_ENABLED` remain default **off**. Submit-review now awaits
`Promise.resolve(createProposal(…))` so hosted canister create works (capture precedent).
Consent ledger files stay process-local this slice. No Scooling posture/env flip; no
feature→GitHub-main. Hosted SMOKE remains Tier 3 after flip + coordinated env ON.

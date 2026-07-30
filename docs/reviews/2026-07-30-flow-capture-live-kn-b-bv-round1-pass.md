# Build verification — FLOW-CAPTURE-LIVE-KN-b round 1

**Verdict:** pass  
**Frozen spec:** `~/scooling/docs/FLOW-CAPTURE-LIVE-FREEZE.md` (`frozen: true`, review_stamp `pass`, digest `sha256:f0ca2edd…`)  
**Diff scope:** Knowtation `feat/flow-capture-live` — gateway capture proxies, bridge capture routes, hosted capture proposal helper, async propose/dismiss, PROPOSAL-LIFECYCLE Wave 2 note, seven-tier `test/flow-capture-live-kn-b.test.mjs`  
**Reviewer posture:** independent verifier (thinking-high); not redesign

### Evidence

| type | sha256 | ref | notes |
| --- | --- | --- | --- |
| test_output | `eea48141de910dddc4fe1fa8034ca58aa46a2135332f878a43e42298292c1846` | `node --test test/flow-capture-live-kn-b.test.mjs` | **13/13** pass (7 suites) |
| test_file | `8ef28cc4e4614ecadbfadb898cb56a4fbb99d0b0c52d1bda393fe0a191a49838` | `test/flow-capture-live-kn-b.test.mjs` | Seven-tier source |

### Checklist

| # | Check | Evidence |
| --- | --- | --- |
| V1 | Frozen deliverables exist | Gateway proxies in `hub/gateway/server.mjs`; `hub/bridge/flow-capture-routes.mjs` + `registerBridgeFlowCaptureRoutes`; `lib/flow/flow-capture-hosted-proposal.mjs`; PROPOSAL-LIFECYCLE Wave 2 note; seven-tier test file |
| V2 | APIs match freeze | POST observe, GET candidates, POST propose/dismiss → bridge; T5 refuse-all for promote/merge/dismiss; no `matchesScoolingFlowCaptureFingerprint` |
| V3 | Seven-tier matrix | unit/integration/e2e/stress/data-integrity/performance/security — **13/13** |
| V4 | No scope creep | No Scooling product code; no capture env ON; no T5 admit; run stays unproxied |
| V5 | No silent deletion | Authoring proxies retained; capture added beside them |
| V6 | Governance truthful after this pass | ROADMAP/HANDOVER updated in closing commit with DONE + NEXT = FLOW-CAPTURE-LIVEb |
| V7 | No secrets / unsafe defaults | Envs default off; security tier asserts no env hard-on; no secrets in envelopes |
| V8 | Claims match evidence | Tests green with digests above; freeze §FCL.3 KN-b + FCL-C3 + FCL-C10 satisfied |

### Findings

None.

### Honest summary

Wave 2 Knowtation KN-b ships gateway→bridge capture proxies (observe / list / propose / dismiss) and bridge handlers that call the existing capture facade (writes/detection still default OFF). Propose/dismiss await async `createProposal` so hosted canister create works; `createCaptureProposalOnCanister` embeds `source`/`capture_meta` in frontmatter without E1 admission. T5 stays refuse-all for all `flow_capture` kinds even when session-bound author==approver. PROPOSAL-LIFECYCLE documents Wave 2 option B. No capture posture/env flip; no Scooling product changes.

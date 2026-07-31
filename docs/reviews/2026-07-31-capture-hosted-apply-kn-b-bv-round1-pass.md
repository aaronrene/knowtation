# Build verification — CAPTURE-HOSTED-APPLY-KN-b round 1

**Verdict:** pass  
**Frozen spec:** `docs/CAPTURE-HOSTED-APPLY-FREEZE.md` (`frozen: true`, review_stamp `pass`, digest `sha256:6db36223…`)  
**Diff scope:** Knowtation `feat/flow-capture-live` — NEW `hub/gateway/capture-approve-hosted.mjs`, `lib/flow/flow-capture-hosted-apply.mjs`, `test/capture-hosted-apply-kn-b.test.mjs`; MOD `hub/bridge/flow-capture-routes.mjs` (apply-approved + GET flows list/get), `hub/gateway/server.mjs` (hook wiring + proxies), `docs/PROPOSAL-LIFECYCLE.md` (Wave 2 note)  
**Reviewer posture:** independent verifier subagent (fresh session, not the build session; Grok 4.5 high — both Claude thinking-high slugs were API-limited at review time); not redesign

### Evidence

| type | sha256 | ref | notes |
| --- | --- | --- | --- |
| test_output | `7671a00ded680291437bebd40560eae5b898792016a30d316c5a4a6c80ab3eee` | `node --test test/capture-hosted-apply-kn-b.test.mjs` | **15/15** pass (7 suites), exit 0 |
| test_output | `1287a1325477e39b1da462a724decf8f2fcdaec5834cf9611c0c3e7985d40696` | `node --test test/flow-capture-live-kn-b.test.mjs` | **13/13** pass, exit 0 |

### Checklist

| # | Check | Evidence |
| --- | --- | --- |
| V1 | Frozen deliverables exist | Hook module + merge helper; `applyApprovedCaptureProposalFromCanister`; bridge apply-approved + GET flows list/get; gateway import/call/proxies; lifecycle note; seven-tier test file |
| V2 (CHA-C1) | Gateway hook per freeze | Separate module; merges `capture_index_applied` / `capture_apply` / `capture_apply_error`+`_code`; null for non-capture; approve HTTP status preserved; `console.error` on failure |
| V2 (CHA-C2) | Bridge apply-approved | Behind `requireBridgeAuth` + vault context + canister headers; helper steps 1–8 (fetch → 400 non-capture → 409 non-approved → shared precheck refusal passthrough, no store mutate → `applyCaptureProposal` → blob persist via `withExternalProtocolBlobSync` → payload with promote/merge/dismiss markers) |
| V2 (CHA-C3/C10) | No precheck fork; body intact | Same `precheckApprovedCaptureProposal` + `applyCaptureProposal` as self-hosted `hub/server.mjs`; blob hydrate before precheck; normalize passes canister `body` through intact |
| V2 (CHA-C4) | T5 refuse-all unchanged | `lib/hub-proposal-personal-self-apply.mjs` untouched; no capture fingerprint admission; `SELF_APPLY_NOT_ADMITTED` regression green |
| V2 (CHA-C5) | Route ordering | Bridge GETs after `flows/candidates`; gateway GETs after projection/external-grants/candidates, before canister catch-all — no route stealing |
| V2 (CHA-C6) | Lifecycle doc | Wave 2 subsection: T5 refuse-all; Hub-complete approve applies; propose-only clarified; no hosted media apply claim |
| V2 (CHA-C7/C11) | Hard stops + honesty | No `FLOW_CAPTURE_*` env/posture flip; no approve of `prop-1785500300353491755`; no atomic approve+apply claim; ops re-apply route exists |
| V3 | Seven-tier matrix (§CHA.4) | unit/integration/e2e/stress/data-integrity/performance/security — **15/15**; real behavior assertions, e2e boots live gateway + mock bridge/canister |
| V4 | No scope creep | No T5 change; no Scooling product code; capture run path untouched |
| V5 | No silent deletion | Existing observe/list/propose/dismiss routes retained; apply-approved and GET flows added beside them |
| V6 | Governance truthful | ROADMAP/HANDOVER claimed BUILT — BV pending before this review; DONE only after this pass |
| V7 | No secrets / unsafe defaults | Security tier asserts no secrets in `capture_apply` payload; envs default off |
| V8 | Claims match evidence | Test digests above; prior KN-b T5 suite still green |

### Findings

None.

### Honest summary

Hosted Hub-complete capture apply landed as frozen: after an admin/evaluator approve on
the hosted gateway, `maybeApplyHostedCaptureAfterApprove` calls the bridge
`apply-approved` route, which runs the same precheck/apply pair as self-hosted Hub
approve and persists `hub_flow_store.json` via blob sync; hosted `GET api/v1/flows`
(+ `:id`) makes the promoted Flow observable. Hosted approve commits before the hook,
so an apply failure surfaces honestly as `capture_index_applied: false` with an ops
re-apply path. T5 personal self-apply stays refuse-all (SD-23); no posture/env flip;
`prop-1785500300353491755` untouched.

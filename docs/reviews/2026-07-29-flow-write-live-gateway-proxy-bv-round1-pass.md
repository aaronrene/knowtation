# Build verification — FLOW-WRITE-LIVE-GATEWAY-PROXY round 1

**Verdict:** pass  
**Frozen contract:** product-order paste in `docs/OVERSEER-HANDOVER.md` /
`~/scooling/docs/OVERSEER-HANDOVER.md` (FLOW-WRITE-LIVE-GATEWAY-PROXY Auto);
parent `~/scooling/docs/FLOW-WRITE-LIVE-FREEZE.md` (§FWL.9 gap).  
**Diff scope:** Knowtation Muse branch `feat/fwl9-smoke-fail-gateway-gap` —
gateway→bridge Flow authoring proxies, bridge flow routes + hosted canister
proposal create, seven-tier tests. No capture/run/Delegation flip; no Scooling
Hub JWT envs; no `FLOW_AUTHORING_WRITES` prod flip.

### Findings

| ID | Sev | path:line | Claim vs reality |
| --- | --- | --- | --- |
| — | — | — | No blocking findings |

### Evidence

| type | sha256 | ref | notes |
| --- | --- | --- | --- |
| test_output | `da2531de854829556d59f6aab6941c0191f096d432faba047e99e25eda5313b9` | `node --test test/gateway-flow-authoring-proxy.test.mjs` | **12/12** pass (7 suites) |
| test_file | `97bd4b6a28a27d61d0f6396bc23ca0c6cc27abb4cae5a91f507727f244160db5` | `test/gateway-flow-authoring-proxy.test.mjs` | Seven-tier source |

### Checklist

| # | Check | Evidence |
| --- | --- | --- |
| V1 | Three gateway proxies before canister catch-all | `hub/gateway/server.mjs` — `POST /api/v1/flows/import`, `POST /api/v1/flows`, `POST /api/v1/flows/:id/proposals` inside `BRIDGE_URL` block; static `/import` before `:id` |
| V2 | Paths hit BRIDGE_URL not canister | Integration/e2e/stress tests use mock bridge; assert bridge call counts + response codes (`FLOW_AUTHORING_DISABLED` / 201 from mock) |
| V3 | Seven-tier matrix | unit/integration/e2e/stress/data-integrity/performance/security in `test/gateway-flow-authoring-proxy.test.mjs` — **12/12** |
| V4 | No scope creep | No capture/run gateway proxies; no Delegation write env; no Scooling Hub JWT envs (security source-scan) |
| V5 | Spec requirements retained | Bridge `registerBridgeFlowRoutes` + `createFlowProposalOnCanister` so proxy destination exists (parity with tasks); `handleFlowProposeRequest` async for hosted create |
| V6 | Governance truthful | ROADMAP/HANDOVER updated with BV pass + NEXT = Operator §FWL.9 retry (confirm `FLOW_AUTHORING_WRITES` on bridge — do not flip casually) |
| V7 | Security | Frontmatter markers for Flow self-apply fingerprint on hosted; no secrets in envelopes; import not captured as `:id` |
| V8 | Claims ↔ tests | Diff implements paste deliverables; tests exercise live Express gateway→mock bridge HTTP |

### Honest summary

Gateway Flow authoring POSTs no longer fall through to the canister catch-all
(404 → Scooling `unknown_flow`). They proxy to BRIDGE_URL like `tasks/proposals`.
Bridge registers the same three routes, gated by existing `FLOW_AUTHORING_WRITES`
(default off). Operator must confirm prod bridge env before expecting
`hosted_flow_saved` on §FWL.9 retry — this session does **not** flip that env.

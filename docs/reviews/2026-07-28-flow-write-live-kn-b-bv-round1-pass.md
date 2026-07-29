# Build verification — FLOW-WRITE-LIVE-KN-b round 1

**Verdict:** pass  
**Frozen spec:** `~/scooling/docs/FLOW-WRITE-LIVE-FREEZE.md` (`frozen: true`,
`review_stamp.verdict: pass`, digest `sha256:24c31c41…`)  
**Diff scope:** Knowtation Muse branch `feat/flow-write-live-kn-b` — Flow
`external_ref` propose validation, T5 Flow fingerprint admission, seven-tier tests,
PROPOSAL-LIFECYCLE + governance.

### Findings

| ID | Sev | path:line | Claim vs reality |
| --- | --- | --- | --- |
| — | — | — | No blocking findings |

### Evidence

| type | sha256 | ref | notes |
| --- | --- | --- | --- |
| test_output | `b64ed99cd6e71afb4d5fae0ef905d4b428f16877fdf6cf0505abf7500b87dcbc` | `node --test test/flow-write-live-kn-b.test.mjs` | **11/11** pass (7 suites / §FWL.7) |
| test_file | `880a4720a43e9a83a2771f66efa2b1a1b135840056d09795902f0ce35867e3b7` | `test/flow-write-live-kn-b.test.mjs` | Seven-tier source |

### Checklist

| # | Check | Evidence |
| --- | --- | --- |
| V1 | §FWL.8 KN-b deliverables present | `resolveFlowProposeExternalRef` in `lib/flow/flow-authoring.mjs`; `matchesScoolingFlowFingerprint` + T5 widen in `lib/hub-proposal-personal-self-apply.mjs`; `SCOOLING_FLOW_EXTERNAL_REF_RE` in `lib/scooling-external-ref.mjs`; PROPOSAL-LIFECYCLE Flow row |
| V2 | Fingerprint matches §FWL.4.1 | source `flow`; kind exact `{new,edit,import}` with no missing-kind default; path `^meta/flows/…\.md$`; ref `^scooling\.flow:…{1,128}$`; personal scope; session binding via existing seam gates |
| V3 | §FWL.7 seven-tier | unit/integration/e2e/stress/data-integrity/performance/security in `test/flow-write-live-kn-b.test.mjs` — **11/11** |
| V4 | No scope creep | No Scooling posture flip (`FLOW_AUTHORING_WRITES_AUTHORIZED` still `false`); no prod `FLOW_AUTHORING_WRITES`; capture/run/Delegation unchanged |
| V5 | Spec requirements retained | Capture / Delegation / project/org / wrong-ref / missing kind still refuse |
| V6 | Governance truthful | ROADMAP/HANDOVER updated with BV pass + NEXT = SC-b |
| V7 | Security | Injection chars fail regex; P4 delegation refused; no secrets in envelopes |
| V8 | Claims ↔ tests | Diff implements §FWL.4; tests exercise real propose + admission paths |

### Honest summary

Knowtation Wave 1 Flow authoring admission is implemented on
`feat/flow-write-live-kn-b`: propose accepts optional `scooling.flow:` refs for
`new`/`edit`/`import` (malformed → 400; absent → propose ok, not admitted; import
lineage no longer substitutes), personal self-apply T5 admits §FWL.4.1 fingerprints
only, and seven-tier tests are green. No production env or Scooling posture change.
NEXT = FLOW-WRITE-LIVE-SC-b on Scooling (posture still false).

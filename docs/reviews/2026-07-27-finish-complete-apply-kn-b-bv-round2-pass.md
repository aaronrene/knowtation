## Build verification — FINISH-COMPLETE-APPLY-KN-b round 2

**Verdict:** pass
**Frozen spec:** `~/scooling/docs/FINISH-COMPLETE-APPLY-CONTRACT.md` (`frozen: true`, freeze-review `pass`)
**Diff scope:** Muse `feat/finish-complete-apply-kn-b` — impl `d7bf9d88` + BV test fixes (this round)

### Findings
| ID | Sev | path:line | Claim vs reality |
| --- | --- | --- | --- |
| — | — | — | None. Round-1 BV1–BV3 closed. |

### Round-1 resolution
| ID | Fix |
| --- | --- |
| BV1 | `test/finish-complete-apply-kn-b.test.mjs` — media_external_link propose persists `external_ref` + class holds |
| BV2 | Same file — e2e create+E1+class for media_external_link |
| BV3 | Same file — `partitionOwned: false` → `NOT_PARTITION_OWNED` for task + media |

### Checklist evidence (V1–V8)
| # | Result |
| --- | --- |
| V1 | Deliverables present: `lib/scooling-external-ref.mjs`, admission in `lib/hub-proposal-personal-self-apply.mjs`, task/media propose wiring, Motoko pending→id rewrite, `docs/PROPOSAL-LIFECYCLE.md` T5 |
| V2 | Fingerprints §FCA.4.1/4.2; Delegation `SELF_APPLY_DELEGATION_REFUSED`; Flow not admitted; E1 sessionBound/author gates |
| V3 | Seven-tier **16/16** exercises unit/integ/e2e/stress/data-integrity/perf/security matrix rows including media + IDOR |
| V4 | No Delegation self-apply; no Flow admission; no prod env flips |
| V5 | No silent deletion of frozen requirements |
| V6 | Governance updated to DONE only after this `pass` |
| V7 | No secrets; client eval strip retained (P2); wrong-prefix refs rejected |
| V8 | Claims match Muse branch + test output hash below; honesty ledger N/A (`honesty.enabled` absent) |

### Honest summary
Knowtation FINISH-COMPLETE-APPLY-KN-b ships T5 personal self-apply admission for Tasks/Media fingerprints only: validated `scooling.task:` / `scooling.media:` `external_ref` on propose, personal-scope + self-assign-only `task_assign`, E1 create-time evaluation when sessionBound/author hold, Motoko/Node pending mirror path rewrite to `{proposal_id}`, Delegation forever refused, Flow not admitted. Not merged; not live.

### Evidence
| type | sha256 | ref | notes |
| --- | --- | --- | --- |
| test_output | aaf3ef055623997455e4b21284da7b8e8f4f1ce4964c9546d16843ee914d3622 | finish-complete-apply-kn-b.test.mjs 16/16 | Round 2 pass |

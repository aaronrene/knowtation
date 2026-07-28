## Build verification — FINISH-COMPLETE-APPLY-KN-b round 1

**Verdict:** findings
**Frozen spec:** `~/scooling/docs/FINISH-COMPLETE-APPLY-CONTRACT.md` (`frozen: true`, freeze-review `pass`)
**Diff scope:** Muse `feat/finish-complete-apply-kn-b` commits `d7bf9d88` (impl) + `71839495` (governance awaiting BV)

### Findings
| ID | Sev | path:line | Claim vs reality |
| --- | --- | --- | --- |
| BV1 | MAJOR | test/finish-complete-apply-kn-b.test.mjs:197-280 | §FCA.7 integration requires task/**media** `external_ref` persist + class; suite only exercises `handleTaskProposeRequest` |
| BV2 | MAJOR | test/finish-complete-apply-kn-b.test.mjs:282-314 | §FCA.7 e2e requires personal `task_create` **+** `media_external_link` without Hub eval hop; only task path runs |
| BV3 | MAJOR | test/finish-complete-apply-kn-b.test.mjs:389-415 | §FCA.7 security requires IDOR denied; suite never asserts `partitionOwned: false` → `NOT_PARTITION_OWNED` |

### Notes (not blocking this round)
- Product code for §FCA.4–§FCA.8 KN-b deliverables is present (`lib/hub-proposal-personal-self-apply.mjs`, `lib/scooling-external-ref.mjs`, task/media propose wiring, E1 widen, Motoko pending→id rewrite, PROPOSAL-LIFECYCLE T5).
- Seven-tier **14/14** green is insufficient for DONE under V3 until cited matrix rows are exercised.
- No merge / no prod env flips.

### Evidence
| type | sha256 | ref | notes |
| --- | --- | --- | --- |
| test_output | 429f41d270bf8105638b8b06c498294f439366d47f9ae50f7a971d00a96980c2 | finish-complete-apply-kn-b.test.mjs 14/14 | Pre-fix; coverage gaps BV1–BV3 |

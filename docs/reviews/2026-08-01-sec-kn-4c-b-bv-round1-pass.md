# Build verification — SEC-KN-4c-b round 1

**Verdict:** pass
**Frozen spec:** docs/SEC-KN-4C-MIGRATION-HOOK-RESTORE-FREEZE.md (frozen: true; freeze review `pass` 2026-08-01, artifact_digest sha256:67d6a9f1a0c92b4ab7d7a9d35623862f27f3d35ac856c2ce6989f57d3641bbe3)
**Diff scope:** Muse commit `ec1e80b32f4a…` on `feat/sec-kn-4c-land`, cut from Muse `main` tip `4179ed46ffe3…`. `muse diff main HEAD` touches exactly five files:

1. `hub/icp/src/hub/Migration.mo` — actor hook restored to identity on `StableStorage`; module header rewritten to the post-T1 invariant
2. `scripts/verify-canister-migration.mjs` — two contract flips (identity domain check; TODO forbidden / SEC-KN-4c mention required)
3. `test/sec-kn-4-delegation-principal-binding.test.mjs` — 4C-R6 assertion flip + title rename
4. `test/sec-kn-4c-migration-hook-restore.test.mjs` — new seven-tier suite (4C-R7)
5. `docs/SEC-KN-4C-MIGRATION-HOOK-RESTORE-FREEZE.md` — freeze artifact carried onto branch (new relative to `main`)

Governance docs (`docs/ROADMAP.md`, `docs/OVERSEER-HANDOVER.md`) are intentionally absent from this commit — they land in the closing SD-17 commit after this verdict, per the review instructions. Not a finding.

**Reviewer posture:** independent (thinking-high); did not author the build. All evidence below re-run in this session, 2026-08-01.

## Requirement verification (4C-R1 … 4C-R9)

| Req | Verdict | Evidence (file+line, this branch tip) |
| --- | --- | --- |
| 4C-R1 identity hook | PASS | `hub/icp/src/hub/Migration.mo:455-457` — `public func migration(old : { var storage : StableStorage }) : { var storage : StableStorage } { old }`. No `StableStorageV7` actor-hook domain and no `_proposalV7ToCurrent` call anywhere in the public hook (hook is the final declaration, lines 452–458). |
| 4C-R2 TODO removed, locator kept | PASS | `rg 'TODO\(SEC-KN-4c\)' hub/` → no matches. Non-TODO `SEC-KN-4c` locator comments at `Migration.mo:10` and `Migration.mo:454`. |
| 4C-R3 historical helpers kept | PASS | `_proposalV7ToCurrent` at `Migration.mo:417-450` (sets `created_by = ""` at :448, private, uncalled by hook); `_proposalBeforeEnrichToCurrent` :271-303 and `_proposalV4ToV5` :306-338 both return `ProposalRecordV7`; `StableStorageV5`/`V6`/`V7` pins on `[ProposalRecordV7]` at :237-260. |
| 4C-R4 header invariant | PASS | `Migration.mo:8-12` — states one-time V7→`created_by` (T1), identity thereafter (SEC-KN-4c / T4), and that pre-`created_by` canisters must install the one-shot `StableStorageV7` WASM first (git history). |
| 4C-R5 verify-script flips | PASS | `scripts/verify-canister-migration.mjs:49-51` requires identity domain (exact substring — cannot match the old `StableStorageV7 }` domain); :101-107 requires `_proposalV7ToCurrent` + `SEC-KN-4c` mention + `!includes('TODO(SEC-KN-4c)')`; old actor-hook-V7 check removed (diff), V7 retained only as historical type check :60-63. `npm run canister:verify-migration` exit 0 re-run this session. |
| 4C-R6 SEC-KN-4 unit flip | PASS | `test/sec-kn-4-delegation-principal-binding.test.mjs:453-469` — identity-domain `assert.match` (:459-462), `_proposalV7ToCurrent` retained (:457), `assert.doesNotMatch` on `TODO(SEC-KN-4c)` (:463), V5/V6/V7→`ProposalRecordV7` pins kept (:455-456, :464-468), title renamed off “+ TODO(SEC-KN-4c)” (:453). |
| 4C-R7 seven tiers | PASS | `test/sec-kn-4c-migration-hook-restore.test.mjs` — unit :48-83, integration (real `dfx build --check hub`, scrubbed env) :88-101, e2e :106-111, stress :116-122, data-integrity :127-137, performance :142-149, security :154-167. All seven tiers named; 11/11 green re-run this session. |
| 4C-R8 no redeploy | PASS | Reviewer re-read live state this session: `dfx canister --network ic info rsovz-byaaa-aaaaa-qgira-cai` → `Module hash: 0x039360a0985c79e2ec993e0d0b81dc6e6b85e4d924c1123f5d1af26cdfd69bae` (matches frozen expected); `GET /health` → `{"ok":true,"gateway_auth_configured":true}`. Hash unchanged from the 2026-07-28 T4 record — consistent with no redeploy. No deploy artifacts in the diff. |
| 4C-R9 hard stops | PASS | Diff limited to the five files above; no posture/env/gate flips, no F7 files, no P6 claims, no PR/merge activity in the commit. P6 remains UNVERIFIED; F7 parked. |

## Non-tautology check (V3)

The suites fail on the pre-4c source shape (reasoned from assertions against the old hunk visible in `muse diff main HEAD`):

- Old hook domain was `migration(old : { var storage : StableStorageV7 })`. The identity regex (`test/sec-kn-4c-migration-hook-restore.test.mjs:28-29`) requires `StableStorage \}` — `StableStorageV7 }` cannot match (next char after `StableStorage` is `V`, not space). `assert.match` fails.
- Old source contained `TODO(SEC-KN-4c)` → `assert.doesNotMatch` at :59 and `sec-kn-4…test.mjs:463` fail; verify-script check :101-107 fails (`!includes('TODO(SEC-KN-4c)')`).
- Old hook body mapped `proposalEntries` via `Array.map` and `_proposalV7ToCurrent` → stress (:117-121) and data-integrity (:134-135) `doesNotMatch` assertions fail. `publicMigrationHookSource` (:39-43) slices from `public func migration(` to EOF, so hook-scoped assertions cannot be satisfied by historical helpers.
- The integration tier executes a real `dfx build --check hub` (1524 ms observed) — not a mock.

## Checklist V1–V8

| # | Check | Result |
| --- | --- | --- |
| V1 | All frozen deliverables exist at spec-named paths | PASS — all five files present on branch tip; none are stubs |
| V2 | Public APIs match frozen interfaces | PASS — hook signature byte-matches 4C-R1; verify script exits 0/1 per contract |
| V3 | Tests cover the frozen matrix, non-tautological | PASS — seven tiers named and green; fail on pre-4c shape (see above) |
| V4 | No scope creep | PASS — diff is exactly the five files; no extra features |
| V5 | No silent deletion of frozen requirements | PASS — historical helpers/type pins retained per 4C-R3; only the actor-hook wiring changed |
| V6 | Governance docs truthful | PASS (pending SD-17 close) — ROADMAP/HANDOVER not yet updated; commit message says “BV review pending before DONE”, which is honest. Note: untracked `docs/KNOWTATION-ROADMAP.md` and `backups/pre-t1-snapshot-20260728T205623Z/` in the working tree must be resolved in the closing governance commit (tree must not be dirty at session end). |
| V7 | No secrets / injection surfaces / unsafe defaults | PASS — secret-pattern scan of full diff: no matches; security tier asserts no literal secret assignment and no `X-User-Id` authorship path; `dfx build --check` warnings (M0155) are pre-existing in untouched `main.mo` lines |
| V8 | Claims match verifiable state | PASS — every build-session claim reproduced this session: new suite 11/11, SEC-KN-4 suite 31/31, verify-migration exit 0, `dfx build --check hub` exit 0, live hash + health independently re-read and matching. Honesty module not enabled in this repo — no ledger append required; claims↔evidence binding recorded here per skill rule 5. |

### Findings

None. (Per 4C-R0, findings require file+line citations; no citable defect was found.)

### Honest summary

What actually shipped on `feat/sec-kn-4c-land` (one Muse commit `ec1e80b32f4a…` over `main` tip `4179ed46…`): the actor upgrade hook in `hub/icp/src/hub/Migration.mo:455-457` was restored from the one-shot V7→`created_by` map to identity on `StableStorage`, with the module header (:1-14) rewritten to document the post-T1 invariant and the one-shot path for pre-`created_by` canisters; the historical `_proposalV7ToCurrent` map (:417-450) and V5/V6/V7 type pins were kept but disconnected from the hook. `scripts/verify-canister-migration.mjs` flipped two contracts (:49-51, :101-107) so it now requires the identity domain and forbids the TODO marker, and exits 0 on this tree. The SEC-KN-4 unit assertion flipped accordingly (`test/sec-kn-4-delegation-principal-binding.test.mjs:453-469`, 31/31 green), and a new named seven-tier suite `test/sec-kn-4c-migration-hook-restore.test.mjs` (11/11 green, including a real scrubbed-env `dfx build --check hub`) pins the restore. The live canister was not redeployed: the reviewer independently re-read module hash `0x039360a0…` (matches frozen expected) and health `{"ok":true,"gateway_auth_configured":true}` this session. Remaining before DONE: SD-17 closing commit (ROADMAP + OVERSEER-HANDOVER + this review doc), then Tier-3/SD-21 Muse `main` + muse-mirror land (D5, D6).

### Evidence

| type | sha256 | ref | notes |
| --- | --- | --- | --- |
| test_output | 5ece0de51c902be2c5fbc0009ae1c00149a8bccbee297f13fea6bbea2bdb8e61 | node --test test/sec-kn-4c-migration-hook-restore.test.mjs | 11/11 pass, 7 suites, exit 0 |
| test_output | 66f9a814f08a82db0216fcde7411007255a099c38962da6e8878537271287621 | node --test test/sec-kn-4-delegation-principal-binding.test.mjs | 31/31 pass, exit 0 |
| test_output | 4e18b19bf67184b800506814ac75e35bd244e78387fdf99b1a788f10a44bab9b | npm run canister:verify-migration | exit 0, “OK (Migration.mo + main.mo contracts)” |
| test_output | 3dba26cfb85e3e4b9fea40bd2b53ce67feda774bdeb9728d2841b17d41d6b7f3 | env -i … dfx build --check hub (hub/icp) | exit 0; pre-existing M0155 warnings only |
| deploy_health | d91bff94784e126c3e7f2c26c133abb81dfb849f00c57a49983d4a614bc46cc1 | dfx canister --network ic info rsovz-byaaa-aaaaa-qgira-cai | Module hash 0x039360a0985c79e2ec993e0d0b81dc6e6b85e4d924c1123f5d1af26cdfd69bae |
| deploy_health | 9e185e862b3eaa8d33adb25c4193073c9c9821e9935a01f7c81f0a3ebb11622c | GET https://rsovz-byaaa-aaaaa-qgira-cai.raw.icp0.io/health | {"ok":true,"gateway_auth_configured":true} |
| diff | 35e9545a3a99d253778c10ab1b6098a17c7730140e1dd531bdce56ef87c6266b | muse diff main HEAD --text | 563 lines; five files |

Reviewer: independent build-verification session (thinking-high posture), 2026-08-01.

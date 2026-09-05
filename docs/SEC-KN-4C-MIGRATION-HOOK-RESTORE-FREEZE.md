# SEC-KN-4c — frozen spec: restore migration hook to identity (T4 land)

**Phase:** SEC-KN-4c (`SEC-KN-4c-a` Thinking freeze → `SEC-KN-4c-b` Auto land)
**Freeze status:** **CLEARED for `SEC-KN-4c-b` Auto land** — freeze-review `pass`
(2026-08-01; mechanical stamp + Thinking semantic clearance). Live T4 already on
canister (`0x039360a0…`); residual is Muse/`main` + muse-mirror land + test flips.
**Date:** 2026-08-01
**Model (this artifact):** Thinking
**Owner repo:** Knowtation
**Parent freeze:** `docs/SEC-KN-4-DELEGATION-PRINCIPAL-BINDING-FREEZE.md` (§8 gate **T4**, R1.4, D2
ratified 2026-07-26)

## Freeze-contract declaration

```yaml
phase: SEC-KN-4c-a
outputs:
- id: sec-kn-4c-freeze
  path: docs/SEC-KN-4C-MIGRATION-HOOK-RESTORE-FREEZE.md
  frozen: true
  notes: Identity migration on StableStorage after T1; Muse/main + muse-mirror land of Motoko already live on canister; no redeploy unless module hash diverges; no posture/env flips; F7 parked; P6 share UNVERIFIED; live created_by field probe optional
frozen_inputs:
- id: sec-kn-4-freeze
  path: docs/SEC-KN-4-DELEGATION-PRINCIPAL-BINDING-FREEZE.md
  notes: frozen:true; review_stamp pass; R1.4 one-shot hook + T4; D2 ratified option A
- id: migration-mo
  path: hub/icp/src/hub/Migration.mo
  notes: live tip on feat/sec-kn-4c-identity-migration already identity; Muse main still V7→current + TODO
- id: verify-migration
  path: scripts/verify-canister-migration.mjs
  notes: must require identity hook + forbid TODO(SEC-KN-4c) after land
- id: sec-kn-4-tests
  path: test/sec-kn-4-delegation-principal-binding.test.mjs
  notes: unit assertion still matches TODO(SEC-KN-4c) — Auto must flip
review_stamp:
  reviewed_at: '2026-08-01T13:14:37Z'
  verdict: pass
  reviewer_mode: agent
  reviewer_model: thinking-high
  reviewer_provider: local
  kit_version: 0.1.0
  artifact_digest: sha256:67d6a9f1a0c92b4ab7d7a9d35623862f27f3d35ac856c2ce6989f57d3641bbe3
downstream:
- id: SEC-KN-4c-b
  model: Auto
  consumes_as_ground_truth: true
  notes: Land identity Migration.mo + verify script + test flips onto Muse tip; seven-tier; BV pass; no canister redeploy unless hash mismatch
tier3_gates:
- T1 Muse main merge of the identity-restore Motoko (SD-14 path only)
- T2 muse-bridge + GitHub muse-mirror → main PR (never feature→main)
- T3 Any new canister WASM deploy (forbidden unless live module hash ≠ frozen expected hash)
- T4 Any posture / write-env / Delegation gate flip (out of scope — hard stop)
```

## Review record

| Round | Reviewer | Verdict | Resolution |
| --- | --- | --- | --- |
| 0 | Thinking (this session) | draft | Freeze authored from live evidence + source |
| 1 | `ok review --freeze` (mechanical) | findings | F1 MINOR C8 — artifact lacked literal `file+line` citation-readiness evidence; fixed in §4C-R0 |
| 2 | Thinking semantic + `ok review --freeze` | **pass** | Re-derived: live module hash matches T4 record; Muse/`main` still V7 hook; feature-branch Motoko identity + verify script OK; SEC-KN-4 unit still expects `TODO(SEC-KN-4c)` (4C-R6 required). C1–C8 pass; nothing escalating open. Cleared for 4c-b Auto land only. |

### Round 1 findings (cited — file+line)

| ID | Sev | Cat | Citation | Finding | Fix |
| --- | --- | --- | --- | --- | --- |
| CLI-F1 | MINOR | consistency | docs/SEC-KN-4C-MIGRATION-HOOK-RESTORE-FREEZE.md:1 | Checklist C8 requires literal `file+line` citation-readiness evidence. | Added §4C-R0. |

---

## 4C-R0 — Citation readiness

Every freeze-review / build-verification finding against this artifact **must** cite
**file+line**. Uncited findings are invalid.

---

## 1. Plain-language summary

After the canister learned who created each proposal (`created_by`), the upgrade code that
added that field had to stay special for exactly one install. Leaving that special code in
place blocks every later upgrade. This step puts the upgrade code back to “do nothing —
state is already current,” so future fixes can ship. The live canister already runs that
safe version; Muse/`main` and GitHub still show the old special code. Auto must land the
safe version into the canonical Muse tip without redeploying the canister unless the live
module hash no longer matches.

## 2. Technical summary

**SEC-KN-4c** discharges freeze gate **T4** from
`docs/SEC-KN-4-DELEGATION-PRINCIPAL-BINDING-FREEZE.md:415` (R1.4 addendum): restore
`Migration.migration` to **identity on `StableStorage`** so repeat upgrades are accepted
(`moc --stable-compatible` exit 0; no `Compatibility error [M0216]`).

Measured consequence of leaving the T1 hook in place (2026-07-26): repeat deploy refused
with M0216 (`Missing field 'created_by'`), blocking hotfixes — not silent authorship erase.

### 2.1 Verified state (this Thinking session — 2026-08-01)

| Fact | Evidence |
| --- | --- |
| Live hub module hash | `dfx canister --network ic info rsovz-byaaa-aaaaa-qgira-cai` → `Module hash: 0x039360a0985c79e2ec993e0d0b81dc6e6b85e4d924c1123f5d1af26cdfd69bae` |
| Matches 2026-07-28 T4 deploy record | `docs/KNOWTATION-OVERSEER-HANDOVER.md` on `feat/sec-kn-4c-identity-migration` (Prior session §FCA.2) |
| Live health (raw) | `GET https://rsovz-byaaa-aaaaa-qgira-cai.raw.icp0.io/health` → `{"ok":true,"gateway_auth_configured":true}` |
| Feature-branch Motoko | `hub/icp/src/hub/Migration.mo:455-457` is identity `migration(old : { var storage : StableStorage }) { old }` |
| Feature-branch verify script | `scripts/verify-canister-migration.mjs:49-50` + `:101-106` require identity + forbid `TODO(SEC-KN-4c)` |
| `canister:verify-migration` on feature branch | exit 0 |
| Muse/`main` + GitHub `origin/main` Motoko | still `migration(old : { var storage : StableStorageV7 })` + `TODO(SEC-KN-4c)` + `_proposalV7ToCurrent` wired into the actor hook |
| Live proposal `created_by` field | **UNVERIFIED** this session (optional probe; not a land blocker) |
| P6 MCP / `SESSION_SECRET` share | **UNVERIFIED** (out of scope) |
| MuseHub F7 | **AWS-parked** (do not start) |

**Board honesty:** later relay refreshes on Muse/`main` (`docs/relay-sd21-landed`) re-opened
SEC-KN-4c as “TODO” while live T4 already matched `0x039360a0…`. This freeze corrects that:
**live T4 is DONE; canonical Muse/`main` land is the residual.**

---

## 3. Frozen requirements (4C-R1 … 4C-R9)

### 4C-R1 — Actor hook is identity on `StableStorage`

`hub/icp/src/hub/Migration.mo` public hook **must** be exactly:

```motoko
public func migration(old : { var storage : StableStorage }) : { var storage : StableStorage } {
  old
};
```

(Equivalent `{ var storage = old.storage }` is acceptable if type-identical; prefer `old`
matching `2624dbf` V5 identity pattern.)

**Forbidden:** any actor-hook domain still typed `StableStorageV7`, or any map through
`_proposalV7ToCurrent` inside the public `migration` function.

### 4C-R2 — Remove the one-shot TODO marker

The literal `TODO(SEC-KN-4c)` **must not** appear in `Migration.mo` after land.
A non-TODO comment naming `SEC-KN-4c` / T4 (as on the feature branch today) **must** remain
so verify-script and operators can locate the restore.

### 4C-R3 — Keep historical helpers

Retain as private/historical (not called by the actor hook):

- `_proposalV7ToCurrent` (sets `created_by = ""` for provenance / tooling)
- `_proposalBeforeEnrichToCurrent` / `_proposalV4ToV5` returning `ProposalRecordV7`
- `StableStorageV5` / `V6` / `V7` type pins on `ProposalRecordV7`

Do **not** delete the one-shot map function — only disconnect it from the actor hook
(same pattern as historical V4→V5 after identity restore).

### 4C-R4 — Module header documents the post-T1 invariant

Header / hook comments must state: after the one-time V7→`created_by` upgrade (T1) has
run on a canister, the hook is identity on `StableStorage` so repeat deploys succeed.
Canisters that have never received T1 must not install this identity WASM as their first
`created_by` upgrade (they need the one-shot V7→current WASM once — git history /
`feat/sec-kn-4a-…` tip).

### 4C-R5 — Verify script contracts flip

`scripts/verify-canister-migration.mjs` **must**:

1. Require `migration(old : { var storage : StableStorage })` (identity domain).
2. Require `_proposalV7ToCurrent` still present (historical).
3. Require a `SEC-KN-4c` mention **and** `!includes('TODO(SEC-KN-4c)')`.
4. **Stop** requiring the actor hook to be `StableStorageV7` (the pre-4c check name
   “V7→V8 adds cors…” is obsolete for the actor hook; V7 type may remain as a historical
   type declaration check).

`npm run canister:verify-migration` must exit 0 on the landed tree.

### 4C-R6 — SEC-KN-4 unit assertion flips

`test/sec-kn-4-delegation-principal-binding.test.mjs` (unit tier, currently
`:453-464` on trees that still expect the TODO) **must**:

- Assert identity hook domain `migration(old : { var storage : StableStorage })`.
- Assert `_proposalV7ToCurrent` retained.
- Assert **absence** of `TODO(SEC-KN-4c)`.
- Keep V5/V6/V7 → `ProposalRecordV7` pin assertions.

Renaming the test title to drop “+ TODO(SEC-KN-4c)” is required.

### 4C-R7 — Seven-tier matrix (land-focused)

| Tier | Expectation |
| --- | --- |
| **unit** | Source assertions in 4C-R6; `canister:verify-migration` exit 0 |
| **integration** | Motoko compile check: `env -i PATH="…" HOME="…" NO_COLOR=1 TERM=dumb dfx build --check hub` exit 0 |
| **e2e** | No new HTTP surface — assert actor still uses `(with migration = Migration.migration)` in `main.mo` (existing verify-script mainChecks) |
| **stress** | Identity hook body is O(1) — no `Array.map` over `proposalEntries` in the public `migration` function (source assertion) |
| **data-integrity** | `_proposalV7ToCurrent` still sets `created_by = ""` (historical map unchanged); public hook does not call it |
| **performance** | `canister:verify-migration` completes under 2s locally (wall clock) |
| **security** | No secrets added; no `X-User-Id` / body authorship path introduced; diff limited to Migration.mo + verify script + SEC-KN-4 test assertion + governance docs |

Auto may place these in `test/sec-kn-4c-migration-hook-restore.test.mjs` **or** extend the
existing SEC-KN-4 suite — either is fine if all seven tiers are green and named.

### 4C-R8 — No canister redeploy by default

If live module hash is still
`0x039360a0985c79e2ec993e0d0b81dc6e6b85e4d924c1123f5d1af26cdfd69bae`, Auto **must not**
run `dfx deploy` / canister install. Land is source + mirror only.

If the hash **differs**, Auto **stops** (`gates_tier3`) and reports — Operator decides
whether a new WASM is required. Do not improvise a redeploy.

### 4C-R9 — Hard stops (out of scope)

- No Delegation / Tasks / Media / Flow / Lab posture or write-env flips
- No MuseHub F7 work
- No P6 exploitability assessment (leave UNVERIFIED)
- No claim that live proposal `created_by` was re-probed unless an authenticated GET is
  executed and cited this session
- No GitHub PR from a feature branch to `main` (SD-14 — only `muse-mirror` → `main`)
- No redesign of R1–R9 from SEC-KN-4a/4b

---

## 4. Auto land procedure (SEC-KN-4c-b) — mechanical

1. Start from current Muse/`main` tip (or rebase `feat/sec-kn-4c-identity-migration` onto it).
2. Bring forward **only**:
   - `hub/icp/src/hub/Migration.mo` identity hook (4C-R1–R4)
   - `scripts/verify-canister-migration.mjs` (4C-R5)
   - SEC-KN-4 / SEC-KN-4c test assertion updates (4C-R6–R7)
   - `docs/KNOWTATION-ROADMAP.md` + `docs/KNOWTATION-OVERSEER-HANDOVER.md` (SD-17)
3. Run seven-tier suite for the land + `npm run canister:verify-migration` + Motoko
   `--check` compile.
4. Re-read live module hash (4C-R8). If match → no deploy.
5. `/build-verification-review` → `pass` before ROADMAP → DONE for 4c-b code land on the
   feature branch.
6. **Stop for Operator** on Muse/`main` merge + muse-bridge + `muse-mirror` → GitHub
   `main` (Tier 3 / SD-14), unless SD-21 land-hygiene criteria are explicitly met for this
   diff (Motoko-only identity restore with **no** live posture flip qualifies for SD-21
   path **only** when the Operator/session is in finish-mode land — still never
   `git push origin main` or feature→`main`).

Reference implementation already exists on Muse branch
`feat/sec-kn-4c-identity-migration` @ `sha256:57be6cf27cfc…` (2026-07-28). Auto may
cherry-pick / rebase that Motoko+script delta; it must still satisfy 4C-R6 (test flip was
incomplete on that tip — unit test still expects `TODO(SEC-KN-4c)`).

---

## 5. Definition of Done

| # | Gate |
| --- | --- |
| D1 | Freeze-review `pass` (this artifact) before Auto starts |
| D2 | 4C-R1–R7 implemented on feature branch; seven-tier green |
| D3 | `/build-verification-review` `pass` |
| D4 | Live module hash re-checked; redeploy skipped when hash matches frozen expected |
| D5 | ROADMAP + OVERSEER-HANDOVER updated together; NEXT points past 4c-b |
| D6 | Muse/`main` + GitHub `main` contain identity hook (via SD-14 mirror) — Operator land |
| D7 | No secrets; no posture/env flips; F7 untouched |

---

## 6. Ground-truth edge

`SEC-KN-4c-b` (Auto) may treat §§3–5 as ground truth and must not re-open the T1 one-shot
design, re-derive principal binding (SEC-KN-4 R1–R9), or “improve” the identity shape.
If land reveals the live hash diverges from `0x039360a0…`, stop for Operator — do not
redeploy from Auto.

---

## 7. Residual / also open (not blockers for 4c-b)

| Item | Status |
| --- | --- |
| Operator probe of proposal `created_by` on a live record | UNVERIFIED — optional |
| P6 MCP / `SESSION_SECRET` share exploitability | UNVERIFIED |
| MuseHub F7 | AWS-parked |

---

## 8. Paste-ready Auto prompt (after freeze `pass`)

```text
Step: SEC-KN-4c-b
Model: Auto
Authority: knowtation
Branch: feat/sec-kn-4c-identity-migration (rebase onto current Muse main) or fresh feat/sec-kn-4c-land

Implement docs/SEC-KN-4C-MIGRATION-HOOK-RESTORE-FREEZE.md (4C-R1–R9) exactly.
Land identity Migration.migration on StableStorage + verify-script + SEC-KN-4 test flips.
Live module hash expected: 0x039360a0985c79e2ec993e0d0b81dc6e6b85e4d924c1123f5d1af26cdfd69bae — do NOT redeploy if it matches.
Seven-tier green; canister:verify-migration exit 0; Motoko dfx build --check hub.
/build-verification-review → pass before DONE.
Keep F7 AWS-parked. P6 share UNVERIFIED. No posture/env flips.
Muse main / muse-mirror = Tier 3 stop (or SD-21 land hygiene only if criteria met).
```

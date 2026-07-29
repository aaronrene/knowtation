# Roadmap — knowtation

**Scope of this board.** Knowtation is the **canonical store and permission authority**. This
roadmap governs **Knowtation-owned work only** — gateway authorization, canister auth, proposal
lifecycle, delegation, and the vault/MCP surfaces.

Cross-repo *product* sequencing (what Scooling ships, in what order) still lives on the Scooling
board: `~/scooling/docs/OVERSEER-HANDOVER.md` + `~/scooling/docs/ROADMAP.md`. When the two disagree
about **product order**, Scooling wins. When they disagree about **Knowtation's own security or
authorization behavior**, this board wins.

## Phase Model Key

| Label | Meaning |
| --- | --- |
| **Thinking** | Design + freeze spec before any build |
| **Auto** | Mechanical implementation against frozen spec |
| **Thinking → Auto** | Thinking design + test matrix, then Auto build |
| **Operator + Auto** | Tier 3 operator authorization for live/staging gates; Auto for implementation |

**Handover rule (SD-3):** any step marked **Thinking → Auto** is split into **`{step}a` (Thinking)**
then **`{step}b` (Auto)** in `docs/OVERSEER-HANDOVER.md`. Every next-step table and paste block
**must** include **`Model:`**.

## Current status (2026-07-26)

| | |
| --- | --- |
| **Overseer Kit** | **Live** — `initialized: true`, `kit_version: 0.1.0`, `footprint_self_integrity: ok`, `muse_sync: synced` (verified 2026-07-26). Installed on `feat/overseer-kit-install`. |
| **Known footprint deviation** | `ok status --check-footprint` reports `footprint_integrity: mismatch` **by design** — `MUSE-BRIDGE-WORKFLOW.md` and `scripts/muse-bridge-deploy.sh` were restored to Knowtation's live versions after `--force` overwrote them with kit templates. See `.overseer/config.yaml` → `kit.notes`. **Do not "repair" by re-syncing those two files.** |
| **Driving input** | `~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md` — independent Pass 2 audit, verdict `findings`. **7 of 11 code findings are Knowtation-owned.** |
| **Product API** | `api.knowtation.store` live · MCP public `https://mcp.knowtation.store/mcp` · Calendar 1D live |
| **Gate** | Scooling's `FINISH-COMPLETE-APPLY-KN-b` is **NO-GO** until **SEC-KN-1** canister upgrade (Tier 3) and remaining SEC queue items that the Scooling freeze carries (P3/P4). **SEC-KN-2**, **SEC-KN-3**, **SEC-KN-3a**, **SEC-KN-4b**, **SEC-KN-5**, and **SEC-KN-6** shipped (code on feature branches; not merged to main). **SEC-KN-4a/4b** are **DONE** (freeze + build verification `pass`); P4 is still **not live** until the Tier-3 canister upgrade installs `created_by` (gate T1) and T4 restores the migration hook. |

## Build queue

| Phase | Model | Status | Deliverable |
| --- | --- | --- | --- |
| **SEC-KN-0** | **Operator** | **DONE 2026-07-26** | **Canister gateway auth secret verified SET.** Live probe on hub `rsovz-byaaa-aaaaa-qgira-cai`: `GET /vaults` without `X-Gateway-Auth` → `403 GATEWAY_AUTH_REQUIRED`. (`operator_status` does not exist on the canister.) Knowtation Netlify `knowtation-gateway`: `CANISTER_AUTH_SECRET` / `SESSION_SECRET` / `HUB_ADMIN_USER_IDS` present; `HUB_EVALUATOR_MAY_APPROVE` absent. MCP/`SESSION_SECRET` share still UNVERIFIED. |
| **SEC-KN-1** | **Auto** | **DONE 2026-07-26** (code on `feat/sec-kn-1-gateway-auth-fail-closed`; **canister upgrade NOT deployed** — Tier 3) | **P1 fail-closed.** `gatewayAuthorized` empty-secret branch returns **false** (`hub/icp/src/hub/main.mo`). Health stays public 200 with loud `gateway_auth_configured` boolean. Seven-tier tests in `test/sec-kn-1-gateway-auth-fail-closed.test.mjs` (security tier diverges from legacy fail-open). Build verification **pass** (round 1). |
| **SEC-KN-2** | **Auto** | **DONE 2026-07-26** (code on `feat/sec-kn-2-server-only-evaluation`; **not merged to main**) | **P2 evaluation state is server-only.** `stripClientEvaluationFields` runs on every create augment before policy/triggers/E1; E1 no longer falls back to client `evaluated_by`. Seven-tier tests in `test/sec-kn-2-server-only-evaluation.test.mjs` (security tier diverges from legacy forge-preserving augment). Build verification **pass** (round 1). |
| **SEC-KN-3** | **Auto** | **DONE 2026-07-26** (code on `feat/sec-kn-3-mcp-access-role-cap`; **not merged to main**) | **P6 agent tokens cannot inherit admin.** `resolveHostedActorRole` early-returns for `mcp_access` with `roleFromMcpAccessScopes` (never allowlist). `roleEligibleForPersonalSelfApply` rejects agent / `mcp_access` / `humanActor:false`. Seven-tier tests in `test/sec-kn-3-mcp-access-role-cap.test.mjs` (security tier diverges from legacy allowlist inheritance). Build verification **pass** (round 1). |
| **SEC-KN-4a** | **Thinking** | **DONE 2026-07-26** — freeze review `pass` (round 3), D1/D2 ratified (freeze on `feat/sec-kn-4a-delegation-principal-binding-freeze`) | **P4 spec written and reviewed, not cleared.** `docs/SEC-KN-4-DELEGATION-PRINCIPAL-BINDING-FREEZE.md` (`frozen: true`) freezes R1–R9: server-only canister `created_by` (from `X-Actor-Id`, never the body, **no fallback**), `principal_ref` / `owner_ref` re-derived at apply from the **recorded author** (not the approver — §3.1), refuse-on-mismatch, `org_ref:` authority refs rejected in v0, delegation-gate check added to the ungated apply path, delegation intents stay out of self-apply. Round-1 independent review returned **blocked**: 6 findings amended in place, **2 escalated** (`security`: a fail-open author fallback I had specified; `irreversible`: the migration hook stops being idempotent, so a repeat deploy would erase the authorship column). See freeze §12 D1/D2. **Round 2** (fresh reviewer, re-derived from source) confirmed all 8 amendments **hold** and raised no remaining technical defect; it blocked on governance — the session had recorded its own ratification of D1/D2, now reverted to **UNRATIFIED** (freeze §12.1) — plus 3 cited wording fixes (R2.1/§6 vs R3 mismatch refusal; idempotency row scoped to `agent_identity` with consent duplicate-append as RR6; repeat-deploy consequence stated as "fails compatibility **or** silent reset"). The spec is **twice-reviewed and stable**. **Operator ratified D1 and D2 on 2026-07-26** (both option A: fail-closed author, one-shot hook + T4) — recorded verbatim in freeze §12.1. **Round-3** review on the fully amended artifact returned **`pass`** (C1–C8 all pass, nothing open in an escalating category, implementable with zero design decisions left open), so clearance rests on a reviewer verdict rather than the authoring session's own judgement. Its one MINOR (R3(2) "non-empty" vs R2.1's "empty after trim" for a whitespace-only value) is fixed. Mechanical gate `ok review --freeze` = pass (re-run after every amendment). **Freeze CLEARED for 4b — code build only; T1–T4 not authorized.** |
| **SEC-KN-4b** | **Auto** | **DONE 2026-07-26** — BV round 2 = `pass` (code on `feat/sec-kn-4a-delegation-principal-binding-freeze`; **not merged to main**) | **P4 implementation** against the frozen spec: canister `created_by` from `X-Actor-Id` only (R1), `precheckApprovedDelegationProposal` author binding + gate + re-derive (R2–R7), `org_ref:` rejected on both refs for every kind (R5), seven-tier tests in `test/sec-kn-4-delegation-principal-binding.test.mjs` (**31/31**). BV round 1 = `findings` (4 MINOR, fixed). BV round 2 re-verified those fixes, confirmed R1–R9 match the freeze, security regression still discriminates, Motoko compile **VERIFIED** (`env -i … NO_COLOR=1 TERM=dumb dfx build --check hub`), `canister:verify-migration` exit 0, and found one new MINOR (R5 docs `:245` missing the reserved wording) which was fixed in-session before `pass`. Snapshot-diff from SEC-KN-3 tip → HEAD does **not** include `hub/gateway/server.mjs` or the RBAC assertion files (SEC-KN-3a remains pre-existing). Canister WASM upgrade is **Tier 3** (gate T1); until it installs, hosted delegation apply refuses by design (fail-closed). T1–T4 not executed. |
| **SEC-KN-4c** | **Operator + Auto** | **TODO** (after the T1 canister upgrade) | **Restore the migration hook to identity** on `StableStorage` (`hub/icp/src/hub/Migration.mo`) in the release immediately following the `created_by` upgrade. Required, not cleanup — and the reason is now **measured**, not assumed: a repeat deploy of the T1 WASM is **refused** with `Compatibility error [M0216]` (`moc --stable-compatible`, exit 1), so between T1 and T4 the canister **cannot be upgraded at all**. There is no silent authorship erasure, but a hotfix window would be blocked. Freeze §8 gate T4 + R1.4 addendum. |
| **SEC-KN-3a** | **Auto** | **DONE 2026-07-26** — BV round 1 = `pass` (code on `feat/sec-kn-4a-delegation-principal-binding-freeze`; **not merged to main**) | **Stale RBAC source-shape assertions refreshed** to match post-SEC-KN-3 `resolveHostedActorRole`: single entry `jwt.verify` → reuse `bearerPayload`; return `{ role, mayApproveProposals, isMcpAccess }`; bridge fallback asserts `roleFromVerifiedAccessPayload(bearerPayload)` (not a second verify / raw parse); override section asserts `mayApplyAdminAllowlistOverride`. SEC-KN-3 security properties **not** weakened — `test/sec-kn-3-mcp-access-role-cap.test.mjs` still green. **Billing-repair decision:** do **not** gate on canister replica (suite already sets `CANISTER_URL=''`); hang was corrupt shared `data/hosted_billing.json` — fixed via call-time `KNOWTATION_BILLING_DB_PATH` / `KNOWTATION_GATEWAY_DATA_DIR` in `billing-store.mjs` + isolated temp DB in the test. RBAC trio + SEC-KN-3 + billing-repair = **82/82**. T1–T4 not executed. |
| **SEC-KN-5** | **Auto** | **DONE 2026-07-26** — BV round 1 = `pass` (code on `feat/sec-kn-5-delegation-ttl-viewer-mint`; **not merged to main**) | **P12 + P13 delegation limits.** `readVaultDelegationPolicy` clamps `max_ttl_seconds` with `Math.min(..., MAX_TTL_SECONDS)` so a vault policy of `604800` cannot widen SD-10's 24h cap. Self-hosted `POST /api/v1/delegation/grants` is `requireRole('admin')` only (viewer/editor/evaluator cannot mint runtime bearer authority); consent propose stays viewer-inclusive. Seven-tier tests in `test/sec-kn-5-delegation-ttl-viewer-mint.test.mjs` (**19/19**) + self-hosted route assertion; combined with route file **26/26**. Security regressions vs unclamped legacy + viewer-inclusive mint. Related delegation suites **64/64**. T1–T4 not executed. |
| **SEC-KN-6** | **Auto** | **DONE 2026-07-26** — BV round 1 = `pass` (code on `feat/sec-kn-6-constant-time-secret-compare`; **not merged to main**; **canister upgrade NOT deployed** — Tier 3) | **P14 constant-time secret compare.** Motoko `constantTimeTextEqual` (OR-of-XOR over every character; no early-exit `==`) used by both `gatewayAuthorized` and `operatorExportAuthorized` in `hub/icp/src/hub/main.mo`. JS mirror in `lib/gateway-authorized.mjs`. Seven-tier tests in `test/sec-kn-6-constant-time-secret-compare.test.mjs` (**18/18**) with security regression vs length-then-`==` early-exit; SEC-KN-1 suite still green (**19/19**); Motoko compile **VERIFIED**. T1–T4 not executed. |
| **SEC-SEAM-1** | **Thinking → Auto** | **DONE 2026-07-27** — 1a freeze CLEARED (round 7 `pass`); **1b BV round 1 = `pass`** (code on `feat/sec-seam-1-session-bound-writes`; **not merged to main**) | **P3 session-bound learner identity.** S1 stamps `type:'session'` at all five learner mint sites; S2–S6/S10 seam classify + named refusals. Step 11 was empty admission (W3) until **FINISH-COMPLETE-APPLY-KN-b** (T5) widened Tasks/Media. T1–T4 still unexecuted for live. |
| **SEC-SEAM-MEDIA** | **Thinking → Auto** | **TODO** (post–SEC-SEAM-1b; ratified D2 = A) | **Hosted media proposal surface.** No hosted media route exists today (freeze S7 / G17). Opened so media stays out of SEC-SEAM-1b scope while the gap is tracked. Must ship with a `maybeApplyHostedMediaAfterApprove` hook **and** a matching S3.1 condition in the same change (S3.0). |
| **KN-b (FINISH-COMPLETE-APPLY)** | **Auto** | **DONE 2026-07-27** — BV `pass` round 2 + independent **round 3 `pass`**; landed Muse/`main` + GitHub [KN #275](https://github.com/aaronrene/knowtation/pull/275) | **T5 admission.** Persist validated `external_ref` on task/media propose; §FCA.4 Tasks/Media fingerprints; Delegation stays `SELF_APPLY_DELEGATION_REFUSED`; Flow not admitted (until FLOW-WRITE-LIVE-KN-b); E1 widened with sessionBound/author gates; Motoko pending→id path rewrite; seven-tier `test/finish-complete-apply-kn-b.test.mjs` (**16/16**). Live Tasks/Media one-click still needs P1 WASM + T1 `created_by` + Tier 3 env (§FCA.2). |
| **DURABLE-AGENT-AUTH-C** | **Thinking → Auto** | **DONE 2026-07-27** — C-a freeze CLEARED; C-b BV round 2 = `pass` (22/22); **landed Muse/`main` 2026-07-28** (operator Tier 3; bridge → GitHub `muse-mirror` → `main`) | **Scoped REST agent credentials** for Trend Agent / Paperclip. Opaque `kt_agent_` + `agent_access` JWT exchange; Netlify-mounted mint/list/revoke/rotate; propose-scope REST authz; Hub UI; docs/OpenAPI. Seven-tier `test/agent-credentials-*.test.mjs`. Freeze: `docs/DURABLE-AGENT-AUTH-PHASE-C-FREEZE.md`. Consumer wiring on VideoFactory-trend-agent after Hub deploy is live. |
| **FLOW-WRITE-LIVE-KN-b** | **Auto** | **DONE 2026-07-28** — BV round 1 = `pass` (code on `feat/flow-write-live-kn-b`; **not merged to main**) | **Admit §FWL.4 Flow fingerprints.** Persist validated `scooling.flow:` `external_ref` on flow propose for `new`\|`edit`\|`import`; widen T5 with `matchesScoolingFlowFingerprint` (exact kind, no default-to-`new`; `meta/flows/*.md`; personal scope); capture/Delegation/project/org/wrong-ref refuse; PROPOSAL-LIFECYCLE updated; seven-tier `test/flow-write-live-kn-b.test.mjs` (**11/11**). No `FLOW_AUTHORING_WRITES` prod flip. Frozen: `~/scooling/docs/FLOW-WRITE-LIVE-FREEZE.md`. NEXT product = **FLOW-WRITE-LIVE-SC-b**. |
| **HUB-DASH-IA** | **Thinking → Auto** | **IN PROGRESS** on `feat/hub-dashboard-ia` (side track; does **not** displace FLOW-WRITE-LIVE / SEC primary) | Signed-in Hub IA: rail **Vault / Review(N) / History**; Discarded under History; Needs-you banner; retire user-facing “Suggested”. Freeze: `docs/reviews/2026-07-29-hub-dashboard-ia.md`. No Auto until freeze review `pass`. |

## Definition of Done (every phase)

- Deliverables match frozen spec for the phase
- **Freeze review `pass`** before any **Auto** build that consumes a `frozen: true` artifact (`/freeze-review-loop` when findings)
- Required seven-tier tests green locally (`.overseer/policy/test-tiers.yaml`)
- **Build verification `pass`** after any **Auto** (`{step}b`) phase before status → **DONE** (`/build-verification-review`; thinking-high)
- No secrets committed
- Both `docs/ROADMAP.md` and `docs/OVERSEER-HANDOVER.md` updated together (SD-17)
- Feature branch → commit → (push/PR per `muse+git-mirror` rules); no `main` merge without Tier 3

**Security-phase addition (SEC-*):** every SEC phase must land a **security-tier test that fails
against the pre-fix code**. A fix without a regression test that would have caught the finding is
not DONE.

## VCS context (this repo)

| Setting | Value |
| --- | --- |
| Regime | muse+git-mirror |
| Canonical | muse |
| Git remote | origin |
| Main branch | main |
| Mirror branch | muse-mirror |
| Muse staging | staging |
| Muse main | main |
| Feature branch pattern | feat/{slug} |

**Hard stop:** never `git push origin main`. GitHub `main` receives changes only through a
`muse-mirror → main` PR after a Tier 3 merge to Muse `main` (see `MUSE-BRIDGE-WORKFLOW.md` — the
repo-specific version, not the kit template).

## Cross-references

- `docs/OVERSEER-HANDOVER.md` — living relay; paste NEXT SESSION into fresh chats
- `docs/SEC-KN-4-DELEGATION-PRINCIPAL-BINDING-FREEZE.md` — frozen P4 spec (ground truth for SEC-KN-4b)
- `docs/CROSS-REPO-COORDINATION.md` — Standing Decisions (ADR) log and decision authority tiers
- `.overseer/policy/tiers.yaml` — machine-readable Tier 1/2/3 authority table
- `.overseer/policy/model-labels.yaml` — allowed Model labels for roadmap + handover
- `~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md` — the audit driving the SEC queue
- `~/scooling/docs/OVERSEER-HANDOVER.md` — cross-repo product order

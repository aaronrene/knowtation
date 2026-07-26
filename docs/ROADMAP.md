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
| **Gate** | Scooling's `FINISH-COMPLETE-APPLY-KN-b` is **NO-GO** until **SEC-KN-1 verified** (source done; canister upgrade pending Tier 3) and **SEC-KN-2 shipped** |

## Build queue

| Phase | Model | Status | Deliverable |
| --- | --- | --- | --- |
| **SEC-KN-0** | **Operator** | **DONE 2026-07-26** | **Canister gateway auth secret verified SET.** Live probe on hub `rsovz-byaaa-aaaaa-qgira-cai`: `GET /vaults` without `X-Gateway-Auth` → `403 GATEWAY_AUTH_REQUIRED`. (`operator_status` does not exist on the canister.) Knowtation Netlify `knowtation-gateway`: `CANISTER_AUTH_SECRET` / `SESSION_SECRET` / `HUB_ADMIN_USER_IDS` present; `HUB_EVALUATOR_MAY_APPROVE` absent. MCP/`SESSION_SECRET` share still UNVERIFIED. |
| **SEC-KN-1** | **Auto** | **DONE 2026-07-26** (code on `feat/sec-kn-1-gateway-auth-fail-closed`; **canister upgrade NOT deployed** — Tier 3) | **P1 fail-closed.** `gatewayAuthorized` empty-secret branch returns **false** (`hub/icp/src/hub/main.mo`). Health stays public 200 with loud `gateway_auth_configured` boolean. Seven-tier tests in `test/sec-kn-1-gateway-auth-fail-closed.test.mjs` (security tier diverges from legacy fail-open). Build verification **pass** (round 1). |
| **SEC-KN-2** | **Auto** | **TODO** | **P2 evaluation state is server-only.** Strip `evaluation_status`, `evaluated_by`, and `evaluated_at` from **all** client proposal-create bodies at the gateway (`lib/hub-proposal-create-augment.mjs:39-42`). Today a client can send `evaluation_status: "passed"` for any non-fingerprint intent and `evalStatusAllowsApprove` (`main.mo:1362-1369`) honors it, and `evaluated_by` forges the audit trail. |
| **SEC-KN-3** | **Auto** | **TODO** | **P6 agent tokens cannot inherit admin.** In `resolveHostedActorRole` (`hub/gateway/server.mjs:2976-3001`), when `payload.type === 'mcp_access'`, cap the role by the token's own scopes and **never** apply the admin-allowlist override — `hub/gateway/access-token-authz.mjs:4-7,45-52` already states this rule; the gateway violates it. Also add a human-actor test to `roleEligibleForPersonalSelfApply` (`lib/hub-proposal-personal-self-apply.mjs:75-78`) so agent tokens are never self-apply eligible. |
| **SEC-KN-4** | **Thinking → Auto** | **TODO** | **P4 delegation apply binds to the real principal.** `precheckApprovedDelegationProposal` (`lib/agent/delegation.mjs:837-878`) trusts `proposal.body.principal_ref` and never re-derives it from the proposer; `ProposalRecord` has no `created_by` (`main.mo:1332-1346`). Re-derive `principal_ref` from the authenticated actor at apply, and record proposal authorship. **Thinking first** — this changes the delegation trust model. |
| **SEC-KN-5** | **Auto** | **TODO** | **P12 + P13 delegation limits.** Clamp a vault policy's `max_ttl_seconds` to `MAX_TTL_SECONDS` (86400) — `lib/agent/delegation.mjs:124-136` currently accepts any value `> 0`, silently widening SD-10. Restrict self-hosted grant mint to `admin` — `hub/server.mjs:1872,1912` currently allows `viewer` to issue runtime bearer authority. |
| **SEC-KN-6** | **Auto** | **TODO** | **P14 constant-time secret compare** in `main.mo:919-939` (gateway auth + operator export currently use `==` after a length check). |
| **SEC-SEAM-1** | **Thinking → Auto** | **TODO** | **P3 (shared with Scooling).** Task / media / delegation proposals currently arrive with a **shared service token** from Scooling env, not the learner's session — so every learner's proposal lands in one identity's partition. Knowtation side: accept session-bound learner identity for these surfaces and **reject service-token proposals from the self-apply class**. Scooling side is tracked as `L-SEAM` on the Scooling board. **This is a precondition of the FINISH-COMPLETE-APPLY freeze.** |
| **KN-b (FINISH-COMPLETE-APPLY)** | **Auto** | **BLOCKED** | Self-apply policy for the selected fingerprints. Blocked on SEC-KN-0/1/2 and on the Scooling freeze carrying P1–P6. **Delegation intents are excluded from self-apply — non-negotiable (P4).** |

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
- `docs/CROSS-REPO-COORDINATION.md` — Standing Decisions (ADR) log and decision authority tiers
- `.overseer/policy/tiers.yaml` — machine-readable Tier 1/2/3 authority table
- `.overseer/policy/model-labels.yaml` — allowed Model labels for roadmap + handover
- `~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md` — the audit driving the SEC queue
- `~/scooling/docs/OVERSEER-HANDOVER.md` — cross-repo product order

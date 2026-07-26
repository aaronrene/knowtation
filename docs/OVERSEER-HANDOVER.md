# Overseer Handover — Knowtation

**Living relay for Knowtation-owned work.** Paste the **NEXT SESSION** block into a fresh chat to
resume without prior history.

**Authority split (changed 2026-07-26).** This file is **no longer a thin pointer**. Knowtation now
has the Overseer Kit installed and owns its own security/authorization board
(`docs/ROADMAP.md`). Cross-repo **product order** still lives on the Scooling board
(`~/scooling/docs/OVERSEER-HANDOVER.md` + `~/scooling/docs/ROADMAP.md`). When the two disagree about
**product sequencing**, Scooling wins. When they disagree about **Knowtation's own authorization
behavior**, this board wins.

**Why this changed:** the independent Pass 2 security audit
(`~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md`, verdict `findings`) put **7 of 11
code-level findings in Knowtation**. Knowtation was doing the highest-risk work with no governed
roadmap, no freeze review, and no build-verification gate.

---

## NEXT SESSION — SEC-KN-1 fail-closed gateway auth (PRIMARY)

**Date:** 2026-07-26
**Model:** **Auto**

**SEC-KN-0 DONE (2026-07-26):** Live probe proved `gateway_auth_secret` **is set** on hub
canister `rsovz-byaaa-aaaaa-qgira-cai` — `GET …/vaults` without `X-Gateway-Auth` returns
`403 GATEWAY_AUTH_REQUIRED`. `operator_status` does **not** exist on the canister (handover
command was wrong). Knowtation Netlify `knowtation-gateway`: `CANISTER_AUTH_SECRET`,
`SESSION_SECRET`, `HUB_ADMIN_USER_IDS` present; `HUB_EVALUATOR_MAY_APPROVE` absent (fail-safe).
MCP host / gateway `SESSION_SECRET` sharing remains **UNVERIFIED**.

**Why SEC-KN-1 next:** even though the secret is set today, `hub/icp/src/hub/main.mo:930-939`
still returns `true` when `gateway_auth_secret` is empty. A future deploy/migration that clears
the secret would silently reopen the bypass. Fail closed permanently.

```text
SEC-KN-1 — fail-closed when gateway_auth_secret is empty.

Model: Auto.

Read first:
- docs/ROADMAP.md (this repo — SEC build queue)
- docs/OVERSEER-HANDOVER.md (this file)
- hub/icp/src/hub/main.mo (gatewayAuthorized ~930-939)
- ~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md (finding P1)

Do:
1) Change gatewayAuthorized so an empty secret DENIES (fail closed), not allows.
2) Keep health / OPTIONS behavior as specified in existing code (do not break public health).
3) Add a security-tier regression test that fails against the pre-fix fail-open behavior.
4) Seven-tier coverage for the change as appropriate for Motoko/canister + any gateway callers.
5) Update ROADMAP + this handover; Muse commit on feature branch. Do NOT merge to main.

Do NOT: rotate secrets, flip postures, merge to main, or claim live canister redeploy without
operator Tier 3 authorization for the canister upgrade.

Governance gates (§KH1.9 — mandatory; silence is not pass):
- [ ] Freeze review — N/A if implementing against Pass 2 P1 citation as the frozen requirement;
      if you introduce a new PHASE artifact, run /freeze-review-loop until pass first.
- [ ] Build verification — BEFORE ROADMAP row goes DONE: /build-verification-review (thinking-high).
- [ ] Governance sync — ROADMAP + this file in the closing Muse commit (SD-17).
- [ ] Verify claims — ok -C ~/knowtation status --json (initialized, kit_version, footprint ok).
```

### Knowtation-owned findings (from Pass 2)

| ID | Sev | Finding | Primary citation |
| --- | --- | --- | --- |
| **P1** | **CRITICAL**-conditional | `gatewayAuthorized` fails **open** on empty secret; identity from raw `X-User-Id` | `hub/icp/src/hub/main.mo:930-939`, `:153-158`, `:1017`, `:1149` |
| **P2** | **MAJOR** | Client-supplied `evaluation_status: "passed"` / `evaluated_by` persisted verbatim outside the fingerprint class | `lib/hub-proposal-create-augment.mjs:39-42`; `main.mo:1339-1341,1362-1369` |
| **P4** | **MAJOR** | Delegation apply trusts `proposal.body.principal_ref`; no `created_by` on the record → approval mints a grant for an attacker-named principal | `lib/agent/delegation.mjs:837-878`, `:1013`; `main.mo:1332-1346` |
| **P6** | **MAJOR** | `mcp_access` tokens get admin-allowlist role lookup, contradicting `access-token-authz.mjs`; agent tokens also satisfy the self-apply human-review predicate | `hub/gateway/server.mjs:2976-3001` vs `hub/gateway/access-token-authz.mjs:4-7,45-52`; `lib/hub-proposal-personal-self-apply.mjs:75-78` |
| **P12** | **MINOR** | Vault policy `max_ttl_seconds` accepted with no ceiling → silently widens SD-10's 24h cap | `lib/agent/delegation.mjs:124-136` with `:996-1003` |
| **P13** | **MINOR** | Self-hosted `viewer` may mint delegation grants (runtime bearer authority) | `hub/server.mjs:1872,1912` |
| **P14** | **INFO** | Non-constant-time secret comparison | `main.mo:919-939` |
| **P3** | **MAJOR** (shared) | Task/media/delegation proposals arrive with a **shared service token**, not a learner session — no ownership proof for self-apply | Scooling `src/adapters/taskWriteHubTransport.ts:210,298` and siblings |

**What Pass 2 found CLEAN in Knowtation** (do not re-litigate): `PROXY_HEADER_ALLOWLIST` never
forwards client `authorization` or `cookie` to the canister; no secret appears in logs, errors, or
results; `principal_ref` is hashed before it reaches a result; delegation TTL is server-clamped
(default 3600s, max 86400s) with no client-supplied expiry accepted; JWT `role` claims are not
trusted (role is re-derived from `sub`); AIR attestation is fail-open and does not weaken the write
gate; canister proposals are partitioned by effective user id with no gateway-path IDOR.

### Governance gates checklist

- [x] **Overseer Kit installed** — 2026-07-26, `initialized: true`, `kit_version: 0.1.0`, `footprint_self_integrity: ok`, `muse_sync: synced`
- [x] **SEC-KN-0** — canister gateway auth secret verified **SET** (2026-07-26 live probe) — **DONE**
- [ ] **SEC-KN-1** — P1 fail-closed + security-tier regression test (**Auto**) — **NEXT**
- [ ] **SEC-KN-2** — P2 server-only evaluation fields (**Auto**)
- [ ] **SEC-KN-3** — P6 `mcp_access` role cap + no self-apply for agent tokens (**Auto**)
- [ ] **SEC-KN-4** — P4 re-derive `principal_ref` at apply + proposal authorship (**Thinking → Auto**)
- [ ] **SEC-KN-5** — P12 clamp policy TTL + P13 `viewer` cannot mint (**Auto**)
- [ ] **SEC-KN-6** — P14 constant-time compare (**Auto**)
- [ ] **SEC-SEAM-1** — P3 session-bound identity for task/media/delegation writes (**Thinking → Auto**)
- [ ] **KN-b** — FINISH-COMPLETE-APPLY self-apply policy — **BLOCKED** on the above + the Scooling freeze

---

## Status (Knowtation product)

| | |
| --- | --- |
| **API** | `api.knowtation.store` live |
| **MCP public** | `https://mcp.knowtation.store/mcp` |
| **Durable agent auth** | MCP OAuth durable refresh + Hub **Connect cloud agent** (RFC 8628) shipped on `main` ([KN #271](https://github.com/aaronrene/knowtation/pull/271)). Public recipes: [`AGENT-INTEGRATION.md`](./AGENT-INTEGRATION.md) § Always-on cloud agents. Device routes require the **persistent MCP gateway** deploy. |
| **Calendar 1D** | LIVE (gate on) |
| **Overseer Kit** | **Live** (2026-07-26) — see deviation note below |

## Verified snapshot (what exists now)

| Area | State |
| --- | --- |
| **Overseer Kit** | `initialized: true`, `lock.kit_version: 0.1.0`, `footprint_self_integrity: ok`, `muse_sync: synced`, `substrate: healthy` — verified 2026-07-26 via `ok -C ~/knowtation status --json` |
| **Footprint deviation (intentional)** | `ok status --check-footprint` → `footprint_integrity: mismatch`. Cause: `MUSE-BRIDGE-WORKFLOW.md` and `scripts/muse-bridge-deploy.sh` were restored to Knowtation's live versions (sha256 `ef8a50b5…` and `fcc17c36…`) after `init --force` overwrote them with kit templates. Knowtation's bridge script is 10,004 bytes and is the live deploy path; the kit template is 3,842 bytes and is **not** a substitute. **Do not "repair" these two files.** Recorded in `.overseer/config.yaml` → `kit.notes`. |
| **Canister gateway auth secret** | **SET** (2026-07-26) — hub `rsovz-byaaa-aaaaa-qgira-cai`; `GET /vaults` without `X-Gateway-Auth` → `403 GATEWAY_AUTH_REQUIRED`. `operator_status` does not exist on canister. |
| **Knowtation Netlify env** | Site `knowtation-gateway` (`api.knowtation.store`, id `3123cc84-…`): `CANISTER_AUTH_SECRET` present, `SESSION_SECRET` present, `HUB_ADMIN_USER_IDS` present, `HUB_EVALUATOR_MAY_APPROVE` **absent** (fail-safe). |
| **MCP host / gateway `SESSION_SECRET` sharing** | **UNVERIFIED** — determines P6 exploitability today |

## Hard stops

- Never `git push origin main` — GitHub `main` only via a `muse-mirror → main` PR after a Tier 3 Muse `main` merge
- Never merge to Muse `main` without operator authorization (Tier 3)
- Never claim a runtime/security state without running the check in the same session
- **Delegation intents are never eligible for personal self-apply** (P4) — this is not a tuning knob
- Do not re-sync `MUSE-BRIDGE-WORKFLOW.md` / `scripts/muse-bridge-deploy.sh` from the kit

## Change log

| Date | Event |
| --- | --- |
| 2026-07-26 | **SEC-KN-0 DONE** — canister gateway auth secret verified SET via live HTTP probe (hub `rsovz-byaaa-aaaaa-qgira-cai` → `403 GATEWAY_AUTH_REQUIRED`). Knowtation gateway env keys confirmed present. MCP/`SESSION_SECRET` share still UNVERIFIED. NEXT = **SEC-KN-1** (fail-closed). Cross-board: Scooling L-ENV (P7/P8/P9) also closed same day. |
| 2026-07-26 | **Overseer Kit installed** (`init --regime muse+git-mirror --migrate --force`, option A) on `feat/overseer-kit-install`. Existing `docs/OVERSEER-HANDOVER.md` preserved; `docs/ROADMAP.md` + `docs/CROSS-REPO-COORDINATION.md` seeded; live bridge assets restored over kit templates (known footprint deviation). Verified `initialized: true`. |
| 2026-07-26 | **SEC queue opened** from independent Pass 2 audit (`~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md`, verdict `findings`) — Knowtation owns P1, P2, P4, P6, P12, P13, P14 and shares P3. Scooling's `FINISH-COMPLETE-APPLY-KN-b` is NO-GO until SEC-KN-0 is verified and SEC-KN-2 ships. |
| 2026-07-13 | Docs hygiene: durable-auth freeze/evidence moved to local `development/` (not public). |
| 2026-07-13 | Connect cloud agent + honesty UI merged — [KN #271](https://github.com/aaronrene/knowtation/pull/271) |
| 2026-07-12 | Durable MCP OAuth refresh (strong store) merged — [KN #270](https://github.com/aaronrene/knowtation/pull/270) |

## Shared context (prepend to any phase prompt)

Knowtation is the **canonical store and permission authority** — notes, calendar, tasks, Flows, and
the authorization decisions over them. Scooling is a **consumer** and stores nothing canonical.
MuseHub **enriches** (version/provenance/social); it does not own.

Read first: `docs/ROADMAP.md`, this file, `AGENTS.md`, `MUSE-BRIDGE-WORKFLOW.md`,
`docs/PROPOSAL-LIFECYCLE.md`, `docs/AGENT-DELEGATION-V0-SPEC.md`, and
`~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md` for the SEC queue.

Tests: seven tiers (unit, integration, e2e, stress, data-integrity, performance, security) for new
slices. Every SEC phase additionally needs a security-tier test that **fails against the pre-fix
code**.

Governance: update **both** `docs/ROADMAP.md` and this file in the closing commit (SD-17). Muse
feature branch → (Tier 3) Muse `main` → `muse-mirror` PR only.

**Model labeling:** every NEXT block and paste-ready prompt must include **`Model:`** —
Thinking, Auto, Thinking → Auto, or Operator + Auto.

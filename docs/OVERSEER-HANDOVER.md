# Overseer Handover — Knowtation (Phase 8 P1b)

Status: **Living artifact — Knowtation cross-repo handover for Phase 8 P1b offline-locked auth.**

Scooling overseer handoff lives in `scooling/docs/OVERSEER-HANDOVER.md`. Update **both** when P1b
milestones land.

---

## Next step at a glance (2026-07-01)

| | |
| --- | --- |
| **P1b-a spec** | **DONE** — `docs/PHASE-8-P1B-OFFLINE-LOCKED-AUTH-SPEC.md` (681 lines, frozen) |
| **P1b-b build** | **DONE** — inert code + seven-tier tests (29/29 green); gates **hard-false** |
| **Branch** | `feat/phase-8-p1b-offline-locked-auth-spec` → Tier 3 merge to `main` (bundled with P1b-a) |
| **Posture** | `OFFLINE_LOCKED_AUTH_CODE_SHIPPED = false`; `KNOWTATION_OFFLINE_LOCKED_AUTH` unset |
| **Next (Knowtation)** | **P1b-c flag flip** (Tier 3) — flip `OFFLINE_LOCKED_AUTH_CODE_SHIPPED` → `true` after operator authorizes; env gate remains separate Tier 3 per install |
| **Next (Scooling)** | **P1b-verify (5c)** — `sign_in_auth` matrix cell → `available` (see Scooling PRIMARY) |

---

## Verified snapshot (P1b-b)

| Deliverable | Location |
| --- | --- |
| Credential store + Argon2id | `hub/lib/local-auth.mjs` |
| Feature flag (inert) | `hub/lib/local-auth-feature-flag.mjs` — `OFFLINE_LOCKED_AUTH_CODE_SHIPPED = false` |
| Bootstrap (setup token + CLI) | `hub/lib/local-auth-bootstrap.mjs`, `hub/lib/local-auth-cli.mjs` |
| Hub routes | `hub/lib/local-auth-routes.mjs`; wired in `hub/server.mjs`, `hub/gateway/server.mjs` |
| CLI | `knowtation auth generate-setup-token \| bootstrap-admin \| token` |
| Breached-password check | `hub/lib/breached-passwords.mjs` + `hub/lib/breached-passwords-sha1.txt` (~2k hashes; loader ready for expansion) |
| Tests | `test/{unit,integration,e2e,stress,data-integrity,performance,security}/phase8-p1b-*.test.mjs` — **29/29 PASS** |

**Test command:**

```bash
node --test test/unit/phase8-p1b-*.test.mjs \
  test/integration/phase8-p1b-*.test.mjs \
  test/e2e/phase8-p1b-*.test.mjs \
  test/stress/phase8-p1b-*.test.mjs \
  test/data-integrity/phase8-p1b-*.test.mjs \
  test/performance/phase8-p1b-*.test.mjs \
  test/security/phase8-p1b-*.test.mjs
```

---

## Next-chat prompt — P1b-c compile-time flag flip · Model: **Auto** (Tier 3)

Paste after P1b bundle is on `main` and operator authorizes live code paths (separate from env gate).

```text
OVERSEER HANDOVER — P1b-c offline-locked auth flag flip (Knowtation)

Prerequisite: P1b-a spec + P1b-b code MERGED to Knowtation main (bundled muse-mirror PR).
29/29 phase8-p1b tests green on branch before merge.

Goal: Flip OFFLINE_LOCKED_AUTH_CODE_SHIPPED to true in hub/lib/local-auth-feature-flag.mjs.
Do NOT flip KNOWTATION_OFFLINE_LOCKED_AUTH in repo or .env — env gate is per-install Tier 3.

Read first:
- docs/PHASE-8-P1B-OFFLINE-LOCKED-AUTH-SPEC.md §11
- hub/lib/local-auth-feature-flag.mjs

Deliverables:
1. OFFLINE_LOCKED_AUTH_CODE_SHIPPED = true
2. Re-run seven-tier phase8-p1b suite (gate-on via test harness only unless env set in CI)
3. Muse + Git commit; Tier 3 merge approval before muse-mirror PR

Hard stops: no Scooling changes · no SD-8 · no env gate flip in this session

Cursor model: Auto
```

---

## Change log

| Date | Event |
| --- | --- |
| 2026-07-01 | P1b-a spec frozen on `feat/phase-8-p1b-offline-locked-auth-spec` (Muse `4aaa6f7`) |
| 2026-07-01 | P1b-b Auto build complete — inert libs + 29 tests; bundled for Tier 3 merge |

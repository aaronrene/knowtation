# Overseer Handover — Knowtation (Phase 8 P1b)

Status: **Living artifact — Knowtation cross-repo handover for Phase 8 P1b offline-locked auth.**

Scooling overseer handoff lives in `scooling/docs/OVERSEER-HANDOVER.md`. Update **both** when P1b
milestones land.

---

## Next step at a glance (2026-07-01)

| | |
| --- | --- |
| **P1b-a spec** | **DONE** — `docs/PHASE-8-P1B-OFFLINE-LOCKED-AUTH-SPEC.md` (681 lines, frozen) |
| **P1b-b build** | **DONE** — code + seven-tier tests (29/29 green); merged to `main` (PR #254) |
| **P1b-c flag flip** | **DONE on branch** — `OFFLINE_LOCKED_AUTH_CODE_SHIPPED = true`; 29/29 green |
| **Branch** | `feat/phase-8-p1b-c-offline-locked-auth-flag-flip` → Tier 3 merge to `main` |
| **Posture** | `OFFLINE_LOCKED_AUTH_CODE_SHIPPED = true` (on branch); `KNOWTATION_OFFLINE_LOCKED_AUTH` unset (env gate separate Tier 3 per install) |
| **Next (Knowtation)** | **P1b-c merge + muse-mirror PR** (Tier 3) — operator authorized 2026-07-01 |
| **Next (Scooling)** | **Idle** — P1b-verify CONSUMED; no Scooling changes for P1b-c |

---

## Verified snapshot (P1b-c)

| Deliverable | Location |
| --- | --- |
| Credential store + Argon2id | `hub/lib/local-auth.mjs` |
| Feature flag (shipped) | `hub/lib/local-auth-feature-flag.mjs` — `OFFLINE_LOCKED_AUTH_CODE_SHIPPED = true` |
| Bootstrap (setup token + CLI) | `hub/lib/local-auth-bootstrap.mjs`, `hub/lib/local-auth-cli.mjs` |
| Hub routes | `hub/lib/local-auth-routes.mjs`; wired in `hub/server.mjs`, `hub/gateway/server.mjs` |
| CLI | `knowtation auth generate-setup-token \| bootstrap-admin \| token` |
| Breached-password check | `hub/lib/breached-passwords.mjs` + `hub/lib/breached-passwords-sha1.txt` (~2k hashes; loader ready for expansion) |
| Tests | `test/{unit,integration,e2e,stress,data-integrity,performance,security}/phase8-p1b-*.test.mjs` — **29/29 PASS** (post flip) |

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

## Next-chat prompt — P1b-c merge + mirror · Model: **Auto** (Tier 3)

Paste when ready to merge P1b-c branch to Muse `main` and open `muse-mirror` PR.

```text
OVERSEER HANDOVER — P1b-c merge + mirror (Knowtation)

Prerequisite: feat/phase-8-p1b-c-offline-locked-auth-flag-flip committed; 29/29 phase8-p1b green.

Goal: Tier 3 merge to Muse main → muse-mirror PR to GitHub main (SD-14).

Hard stops: no env gate flip · no Scooling changes · no SD-8 bundling

Cursor model: Auto
```

---

## Change log

| Date | Event |
| --- | --- |
| 2026-07-01 | P1b-c flag flip — `OFFLINE_LOCKED_AUTH_CODE_SHIPPED = true`; 29/29 green on `feat/phase-8-p1b-c-offline-locked-auth-flag-flip` (Tier 3 authorized) |
| 2026-07-01 | P1b-a spec frozen on `feat/phase-8-p1b-offline-locked-auth-spec` (Muse `4aaa6f7`) |
| 2026-07-01 | P1b-b Auto build complete — inert libs + 29 tests; bundled for Tier 3 merge |

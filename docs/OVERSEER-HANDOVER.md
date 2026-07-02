# Overseer Handover — Knowtation (Phase 8 P1b)

Status: **Living artifact — Knowtation cross-repo handover for Phase 8 P1b offline-locked auth.**

Scooling overseer handoff lives in `scooling/docs/OVERSEER-HANDOVER.md`. Update **both** when P1b
milestones land.

---

## Next step at a glance (2026-07-02)

| | |
| --- | --- |
| **P1b-a spec** | **DONE** — `docs/PHASE-8-P1B-OFFLINE-LOCKED-AUTH-SPEC.md` (681 lines, frozen) |
| **P1b-b build** | **DONE** — code + seven-tier tests (29/29 green); merged to `main` (PR #254) |
| **P1b-c flag flip** | **CONSUMED** — `OFFLINE_LOCKED_AUTH_CODE_SHIPPED = true`; 29/29 green |
| **Airgapped smoke** | **CONSUMED** (2026-07-01) — Tester Vault; env gate + bootstrap + JWT login PASS |
| **Branch** | Merged to Muse `main` @ `sha256:537d4407…`; GitHub PR #255 @ `6976eef` |
| **Posture** | `OFFLINE_LOCKED_AUTH_CODE_SHIPPED = true`; per-install env gate is operator Tier 3 |
| **Next (Knowtation)** | None active — Phase 8 P1b track **complete** |
| **Next (Scooling)** | **Phase 8C-a** (Thinking) — model consolidation outline freeze (see Scooling PRIMARY) |

---

## Verified snapshot (P1b complete)

| Deliverable | Location |
| --- | --- |
| Credential store + Argon2id | `hub/lib/local-auth.mjs` |
| Feature flag (shipped) | `hub/lib/local-auth-feature-flag.mjs` — `OFFLINE_LOCKED_AUTH_CODE_SHIPPED = true` |
| Bootstrap (setup token + CLI) | `hub/lib/local-auth-bootstrap.mjs`, `hub/lib/local-auth-cli.mjs` |
| Hub routes | `hub/lib/local-auth-routes.mjs`; wired in `hub/server.mjs`, `hub/gateway/server.mjs` |
| CLI | `knowtation auth generate-setup-token \| bootstrap-admin \| token` |
| Breached-password check | `hub/lib/breached-passwords.mjs` + `hub/lib/breached-passwords-sha1.txt` (~2k hashes; loader ready for expansion) |
| Tests | `test/{unit,integration,e2e,stress,data-integrity,performance,security}/phase8-p1b-*.test.mjs` — **29/29 PASS** (post flip) |

**Operator smoke evidence (2026-07-01):**

- Vault: `/Users/aaronrenecarvajal/Tester Vault`
- Data dir: `knowtation/data/offline-smoke-test` (isolated from production Hub data)
- `KNOWTATION_OFFLINE_LOCKED_AUTH=enabled`
- `auth bootstrap-admin --username admin` → `{"ok":true,"userId":"admin_001"}`
- `POST /api/v1/auth/local/login` → JWT; `sub: local:admin_001`, `provider: local`, `role: admin`

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

## Change log

| Date | Event |
| --- | --- |
| 2026-07-02 | **Airgapped smoke CONSUMED** — Tester Vault; env gate + bootstrap + local login PASS |
| 2026-07-01 | P1b-c **MERGED** — `OFFLINE_LOCKED_AUTH_CODE_SHIPPED = true`; Muse `sha256:537d4407…`; GitHub PR #255 @ `6976eef` |
| 2026-07-01 | P1b-c flag flip — 29/29 green on `feat/phase-8-p1b-c-offline-locked-auth-flag-flip` (Tier 3 authorized) |
| 2026-07-01 | P1b-a spec frozen on `feat/phase-8-p1b-offline-locked-auth-spec` (Muse `4aaa6f7`) |
| 2026-07-01 | P1b-b Auto build complete — inert libs + 29 tests; bundled for Tier 3 merge |

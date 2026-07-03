# Overseer Handover — Knowtation (Phase 8 P1b)

Status: **Living artifact — Knowtation cross-repo handover for Phase 8 P1b offline-locked auth.**

Scooling overseer handoff lives in `scooling/docs/OVERSEER-HANDOVER.md`. Update **both** when P1b
milestones land.

---

## Next step at a glance (2026-07-03)

| | |
| --- | --- |
| **Status** | **Muse bridge-safety hygiene landed on Muse `main`** (2026-07-03) + 2F-b-d-kn track MERGED + MIRRORED · **NEXT = reconcile diverged local git + file upstream Muse bridge issue** (see below) |
| **Muse `main`** | `sha256:3a12929a…` (shared `scripts/muse-local-setup.sh` + `vault/areas/muse-ops/muse-local-hygiene.md` + rc15 bridge-issue re-file, on top of `8288517…` 2F-b-d-kn-d) |
| **GitHub `main`** | [PR #258](https://github.com/aaronrene/knowtation/pull/258) @ `bf4aad8` — **⚠ local git diverged: on stale branch `feat/phase-2f-b-d-kn-d-attach-gate`, 14 commits ahead of `origin/main`, with unrelated uncommitted edits. Reconcile before mirroring (fetch + compare Muse `main` vs `origin/main`).** |
| **Muse bridge safety** | `.env`/`config/local.yaml` deletion root cause = hand-run `muse bridge git-export --git-dir .` (universal Muse CLI bug, unfixed through rc15). Everyday commands + `scripts/muse-bridge-deploy.sh` are safe (verified). Run `scripts/muse-local-setup.sh` on fresh clones. **`muse hub issue` auth now works** — upstream re-file draft ready at `docs/musehub-issues/2026-07-03-bridge-deletes-ignored-files-rc15-refile.md`, not yet filed. |
| **Branch protection** | **Queued** (not yet applied): require `test (20)` + `Secret scanning (TruffleHog)` on `main` — both verified to run on PRs. `gh api` command in Scooling handover / next-session prompt. |
| **THE ONE NEXT STEP** | Reconcile diverged local git → then mirror Muse `main` (`scripts/muse-bridge-deploy.sh`) + enable branch protection + file the upstream issue. Then Scooling **Phase 7B-a** inert model studio. |
| **PRIMARY prompt** | Knowtation Muse-hygiene reconcile + mirror (below); then Scooling **Phase 7B-a** |

| Step | Status |
| --- | --- |
| **2F-b-d-kn-a contract** | **✅ DONE** — `docs/MEDIA-WRITE-SURFACES-CONTRACT-2F-b-d-kn.md` |
| **2F-b-d-kn-b build** | **✅ DONE** — canonical write surfaces; Muse `main` merged |
| **2F-b-d-kn-c external link gate** | **✅ DONE** — link gate on dev/staging; 22/22 tests; live smoke 5/5 |
| **2F-b-d-kn-d attach gate** | **✅ DONE** — attach gate on dev/staging; 22/22 tests; live smoke 7/7 |
| **2F-b-d-kn-d-merge** | **✅ MERGED + MIRRORED** (2026-07-03) — [PR #258](https://github.com/aaronrene/knowtation/pull/258) @ `bf4aad8` |

| Scooling consumer (cross-repo) | Status |
| --- | --- |
| **2F-b-d-e** | **✅ MERGED** — `MEDIA_EXTERNAL_LINK_AUTHORIZED` live on Muse `main` |
| **2F-b-d-f** | **✅ MERGED** — `MEDIA_ATTACH_AUTHORIZED` live on Muse `main` |
| **2F-b-d-merge** | **✅ MERGED + MIRRORED** — Scooling [PR #134](https://github.com/aaronrene/scooling/pull/134) @ `f7442a5` |

---

## Media write surfaces (2F-b-d-kn)

| | |
| --- | --- |
| **Gates (dev/staging on `main`)** | `MEDIA_EXTERNAL_LINK_ENABLED` **on** · `MEDIA_ATTACH_ENABLED` **on** via `data/hub_media_write_policy.json` (gitignored) |
| **Gates (production default)** | Both **off** in code defaults |
| **Seed command** | `node scripts/seed-media-write-staging.mjs` |
| **Test command** | `node --test test/media-write-*.test.mjs` — **22/22 PASS** |
| **Smoke (live)** | `HUB_PORT=3456 node scripts/run-media-write-live-smoke.mjs` — **7/7 PASS** |

---

## Attachment gates (Scooling Phase 2F-b)

| | |
| --- | --- |
| **2F-b-b** | **✅ MERGED** — read-only list/get; [PR #256](https://github.com/aaronrene/knowtation/pull/256) |
| **Consumer (Scooling `main`)** | `MEDIA_LIVE_READ_AUTHORIZED` · `MEDIA_EXTERNAL_LINK_AUTHORIZED` · `MEDIA_ATTACH_AUTHORIZED` **all live** |

---

## Change log

| Date | Event |
| --- | --- |
| 2026-07-03 | **Muse bridge-safety hygiene on Muse `main` `sha256:3a12929a…`** — shared `scripts/muse-local-setup.sh`, canonical vault note `areas/muse-ops/muse-local-hygiene.md`, and rc15 upstream bridge-issue re-file. `.env` deletion root cause confirmed (hand-run `--git-dir .`). MuseHub issue auth restored (May `401` cleared). ⚠ Local git diverged — reconcile pending. |
| 2026-07-03 | **2F-b-d-merge MERGED + MIRRORED** — Muse `sha256:8288517…`; GitHub [PR #258](https://github.com/aaronrene/knowtation/pull/258) @ `bf4aad8`; Scooling [PR #134](https://github.com/aaronrene/scooling/pull/134) @ `f7442a5` |
| 2026-07-03 | **Cross-repo sync** — Scooling 2F-b-d-f DONE on branch; both repos ready for **2F-b-d-merge** (Tier 3) |
| 2026-07-03 | **2F-b-d-kn-d DONE** — attach gate dev/staging; 22/22 tests; live smoke 7/7; §16.2 KA-* passed |
| 2026-07-03 | **Scooling 2F-b-d-e CONSUMED on branch** — `MEDIA_EXTERNAL_LINK_AUTHORIZED` live |
| 2026-07-02 | **2F-b-d-kn-c DONE** — external link gate dev/staging; unblocks Scooling 2F-b-d-e |
| 2026-07-02 | **2F-b-d-kn-b MERGED** — [PR #257](https://github.com/aaronrene/knowtation/pull/257) |
| 2026-07-02 | **2F-b-d-kn-a contract FROZEN** |
| 2026-07-01 | P1b-c **MERGED** — offline locked auth shipped |

---

## Next-chat prompt — PRIMARY — Phase 7B-a (Scooling) · Model: **Thinking → Auto**

**Knowtation 2F-b-d leg COMPLETE.** Active build track moved to Scooling Phase 7B-a inert model studio.

```text
(See scooling/docs/OVERSEER-HANDOVER.md → PRIMARY — Phase 7B-a inert model studio)
```

### CONSUMED — 2F-b-d-kn-d-merge · Model: **Auto (Tier 3 operator)**

Ran 2026-07-03. Muse `main` @ `sha256:8288517…`; GitHub [PR #258](https://github.com/aaronrene/knowtation/pull/258) @ `bf4aad8`.

```text
(Superseded — do not paste.)
```

### CONSUMED — 2F-b-d-kn-d attach gate · Model: **Auto (Tier 3 operator)**

Ran 2026-07-03. `MEDIA_ATTACH_ENABLED` on dev/staging; external-link unchanged; 22/22; live 7/7.

```text
(Superseded — do not paste.)
```

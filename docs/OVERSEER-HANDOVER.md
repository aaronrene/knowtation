# Overseer Handover — Knowtation (Phase 8 P1b)

Status: **Living artifact — Knowtation cross-repo handover for Phase 8 P1b offline-locked auth.**

Scooling overseer handoff lives in `scooling/docs/OVERSEER-HANDOVER.md`. Update **both** when P1b
milestones land.

---

## Next step at a glance (2026-07-03)

| | |
| --- | --- |
| **Status** | **2F-b-d-kn track COMPLETE on branch** · **NEXT = Tier 3 merge** · Scooling 2F-b-d-f **DONE on branch** |
| **Branch (WIP)** | `feat/phase-2f-b-d-kn-d-attach-gate` @ Git `ef503de` (unmerged) |
| **Muse `main`** | `sha256:3690634d…` (2F-b-d-kn-b build; pre attach-gate merge) |
| **THE ONE NEXT STEP** | **Tier 3 merge** — this branch → Muse `main` + muse-mirror PR (SD-14); coordinate with Scooling **2F-b-d-merge** |
| **PRIMARY prompt** | Paste block below (or use Scooling handover PRIMARY — same operator session) |

| Step | Status |
| --- | --- |
| **2F-b-d-kn-a contract** | **✅ DONE** — `docs/MEDIA-WRITE-SURFACES-CONTRACT-2F-b-d-kn.md` |
| **2F-b-d-kn-b build** | **✅ DONE** — canonical write surfaces; Muse `main` merged |
| **2F-b-d-kn-c external link gate** | **✅ DONE** — link gate on dev/staging; 22/22 tests; live smoke 5/5 |
| **2F-b-d-kn-d attach gate** | **✅ DONE on branch** — attach gate on dev/staging; 22/22 tests; live smoke 7/7 |
| **2F-b-d-kn-d-merge** | **⬜ NEXT** — merge feature branch → Muse `main` + muse-mirror PR |

| Scooling consumer (cross-repo) | Status |
| --- | --- |
| **2F-b-d-e** | **✅ DONE on branch** — `MEDIA_EXTERNAL_LINK_AUTHORIZED` live |
| **2F-b-d-f** | **✅ DONE on branch** — `MEDIA_ATTACH_AUTHORIZED` live (2026-07-03) |
| **2F-b-d-merge** | **⬜ NEXT** — Scooling `feat/phase-2f-b-d-external-link-attach-contract` @ `efa1ccd` |

---

## Media write surfaces (2F-b-d-kn)

| | |
| --- | --- |
| **Gates (dev/staging on branch)** | `MEDIA_EXTERNAL_LINK_ENABLED` **on** · `MEDIA_ATTACH_ENABLED` **on** via `data/hub_media_write_policy.json` (gitignored) |
| **Gates (production default)** | Both **off** in code defaults |
| **Seed command** | `node scripts/seed-media-write-staging.mjs` |
| **Test command** | `node --test test/media-write-*.test.mjs` — **22/22 PASS** |
| **Smoke (live)** | `HUB_PORT=3456 node scripts/run-media-write-live-smoke.mjs` — **7/7 PASS** |

---

## Attachment gates (Scooling Phase 2F-b)

| | |
| --- | --- |
| **2F-b-b** | **✅ MERGED** — read-only list/get; [PR #256](https://github.com/aaronrene/knowtation/pull/256) |
| **Consumer (Scooling branch)** | `MEDIA_LIVE_READ_AUTHORIZED` **live on main** · `MEDIA_EXTERNAL_LINK_AUTHORIZED` **live on branch** · `MEDIA_ATTACH_AUTHORIZED` **live on branch** |

---

## Change log

| Date | Event |
| --- | --- |
| 2026-07-03 | **Cross-repo sync** — Scooling 2F-b-d-f DONE on branch; both repos ready for **2F-b-d-merge** (Tier 3) |
| 2026-07-03 | **2F-b-d-kn-d DONE on branch** — attach gate dev/staging; 22/22 tests; live smoke 7/7; §16.2 KA-* passed |
| 2026-07-03 | **Scooling 2F-b-d-e CONSUMED on branch** — `MEDIA_EXTERNAL_LINK_AUTHORIZED` live |
| 2026-07-02 | **2F-b-d-kn-c DONE** — external link gate dev/staging; unblocks Scooling 2F-b-d-e |
| 2026-07-02 | **2F-b-d-kn-b MERGED** — [PR #257](https://github.com/aaronrene/knowtation/pull/257) |
| 2026-07-02 | **2F-b-d-kn-a contract FROZEN** |
| 2026-07-01 | P1b-c **MERGED** — offline locked auth shipped |

---

## Next-chat prompt — PRIMARY — 2F-b-d-merge (Knowtation leg) · Model: **Auto (Tier 3 operator)**

**THE ONE NEXT STEP.** Merge attach-gate branch; coordinate with Scooling 2F-b-d-merge in same session.

```text
OVERSEER HANDOVER — (Knowtation 2F-b-d-kn-d-merge — Tier 3)

Cursor model: Auto (Tier 3 operator session)

Merge feat/phase-2f-b-d-kn-d-attach-gate → Muse main + muse-mirror PR (SD-14).
Attach gate already enabled on dev/staging on branch — merge only; no new gate flips.

Pre-merge: node --test test/media-write-*.test.mjs (22/22)
Merge: muse checkout main && muse merge feat/phase-2f-b-d-kn-d-attach-gate
Mirror: per knowtation/AGENTS.md — muse-mirror PR → gh pr merge --merge
Hard stop: NEVER git push origin main

Cross-repo: Scooling feat/phase-2f-b-d-external-link-attach-contract merge in same session
(see scooling/docs/OVERSEER-HANDOVER.md PRIMARY — 2F-b-d-merge).
```

### CONSUMED — 2F-b-d-kn-d attach gate · Model: **Auto (Tier 3 operator)**

Ran 2026-07-03. `MEDIA_ATTACH_ENABLED` on dev/staging; external-link unchanged; 22/22; live 7/7.

```text
(Superseded — do not paste.)
```

### CONSUMED — Scooling 2F-b-d-e external link consumer flip

Ran 2026-07-03. Scooling `MEDIA_EXTERNAL_LINK_AUTHORIZED` live on branch.

```text
(Superseded — do not paste.)
```

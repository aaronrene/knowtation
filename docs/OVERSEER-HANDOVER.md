# Overseer Handover — Knowtation

**Cross-repo note:** Scooling is the orchestration layer. **Primary handover lives in
`scooling/docs/OVERSEER-HANDOVER.md`** — copy the NEXT SESSION block from there.

Knowtation-specific history → this file's change log below. Phase truth → `scooling/docs/ROADMAP.md`.

---

## NEXT SESSION — same as Scooling PRIMARY

Active track (2026-07-05): **Calendar step 11b** — build the read-only **Google OAuth connector
(Phase 1D)**, gated off (`CALENDAR_OAUTH_GOOGLE_AUTHORIZED=false`). Spec **FROZEN** (11a) at
`docs/CALENDAR-OAUTH-CONNECTOR-1D-SPEC.md`. SD-8 domain registration remains queued (blocked on
MuseHub `/api/v1/domains` deploy).

See **`scooling/docs/OVERSEER-HANDOVER.md` → NEXT SESSION** for the paste block.

---

## Knowtation status

| | |
| --- | --- |
| **GitHub `main`** | `bd73698` (PR #259 merged 2026-07-03) |
| **Media write gates** | External link + attach **on** dev/staging |
| **API** | **`api.knowtation.store` live** — hosted smokes passed |
| **Domain plugin** | Code green (1570 tests); pushed to `aaronrene/gabriel-muse` staging; **registration blocked** on MuseHub `/api/v1/domains` deploy |

---

## Change log (recent)

| Date | Event |
| --- | --- |
| 2026-07-05 | Calendar step 11a — Google OAuth connector spec **FROZEN** (`docs/CALENDAR-OAUTH-CONNECTOR-1D-SPEC.md`); active track → 11b build (gated off) on `feat/calendar-oauth-1d-spec` |
| 2026-07-05 | Active track → SD-8 (Scooling handover reprioritized; Track C parked) |
| 2026-07-03 | Muse bridge-safety hygiene merged PR #259 |
| 2026-07-03 | 2F-b-d-kn merge complete — media write surfaces live on dev/staging |
| 2026-07-01 | P1b-c offline locked auth merged |

Full history: earlier entries preserved below in this file.

---

## Legacy detail (2026-07-03 snapshot — reference only)

Media write surfaces (2F-b-d-kn): gates on dev/staging via `data/hub_media_write_policy.json`;
`node --test test/media-write-*.test.mjs` — 22/22; live smoke 7/7. Scooling consumer:
`MEDIA_*_AUTHORIZED` all live on `main`. Superseded prompts archived in git history @ `bd73698`.

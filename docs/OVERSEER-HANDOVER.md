# Overseer Handover — Knowtation

**Cross-repo note:** Scooling is the orchestration layer. **Primary handover lives in
`scooling/docs/OVERSEER-HANDOVER.md`** — copy the NEXT SESSION block from there.

Knowtation-specific history → this file's change log below. Phase truth → `scooling/docs/ROADMAP.md`.

---

## NEXT SESSION — same as Scooling PRIMARY

Active track (2026-07-05): **Calendar step 11b MERGED** — Google OAuth connector (Phase 1D) on
`main`, **gated off** (`CALENDAR_OAUTH_GOOGLE_AUTHORIZED=false`). Next: **operator Tier 3 Session A**
(loopback Google OAuth live smoke — flip gate + Google Cloud test client only).

See **`scooling/docs/OVERSEER-HANDOVER.md` → NEXT SESSION** for the paste block.

---

## Knowtation status

| | |
| --- | --- |
| **Phase 1D** | **MERGED** (2026-07-05) — connector routes + seven-tier tests; gate off until Tier 3 |
| **Media write gates** | External link + attach **on** dev/staging |
| **API** | **`api.knowtation.store` live** |
| **Domain plugin** | Registration on staging; MuseHub deploy gate for public `/api/v1/domains` |

---

## Change log (recent)

| Date | Event |
| --- | --- |
| 2026-07-05 | Calendar step **11b MERGED** — Google OAuth connector (1D): vault, normalizer, connector module, Hub routes; 21/21 tests; gate stays `false` until Tier 3 |
| 2026-07-05 | Calendar step 11a — spec **FROZEN** (`docs/CALENDAR-OAUTH-CONNECTOR-1D-SPEC.md`) |
| 2026-07-03 | Muse bridge-safety hygiene merged PR #259 |
| 2026-07-03 | 2F-b-d-kn merge complete — media write surfaces live on dev/staging |

Full history: earlier entries preserved below in this file.

---

## Legacy detail (2026-07-03 snapshot — reference only)

Media write surfaces (2F-b-d-kn): gates on dev/staging via `data/hub_media_write_policy.json`;
`node --test test/media-write-*.test.mjs` — 22/22; live smoke 7/7. Scooling consumer:
`MEDIA_*_AUTHORIZED` all live on `main`. Superseded prompts archived in git history @ `bd73698`.

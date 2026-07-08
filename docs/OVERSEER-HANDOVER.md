# Overseer Handover — Knowtation

**Cross-repo note:** Scooling is the orchestration layer. **Primary handover lives in
`scooling/docs/OVERSEER-HANDOVER.md`** — copy the NEXT SESSION block from there.

Knowtation-specific history → this file's change log below. Phase truth → `scooling/docs/ROADMAP.md`.

---

## NEXT SESSION — same as Scooling PRIMARY

Active track (2026-07-08): **INF-KN-3c** — calendar OAuth blob hydrate uses **strong** consistency +
merge so `begin → callback` does not return `state_invalid` on Netlify. Next after merge/deploy:
**INF-3** operator hosted calendar connect smoke (runbook Step 4).

See **`scooling/docs/OVERSEER-HANDOVER.md` → NEXT SESSION** for the paste block.

---

## Knowtation status

| | |
| --- | --- |
| **Phase 1D** | **LIVE (gate on)** — KN-INF-3a 2026-07-07; connector routes + tests |
| **Hosted calendar blobs** | **INF-KN-3b** merged (#266); **INF-KN-3c** strong read-after-write for pending OAuth |
| **Media write gates** | External link + attach **on** dev/staging |
| **API** | **`api.knowtation.store` live** |
| **Domain plugin** | Registration on staging; MuseHub deploy gate for public `/api/v1/domains` |

---

## Change log (recent)

| Date | Event |
| --- | --- |
| 2026-07-08 | **INF-KN-3c** — calendar store blob hydrate `consistency: 'strong'` + merge pending OAuth (fixes hosted `state_invalid` after Google consent) |
| 2026-07-07 | **INF-KN-3b** — calendar store + OAuth token blobs on Netlify Blobs; gateway `proxyTo` `redirect: 'manual'` — [KN #266](https://github.com/aaronrene/knowtation/pull/266) |
| 2026-07-07 | **KN-INF-3a** — compile-time gate flip `CALENDAR_OAUTH_GOOGLE_AUTHORIZED=true` — [KN #265](https://github.com/aaronrene/knowtation/pull/265) |
| 2026-07-05 | Calendar step **11b MERGED** — Google OAuth connector (1D): vault, normalizer, connector module, Hub routes |
| 2026-07-05 | Calendar step 11a — spec **FROZEN** (`docs/CALENDAR-OAUTH-CONNECTOR-1D-SPEC.md`) |
| 2026-07-03 | Muse bridge-safety hygiene merged PR #259 |
| 2026-07-03 | 2F-b-d-kn merge complete — media write surfaces live on dev/staging |

Full history: earlier entries preserved below in this file.

---

## Legacy detail (2026-07-03 snapshot — reference only)

Media write surfaces (2F-b-d-kn): gates on dev/staging via `data/hub_media_write_policy.json`;
`node --test test/media-write-*.test.mjs` — 22/22; live smoke 7/7. Scooling consumer:
`MEDIA_*_AUTHORIZED` all live on `main`. Superseded prompts archived in git history @ `bd73698`.

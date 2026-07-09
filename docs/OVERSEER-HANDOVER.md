# Overseer Handover — Knowtation

**Cross-repo note:** Scooling is the orchestration layer. **Primary handover lives in
`scooling/docs/OVERSEER-HANDOVER.md`** — copy the NEXT SESSION block from there.

Knowtation-specific history → this file's change log below. Phase truth → `scooling/docs/ROADMAP.md`.

---

## NEXT SESSION — P-FLOW shipped on branch; mirror + Scooling consumer wire

**Date:** 2026-07-09  
**Branch:** `feat/p-flow-run-store`  
**Deliverable:** Canonical `flow_run/v0` read store in `lib/flow/flow-store.mjs` — `listFlowRuns` /
`getFlowRun`, portable `run_ref` (`flow_run:…`) lookup, overseer seed
(`flow_run:fixture-overseer-001`), OpenAPI `FlowRun*` schemas, seven-tier
`test/flow-run-store-*.test.mjs` (**33/33 green** with execution regression slice).

**Next:** Muse commit → push → PR → SD-14 mirror to GitHub `main`. Scooling live `runRef`
resolution remains a **separate consumer step** (no posture flip in this slice).

See **`scooling/docs/OVERSEER-HANDOVER.md`** for cross-repo track selection.

---

## Knowtation status

| | |
| --- | --- |
| **Phase 1D** | **LIVE (gate on)** — KN-INF-3a 2026-07-07 |
| **Hosted calendar blobs** | **INF-KN-3b** (#266) + **INF-KN-3c** (#267) strong read-after-write |
| **INF-3 connect** | **PASS** 2026-07-08 (`connect=ok` + source calendars) |
| **API** | **`api.knowtation.store` live** |

---

## Change log (recent)

| Date | Event |
| --- | --- |
| 2026-07-08 | **INF-3** operator connect smoke PASS after #267 deploy |
| 2026-07-08 | **INF-KN-3c** — calendar store blob hydrate `consistency: 'strong'` + merge pending OAuth — [KN #267](https://github.com/aaronrene/knowtation/pull/267) |
| 2026-07-07 | **INF-KN-3b** — calendar store + OAuth token blobs; gateway `redirect: 'manual'` — [KN #266](https://github.com/aaronrene/knowtation/pull/266) |
| 2026-07-07 | **KN-INF-3a** — `CALENDAR_OAUTH_GOOGLE_AUTHORIZED=true` — [KN #265](https://github.com/aaronrene/knowtation/pull/265) |
| 2026-07-05 | Calendar step **11b MERGED** — Google OAuth connector (1D) |

---

## Legacy detail (2026-07-03 snapshot — reference only)

Media write surfaces (2F-b-d-kn): gates on dev/staging via `data/hub_media_write_policy.json`;
`node --test test/media-write-*.test.mjs` — 22/22; live smoke 7/7. Scooling consumer:
`MEDIA_*_AUTHORIZED` all live on `main`. Superseded prompts archived in git history @ `bd73698`.

# Overseer Handover — Knowtation

**Cross-repo note:** Scooling is the orchestration layer. **Primary handover lives in
`scooling/docs/OVERSEER-HANDOVER.md`** — copy the NEXT SESSION block from there.

Knowtation-specific history → this file's change log below. Phase truth → `scooling/docs/ROADMAP.md`.

---

## NEXT SESSION — same as Scooling PRIMARY

**P-FLOW MERGED** [KN #268](https://github.com/aaronrene/knowtation/pull/268) @ `fba35fc` on Knowtation
`main`. Scooling governance synced [SC #185](https://github.com/aaronrene/scooling/pull/185) @
`1b9e12b`.

**THE ONE NEXT STEP (Scooling):** **9A-P-FLOW-CONSUMER** — wire live `runRef` reads against
`getFlowRun` / `GET /api/v1/flow-runs/{run_ref}` (read-only; no Knowtation gate flips).

See **`scooling/docs/OVERSEER-HANDOVER.md` → NEXT SESSION** for the paste-ready prompt.

---

## Knowtation status

| | |
| --- | --- |
| **P-FLOW** | **MERGED** @ `fba35fc` — `listFlowRuns` / `getFlowRun` + portable `run_ref` |
| **Phase 1D** | **LIVE (gate on)** — KN-INF-3a 2026-07-07 |
| **Hosted calendar blobs** | **INF-KN-3b** (#266) + **INF-KN-3c** (#267) strong read-after-write |
| **API** | **`api.knowtation.store` live** |

---

## Change log (recent)

| Date | Event |
| --- | --- |
| 2026-07-09 | **P-FLOW merged** — [KN #268](https://github.com/aaronrene/knowtation/pull/268) @ `fba35fc` canonical `flow_run/v0` read store |
| 2026-07-08 | **INF-3** operator connect smoke PASS after #267 deploy |
| 2026-07-08 | **INF-KN-3c** — calendar store blob hydrate — [KN #267](https://github.com/aaronrene/knowtation/pull/267) |
| 2026-07-07 | **KN-INF-3a** — `CALENDAR_OAUTH_GOOGLE_AUTHORIZED=true` — [KN #265](https://github.com/aaronrene/knowtation/pull/265) |

# Overseer Handover — Knowtation

**Primary handover:** `scooling/docs/OVERSEER-HANDOVER.md` — copy NEXT SESSION block from there.

---

## Status (2026-07-06)

| | |
| --- | --- |
| **Calendar 1D** | Merged + Sessions A + B PASS (loopback operator smokes) |
| **Gate on GitHub `main`** | `CALENDAR_OAUTH_GOOGLE_AUTHORIZED = false` (correct pre-launch) |
| **Local at rest** | Gate **false**; calendar OAuth `.env` vars may stay set but inert until local flip |
| **Next (Knowtation side)** | Hosted calendar OAuth config (Tier 3, operator, flip day) — set `SCOOLING_RETURN_URL_ALLOWLIST` (deployed Scooling return URL), `CALENDAR_OAUTH_REDIRECT_URI` (hosted Hub callback, registered in verified Google app), hosted `GOOGLE_CALENDAR_OAUTH_CLIENT_ID/_SECRET` + `KNOWTATION_CALENDAR_OAUTH_SECRET`, then flip `CALENDAR_OAUTH_GOOGLE_AUTHORIZED=true`. Frozen in `scooling/docs/CALENDAR-HOSTED-OAUTH-LIVE-SLICE.md` §2.3/§8. |

Operator helpers (gitignored/local): `scripts/calendar-oauth-smoke-check.mjs`, `scripts/refresh-scooling-hub-token.mjs`

---

## Change log

| Date | Item |
| --- | --- |
| 2026-07-05 | Hosted calendar OAuth Thinking freeze authored (Scooling `docs/CALENDAR-HOSTED-OAUTH-LIVE-SLICE.md`); KN-side hosted config prerequisites frozen in §2.3/§8 (config-only, no code change here) |
| 2026-07-06 | Sessions A + B PASS; hygiene gate reverted; path to hosted live in Scooling handover |
| 2026-07-05 | 1D merged PR #261; Session A PASS |

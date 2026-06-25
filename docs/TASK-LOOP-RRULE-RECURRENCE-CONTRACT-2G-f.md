# Task Loop RRULE Recurrence — Contract (Phase 2G-f, Step 2G-f-a)

Status: **Contract frozen (2G-f-a Thinking, 2026-06-24).** Knowtation-canonical extension to
`knowtation.task_loop/v0.recurrence` resolving **OD-2**. Validator + store read paths in **2G-f-b
Auto** — inert until Tier 3 bundled 2G live session.

Related:

- `scooling/docs/LOOP-TRIGGER-AND-RECURRENCE-CONTRACT-2G-f.md` — Scooling trigger eval + posture.
- `docs/TASK-LOOP-STORE-CONTRACT-2G-c.md` — v0 pinned subset (cron / interval / manual / on_wake).
- `docs/TASK-LOOPS-AND-ORCHESTRATOR-PLAN.md` — §3.2 recurrence, OD-2 deferral note.

**Scope fence (2G-f-a):** Schema + validator rules + test matrix **only**. **No** RRULE parser impl,
**no** Hub route changes, **no** live gate flips.

---

## Simple summary

Task loop series can store a standard **RRULE** recurrence (like calendar apps use) instead of only
cron or fixed intervals. Knowtation validates the rule, stores it on the series, and generates stable
occurrence keys. Scooling reads the validated series to compute when the orchestrator should wake —
it never stores its own copy of the rule.

## Technical summary

Additive `recurrence.kind: "rrule"` on `task_loop/v0`. Module `lib/task/task-loop-rrule.mjs`
(validates, projects next occurrence, maps to `occurrence_key`) lands in 2G-f-b. Write proposals
(2G-d) reject invalid RRULE at propose time when writes gate on. Read list/get returns recurrence
as stored; invalid legacy rows return `recurrence_validation_error` on detail get only.

---

## Recurrence shape — `rrule` kind

| Field | Type | Req | Description |
| --- | --- | --- | --- |
| `kind` | const | yes | `"rrule"` |
| `rrule` | string | yes | RFC 5545 RRULE value (no `RRULE:` prefix) |
| `dtstart` | ISO8601 | yes | Series anchor instant |
| `anchor_tz` | IANA string | yes | Must equal series `timezone` |
| `exdates` | ISO8601[] | no | Skipped occurrence instants |
| `source_ical` | string | no | Optional preserved import for audit |

Existing kinds (`cron`, `interval`, `manual`, `on_wake`) unchanged — see 2G-c store contract §1.1.

---

## Validator rules (v0 subset)

Export: `validateTaskLoopRrule(recurrence, seriesTimezone): ValidationResult`

| Rule | Behavior |
| --- | --- |
| DTSTART | Required; must parse as ISO8601 |
| Timezone | `anchor_tz` must match series `timezone` |
| FREQ | One of `DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY` |
| INTERVAL | Optional; default 1; must be ≥ 1 |
| BYDAY | Allowed with `WEEKLY` / `MONTHLY` only |
| BYMONTHDAY | Allowed with `MONTHLY` / `YEARLY` only |
| COUNT | Optional; integer ≥ 1 |
| UNTIL | Optional on RRULE; must not conflict with series `until_at` |
| Rejected tokens | `BYSETPOS`, `BYHOUR`, `BYMINUTE`, `BYYEARDAY`, `WKST`, `EXRULE` |
| exdates | Each must parse; must not duplicate |

Invalid input → `{ ok: false, code: "invalid_rrule", detail: "<token>" }` — no canonical write.

---

## Occurrence projection

Export: `projectNextOccurrence(recurrence, series, afterInstant): OccurrenceProjection | null`

| Output | Description |
| --- | --- |
| `occurrenceAt` | ISO8601 next valid instant after `afterInstant` |
| `occurrenceKey` | Stable string — e.g. `2026-W25`, `2026-06-24`, per FREQ policy table |
| `skippedExdates` | Count of exdates between anchor and result |

Lazy materialization (OD-3) uses projection output for write proposals (2G-d).

### Occurrence key policy (v0)

| FREQ | Key format example |
| --- | --- |
| `WEEKLY` | `2026-W25` (ISO week in series TZ) |
| `DAILY` | `2026-06-24` |
| `MONTHLY` | `2026-06` or `2026-06-24` when BYMONTHDAY set |
| `YEARLY` | `2026` or `2026-06-24` when BYMONTHDAY set |

---

## Store module extension (2G-f-b)

`lib/task/task-loop-store.mjs` — additive:

- Accept `rrule` recurrence in fixture seed data (school-trip + `loop_weekly_checkin`).
- `getTaskLoop` returns recurrence verbatim; runs validator on read for `mode: "validate"`.
- No Hub/CLI/MCP route changes in 2G-f-b (routes land with `TASK_LOOP_LIVE_READ` Tier 3).

---

## Posture

| Constant | Location | Value |
| --- | --- | --- |
| `TASK_LOOP_RRULE_ENABLED` | `lib/task/task-loop-rrule.mjs` | `false` until Tier 3 |

When false: validator runs on fixtures/tests only; live store rejects `rrule` kind on write proposals.

---

## Seven-tier test matrix (Knowtation 2G-f-b)

| Tier | File | Focus |
| --- | --- | --- |
| unit | `test/task-loop-rrule-validator.test.mjs` | Subset accept/reject matrix |
| unit | `test/task-loop-rrule-projection.test.mjs` | Next occurrence + occurrence_key |
| integration | `test/task-loop-rrule-store.test.mjs` | Fixture series read with rrule kind |
| data-integrity | `test/task-loop-rrule-tz.test.mjs` | DST boundary occurrence keys |
| security | `test/task-loop-rrule-security.test.mjs` | Injection in rrule string; oversized input |

---

## Acceptance (2G-f-a)

- [x] `rrule` recurrence wire shape frozen.
- [x] v0 RRULE subset + validator rules documented.
- [x] Occurrence projection + key policy documented.
- [ ] 2G-f-b implements `task-loop-rrule.mjs` + store fixture + tests.

## Non-goals

- Full RFC 5545 parser library vendoring decision (2G-f-b chooses impl).
- iCal file import endpoint.
- Hosted canister RRULE index.

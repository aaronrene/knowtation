# Calendar Events v0 Spec

## Simple Summary

Calendar Events v0 is the Knowtation-side contract for **synced external calendar events**,
**timeline queries**, **multi-calendar toggles**, and **tiered agent calendar context**.

Knowtation Hub already has a **note calendar** (month grid by note `date`). This spec adds a
separate **event store** and **CalendarConnector** layer. Scooling surfaces the unified timeline
through `CalendarAdapter`; agents read calendar context only through scoped retrieval at an
explicit tier — never from provider APIs directly.

Scooling plan: `scooling/docs/CALENDAR-AND-SCHEDULE-PLAN.md` (separate repo).

Status: **Phase 1A–1B+ landed on `feat/calendar-events-v0` (self-hosted Hub). Phase 1C+ not authorized until next gate.**

---

## Technical Summary

- **Canonical owner:** Knowtation (events, connector tokens, sync cursors, agent tier policy).
- **Scooling:** display filters, setup wizard UX, `CalendarAdapter` delegation only.
- **Default:** read-only external sync; Tier **0** agent access for new calendars until user opts in.
- **Separate toggles per calendar:** `enabled_for_display` vs `enabled_for_agents` (independent).

---

## Relationship To Existing Work

### Hub note calendar (unchanged)

The Hub **Calendar** browse mode (`HUB-API.md` §4) remains **notes by date**. Calendar Events v0
does not replace it. Timeline API **merges** note-date buckets + event records when requested.

### Import connectors

Calendar sync extends the Phase 3A connector pattern (`ONBOARDING-WIZARD` / import consent). New
`source_type` values require updates to `lib/import-source-types.mjs` when ICS file import ships.

### Agent retrieval

Calendar fields are **untrusted prompt content** (same as note bodies). Agent tier caps are enforced
in Knowtation retrieval policy + Scooling `WorkspaceScopeAdapter`.

### Memory consolidation daemon

The consolidation daemon (`DAEMON-CONSOLIDATION-SPEC.md`) does **not** ingest calendar titles into
memory. User-approved notes linked to events may enter the vault via review tray only.

---

## Core Types (v0 draft)

### `CalendarConnector`

| Field | Type | Description |
| --- | --- | --- |
| `connector_id` | string | Stable id |
| `vault_id` | string | Scoped vault |
| `provider` | enum | `ics_file`, `ics_url`, `google`, `microsoft` (latter two later) |
| `display_name` | string | User label |
| `oauth_ref` | string? | Encrypted token handle — never returned to clients |
| `sync_cursor` | string? | Provider sync token |
| `last_sync_at` | ISO8601? | |
| `last_sync_error` | enum? | Bounded error code only |
| `revoked_at` | ISO8601? | Revoke deletes synced events per policy |

### `SourceCalendar`

One row per sub-calendar within a connector (e.g. Google “Work”, “Personal”).

| Field | Type | Description |
| --- | --- | --- |
| `source_calendar_id` | string | Provider calendar id |
| `connector_id` | string | Parent |
| `display_name` | string | |
| `color` | string? | Hex or token |
| `user_group` | enum? | `personal`, `work`, `school`, `other` — user-assigned |
| `enabled_for_sync` | boolean | Fetch events |
| `enabled_for_display` | boolean | Show on Scooling/Knowtation timeline |
| `enabled_for_agents` | boolean | Allow agent retrieval |
| `agent_context_tier_max` | 0–4 | Cap for this calendar (default **0**) |

### `CalendarEvent`

| Field | Type | Description |
| --- | --- | --- |
| `event_id` | string | Stable Knowtation id |
| `source_calendar_id` | string | |
| `external_uid` | string | Provider uid for dedup |
| `start` | ISO8601 | UTC instant |
| `end` | ISO8601 | UTC instant |
| `timezone` | string | IANA |
| `summary` | string? | Redacted in tier 0–1 agent responses |
| `busy` | boolean | Free/busy for tier 1 |
| `status` | enum | `confirmed`, `cancelled`, `tentative` |
| `recurrence_rule` | string? | Deferred expansion policy — see open decisions |
| `linked_note_paths` | string[]? | Tier 3 user links |
| `deleted_at` | ISO8601? | Tombstone on provider delete or revoke |

---

## Agent Context Tiers

| Tier | Agent-visible fields |
| --- | --- |
| **0** | None from this calendar |
| **1** | `start`, `end`, `busy` — no title |
| **2** | Tier 1 + `summary` + `user_group` / calendar label |
| **3** | Tier 2 + `linked_note_paths` |
| **4** | Tier 3 + location/description (attendees redacted) — separate consent gate |

Retrieval API must accept `agent_context_tier` and `source_calendar_ids[]` and enforce caps server-side.

---

## API Surfaces (v0 — self-hosted Hub)

### `GET /api/v1/calendar/timeline` (**shipped — self-hosted**)

Query: `from`, `to`, `vault_id`, `layers[]`, `source_calendar_ids[]`, `workspace_id?`

Layers: `notes`, `events`, `tasks` (Phase 2G), `agent_runs` (Scooling metadata passthrough optional).

Response: merged, sorted slices with `kind` discriminator per item. No OAuth tokens.

### Calendar API (self-hosted Hub)

**Shipped (1B):**

- `GET /api/v1/calendar/timeline` — merged note-date + event slices
- `POST /api/v1/calendar/events/import` — one-time ICS text import (read-only)
- `GET /api/v1/calendar/source-calendars` — list toggles (no OAuth secrets)
- `PATCH /api/v1/calendar/source-calendars/:id` — update display/agent toggles, tier cap, user_group

**Deferred (1C+):**

- `POST /api/v1/calendar/connectors` — begin connect (OAuth redirect or ICS URL)
- `GET /api/v1/calendar/connectors` — status, sub-calendars, toggles
- `POST /api/v1/calendar/connectors/:id/sync` — manual refresh (rate-limited)
- `DELETE /api/v1/calendar/connectors/:id` — revoke + delete copied events

MCP/CLI parity deferred to separate phase after Hub REST is proven.

---

## UI Filter Presets (Scooling — consumer)

Scooling maps presets to `layers` + `source_calendar_ids`:

| Preset | layers | notes |
| --- | --- | --- |
| **Notes only** | `notes` | Hub parity |
| **Schedule** | `events`, `tasks`, `agent_runs` | notes optional |
| **Everything** | all enabled | |
| **Learning focus** | `notes`, `tasks`, workspace | external events off |

---

## Security Gates (must pass before implementation)

- Read-only OAuth scopes first.
- Revoke → delete events within documented SLA.
- Student personal calendars: not visible to teacher agents or roster.
- Org/minor policy may cap `agent_context_tier_max` at 0 or 1.
- No calendar content in billing, public social, or unscoped MCP resources.
- Seven-tier tests: scope, revoke, timezone boundaries, tier enforcement, injection fixtures.

### Phase 0 security checklist (signed off 2026-06-18)

| # | Gate | Status | Notes |
| --- | --- | --- | --- |
| 1 | Read-only OAuth scopes first (Google/Microsoft deferred to 1D) | **Accepted** | ICS file/URL are read-only by definition |
| 2 | Revoke → delete synced events within documented SLA | **Accepted** | Target: 24h; enforced in connector lifecycle (1B+) |
| 3 | Student personal calendars never visible to teacher/class agents | **Accepted** | Workspace scope + `enabled_for_agents=false` default |
| 4 | Org/minor policy may cap `agent_context_tier_max` at 0 or 1 | **Accepted** | Hub policy layer in 1E |
| 5 | No calendar content in billing, public social, or unscoped MCP | **Accepted** | Tokens never in API responses; tier redaction server-side |
| 6 | Calendar text is untrusted prompt content (injection threat model) | **Accepted** | Same handling as note bodies; tier 0–1 redacts `summary` |
| 7 | `enabled_for_display` and `enabled_for_agents` are independent | **Accepted** | Defaults: display **on**, agents **off**, tier **0** |
| 8 | Seven-tier test matrix before connector/network code | **Accepted** | Phase 1A: unit tests only; tiers 2–7 at 1B–1E |

**Default for new `SourceCalendar` (agreed — not open):**

| Field | Default |
| --- | --- |
| `enabled_for_sync` | `true` |
| `enabled_for_display` | `true` |
| `enabled_for_agents` | `false` |
| `agent_context_tier_max` | `0` |

Canonical implementation: `lib/calendar/source-calendar-defaults.mjs`.

---

## Implementation Phases

| Phase | Deliverable |
| --- | --- |
| **0** | This spec + security checklist (**done**) |
| **1A** | Pure event normalizer + ICS parse (no network) (**done**) |
| **1B** | Local event store + timeline merge with note dates (self-hosted Hub) (**done**) |
| **1B+** | `PATCH /api/v1/calendar/source-calendars/:id` — display/agent toggles (**done**) |
| **1C** | ICS URL subscription sync (read-only) |
| **1D** | Google read OAuth connector |
| **1E** | Agent tier enforcement in retrieval API |
| **1F** | Scooling `CalendarAdapter` live read |

Hosted canister parity follows self-hosted proof — not blocked on MuseHub staging for local dev.

---

## Open Decisions

1. Recurring events: expand at sync vs query time.
2. Sync horizon: recommend 90 days past / 365 days future.
3. Unified timeline endpoint vs client merge (recommend server merge).
4. ~~Default for new `SourceCalendar`~~ — **Resolved:** `enabled_for_display=true`, `enabled_for_agents=false`, `agent_context_tier_max=0` (see security checklist).

---

## Non-Goals (v0)

- Two-way write to Google/Outlook (invites, study blocks) — separate gate.
- EventKit device sync — Apple client track.
- Auto-link every meeting to learning notes.
- Agents with full calendar access by default.

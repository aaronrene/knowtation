# Calendar OAuth Connector — Phase 1D Frozen Spec (Google read-only)

Status: **FROZEN spec (step 11a, Thinking tier) — 2026-07-05. Build = step 11b (Auto).**
No code, no OAuth client registration change, and no network in this document. Implementation is
gated behind `CALENDAR_OAUTH_GOOGLE_AUTHORIZED` (hard-coded `false`) until seven-tier smokes pass
and an operator flips the Tier 3 gate.

Parent spec: `docs/CALENDAR-EVENTS-V0-SPEC.md` (Phase 1D row). Scooling consumer contract:
`scooling/docs/CALENDAR-OAUTH-CONNECTOR-STEP-11-CONTRACT.md`. Product plan:
`scooling/docs/CALENDAR-AND-SCHEDULE-PLAN.md`.

---

## Simple summary

A user connects their **Google Calendar** to Knowtation so their meetings show up on the Scooling
schedule next to their notes. Knowtation only ever **reads** the calendar (never writes), stores the
connection secret **encrypted**, and the user can **disconnect** at any time — which deletes the
copied events. Agents get **no** access to these events until the user explicitly opts in, one
calendar at a time.

## Technical summary

Phase 1D adds a **server-side, read-only Google Calendar OAuth 2.0 connector** to Knowtation
(canonical owner of tokens and events). It reuses the repo's hardened OAuth primitives — the pure
PKCE core (`lib/companion-oauth-pkce.mjs`: S256-only, CSRF `state`, constant-time compares,
fail-closed) and the AES-256-GCM + scrypt encryption-at-rest pattern
(`lib/memory-provider-encrypted.mjs`) — rather than introducing new crypto. Scooling initiates
consent and shows status only; it never holds a token and never calls Google directly.

This freeze resolves the deferred `CalendarConnector` endpoints (spec §"Deferred (1C+)") for the
**`google`** provider only. ICS URL subscription (1C) is a **separate** freeze and is out of scope
here.

---

## Design decisions frozen in this spec

| # | Decision | Frozen value | Rationale |
| --- | --- | --- | --- |
| D1 | OAuth client type | **Confidential web application client + PKCE (S256)** | Hub is a server; `client_secret` stays server-side. PKCE is defense-in-depth per repo convention. |
| D2 | Scopes (least privilege) | `openid`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, `https://www.googleapis.com/auth/calendar.events.readonly` | Two granular **read-only** scopes; `openid` yields a stable `sub` for per-account dedup. **No** `email`/`profile`, **no** broad `calendar.readonly`, **no** write scope. |
| D3 | Refresh token acquisition | `access_type=offline`, `prompt=consent` | Needed for background/incremental sync without re-login. |
| D4 | Token storage | Refresh token **encrypted at rest** (AES-256-GCM, scrypt key from `KNOWTATION_CALENDAR_OAUTH_SECRET` + per-connector salt). Access tokens **in-memory only** during a sync run. | Matches `memory-provider-encrypted.mjs`. `oauth_ref` is an opaque handle; the token is never persisted in plaintext, never returned to clients, never logged. |
| D5 | Recurring events | **Expand at fetch** via Google `events.list?singleEvents=true&orderBy=startTime`; store instances; `recurrence_rule = null` on instances | Avoids building an RRULE engine in v0; read-only path stays simple. |
| D6 | Sync horizon | **90 days past / 365 days future** (`timeMin`/`timeMax`) | Resolves V0 spec open decision #2/#3. Bounds storage and Google quota. |
| D7 | Incremental sync | `syncToken` per source calendar, stored in `sync_cursor`; full re-list on `410 Gone` | Standard Google incremental sync; bounded work per run. |
| D8 | PII minimization on normalize | Store only `start`, `end`, `timezone`, `summary`, `busy`, `status`, `external_uid`. **Drop** attendees, organizer, location, description, conferencing links, attachments | Tiers 0–2 never expose those anyway; not storing them removes the PII/injection surface entirely for v0. |
| D9 | New-calendar defaults | `enabled_for_sync=true`, `enabled_for_display=true`, `enabled_for_agents=false`, `agent_context_tier_max=0` | Reuses `lib/calendar/source-calendar-defaults.mjs` — agents off until explicit opt-in. |
| D10 | Revoke deletion SLA | **24h** (immediate best-effort purge + reconciliation sweep) | Matches V0 security checklist gate #2. |
| D11 | Google app verification posture | v0 runs in Google **"testing"** mode with allowlisted test users; production/public launch requires Google OAuth verification (sensitive-scope review) — a **separate** later gate | Read-only calendar scopes are "sensitive"; testing mode is sufficient for smoke + staging. |
| D12 | Deployment key ownership | Hosted Knowtation uses its **verified** OAuth app; self-hosted operators register **their own** Google Cloud client and supply `GOOGLE_CALENDAR_OAUTH_CLIENT_ID`/`_SECRET` | Keeps hosted verification separate from self-hosted autonomy. |

---

## OAuth flow (server-side authorization code + PKCE)

```text
Scooling wizard "Connect Google Calendar"
   │  CalendarAdapter.beginConnect('google', return_url)
   ▼
POST /api/v1/calendar/connectors  { provider:'google', display_name?, return_url }
   │  Knowtation: create PENDING connector; generate PKCE (S256) + state (CSPRNG, TTL 10m,
   │  bound to vault_id + connector_id + return_url); persist verifier+state server-side.
   ▼  { connector_id, authorization_url, expires_at }   (no secrets in URL beyond standard params)
Scooling opens authorization_url in the system browser
   ▼
Google consent screen (read-only scopes, offline)
   ▼  redirect to Knowtation callback (server-to-server code exchange)
GET /api/v1/calendar/connectors/callback?code=&state=
   │  validate state (constant-time, single-use, not expired, matches connector)
   │  exchange code + code_verifier + client_secret at token endpoint (server-side TLS)
   │  encrypt refresh_token → oauth_ref; DISCARD plaintext; access token kept in memory
   │  calendarList.list → create SourceCalendar rows (D9 defaults)
   │  initial events.list per calendar (D5/D6) → normalize (D8) → event store
   ▼  302 to allowlisted Scooling return_url  (NO token, NO code in the redirect)
Scooling shows connected account + sub-calendars (display on, agents off)
```

Redirect-URI and `return_url` are **exact-match allowlisted** (env `CALENDAR_OAUTH_REDIRECT_URI`,
`SCOOLING_RETURN_URL_ALLOWLIST`). Open redirects are rejected fail-closed.

---

## Data model additions

Extends `CalendarConnector` (V0 spec) for `provider='google'`. No client-visible field changes.

| Field | Type | Notes |
| --- | --- | --- |
| `provider` | `'google'` | Adds to existing enum (`ics_file`, `ics_url`, `google`, `microsoft`). |
| `oauth_ref` | string? | Opaque handle → encrypted blob file. **Never** returned to clients. |
| `account_sub` | string? | Google OpenID `sub` — dedup connectors per account; **not** an email. |
| `sync_cursor` | string? | Per-connector or per-source-calendar `syncToken` (impl detail). |
| `last_sync_at` | ISO8601? | Existing. |
| `last_sync_error` | enum? | Bounded codes only: `auth_expired`, `rate_limited`, `provider_error`, `network_error`, `none`. **No** provider text. |
| `revoked_at` | ISO8601? | Set on revoke; connector kept as tombstone (no tokens). |

**Encrypted blob** (`data/calendar_oauth/{connector_id}.enc`, gitignored + museignored):
`{ refresh_token, scope, token_type, obtained_at, account_sub }`, AES-256-GCM, per-connector salt.
`client_id`/`client_secret` come from env, are **never** written to the blob or store.

New module: `lib/calendar/oauth-token-vault.mjs` (encrypt/decrypt round-trip; injected secret; pure
crypto, no logging) + `lib/calendar/google-event-normalizer.mjs` (pure Google event → `CalendarEvent`,
no network; mirrors `ics-normalizer.mjs`).

---

## Connector API (freezes V0 §"Deferred (1C+)" for `google`)

All routes under existing `app.use('/api/v1/calendar', jwtAuth, apiLimiter, requireVaultAccess)`.
All fail-closed when `CALENDAR_OAUTH_GOOGLE_AUTHORIZED` is `false` → `501 { code:'NOT_AUTHORIZED' }`.

| Method / route | Role | Request | Response (no secrets) |
| --- | --- | --- | --- |
| `POST /calendar/connectors` | editor, admin | `{ provider:'google', display_name?, return_url }` | `{ connector_id, authorization_url, expires_at }` |
| `GET /calendar/connectors/callback` | (state-authenticated) | `?code=&state=` | `302` → allowlisted `return_url`; on failure `302` → `return_url?connect=error&reason=<enum>` |
| `GET /calendar/connectors` | viewer+ | — | `{ schema:'knowtation.calendar_connectors/v0', connectors:[{ connector_id, provider, display_name, status, last_sync_at, last_sync_error, source_calendar_count }] }` |
| `POST /calendar/connectors/:id/sync` | editor, admin | — | `{ synced, updated, tombstoned, last_sync_at }` — **rate-limited** ≥60s/connector |
| `DELETE /calendar/connectors/:id` | editor, admin | — | `{ revoked:true, events_deleted, sla_hours:24 }` |

`status` enum: `pending`, `connected`, `needs_reauth`, `revoked`.

### Revoke sequence (`DELETE /connectors/:id`)

1. Decrypt `oauth_ref`; call Google revocation endpoint `https://oauth2.googleapis.com/revoke`
   with the refresh token (best-effort; treat network failure as non-fatal to local purge).
2. Delete the encrypted blob file.
3. Delete **all** events whose `source_calendar_id` belongs to this connector (immediate).
4. Set `revoked_at`, `status=revoked`; keep a token-free tombstone record for audit.
5. Reconciliation sweep guarantees purge within the **24h** SLA if step 3 partially failed.

`invalid_grant` on refresh (user revoked at Google) → set `status=needs_reauth`,
`last_sync_error=auth_expired`, **stop** sync. Events are **not** auto-deleted on reauth-needed
(user may reconnect); a hard `DELETE` is required to purge.

---

## Security invariants (must hold — enforced, not documented-only)

- **No secret/PII egress.** Tokens, `client_secret`, authorization codes, `code_verifier`, `state`,
  and attendee/organizer data never appear in responses, redirects, logs, error messages,
  provenance, projections, or MCP resources. Errors carry fixed enum codes only.
- **State/CSRF.** `state` is CSPRNG, single-use, TTL 10m, bound to `vault_id`+`connector_id`+`return_url`,
  compared constant-time (reuse `companion-oauth-pkce` validators). Replay, tamper, and expiry → deny.
- **PKCE S256 only.** `plain` is rejected everywhere.
- **Redirect allowlist.** `redirect_uri` and `return_url` exact-match allowlisted; no open redirect.
- **Read-only scopes only** (D2). Any write scope is a separate future gate.
- **Untrusted content.** `summary` is untrusted prompt content; existing tier redaction (0–1 hide
  `summary`) and agent-context caps (`enabled_for_agents=false`, tier 0 default) apply unchanged.
- **Least data.** D8 drops attendees/location/description — they are never fetched into storage.
- **Server-only provider calls.** Scooling never calls Google; agents never call Google.
- **Backoff.** Respect Google `429`/`403 rateLimitExceeded` with exponential backoff + `Retry-After`.
- **Gate off = inert.** With `CALENDAR_OAUTH_GOOGLE_AUTHORIZED=false`, no network, no token I/O; all
  connector routes return `501 NOT_AUTHORIZED`.

### Environment (secrets — never committed)

| Var | Purpose |
| --- | --- |
| `CALENDAR_OAUTH_GOOGLE_AUTHORIZED` | Tier 3 gate; default `false` in code. |
| `GOOGLE_CALENDAR_OAUTH_CLIENT_ID` | OAuth client id (server). |
| `GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET` | OAuth client secret (server-only). |
| `KNOWTATION_CALENDAR_OAUTH_SECRET` | Encryption secret for the refresh-token vault (≥ 32 chars). |
| `CALENDAR_OAUTH_REDIRECT_URI` | Exact Google-registered callback URL. |
| `SCOOLING_RETURN_URL_ALLOWLIST` | Comma-separated exact `return_url` allowlist. |

`.gitignore` + `.museignore` must exclude `data/calendar_oauth/` and any `*.enc` token blobs.

---

## Seven-tier test matrix (Knowtation — 11b Definition of Done)

All network is faked via an **injected Google client** (token endpoint + `calendarList.list` +
`events.list` doubles). No live Google call in CI. Live smoke is operator-run behind the gate.

| Tier | File (suggested) | Coverage |
| --- | --- | --- |
| **1 unit** | `test/calendar-oauth-connector-unit.test.mjs` | PKCE/state build+validate; `oauth-token-vault` encrypt/decrypt round-trip + tamper→fail; `google-event-normalizer` field mapping + D8 field-drop; SourceCalendar default creation (D9). |
| **2 integration** | `test/calendar-oauth-connector-integration.test.mjs` | Full lifecycle over fake Google client: `POST /connectors` → callback (state valid) → calendarList→SourceCalendars → initial sync → `GET /connectors` → `POST …/sync` incremental (`syncToken`) → `DELETE`. |
| **3 e2e** | `test/calendar-oauth-connector-e2e.test.mjs` | Hub route walkthrough with fake provider: connect → timeline shows Google events (display on) → revoke purges → timeline empty; `needs_reauth` on `invalid_grant`. |
| **4 stress** | `test/calendar-oauth-connector-stress.test.mjs` | Many calendars/events, paginated `calendarList`/`events.list`; repeated + concurrent `/sync` respect rate limit; `410 Gone` triggers full re-list without duplicates. |
| **5 data-integrity** | `test/calendar-oauth-connector-data-integrity.test.mjs` | Dedup by `external_uid` across repeated syncs (no dupes); cancelled → tombstone; revoke deletes **all** connector events; atomic store writes; encrypted blob survives restart. |
| **6 performance** | `test/calendar-oauth-connector-performance.test.mjs` | Sync N events and timeline query within budget; token decrypt overhead bounded. |
| **7 security** | `test/calendar-oauth-connector-security.test.mjs` | No token/secret/PII in any response/redirect/log/error; state replay+tamper+expiry deny; PKCE `plain` rejected; redirect/return_url allowlist; attendees/location/description never stored; tier redaction holds for Google events; `DELETE` calls Google revoke; injection fixtures (malicious `summary`) stay untrusted; gate off → `501`, no network. |

Test command: `node --test test/calendar-oauth-connector-*.test.mjs`.

---

## Out of scope (separate freezes / gates)

- ICS URL subscription sync (1C) — separate freeze.
- Microsoft/Outlook OAuth — later provider.
- Write-back (create/update external events, invites) — separate high-risk gate.
- Tier 3–4 agent detail (location/description) — separate consent gate.
- Google app **verification** for public launch — separate operator/legal gate (D11).
- MCP/CLI connector parity — after Hub REST is proven.

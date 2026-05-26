# SectionSource Hub UI Implementation Spec

## Simple Summary

Phase 1O specifies how the Hub UI may later consume body-free SectionSource metadata.

This phase is planning only. It does not add Hub UI components, JavaScript, CSS, templates,
API calls, canister routes, search, persistence, Scooling runtime behavior, section bodies,
snippets, summaries, PageIndex, OCR, LLM calls, provider routing, MCP resources, or
write-back behavior.

## Technical Summary

The future Hub UI may call the accepted body-free REST endpoint:

```text
GET /api/v1/section-source?path=<vault-relative-note-path>
```

The UI may render only the `knowtation.section_source/v0` allowlist. Heading text and
heading paths are private, untrusted note-derived source material. They must be displayed
as inert text only, never executed as instructions, HTML, code, routing data, provider
requests, write-back approvals, or telemetry payloads.

## Planning Decision

Phase 1O accepts the Hub UI implementation specification only.

It does not approve:

- adding Hub UI runtime code
- adding Hub UI components
- adding Hub UI templates
- adding Hub UI JavaScript API calls
- adding Hub UI CSS
- adding canister routes
- adding search, vectors, indexes, persistence, sidecars, summaries, or memory events
- adding Scooling runtime behavior
- returning or displaying note body text
- returning or displaying section body text
- returning or displaying snippets or source excerpts
- returning or displaying full frontmatter
- returning or displaying line ranges, byte offsets, or section body lengths
- returning or displaying absolute paths, raw canister payloads, provider payloads, or MCP
  resource URIs
- calling PageIndex, OCR, LLMs, or external providers
- adding provider routing or write-back behavior

## Future UI Entry Point

A later UI runtime phase may add a SectionSource affordance to an existing note detail or
document navigation context.

The future UI must not make SectionSource the default note body view. SectionSource is a
body-free structural aid for choosing sections, not a replacement for authorized note
reading.

## UI Auth And Session Expectations

The future UI must rely on existing Hub session behavior:

- The browser must already be authenticated to the Hub.
- The request must use the same JWT/cookie/session path used by adjacent Hub REST calls.
- The UI must not store or display bearer tokens.
- The UI must not accept user id, role, canister user id, vault access, provider, body,
  snippet, line range, byte offset, or search options from user-editable UI state.
- `401` responses must show a generic sign-in/session-expired state without note details.
- `403` responses must show a generic unavailable/unauthorized state without confirming
  another user's or vault's content.

## Active Vault Boundary

The future UI must use the active Hub vault selected by the existing Hub vault switcher or
session context.

Rules:

- The UI must not let a SectionSource widget override `X-Vault-Id` independently of the
  existing active vault state.
- The displayed path must be the response's normalized vault-relative `path`.
- The UI must not display canister storage keys, absolute filesystem paths, or raw upstream
  paths.
- If the active vault changes while a request is in flight, stale responses must be ignored
  or revalidated before display.

## API Call Shape

The future UI may call:

```text
GET /api/v1/section-source?path=<encodeURIComponent(path)>
```

Call rules:

- The UI sends one vault-relative note path.
- The UI must not send a request body.
- The UI must not batch paths.
- The UI must not add body, snippet, search, filter, ranking, provider, resource, line
  range, byte offset, classroom, or write-back options.
- The UI must treat all failed responses as non-authoritative and must not fall back to
  parsing Markdown client-side.

## Rendering Allowlist

The future UI may render only body-free `knowtation.section_source/v0` fields.

Allowed top-level fields:

- `schema`
- `path`
- `title`
- `sections`
- `truncated`

Allowed section fields:

- `section_id`
- `heading_id`
- `level`
- `heading_path`
- `heading_text`
- `child_section_ids`
- `body_available`
- `body_returned`
- `snippet_returned`

Rendering rules:

- `schema` must be exactly `knowtation.section_source/v0`.
- `body_returned` must be `false`.
- `snippet_returned` must be `false`.
- Heading text and heading paths must be rendered as escaped text.
- The UI must not derive snippets from hidden note bodies.
- The UI must not display body availability as permission to fetch or reveal body text.

## Explicitly Excluded UI Display

The future UI must not display:

- note body text
- section body text
- snippets
- source excerpts
- full frontmatter
- line ranges
- byte offsets
- section body lengths
- absolute filesystem paths
- raw canister paths
- raw canister payloads
- provider payloads
- provider keys
- rendered HTML from note content
- summaries
- vector scores
- search results
- persistence ids
- sidecar paths
- memory events
- MCP resource URIs
- PageIndex output
- OCR text
- media metadata
- Scooling adapter state
- classroom policy state

## Loading, Empty, And Error States

The future UI must define bounded states:

- Loading: show generic progress without note body previews.
- Empty: show that no headings/sections are available, without fetching body text.
- Truncated: show that the section list is capped, without suggesting hidden content was
  read.
- Invalid path: show a generic unavailable state.
- Missing note: show a generic not-found state.
- Unauthorized note: show a generic unavailable state.
- Upstream failure: show a retry-safe generic failure state.

Error states must not display raw upstream payloads, requested unsafe paths, tokens, headers,
absolute paths, frontmatter, note bodies, snippets, provider payloads, or MCP resource URIs.

## Prompt-Injection Handling

Every rendered text field is untrusted:

- `title`
- `heading_text`
- `heading_path`

Prompt-like headings that ask a model, browser, extension, or user to reveal secrets, bypass
review, call providers, alter grades, disable guardrails, or write notes must remain inert
text. The UI must not interpret headings as commands, HTML, Markdown-to-HTML instructions,
JavaScript, prompt prefill, system messages, tool arguments, or approval decisions.

## Logging And Telemetry Exclusions

The future UI must not log or send telemetry containing:

- note body text
- section body text
- snippets
- full frontmatter
- heading text
- heading paths
- raw canister payloads
- requested unsafe paths
- absolute paths
- bearer tokens
- gateway secrets
- provider payloads
- MCP resource URIs

Bounded telemetry may include only:

- route name
- sanitized outcome class
- elapsed time bucket
- section count bucket
- truncated flag

## Deletion, Export, And Staleness

The future UI must treat SectionSource as on-demand derived display state.

Until a separate persistence spec is accepted:

- no UI cache is source of truth
- no SectionSource sidecar is created
- no SectionSource index is created
- no vector record is created
- no memory event is created
- no summary record is created
- no provider record is created
- no Scooling record is created
- export behavior remains unchanged
- deleting a note leaves no SectionSource-derived Hub UI artifact to delete
- editing a note must invalidate any visible stale SectionSource display for that note

## Accessibility Expectations

The future UI must be accessible before implementation is accepted:

- Section hierarchy must be navigable by keyboard.
- Heading levels must be conveyed without relying only on color or indentation.
- Loading, empty, truncated, and error states must have readable text.
- The UI must preserve focus when refreshing SectionSource data.
- Controls must have accessible names.
- Long heading paths must remain readable without exposing hidden body content.

## No Write-Back Behavior

SectionSource UI consumption must not grant write permissions.

The future UI must not:

- create notes
- update notes
- approve proposals
- discard proposals
- change learner memory
- alter classroom records
- write educator feedback
- trigger Scooling write-back
- generate summaries or snippets
- call providers

## Scooling Consumption Boundary

This phase does not add Scooling runtime behavior.

Future Scooling consumption must remain behind Scooling-owned adapter boundaries. Hub UI
SectionSource rendering must not become Scooling's canonical parser, section id generator,
authorization owner, persistence source of truth, provider router, or write-back gate.

## Seven-Tier Test Requirements

### Unit

- The spec documents auth/session, active vault, API call, rendering allowlist, states,
  errors, prompt-injection, logging, lifecycle, accessibility, write-back, and Scooling
  boundaries.
- The render allowlist matches body-free `SectionSource v0`.
- `body_returned` and `snippet_returned` remain false.

### Integration

- No Hub UI runtime API call, component, template, JS, or CSS is added in this planning
  phase.
- REST `GET /api/v1/section-source` remains available.
- Hosted MCP `get_section_source` remains available.
- No canister route is added.

### End To End

- A Hub UI user cannot reach a SectionSource widget in this planning phase.
- Existing Hub UI note, search, settings, and import flows remain unchanged.
- Future UI runtime tests must prove body-free rendering through the accepted REST endpoint.

### Stress

- Planning checks stay bounded to SectionSource docs, Hub UI files, REST route files,
  OpenAPI docs, and contract tests.
- Future UI runtime tests must prove large section lists remain capped and render without
  body text.
- Future UI runtime tests must prove repeated refreshes do not leak stale active-vault data.

### Data Integrity

- This planning phase writes no notes, UI state stores, sidecars, indexes, vectors, memory,
  summaries, provider records, Scooling records, or canister state.
- Future UI runtime must not persist SectionSource as truth.
- Export, delete, edit, backup, and restore behavior remain unchanged in this phase.

### Performance

- Future UI calls must request one note only.
- Future UI calls must not scan the whole vault.
- Future UI calls must not call bridge search.
- Future UI calls must not call external providers.
- Rendering size must remain bounded by accepted SectionSource caps.

### Security

- Hub UI exposure remains blocked in this phase.
- No note body text appears in future SectionSource UI output.
- No section body text appears in future SectionSource UI output.
- No snippets appear in future SectionSource UI output.
- No full frontmatter appears in future SectionSource UI output.
- No absolute filesystem paths appear in future SectionSource UI output or errors.
- No raw canister payload appears in future SectionSource UI output or errors.
- No provider payload appears in future SectionSource UI output or errors.
- No MCP resource URI appears for SectionSource UI content.
- Search, persistence, Scooling, PageIndex, OCR, LLM, provider, and write-back exposure
  remain blocked.

## Contract Guards

This planning phase must add tests proving:

- this Hub UI spec is complete
- no Hub UI runtime/API call/component/template/JS/CSS surface is added yet
- REST `GET /api/v1/section-source` remains available
- hosted MCP `get_section_source` remains available
- no search, persistence, Scooling, body, snippet, provider, or resource surface is added

## Stop Conditions

Stop and re-plan if Hub UI work requires:

- returning or displaying note body text
- returning or displaying section body text
- returning or displaying snippets
- returning or displaying full frontmatter
- returning or displaying exact line ranges
- returning or displaying byte offsets
- returning or displaying section body lengths
- returning or displaying absolute paths
- returning or displaying raw canister payloads
- returning or displaying provider payloads
- returning or displaying MCP resource URIs
- adding canister routes
- adding search, vectors, indexes, persistence, sidecars, summaries, or memory events
- adding Scooling runtime behavior
- calling PageIndex, OCR, LLMs, or external providers
- weakening hosted role ACL, active vault, effective canister user, REST auth, or path
  safety behavior
- logging note content, section content, headings, raw upstream payloads, auth headers,
  gateway secrets, bearer tokens, or provider payloads

## Acceptance Criteria

Phase 1O is accepted when:

- The Hub UI behavior is specified before runtime exposure.
- The future UI call is limited to one vault-relative note path.
- The future UI rendering is limited to body-free `knowtation.section_source/v0` metadata.
- Loading, empty, truncated, missing, unauthorized, invalid, and upstream error states are
  defined.
- Prompt-injection text remains untrusted source material.
- Logging and telemetry exclusions are documented.
- Accessibility expectations are documented.
- Write-back remains blocked.
- Scooling remains a downstream consumer behind its adapter boundary.
- Contract tests prove Hub UI exposure remains absent in this planning phase.
- Contract tests prove REST and hosted MCP SectionSource remain available.
- Contract tests prove no search, persistence, Scooling, body, snippet, provider, or resource
  surface was added.

## Recommendation

Phase 1O is the accepted planning and contract-test phase.

Phase 1P implements the Hub UI runtime that follows this spec. It adds the note detail
drawer Sections action, body-free REST consumption, escaped allowlist rendering, bounded UI
states, and seven-tier runtime tests together. It does not add canister routes, search,
persistence, Scooling runtime behavior, body reads, snippets, summaries, PageIndex, OCR, LLM
calls, provider routing, or write-back behavior.

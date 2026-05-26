# SectionSource Hub REST/OpenAPI Implementation Spec

## Simple Summary

Phase 1M specifies a future Hub REST/OpenAPI surface for body-free SectionSource metadata.

This phase is planning only. It does not add a Hub REST endpoint, OpenAPI schema, Hub UI,
canister route, search mode, persistence, Scooling runtime behavior, section body, snippet,
summary, PageIndex, OCR, LLM call, provider route, MCP resource, or write-back behavior.

## Technical Summary

The future Hub REST surface must mirror the accepted hosted MCP `get_section_source`
runtime, but through a browser/API route instead of MCP. The route must read exactly one
authorized note, derive body-free `knowtation.section_source/v0` metadata in memory, and
return only the SectionSource v0 allowlist.

The future OpenAPI surface may document that route only after the Hub REST implementation is
added and tested.

## Planning Decision

Phase 1M accepts the Hub REST/OpenAPI implementation specification only.

It does not approve:

- adding `GET /api/v1/section-source`
- adding any other Hub REST SectionSource endpoint
- adding OpenAPI paths, tags, schemas, examples, or components for SectionSource
- adding Hub UI calls or display components
- adding canister routes
- adding search, vectors, indexes, persistence, sidecars, summaries, or memory events
- adding Scooling runtime behavior
- returning note body text
- returning section body text
- returning snippets or source excerpts
- returning full frontmatter
- returning line ranges, byte offsets, or section body lengths
- returning absolute paths, raw canister payloads, provider payloads, or MCP resource URIs
- calling PageIndex, OCR, LLMs, or external providers
- adding provider routing or write-back behavior

## Future REST Endpoint

A later runtime phase may propose:

```text
GET /api/v1/section-source?path=<vault-relative-note-path>
```

The endpoint uses a query parameter instead of a path parameter so vault-relative paths with
slashes do not require greedy route matching.

The route must be read-only and must not accept a request body.

## REST Auth Requirements

The future endpoint must require the same Hub API authentication as adjacent note-read
routes:

- `Authorization: Bearer <access_token>` is required.
- Missing, expired, malformed, or invalid JWTs return `401`.
- The caller must have read access to the active vault.
- Viewer-equivalent read roles may call the route only after the route is implemented.
- Write, admin, proposal, evaluator, billing, import, export, and operator permissions must
  not grant additional SectionSource fields.
- The request must not accept client-supplied user id, role, canister user id, vault access,
  provider, resource, body, snippet, line range, byte offset, or search options.

## Active Vault Boundary

The future endpoint must use the active Hub vault boundary:

- Hosted gateway: the active vault comes from `X-Vault-Id` or the session default already
  accepted by Hub gateway note-read routes.
- Self-hosted Hub: the active vault comes from the authenticated Hub context and configured
  local vault access.
- The client cannot read from a different vault by placing a vault id in `path`.
- The returned `path` must be the normalized request path, not an upstream absolute path or
  raw canister/storage key.
- Missing and unauthorized responses must not reveal whether the note exists in another
  vault.

## Effective Canister User Boundary

Hosted Hub REST must use the same effective canister user boundary as adjacent hosted note
routes:

- The gateway resolves the effective canister user from hosted context.
- The canister read sends `X-User-Id` with the effective canister user id.
- The actor user id may be forwarded only as existing Hub audit context where adjacent routes
  already do so.
- The client cannot supply or override the effective canister user id.
- SectionSource output must not mix notes across effective canister users.

Self-hosted Hub has no canister user boundary. It must preserve the local authenticated
vault boundary instead.

## Canister Auth And Header Behavior

Hosted Hub REST must use the same canister note-read behavior as adjacent gateway note
routes:

```text
GET {canisterUrl}/api/v1/notes/{encodeURIComponent(normalizedPath)}
```

Headers:

- `Authorization: Bearer <gateway JWT or trusted upstream token>` when adjacent note-read
  proxy behavior requires it
- `X-Vault-Id: <active vault id>`
- `X-User-Id: <effective canister user id>`
- `X-Gateway-Auth: <configured canister auth secret>` when configured
- `Accept: application/json`

The endpoint must not forward SectionSource-specific options, provider options, Scooling
options, search filters, body flags, snippet flags, line ranges, byte offsets, or resource
URIs upstream.

## One-Note Read Behavior

The future endpoint must perform one note read per request.

Allowed behavior:

- validate auth
- resolve active vault and effective canister user
- normalize and validate one `path`
- read exactly one note
- derive body-free SectionSource metadata in memory
- return JSON

Blocked behavior:

- listing notes
- scanning the whole vault
- calling bridge search
- calling index, vector, PageIndex, OCR, LLM, provider, summary, memory, import, export, or
  write routes
- creating sidecars, indexes, vectors, summaries, memory events, Scooling records, or
  canister state

## Path Normalization And Unsafe Path Rejection

The future endpoint must reject unsafe paths before any upstream note fetch.

The normalization algorithm must:

- require `path` as a query parameter
- require a string
- trim whitespace
- replace backslashes with `/`
- reject empty paths
- reject POSIX absolute paths
- reject Windows absolute paths
- split on `/`
- remove empty segments caused by duplicate slashes
- reject any `..` segment
- join safe segments with `/`

Unsafe path errors must not echo the raw unsafe path.

## Output Allowlist

The future endpoint may return only body-free `knowtation.section_source/v0` output:

```json
{
  "schema": "knowtation.section_source/v0",
  "path": "inbox/example.md",
  "title": "Example",
  "sections": [
    {
      "section_id": "inbox-example-md:h1-example-0001",
      "heading_id": "h1-example-0001",
      "level": 1,
      "heading_path": ["Example"],
      "heading_text": "Example",
      "child_section_ids": [],
      "body_available": true,
      "body_returned": false,
      "snippet_returned": false
    }
  ],
  "truncated": false
}
```

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

Required constants:

- `schema` must be exactly `knowtation.section_source/v0`.
- `body_returned` must be `false`.
- `snippet_returned` must be `false`.

## Explicitly Excluded Output

The future endpoint must not output:

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
- rendered HTML
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

## Error Sanitization

The future endpoint must return the existing Hub JSON error envelope:

```json
{
  "error": "Invalid path",
  "code": "INVALID_PATH"
}
```

Rules:

- Missing `Authorization` returns `401` without note details.
- Missing `path` returns `400` with a generic invalid path code.
- Non-string or empty `path` returns `400`.
- Unsafe paths return `400` before any upstream fetch.
- Missing notes return `404` without note body, frontmatter, headings, or raw upstream body.
- Unauthorized notes return `403` without revealing whether another vault or user can read
  the note.
- Upstream failures return a bounded upstream status class and no raw upstream payload.
- Runtime failures return a generic error and no private content.

Errors must not contain:

- note body text
- section body text
- snippets
- full frontmatter
- heading paths beyond an authorized successful response
- absolute paths
- requested unsafe paths
- raw canister payloads
- auth headers
- bearer tokens
- gateway secrets
- provider payloads
- MCP resource URIs

## Logging Exclusions

The future implementation must not log:

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
- canister auth secrets
- provider payloads
- MCP resource URIs

Bounded operational logs may include only:

- route name
- sanitized outcome class
- sanitized upstream status class
- elapsed time
- section count
- truncated flag

## Deletion, Export, And Staleness

The future endpoint is on-demand and non-persistent.

Until a separate persistence spec is accepted:

- no hosted SectionSource sidecar is created
- no hosted SectionSource index is created
- no vector record is created
- no memory event is created
- no summary record is created
- no provider record is created
- no Scooling record is created
- export behavior remains unchanged
- deleting a note leaves no SectionSource-derived Hub artifact to delete
- editing a note leaves no stale SectionSource-derived Hub artifact to invalidate

## Prompt-Injection Handling

SectionSource text fields are private, untrusted source material:

- `title`
- `heading_text`
- `heading_path`
- future labels, snippets, or section bodies if separately accepted

Prompt-like headings that ask a model to reveal secrets, bypass review, ignore policy, call
providers, exfiltrate learner data, alter grades, or disable guardrails must remain inert
text. They must not become tool instructions, system prompts, routing decisions, provider
requests, write-back approvals, UI actions, or authorization overrides.

## Hosted MCP Parity Boundary

The future Hub REST endpoint must match hosted MCP `get_section_source` for the body-free
data contract, one-note read behavior, active vault boundary, effective canister user
boundary, path safety, and excluded fields.

Parity does not mean adding:

- MCP resource URIs
- MCP prompt behavior
- hosted MCP-only error envelopes
- search behavior
- body reads
- snippets
- write-back behavior

Hosted MCP `get_section_source` remains available in this planning phase.

## Scooling Consumption Boundary

This phase does not add Scooling runtime behavior.

Future Scooling consumption of Hub REST SectionSource may happen only after:

- the Hub REST runtime implementation is accepted and tested
- Scooling calls through a Scooling-owned adapter
- Scooling preserves the body-free `knowtation.section_source/v0` allowlist
- Scooling treats heading text and heading paths as untrusted source material

Scooling must not:

- bypass Knowtation hosted authorization
- parse Markdown as the canonical section parser
- derive canonical section ids
- store SectionSource as truth
- call PageIndex, OCR, LLMs, or external providers to recreate sections
- expose private learner section metadata outside authorized contexts
- request note bodies, section bodies, snippets, resource URIs, provider payloads, line
  ranges, byte offsets, or section body lengths through this endpoint
- use SectionSource reads as write-back approval

## Seven-Tier Test Requirements

### Unit

- The spec documents auth, vault, effective canister user, canister headers, one-note read,
  path safety, output allowlist, error, logging, lifecycle, prompt-injection, hosted MCP
  parity, and Scooling boundaries.
- The future output allowlist matches body-free `SectionSource v0`.
- `body_returned` and `snippet_returned` remain false.
- Invalid path errors do not echo unsafe paths.

### Integration

- No Hub REST route is registered in this planning phase.
- No OpenAPI path, tag, schema, component, or example is added in this planning phase.
- Hosted MCP `get_section_source` remains registered and body-free.
- Future runtime tests must prove canister reads use the active vault and effective canister
  user boundaries.

### End To End

- A REST client cannot call `GET /api/v1/section-source` in this planning phase.
- A hosted MCP client can still call `get_section_source`.
- Future REST runtime tests must prove a client can request one body-free SectionSource
  response only after route and OpenAPI updates are accepted.
- No flow returns note bodies, section bodies, snippets, full frontmatter, provider payloads,
  or resource URIs.

### Stress

- Planning checks stay bounded to SectionSource docs, Hub route files, OpenAPI docs, and
  contract tests.
- Future runtime tests must prove large notes remain capped by heading and text caps.
- Future runtime tests must prove repeated calls for unchanged notes are deterministic.
- No test scans a real vault or calls external providers.

### Data Integrity

- This planning phase writes no notes, sidecars, indexes, vectors, memory, summaries,
  provider records, Scooling records, or canister state.
- Future runtime tests must prove one REST request performs one note read and no writes.
- Export, delete, edit, backup, and restore behavior remain unchanged in this phase.

### Performance

- The future endpoint must read one note only.
- The future endpoint must not scan the whole vault.
- The future endpoint must not call bridge search.
- The future endpoint must not call external providers.
- Output size must remain bounded by accepted SectionSource caps.

### Security

- Hub REST exposure remains blocked in this phase.
- OpenAPI exposure remains blocked in this phase.
- No note body text appears in future SectionSource REST output.
- No section body text appears in future SectionSource REST output.
- No snippets appear in future SectionSource REST output.
- No full frontmatter appears in future SectionSource REST output.
- No absolute filesystem paths appear in future SectionSource REST output or errors.
- No raw canister payload appears in future SectionSource REST output or errors.
- No provider payload appears in future SectionSource REST output or errors.
- No MCP resource URI appears for SectionSource REST content.
- Search, persistence, Scooling, PageIndex, OCR, LLM, and provider exposure remain blocked.

## Contract Guards

This planning phase must add tests proving:

- this Hub REST/OpenAPI spec is complete
- no Hub REST route is registered yet
- no OpenAPI path, schema, tag, component, or example is added yet
- hosted MCP `get_section_source` remains available
- no search, persistence, Scooling, body, snippet, provider, or resource surface is added

## Stop Conditions

Stop and re-plan if Hub REST/OpenAPI work requires:

- returning note body text
- returning section body text
- returning snippets
- returning full frontmatter
- returning exact line ranges
- returning byte offsets
- returning section body lengths
- returning absolute paths
- returning raw canister payloads
- returning provider payloads
- returning MCP resource URIs
- adding Hub UI
- adding canister routes
- adding search, vectors, indexes, persistence, sidecars, summaries, or memory events
- adding Scooling runtime behavior
- calling PageIndex, OCR, LLMs, or external providers
- weakening hosted role ACL, active vault, effective canister user, REST auth, or path
  safety behavior
- logging note content, section content, headings, raw upstream payloads, auth headers,
  gateway secrets, bearer tokens, or provider payloads

## Acceptance Criteria

Phase 1M is accepted when:

- The Hub REST/OpenAPI behavior is specified before runtime exposure.
- The future endpoint is limited to one vault-relative note path.
- The future route is read-only and auth-gated.
- The future canister request uses active vault and effective canister user boundaries.
- The future output is limited to body-free `knowtation.section_source/v0` metadata.
- Errors and logs are sanitized.
- Deletion, export, and staleness behavior remain non-persistent.
- Prompt-injection text remains untrusted source material.
- Hosted MCP parity is documented.
- Scooling remains a downstream consumer behind its adapter boundary.
- Contract tests prove Hub REST and OpenAPI exposure remain absent in this planning phase.
- Contract tests prove no search, persistence, Scooling, body, snippet, provider, or resource
  surface was added.

## Recommendation

Phase 1M is the accepted planning and contract-test phase.

Phase 1N implements the Hub gateway REST/OpenAPI runtime that follows this spec. It adds
the route, OpenAPI schema, Hub API documentation, and seven-tier runtime tests together. It
does not add Hub UI, canister routes, search, persistence, Scooling runtime behavior, body
reads, snippets, summaries, PageIndex, OCR, LLM calls, provider routing, or write-back
behavior.

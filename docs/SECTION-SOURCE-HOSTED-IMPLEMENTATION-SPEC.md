# SectionSource Hosted Implementation Spec

## Simple Summary

Phase 1K specifies the future hosted MCP implementation for body-free
`get_section_source`.

This phase is planning only. It does not register hosted `get_section_source`, add hosted
ACL entries, add Hub routes, add search or persistence, add Scooling runtime behavior, or
return note bodies, section bodies, snippets, full frontmatter, provider payloads, resource
URIs, line ranges, byte offsets, section body lengths, or absolute paths.

## Technical Summary

The future hosted `get_section_source` tool must mirror the adjacent hosted one-note read
tools: `get_note_outline`, `get_document_tree`, and `get_metadata_facets`.

The accepted future behavior is:

- require an authenticated hosted MCP session
- pass the hosted role ACL before registration
- use the active hosted vault from `ctx.vaultId`
- use the effective canister user from `ctx.canisterUserId`, falling back to `ctx.userId`
- send the same canister auth headers as adjacent hosted note-read tools
- normalize and reject unsafe paths before any upstream fetch
- read exactly one note from the canister
- derive body-free `knowtation.section_source/v0` metadata from that note body in memory
- return only the SectionSource v0 allowlist
- sanitize invalid, missing, unauthorized, and upstream errors

## Planning Decision

Phase 1K accepts the hosted implementation specification only.

It does not approve:

- registering hosted `get_section_source`
- adding `get_section_source` to hosted role ACLs
- adding Hub REST, OpenAPI, Hub UI, or canister routes
- adding search, vectors, indexes, persistence, sidecars, summaries, or memory events
- adding Scooling runtime behavior
- returning note body text
- returning section body text
- returning snippets or source excerpts
- returning full frontmatter
- returning line ranges, byte offsets, or section body lengths
- returning absolute paths, raw canister payloads, provider payloads, or MCP resource URIs
- calling PageIndex, OCR, LLMs, or external providers
- adding provider routing

## Future Hosted Tool

A later runtime phase may register:

```text
get_section_source
```

Registration must be guarded by:

```text
isToolAllowed('get_section_source', role)
```

The tool must be exposed only after `mcp-tool-acl.mjs` explicitly approves it.

## Input Schema

The future hosted tool may accept exactly:

```json
{
  "path": "inbox/example.md"
}
```

Field rules:

- `path` is required.
- `path` must be a string.
- `path` must be non-empty after trimming.
- `path` must be vault-relative.
- `path` must not be POSIX absolute.
- `path` must not be Windows absolute.
- `path` must not contain traversal segments.
- `path` must be normalized to forward slashes before the canister read.
- No batch paths are accepted.
- No vault id, user id, role, body, snippet, search, filter, rank, provider, Scooling,
  classroom, resource, persistence, line range, byte offset, or summary option is accepted.

## Hosted Role ACL Requirements

The future runtime phase must add `get_section_source` to the hosted read-tool ACL only when
the implementation is added.

The approved runtime ACL behavior is:

- `viewer`, `editor`, `evaluator`, and `admin` may list and call the tool after the ACL entry
  is added.
- Unknown roles inherit the existing hosted ACL fallback behavior and must not receive a
  broader tool set than `viewer`.
- The server must not register the tool when `isToolAllowed('get_section_source', role)`
  returns false.
- The tool must not be available through write-only, admin-only, prompt, resource, or Hub
  route registration paths.

Phase 1K does not add the ACL entry.

## Active Vault Boundary

The future hosted tool must use only the active hosted vault from the MCP session context:

```text
ctx.vaultId
```

Rules:

- The client cannot supply a vault id.
- The request path is interpreted only inside `ctx.vaultId`.
- The canister read must send `X-Vault-Id: <ctx.vaultId>`.
- The output `path` must be the normalized request path, not a canister-supplied path.
- A canister response that contains another vault path, an absolute path, or a raw storage key
  must not affect the returned path.
- Missing, unauthorized, and invalid responses must not reveal whether a note exists in any
  other vault.

## Effective Canister User Boundary

The future hosted tool must use the same effective canister user boundary as adjacent hosted
read tools:

```text
ctx.canisterUserId || ctx.userId
```

Rules:

- The client cannot supply a user id.
- The canister read must send `X-User-Id` with the effective canister user id.
- The implementation must not use the actor user id when a distinct effective canister user
  id is present.
- The implementation must not mix SectionSource output across effective users.
- Errors must not reveal another user's path, note body, frontmatter, canister payload, or
  authorization state.

## Canister Auth And Header Behavior

The future hosted tool must perform the same canister note-read request shape as
`get_note_outline`, `get_document_tree`, and `get_metadata_facets`:

```text
GET {canisterUrl}/api/v1/notes/{encodeURIComponent(normalizedPath)}
```

Headers:

- `Authorization: Bearer <ctx.token>`
- `X-Vault-Id: <ctx.vaultId>`
- `X-User-Id: <effective canister user id>`
- `X-Gateway-Auth: <ctx.canisterAuthSecret>` when configured
- `Accept: application/json`
- `Content-Type: application/json`

The future implementation must not forward section-specific options, provider options,
Scooling options, search filters, line ranges, byte offsets, or resource URIs upstream.

## One-Note Read Behavior

The future hosted tool must read one note only.

Allowed upstream behavior:

- one canister `GET /api/v1/notes/{path}` after path validation succeeds
- in-memory derivation using the already accepted SectionSource builder
- no write to notes, sidecars, indexes, vectors, summaries, memory, canister state, or provider
  state

Blocked upstream behavior:

- `GET /api/v1/notes` list scans
- Hub REST calls
- bridge search calls
- index, vector, PageIndex, OCR, LLM, provider, summary, memory, import, export, or write calls
- Scooling calls
- resource registration or resource reads for SectionSource content

## Path Normalization And Unsafe Path Rejection

The future hosted implementation must reject unsafe paths before the upstream canister fetch.

The normalization algorithm must:

- require a string
- trim whitespace
- replace backslashes with `/`
- reject empty paths
- reject paths beginning with `/`
- reject Windows drive paths such as `C:/Users/name/private.md`
- split on `/`
- remove empty segments caused by duplicate slashes
- reject any `..` segment
- join safe segments with `/`

Unsafe path errors must not echo the raw unsafe path. In particular, an invalid absolute path
must not return `/Users/...`, `C:/...`, `\\server`, or any private local path in the MCP error.

## Output Allowlist

The future hosted tool may return only body-free `knowtation.section_source/v0` output:

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

The future hosted tool must not output:

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

The future hosted tool must return hosted MCP JSON errors in the existing envelope:

```json
{
  "error": "Invalid path",
  "code": "UPSTREAM_ERROR"
}
```

The result must set `isError: true`.

Exact error rules:

- Missing `path` and non-string `path` return `Invalid path` without echoing the received
  value.
- Unsafe paths return `Invalid path` before any upstream fetch.
- Missing notes return a generic upstream status class such as `Upstream 404`.
- Unauthorized notes return a generic upstream status class such as `Upstream 401` or
  `Upstream 403`.
- Upstream runtime failures return a generic upstream failure without raw upstream response
  bodies.
- Invalid Markdown or malformed canister note JSON must not return note body text,
  frontmatter, raw canister payloads, paths from the canister response, headers, tokens, or
  provider payloads.

Errors must not contain:

- note body text
- section body text
- snippets
- full frontmatter
- heading paths beyond what was already authorized in a successful response
- absolute paths
- requested unsafe paths
- raw canister payloads
- canister auth secrets
- bearer tokens
- gateway secrets
- provider payloads
- MCP resource URIs

## Logging Exclusions

The future hosted implementation must not log:

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

- tool name
- sanitized outcome class
- sanitized upstream status class
- elapsed time
- section count
- truncated flag

## Deletion, Export, And Staleness

The future hosted tool is on-demand and non-persistent.

Until a separate persistence spec is accepted:

- no hosted SectionSource sidecar is created
- no hosted SectionSource index is created
- no vector record is created
- no memory event is created
- no summary record is created
- no provider record is created
- no Scooling record is created
- export behavior remains unchanged
- deleting a note leaves no SectionSource-derived hosted artifact to delete
- editing a note leaves no stale SectionSource-derived hosted artifact to invalidate

If a later phase adds persistence, it must define delete, edit, export, backup, restore,
multi-vault isolation, stale-data invalidation, and retention behavior before implementation.

## Prompt-Injection Handling

Hosted SectionSource text fields are private, untrusted source material:

- `title`
- `heading_text`
- `heading_path`
- future labels, snippets, or section bodies if a later spec accepts them

Prompt-like headings that ask a model to reveal secrets, bypass review, ignore policy, call
providers, exfiltrate learner data, alter grades, or disable guardrails must remain inert
text. They must not become tool instructions, system prompts, routing decisions, provider
requests, write-back approvals, or authorization overrides.

## Scooling Consumption Boundary

This phase does not add Scooling runtime behavior.

Future Scooling consumption may use hosted `get_section_source` only after:

- the hosted runtime implementation is added and tested in Knowtation
- the hosted ACL explicitly exposes the tool
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
  ranges, byte offsets, or section body lengths through this tool
- use SectionSource reads as write-back approval

## Seven-Tier Test Requirements

### Unit

- The implementation spec documents role ACL, active vault, effective canister user, canister
  headers, one-note read, path safety, output allowlist, error, logging, lifecycle,
  prompt-injection, and Scooling boundaries.
- The output allowlist matches body-free `SectionSource v0`.
- `body_returned` and `snippet_returned` remain false.
- Invalid path errors do not echo unsafe paths.

### Integration

- Hosted runtime still does not register `get_section_source` in this planning phase.
- Hosted ACL still does not include `get_section_source` in this planning phase.
- Existing hosted `get_note_outline`, `get_document_tree`, and `get_metadata_facets` remain
  the required implementation comparison points.
- Future runtime tests must prove the canister read uses `Authorization`, `X-Vault-Id`,
  `X-User-Id`, and `X-Gateway-Auth` consistently with adjacent hosted read tools.

### End To End

- A hosted MCP client cannot list `get_section_source` in this planning phase.
- A hosted MCP client cannot call `get_section_source` in this planning phase.
- Future runtime tests must prove a hosted MCP client can request one body-free SectionSource
  response only after ACL and registration are added.
- No hosted MCP flow returns note bodies, section bodies, snippets, full frontmatter,
  provider payloads, or resource URIs.

### Stress

- Planning checks stay bounded to SectionSource docs, hosted gateway files, and contract
  tests.
- Future runtime tests must prove large notes remain capped by heading and text caps.
- Future runtime tests must prove repeated calls for unchanged notes are deterministic.
- No test scans a real vault or calls external providers.

### Data Integrity

- This planning phase writes no notes, sidecars, indexes, vectors, memory, summaries,
  provider records, Scooling records, or canister state.
- Future runtime tests must prove one hosted SectionSource request performs one note read and
  no writes.
- Export, delete, edit, backup, and restore behavior remain unchanged in this phase.

### Performance

- The future hosted tool must read one note only.
- The future hosted tool must not scan the whole vault.
- The future hosted tool must not call bridge search.
- The future hosted tool must not call external providers.
- Output size must remain bounded by accepted SectionSource caps.

### Security

- Hosted runtime exposure remains blocked in this phase.
- Hosted ACL exposure remains blocked in this phase.
- No note body text appears in hosted SectionSource output.
- No section body text appears in hosted SectionSource output.
- No snippets appear in hosted SectionSource output.
- No full frontmatter appears in hosted SectionSource output.
- No absolute filesystem paths appear in hosted SectionSource output or errors.
- No raw canister payload appears in hosted SectionSource output or errors.
- No provider payload appears in hosted SectionSource output or errors.
- No MCP resource URI appears for hosted SectionSource content.
- Hub, search, persistence, Scooling, PageIndex, OCR, LLM, and provider exposure remain
  blocked.

## Contract Guards

This planning phase must add tests proving:

- this hosted implementation spec is complete
- hosted runtime still does not expose `get_section_source`
- hosted ACL still does not include `get_section_source`
- hosted tools/list still omits `get_section_source`
- no Hub, search, persistence, Scooling, body, snippet, provider, or resource surface is
  added for SectionSource

## Stop Conditions

Stop and re-plan if hosted work requires:

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
- adding Hub REST, OpenAPI, Hub UI, or canister routes
- adding search, vectors, indexes, persistence, sidecars, summaries, or memory events
- adding Scooling runtime behavior
- calling PageIndex, OCR, LLMs, or external providers
- weakening hosted role ACL, active vault, effective canister user, or path safety behavior
- logging note content, section content, headings, raw upstream payloads, auth headers,
  gateway secrets, bearer tokens, or provider payloads

## Acceptance Criteria

Phase 1K is accepted when:

- The hosted implementation behavior is specified before runtime exposure.
- The future tool is limited to one vault-relative note path.
- The future ACL behavior is read-only and role-gated.
- The future canister request uses the active vault and effective canister user boundaries.
- The future output is limited to body-free `knowtation.section_source/v0` metadata.
- Errors and logs are sanitized.
- Deletion, export, and staleness behavior remain non-persistent.
- Prompt-injection text remains untrusted source material.
- Scooling remains a downstream consumer behind its adapter boundary.
- Contract tests prove hosted runtime and ACL exposure remain absent in this planning phase.
- Contract tests prove no Hub, search, persistence, Scooling, body, snippet, provider, or
  resource surface was added.

## Recommendation

Phase 1K is the accepted planning and contract-test phase.

Phase 1L implements the hosted MCP runtime that follows this spec. It adds hosted ACL
registration and hosted MCP runtime tests together. It does not add Hub REST, OpenAPI, Hub
UI, canister routes, search, persistence, Scooling runtime behavior, body reads, snippets,
summaries, PageIndex, OCR, LLM calls, provider routing, or write-back behavior.

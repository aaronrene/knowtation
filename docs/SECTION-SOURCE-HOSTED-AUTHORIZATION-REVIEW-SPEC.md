# SectionSource Hosted Authorization Review Spec

## Simple Summary

Phase 1H reviews the hosted authorization boundary for a future body-free hosted
`SectionSource v0` tool.

This phase does not implement hosted MCP, Hub routes, search, persistence, Scooling runtime
behavior, section bodies, snippets, summaries, PageIndex, OCR, LLM calls, or provider
routing.

## Technical Summary

Hosted SectionSource can expose private note-derived structure outside the local vault
process. Before that happens, the hosted boundary must be specified and tested separately
from the self-hosted MCP implementation.

This review accepts only the authorization and lifecycle requirements for a future hosted
tool. The future hosted implementation must mirror hosted `get_note_outline`,
`get_document_tree`, and `get_metadata_facets`:

- allow only roles explicitly approved by the hosted MCP ACL
- use the active hosted vault id
- use the effective canister user id
- send the same canister auth headers as adjacent hosted note-read tools
- normalize and reject unsafe paths before upstream fetch
- read one note from the canister
- derive body-free `SectionSource v0` metadata
- return hosted MCP JSON errors without body text, snippets, full frontmatter, absolute
  paths, or raw upstream payloads

## Review Decision

Phase 1H accepts the hosted authorization review only.

It does not approve:

- registering hosted `get_section_source`
- adding `get_section_source` to hosted role ACLs
- adding Hub REST, OpenAPI, Hub UI, or canister routes
- adding search, vectors, indexes, persistence, sidecars, or memory events
- adding Scooling runtime consumption
- returning note body text
- returning section body text
- returning snippets
- returning exact line ranges, byte offsets, or section body lengths
- adding summaries, OCR, PageIndex, LLM calls, or external provider routing

## Future Hosted Tool Shape

A later hosted implementation may propose:

```text
get_section_source
```

The future tool must accept exactly one field:

```json
{
  "path": "inbox/example.md"
}
```

Field rules:

- `path` is required.
- `path` must be a string.
- `path` must be vault-relative.
- `path` must not be absolute.
- `path` must not escape the active vault.
- No batch paths are accepted.
- No body, snippet, search, filter, ranking, provider, classroom, or Scooling options are
  accepted.

## Hosted Authorization Requirements

The future hosted tool must preserve these requirements:

- The caller must have an authenticated hosted MCP session.
- The caller's role must pass `mcp-tool-acl.mjs` for the tool name.
- The tool must use `ctx.vaultId` as the active vault boundary.
- The tool must use `ctx.canisterUserId` as the effective canister user boundary.
- The upstream note read must include the same hosted canister headers as `get_note`,
  `get_document_tree`, and `get_metadata_facets`.
- The requested path must be normalized and rejected before upstream fetch if it is empty,
  absolute, Windows-absolute, or traversal-like.
- Missing and unauthorized notes must not reveal more than adjacent hosted read tools.
- The returned `path` must be the normalized vault-relative request path, not an upstream
  absolute path or raw canister path.

## Accepted Future Output

The future hosted tool may return only the existing body-free `SectionSource v0` shape:

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

## Explicitly Excluded Output

The future hosted tool must not output:

- note body text
- section body text
- snippets
- source excerpts
- full frontmatter
- absolute filesystem paths
- exact line ranges
- byte offsets
- section body lengths
- summaries
- vector scores
- provider payloads
- MCP resource URIs
- search results
- persistence ids
- Scooling adapter state
- raw upstream canister payloads

## Logging And Error Boundary

The future hosted implementation must not log or return note body text, section body text,
snippets, full frontmatter, raw upstream payloads, gateway secrets, bearer tokens, or
provider payloads.

Errors may report only bounded operational context:

- invalid path
- missing note
- upstream status class
- generic authorization failure
- generic runtime failure

Errors must not include note content, section content, raw frontmatter, absolute paths, auth
headers, request tokens, canister secrets, or provider payloads.

## Deletion, Export, And Staleness

The reviewed hosted shape is on-demand and non-persistent.

Until a separate persistence spec is accepted:

- no hosted section sidecar is created
- no hosted section index is created
- no vector record is created
- no memory event is created
- no summary record is created
- export behavior remains unchanged
- deleting or editing a note leaves no SectionSource-derived hosted artifact to clean up

## Prompt-Injection Handling

Hosted heading text and heading paths are private, untrusted source material.

The future hosted tool must not treat headings or section text as instructions. Prompt-like
headings that ask the model to reveal secrets, bypass review, call providers, or disable
guardrails must remain inert text in the body-free response.

## Scooling Boundary

This review does not approve Scooling runtime consumption.

Future Scooling work must remain behind a Scooling-owned adapter and must not bypass
Knowtation hosted authorization, parse Markdown as the canonical section parser, persist
SectionSource as truth, expose private learner sections outside authorized contexts, or
treat section text as model instructions.

## Seven-Tier Test Requirements

### Unit

- The hosted review spec documents role, vault, canister-user, path, logging, error, and
  output boundaries.
- The future output allowlist matches body-free `SectionSource v0`.
- `body_returned` and `snippet_returned` remain false.

### Integration

- Existing hosted `get_note_outline`, `get_document_tree`, and `get_metadata_facets`
  patterns remain the only approved hosted comparison points.
- `get_section_source` remains absent from hosted ACLs in this review phase.
- Hosted runtime files contain no SectionSource builder or local note-read call.

### End To End

- A hosted MCP client cannot list `get_section_source` in this review phase.
- A hosted MCP client cannot call `get_section_source` in this review phase.
- No hosted MCP flow returns section body text or snippets.

### Stress

- Review checks stay bounded to hosted gateway files and SectionSource contract documents.
- No test scans a real vault.
- No test calls external providers.

### Data Integrity

- This review writes no notes, sidecars, indexes, vectors, memory, summaries, or canister
  state.
- No cached hosted section record is created.
- Export, delete, and edit behavior remain unchanged.

### Performance

- The future hosted tool must read one note only.
- The future hosted tool must not scan the whole vault.
- The future hosted tool must not call external providers.

### Security

- Hosted runtime exposure remains blocked in this phase.
- No note body text appears in hosted SectionSource output.
- No section body text appears in hosted SectionSource output.
- No snippets appear in hosted SectionSource output.
- No full frontmatter appears in hosted SectionSource output.
- No absolute filesystem paths appear in hosted SectionSource output.
- No MCP resource URI appears for hosted SectionSource content.
- Hosted, Scooling, classroom, search, persistence, and provider exposure remain blocked.

## Stop Conditions

Stop and re-plan if hosted work requires:

- returning note body text
- returning section body text
- returning snippets
- returning exact line ranges
- returning byte offsets
- returning section body lengths
- adding summaries
- adding search, vectors, indexes, persistence, sidecars, or memory events
- adding Hub REST, OpenAPI, Hub UI, canister routes, or Scooling runtime code
- sending note-derived content to LLMs, OCR, PageIndex, or external providers
- weakening active vault or effective canister-user boundaries
- weakening hosted role checks
- logging note content, auth headers, gateway secrets, bearer tokens, or provider payloads

## Acceptance Criteria

Phase 1H is accepted when:

- The hosted authorization boundary is documented before hosted runtime exposure.
- The future tool shape is limited to one vault-relative note path.
- The future output is limited to body-free `SectionSource v0` metadata.
- The review preserves active vault, effective canister-user, and role ACL boundaries.
- The review blocks hosted runtime registration in this phase.
- Tests prove hosted `get_section_source` remains absent from hosted MCP and ACL files.
- Tests prove hosted, Hub, search, persistence, Scooling, body, snippet, provider, OCR,
  PageIndex, and LLM behavior remain blocked.

## Recommendation

The Scooling adapter planning boundary is accepted separately in
`docs/SECTION-SOURCE-SCOOLING-ADAPTER-PLANNING-SPEC.md`.

The Scooling adapter slice is complete in the Scooling repository at commit `ea5421e`
(`Add Scooling SectionSource transport boundary`).

Proceed to a hosted implementation spec only if hosted SectionSource is required.

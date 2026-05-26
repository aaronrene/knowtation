# SectionSource Scooling Adapter Planning Spec

## Simple Summary

Phase 1I plans how Scooling may later consume body-free `SectionSource v0` metadata.

This phase does not implement Scooling runtime code, hosted MCP, Hub routes, search,
persistence, section bodies, snippets, summaries, PageIndex, OCR, LLM calls, or provider
routing.

## Technical Summary

Scooling may use SectionSource only as a consumer through a Scooling-owned adapter. It must
not become the canonical Markdown parser, section id generator, authorization owner,
retrieval index, or source-of-truth store for SectionSource data.

This planning phase accepts only the adapter boundary for a future Scooling integration.
The future Scooling adapter must consume a tested Knowtation transport and preserve the
body-free `SectionSource v0` contract:

- request one authorized note path at a time
- receive only body-free section metadata
- treat heading text and heading paths as untrusted source material
- preserve fallback behavior when SectionSource is unavailable
- never parse Markdown as the canonical section source
- never persist SectionSource as truth
- never expose learner-private sections outside authorized contexts

## Planning Decision

Phase 1I accepts Scooling adapter planning only.

It does not approve:

- adding Scooling runtime code
- adding a Scooling adapter implementation
- adding hosted `get_section_source`
- adding Hub REST, OpenAPI, Hub UI, or canister routes
- adding search, vectors, indexes, persistence, sidecars, or memory events
- returning note body text
- returning section body text
- returning snippets
- returning exact line ranges, byte offsets, or section body lengths
- adding summaries, OCR, PageIndex, LLM calls, or external provider routing
- writing learner knowledge back without human review

## Future Adapter Target

A later Scooling phase may propose:

```text
KnowtationVaultAdapter.getSectionSource(path)
```

The future adapter method may accept only:

```json
{
  "path": "inbox/example.md"
}
```

Field rules:

- `path` is required.
- `path` must be a string.
- `path` must be vault-relative in the Knowtation transport being called.
- `path` must not be absolute.
- `path` must not escape the authorized vault or learner scope.
- No batch paths are accepted.
- No body, snippet, search, filter, ranking, provider, classroom, or write-back options are
  accepted.

## Accepted Future Input Source

The future Scooling adapter may consume SectionSource only from an accepted Knowtation
surface:

- self-hosted MCP `get_section_source`, if the user's environment is local/self-hosted
- a future hosted `get_section_source`, only after its implementation spec and tests are
  accepted

Scooling must not derive canonical SectionSource data by:

- parsing Markdown directly
- reading raw notes directly
- calling PageIndex or OCR
- using LLMs to infer section boundaries
- reusing stale cached section records as truth
- scraping rendered HTML or UI output

## Accepted Future Output

The future Scooling adapter may receive only the body-free `SectionSource v0` shape:

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

The future Scooling adapter must not receive or store:

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
- raw upstream canister payloads
- classroom visibility decisions outside Scooling policy

## Authorization Boundary

Scooling must treat SectionSource as private note-derived data.

The future adapter must preserve these requirements:

- Knowtation remains the authorization boundary for note-derived SectionSource data.
- Scooling may request SectionSource only for a learner, classroom, organization, and vault
  context already authorized by the active Knowtation transport.
- Scooling must not bypass Knowtation path, vault, hosted, or canister-user checks.
- Scooling must not use SectionSource from one learner, classroom, organization, or vault in
  another context.
- Missing, unauthorized, and unavailable SectionSource responses must fall back without
  exposing private note existence beyond the accepted transport behavior.
- Classroom, mentor, public, and organization displays require separate Scooling policy
  before any private section metadata is shown.

## Fallback Behavior

When SectionSource is unavailable, rejected, truncated, or unsupported, Scooling must fall
back to already accepted body-free surfaces:

- document-level retrieval
- `NoteOutline`
- `DocumentTree`
- `MetadataFacets`
- a "section source unavailable" display state

Fallback must not:

- parse Markdown to recover sections
- call PageIndex, OCR, LLMs, or external providers
- request note bodies or snippets
- treat absence of SectionSource as permission to reveal more detail
- write a replacement section index as truth

## Prompt-Injection Handling

Scooling must treat every SectionSource text field as untrusted source material:

- `title`
- `heading_text`
- `heading_path`
- future labels, snippets, or section bodies if separately accepted

Prompt-like headings that ask the model to reveal secrets, bypass review, call providers,
alter grades, impersonate a teacher, or disable guardrails must remain inert text. They must
not be executed, promoted to instructions, or used to bypass human review.

## Deletion, Export, And Staleness

This planning phase does not approve Scooling persistence.

Until a separate persistence spec is accepted:

- Scooling must not store SectionSource as truth.
- Scooling must not create a section sidecar.
- Scooling must not create a vector record from SectionSource.
- Scooling must not create a summary record from SectionSource.
- Scooling must not export SectionSource as learner-authored content.
- Editing or deleting a Knowtation note leaves no Scooling SectionSource artifact to clean
  up.

If a future Scooling phase stores derived state, it must define edit, delete, export,
backup, restore, and stale-data behavior before implementation.

## Write-Back Boundary

SectionSource consumption must not grant write permissions.

Future Scooling write-back flows must remain separate from SectionSource reads and must
continue to require proposal, conflict, denial, and human-review gates. SectionSource
metadata must not automatically create notes, update notes, change learner memory, alter
classroom records, or write educator feedback.

## Seven-Tier Test Requirements

### Unit

- The adapter target name is documented.
- The accepted input is exactly one vault-relative path.
- The accepted output allowlist matches body-free `SectionSource v0`.
- `body_returned` and `snippet_returned` remain false.

### Integration

- Scooling is documented as a consumer only.
- Knowtation remains the canonical parser and authorization boundary.
- Scooling runtime files remain unchanged in this planning phase.
- Hosted runtime files do not register hosted `get_section_source`.

### End To End

- Scooling cannot consume live SectionSource in this planning phase.
- Scooling fallback remains document-level or body-free.
- No Scooling flow receives note bodies, section bodies, or snippets.

### Stress

- Planning checks stay bounded to SectionSource contract files and Scooling smoke boundary
  files.
- No test scans a real vault.
- No test calls external providers.

### Data Integrity

- This planning phase writes no notes, sidecars, indexes, vectors, memory, summaries,
  classroom records, or canister state.
- No cached Scooling section record is created.
- Export, delete, edit, backup, and restore behavior remain unchanged.

### Performance

- The future adapter must request one note's SectionSource metadata at a time.
- The future adapter must not scan the whole vault.
- The future adapter must not call external providers.

### Security

- Scooling runtime exposure remains blocked in this phase.
- No note body text appears in Scooling SectionSource output.
- No section body text appears in Scooling SectionSource output.
- No snippets appear in Scooling SectionSource output.
- No full frontmatter appears in Scooling SectionSource output.
- No absolute filesystem paths appear in Scooling SectionSource output.
- No MCP resource URI appears for Scooling SectionSource content.
- Hosted, classroom, search, persistence, write-back, and provider exposure remain blocked.

## Stop Conditions

Stop and re-plan if Scooling work requires:

- parsing Markdown as the canonical section parser
- deriving canonical section ids in Scooling
- returning note body text
- returning section body text
- returning snippets
- returning exact line ranges
- returning byte offsets
- returning section body lengths
- adding summaries
- adding search, vectors, indexes, persistence, sidecars, memory events, or classroom
  records
- adding hosted MCP, Hub REST, OpenAPI, Hub UI, or canister routes
- sending note-derived content to LLMs, OCR, PageIndex, or external providers
- bypassing Knowtation authorization
- exposing private learner sections outside authorized contexts
- writing learner knowledge back without proposal and human-review gates

## Acceptance Criteria

Phase 1I is accepted when:

- The Scooling adapter boundary is documented before Scooling runtime exposure.
- The future adapter target is limited to one vault-relative note path.
- The future adapter output is limited to body-free `SectionSource v0` metadata.
- Scooling remains a consumer and not the canonical parser, authorization owner, or store of
  truth.
- Fallback behavior remains body-free when SectionSource is unavailable.
- Tests prove no Scooling runtime, hosted runtime, Hub route, search, persistence, body,
  snippet, provider, OCR, PageIndex, LLM, or write-back behavior was added.

## Recommendation

The Scooling adapter slice is complete in the Scooling repository at commit `ea5421e`
(`Add Scooling SectionSource transport boundary`).

The completed Scooling slice includes `getSectionSource`, strict body-free
`knowtation.section_source/v0` schema validation, REST/memory transport handling, fallback
unavailable state, and seven-tier coverage. No further Knowtation runtime change is needed
for Scooling to consume the current self-hosted SectionSource boundary.

Proceed next to a hosted `get_section_source` implementation spec only if hosted
SectionSource is required.

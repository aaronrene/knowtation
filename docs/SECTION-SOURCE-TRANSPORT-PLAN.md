# SectionSource Body-Free Transport Plan

## Simple Summary

Phase 1D decides how `SectionSource v0` may later be exposed outside direct library calls.

The decision is conservative: only body-free section metadata is eligible for transport.
The local CLI and self-hosted MCP surfaces are now implemented. No hosted MCP tool, Hub
endpoint, search mode, Scooling runtime behavior, body text, snippets, summaries,
persistence, PageIndex, OCR, LLM call, or provider routing is added.

## Technical Summary

Phase 1D accepts transport planning only. It does not implement a transport.

Body-free transport work may proceed only through separately tested implementation phases.
Those implementations must expose the existing `SectionSource v0` shape without adding note
bodies, section bodies, snippets, exact line ranges, byte offsets, section body lengths, raw
frontmatter, vectors, summaries, provider payloads, or persisted section records.

## Transport Decision

The accepted transport decision is:

- Local library support is already implemented through `readSectionSource`.
- The local CLI surface is implemented for body-free `SectionSource v0` metadata.
- The self-hosted MCP tool is implemented for body-free `SectionSource v0` metadata.
- Hosted MCP, Hub REST, OpenAPI, Hub UI, canister routes, search modes, Scooling runtime
  consumption, PageIndex, OCR, LLM calls, external provider routing, section body reads,
  and snippets remain blocked.

This plan does not accept a hosted route, schema extension, hosted role change, ACL change,
or Scooling adapter shape.

## Allowed Future Local CLI Shape

The local CLI phase may add a body-free note-scoped command only if it:

- accepts exactly one vault-relative note path
- uses existing local config and vault resolution behavior
- reads one note through the existing local note-read path
- returns only the accepted `SectionSource v0` fields
- returns `body_returned: false`
- returns `snippet_returned: false`
- exposes no body text, snippets, raw frontmatter, line ranges, byte offsets, section body
  lengths, summaries, vectors, provider payloads, or persistence ids
- includes seven-tier tests for the CLI surface

## Allowed Future Self-Hosted MCP Shape

The self-hosted MCP phase may add a body-free note-scoped read tool only if it:

- mirrors `get_note_outline`, `get_document_tree`, and `get_metadata_facets` local auth and
  path behavior
- accepts exactly one vault-relative note path
- reads one note through the existing local note-read path
- returns only the accepted `SectionSource v0` fields
- returns `body_returned: false`
- returns `snippet_returned: false`
- exposes no MCP resource URI for section bodies, snippets, or section sources
- includes seven-tier tests for the MCP surface

## Hosted Transport Block

Hosted MCP and Hub transport remain blocked.

Before any hosted SectionSource transport can be proposed, a separate hosted authorization
review must prove:

- active vault isolation
- effective canister user isolation
- hosted role ACL behavior
- missing and unauthorized note behavior
- no body or snippet logging
- no section body, snippet, line range, byte offset, summary, vector, provider payload, or
  persisted section record leakage
- multi-vault regression coverage

## Search And Persistence Block

Transport planning does not approve search or persistence.

Future search or persistence work requires a separate spec because it changes deletion,
export, stale-data, ranking, logging, and authorization behavior. No transport may create
sidecars, indexes, vectors, memory events, summaries, provider records, or cached section
payloads.

## Scooling Boundary

Scooling remains blocked from live SectionSource runtime consumption until a separate
Scooling phase.

A future Scooling phase must keep Scooling as a consumer through a Scooling-owned adapter.
Scooling must not parse Markdown as the canonical section parser, derive canonical section
ids, persist section sources as truth, expose private learner sections outside authorized
contexts, or treat section text as model instructions.

## Seven-Tier Test Requirements

### Unit

- Transport handlers return the same `SectionSource v0` schema as the library.
- Transport handlers keep `body_returned` and `snippet_returned` false.
- Transport handlers reject unsafe paths before note reads.

### Integration

- CLI and self-hosted MCP surfaces reuse existing local note-read behavior.
- Missing and traversal paths reveal no extra detail beyond existing note reads.
- Future transport output matches the library output for the same note.

### End To End

- Agent flows can inspect section candidates through a body-free surface.
- No agent flow receives section body text or snippets.
- Scooling fallback remains document-level or body-free until a separate Scooling phase.

### Stress

- Large notes remain capped by heading count and input caps.
- Transport output size remains bounded by section count and text caps.
- Repeated transport calls are deterministic for unchanged notes.

### Data Integrity

- Transport calls do not write notes, sidecars, indexes, vectors, memory, summaries, or
  canister state.
- Transport calls reflect current note content only.
- Persisted future phases define delete, edit, export, backup, and restore behavior before
  implementation.

### Performance

- One-note transport calls do not scan the whole vault.
- No external provider calls occur.
- Hosted future phases must define rate limits and multi-vault isolation before exposure.

### Security

- No note body text in transport output.
- No section body text in transport output.
- No snippets in transport output.
- No full frontmatter in transport output.
- No absolute filesystem paths in transport output.
- No MCP resource URI for section body or snippet data.
- Prompt-injection text remains untrusted source material.
- Hosted, Scooling, classroom, search, and persistence exposure remain blocked until
  separately reviewed.

## Stop Conditions

Stop and re-plan if a transport proposal requires:

- returning note body text
- returning section body text
- returning snippets
- returning exact line ranges
- returning byte offsets
- returning section body lengths
- adding summaries
- adding search, vectors, indexes, persistence, sidecars, or memory events
- adding hosted MCP, Hub REST, OpenAPI, Hub UI, canister routes, or Scooling runtime code
- sending note-derived content to LLMs, OCR, PageIndex, or external providers
- weakening existing note-read authorization behavior

## Acceptance Criteria

Phase 1D is accepted when:

- This plan limits future transport to body-free SectionSource metadata.
- This plan identifies local CLI and self-hosted MCP as the only eligible future transport
  surfaces.
- This plan keeps hosted, Hub, search, persistence, Scooling, body, snippet, provider, OCR,
  PageIndex, and LLM behavior blocked.
- Tests prove the current CLI and self-hosted MCP output remain body-free and hosted, Hub,
  and Scooling runtime transport remain blocked.
- Tests prove current SectionSource output remains body-free.

## Recommendation

Phase 1E is implemented in `cli/index.mjs`; Phase 1G is implemented in
`mcp/create-server.mjs`. Both are documented in
`docs/SECTION-SOURCE-CLI-IMPLEMENTATION-SPEC.md` and
`docs/SECTION-SOURCE-MCP-IMPLEMENTATION-SPEC.md`.

The hosted authorization review is accepted in
`docs/SECTION-SOURCE-HOSTED-AUTHORIZATION-REVIEW-SPEC.md`.

The Scooling adapter planning boundary is accepted in
`docs/SECTION-SOURCE-SCOOLING-ADAPTER-PLANNING-SPEC.md`.

The Scooling adapter slice is complete in the Scooling repository at commit `ea5421e`
(`Add Scooling SectionSource transport boundary`).

Proceed next only with a separate hosted implementation spec if hosted SectionSource is
required. Do not implement hosted, Hub, search, persistence, body reads, snippets,
summaries, OCR, PageIndex, LLM calls, provider routing, or write-back behavior without that
separate plan.

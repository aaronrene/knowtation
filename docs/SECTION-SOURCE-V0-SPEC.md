# SectionSource v0 Spec

## Simple Summary

`SectionSource v0` is the next planning contract after `DocumentTree v0` and
`MetadataFacets v0`.

`DocumentTree v0` answers "what headings exist in this note?" without returning body
text. `MetadataFacets v0` answers "what safe metadata hints exist for this note?"
without returning full frontmatter. `SectionSource v0` plans how Knowtation can later
identify authorized sections as source candidates for tree-aware retrieval.

Accepted phases currently cover body-free local section source metadata, the body/snippet
policy gate, the local CLI command, and the self-hosted MCP tool. They do not add hosted
routes, search modes, indexes, persistence, summaries, Hub UI, OpenAPI changes, section
bodies, snippets, or Scooling runtime behavior.

## Technical Summary

`SectionSource v0` defines the security and data-lifecycle boundary for future tree-aware
retrieval over Markdown note sections. It treats section body text as private, untrusted
note content. The accepted runtime slices remain body-free, local, on-demand, and
non-persistent, with no hosted or external provider exposure.

The purpose of this spec is to prevent section retrieval from becoming an ad hoc feature
that leaks bodies, snippets, line ranges, raw frontmatter, vectors, summaries, provider
data, or unauthorized classroom content.

## Relationship To Existing Work

### `NoteOutline`

`NoteOutline` returns a flat, body-free heading list:

```text
schema, path, title, headings[], truncated
```

Each heading has:

```text
level, text, id
```

`SectionSource v0` must reuse the same parser discipline, path safety, heading id rules,
caps, and authorization model unless this spec explicitly tightens them.

### `DocumentTree v0`

`DocumentTree v0` returns a nested, body-free heading tree:

```text
schema, path, title, root.children[], truncated
```

`SectionSource v0` is allowed to depend on `DocumentTree v0` for stable heading ids and
heading paths. It must not add section body text to the `DocumentTree v0` response.

### `MetadataFacets v0`

`MetadataFacets v0` returns bounded, body-free metadata hints for one note. `SectionSource
v0` may later combine section candidates with metadata facets for ranking or filtering,
but v0 must keep those contracts separate. Metadata facets must not be copied into section
payloads unless a later contract explicitly accepts the field list and deletion behavior.

### Scooling Adapter Boundary

Scooling may consume future section source results only through `KnowtationVaultAdapter`
or an equivalent Scooling-owned adapter. Scooling must not parse Markdown, derive
canonical section ids, build indexes, call PageIndex, or treat retrieved section content as
trusted model instructions.

## Goals

- Define the privacy and lifecycle boundary for tree-aware section retrieval.
- Keep the first implementation pure, local, deterministic, and read-only.
- Preserve the same authorization boundary as note reads.
- Separate section boundaries from section body text, snippets, summaries, indexes, and
  persistence.
- Treat all heading text, metadata, and section body text as untrusted prompt content.
- Define seven-tier tests before any runtime implementation.
- Give Scooling a future adapter target without making Scooling the canonical parser or
  index.

## Non-Goals

- No section body implementation in this phase.
- No section snippet implementation in this phase.
- No hosted MCP tool.
- No Hub REST endpoint.
- No OpenAPI change.
- No Hub UI.
- No canister route or schema change.
- No search mode change.
- No vector/index payload change.
- No persistence or sidecar files.
- No section summaries.
- No LLM calls.
- No PageIndex.
- No OCR.
- No PDF/DOCX section extraction.
- No MuseHub domain/plugin change.
- No Scooling runtime change.
- No external provider routing.

## Terminology

| Term | Meaning |
| --- | --- |
| `SectionSource` | A section candidate derived from a Markdown note and heading tree. |
| `SectionBoundary` | The deterministic span of Markdown that belongs to one heading. Internal in early phases. |
| `SectionBody` | The private note text inside a section. Not returned in the first runtime slice. |
| `SectionSnippet` | A bounded excerpt from section body text. Deferred until snippet policy is accepted. |
| `HeadingPath` | Ordered heading texts from root to the section heading. |
| `SectionId` | Deterministic id derived from the note path and heading id. |
| `SectionIndex` | Future persisted or vectorized section representation. Not part of v0. |
| `SourceCandidate` | A section reference that may later help choose what body text to read. |

## Implementation Status And Phase Order

### Phase 0: Spec

Implemented on local Muse `main`. This document established the security and lifecycle
boundary before runtime behavior changed.

### Phase 1A: Pure Section Boundary Extractor

Implemented on local Muse `main` in `lib/section-source.mjs` with seven-tier tests in
`test/section-source.test.mjs`.

The pure module accepts current Markdown content plus `DocumentTree v0`-compatible heading
ids and returns section source metadata without returning section body text or snippets.

Allowed output in Phase 1A:

- schema
- vault-relative path supplied by caller
- deterministic section ids
- heading ids
- heading path
- heading level
- heading text
- child section ids
- `body_available: true | false`
- `body_returned: false`
- `snippet_returned: false`
- `truncated`

Disallowed in Phase 1A:

- section body text
- snippets
- exact line ranges
- byte offsets
- section body lengths
- summaries
- vectors
- full frontmatter
- persistence
- file reads
- writes
- CLI, MCP, hosted, Hub, or Scooling wiring

### Phase 1B: Local Note Integration

Implemented on local Muse `main` in `lib/section-source-note.mjs`.

The local function reads one authorized Markdown note through existing vault read behavior
and derives section source metadata on demand.

No CLI, MCP, hosted, search, index, persistence, summaries, or Scooling wiring in this
phase.

### Phase 1C: Body Policy Review

Implemented on local Muse `main` in `docs/SECTION-SOURCE-BODY-SNIPPET-POLICY.md`, with
policy contract tests in `test/section-source-policy.test.mjs`.

The accepted policy covers:

- who may read section body text
- whether snippets are allowed
- snippet length caps
- whether snippets may include headings
- prompt-injection treatment
- redaction behavior
- logging exclusions
- export behavior
- deletion and stale-derived-data behavior
- hosted vault isolation
- classroom and minor boundaries

Phase 1C does not return section body text or snippets. Snippets remain blocked for
`SectionSource v0`; future body reads require a separate implementation spec and seven-tier
tests.

### Phase 1D: Transport Planning

Implemented on local Muse `main` in `docs/SECTION-SOURCE-TRANSPORT-PLAN.md`, with transport
planning contract tests in `test/section-source-transport-plan.test.mjs`.

The accepted plan allows body-free local CLI and self-hosted MCP surfaces only. At Phase 1D
it did not implement CLI, MCP, hosted MCP, Hub REST, OpenAPI, Hub UI, search, persistence,
Scooling runtime consumption, body reads, snippets, summaries, PageIndex, OCR, LLM calls,
or provider routing.

### Phase 1E: Local CLI Implementation

Implemented on local Muse `main` in `cli/index.mjs`, specified in
`docs/SECTION-SOURCE-CLI-IMPLEMENTATION-SPEC.md`, with CLI and contract tests in
`test/cli.test.mjs` and `test/section-source-cli-spec.test.mjs`.

The accepted body-free local CLI command is:

```text
knowtation get-section-source <path> --json
```

Phase 1E does not add MCP, hosted MCP, Hub REST, OpenAPI, Hub UI, canister routes, search,
persistence, Scooling runtime consumption, body reads, snippets, summaries, PageIndex, OCR,
LLM calls, or provider routing.

### Phase 1F: Self-Hosted MCP Implementation Spec

Implemented on local Muse `main` in `docs/SECTION-SOURCE-MCP-IMPLEMENTATION-SPEC.md`, with
self-hosted MCP implementation spec contract tests in `test/section-source-mcp-spec.test.mjs`.

The accepted spec named a body-free self-hosted MCP tool:

```text
get_section_source
```

Phase 1F did not implement the MCP tool. It did not add hosted MCP, Hub REST, OpenAPI, Hub
UI, canister routes, search, persistence, Scooling runtime consumption, body reads,
snippets, summaries, PageIndex, OCR, LLM calls, or provider routing.

### Phase 1G: Self-Hosted MCP Implementation

Implemented on local Muse `main` in `mcp/create-server.mjs`, with self-hosted MCP tests in
`test/mcp-section-source.test.mjs` and updated contract tests in
`test/section-source-mcp-spec.test.mjs`.

The accepted body-free self-hosted MCP tool is:

```text
get_section_source
```

Phase 1G does not add hosted MCP, Hub REST, OpenAPI, Hub UI, canister routes, search,
persistence, Scooling runtime consumption, body reads, snippets, summaries, PageIndex, OCR,
LLM calls, or provider routing.

### Phase 1H: Hosted Authorization Review Spec

Implemented on local Muse `main` in
`docs/SECTION-SOURCE-HOSTED-AUTHORIZATION-REVIEW-SPEC.md`, with hosted authorization
contract tests in `test/section-source-hosted-auth-spec.test.mjs`.

Phase 1H documents the required hosted boundaries for any future body-free hosted
`get_section_source` tool:

- hosted role ACL
- active vault id
- effective canister user id
- same canister headers as adjacent hosted read tools
- unsafe path rejection before upstream fetch
- body-free `SectionSource v0` output only
- no section body, snippet, summary, search, persistence, provider, or Scooling runtime
  exposure

Phase 1H does not register hosted `get_section_source`. It does not add Hub REST, OpenAPI,
Hub UI, canister routes, search, persistence, Scooling runtime consumption, body reads,
snippets, summaries, PageIndex, OCR, LLM calls, or provider routing.

### Phase 1I: Scooling Adapter Planning Spec

Implemented on local Muse `main` in
`docs/SECTION-SOURCE-SCOOLING-ADAPTER-PLANNING-SPEC.md`, with Scooling adapter planning
contract tests in `test/section-source-scooling-adapter-spec.test.mjs`.

Phase 1I documents the Scooling consumer boundary for a future body-free adapter target:

```text
KnowtationVaultAdapter.getSectionSource(path)
```

The accepted planning boundary requires Scooling to remain a consumer and not the canonical
Markdown parser, section id generator, authorization owner, retrieval index, or store of
truth. Scooling fallback must remain document-level or body-free through `NoteOutline`,
`DocumentTree`, and `MetadataFacets` when SectionSource is unavailable.

Phase 1I does not add Scooling runtime code. It does not add hosted MCP, Hub REST, OpenAPI,
Hub UI, canister routes, search, persistence, body reads, snippets, summaries, PageIndex,
OCR, LLM calls, provider routing, or write-back behavior.

### Phase 1J: Scooling Adapter Implementation

Implemented in the Scooling repository at commit `ea5421e`:

```text
Add Scooling SectionSource transport boundary
```

The Scooling slice adds the body-free SectionSource transport boundary, including
`getSectionSource`, strict `knowtation.section_source/v0` schema validation,
REST/memory transport handling, fallback unavailable state, and seven-tier coverage.

The accepted Scooling implementation consumes SectionSource as a downstream adapter target.
It does not make Scooling the canonical Markdown parser, section id generator,
authorization owner, persistence source of truth, provider router, or write-back owner.

### Phase 1K: Hosted Implementation Spec

Implemented on local Muse `main` in
`docs/SECTION-SOURCE-HOSTED-IMPLEMENTATION-SPEC.md`, with hosted implementation spec
contract tests in `test/section-source-hosted-implementation-spec.test.mjs`.

Phase 1K specifies the future hosted MCP behavior for body-free `get_section_source`:

- hosted role ACL requirements
- active vault boundary
- effective canister user boundary
- canister auth and header behavior
- one-note canister read behavior
- path normalization and unsafe path rejection before upstream fetch
- body-free `knowtation.section_source/v0` output allowlist
- sanitized invalid, missing, unauthorized, and upstream errors
- logging exclusions
- deletion, export, and staleness behavior
- prompt-injection handling
- Scooling consumption boundary

Phase 1K does not register hosted `get_section_source`. It does not add hosted ACL entries,
Hub REST, OpenAPI, Hub UI, canister routes, search, persistence, Scooling runtime behavior,
body reads, snippets, summaries, PageIndex, OCR, LLM calls, provider routing, or write-back
behavior.

### Phase 1L: Hosted MCP Implementation

Implemented on local Muse `main` in `hub/gateway/mcp-hosted-server.mjs` and
`hub/gateway/mcp-tool-acl.mjs`, with hosted runtime tests in
`test/mcp-hosted-section-source.test.mjs` and updated contract guards.

The accepted hosted runtime tool is:

```text
get_section_source
```

Phase 1L exposes the tool only through hosted MCP read-role ACLs. It reads one authorized
hosted note through the same canister path, active vault id, effective canister user id, and
gateway auth headers as `get_note_outline`, `get_document_tree`, and
`get_metadata_facets`. It normalizes and rejects unsafe paths before upstream fetch, derives
body-free `knowtation.section_source/v0` metadata in memory, and sanitizes invalid,
missing, unauthorized, and upstream errors.

Phase 1L does not add Hub REST, OpenAPI, Hub UI, canister routes, search, persistence,
Scooling runtime behavior, body reads, snippets, summaries, PageIndex, OCR, LLM calls,
provider routing, resource URIs, or write-back behavior.

### Phase 1M: Hub REST/OpenAPI Implementation Spec

Implemented on local Muse `main` in
`docs/SECTION-SOURCE-HUB-REST-OPENAPI-SPEC.md`, with Hub REST/OpenAPI implementation spec
contract tests in `test/section-source-hub-rest-openapi-spec.test.mjs`.

Phase 1M specifies a future body-free Hub REST/OpenAPI surface:

```text
GET /api/v1/section-source?path=<vault-relative-note-path>
```

The accepted planning boundary covers REST auth requirements, active vault behavior,
effective canister user behavior, canister auth/header behavior, one-note reads, unsafe path
rejection before upstream fetch, body-free `knowtation.section_source/v0` output, error
sanitization, logging exclusions, deletion/export/staleness behavior, prompt-injection
handling, hosted MCP parity, and Scooling consumption boundaries.

Phase 1M does not add Hub REST routes, OpenAPI paths or schemas, Hub UI, canister routes,
search, persistence, Scooling runtime behavior, body reads, snippets, summaries, PageIndex,
OCR, LLM calls, provider routing, resource URIs, or write-back behavior.

### Phase 1N: Hub REST/OpenAPI Runtime Implementation

Implemented on local Muse `main` in `hub/gateway/server.mjs`, `docs/HUB-API.md`, and
`docs/openapi.yaml`, with gateway runtime tests in `test/gateway-section-source-rest.test.mjs`
and updated contract guards in `test/section-source-hub-rest-openapi-spec.test.mjs`.

The accepted body-free Hub REST endpoint is:

```text
GET /api/v1/section-source?path=<vault-relative-note-path>
```

Phase 1N exposes SectionSource through the hosted gateway only. It uses existing Hub REST
JWT auth, active vault id, effective canister user id, gateway canister auth headers, and a
single canister note read. It normalizes and rejects unsafe paths before upstream fetch,
returns only body-free `knowtation.section_source/v0` metadata, and sanitizes missing,
unauthorized, invalid, and upstream errors.

Phase 1N does not add Hub UI, canister routes, search, persistence, Scooling runtime
behavior, body reads, snippets, summaries, PageIndex, OCR, LLM calls, provider routing, MCP
resource URIs, or write-back behavior.

### Phase 1O: Hub UI Implementation Spec

Implemented on local Muse `main` in `docs/SECTION-SOURCE-HUB-UI-SPEC.md`, with Hub UI
implementation spec contract tests in `test/section-source-hub-ui-spec.test.mjs`.

Phase 1O specifies how a future Hub UI may consume body-free
`GET /api/v1/section-source?path=...` results. The accepted planning boundary covers Hub
session behavior, active vault behavior, API call shape, rendering allowlist, loading,
empty, truncated, missing, unauthorized, invalid, and upstream error states,
prompt-injection handling, logging and telemetry exclusions, deletion/export/staleness
behavior, accessibility expectations, write-back blocking, and Scooling consumption
boundaries.

Phase 1O does not add Hub UI runtime code, API calls, components, templates, JavaScript,
CSS, canister routes, search, persistence, Scooling runtime behavior, body reads, snippets,
summaries, PageIndex, OCR, LLM calls, provider routing, MCP resource URIs, or write-back
behavior.

### Phase 1P: Hub UI Runtime Implementation

Implemented on local Muse `main` in `web/hub/index.html`, `web/hub/hub.js`,
`web/hub/hub.css`, and `hub/server.mjs`, with Hub UI runtime tests in
`test/hub-section-source-ui-runtime.test.mjs`, self-hosted route tests in
`test/hub-section-source-self-hosted-route.test.mjs`, and updated contract guards in
`test/section-source-hub-ui-spec.test.mjs`.

Phase 1P adds a minimal body-free Sections action to the existing Hub note detail drawer.
The action uses the existing authenticated Hub REST helper, active vault header behavior,
and no-store fetch behavior to call:

```text
GET /api/v1/section-source?path=<vault-relative-note-path>
```

The runtime validates the `knowtation.section_source/v0` schema, rejects forbidden payload
keys before rendering, requires `body_returned: false` and `snippet_returned: false`, and
renders only escaped text for title, path, heading text, heading paths, section ids, child
section ids, and bounded state messages.

Phase 1P does not add canister routes, search, persistence, Scooling runtime behavior, body
reads, snippets, summaries, PageIndex, OCR, LLM calls, provider routing, MCP resource URIs,
or write-back behavior.

### Later Phases

Separate specs are required for:

- section body reads
- section snippets
- section summaries
- section search
- hybrid search
- section indexes or vectors
- persisted section sidecars
- MuseHub Knowtation domain/plugin support
- PageIndex/OCR/provider-derived sections

## Future JSON Contract Shape

This is the current body-free contract shape returned by the local library, local CLI,
self-hosted MCP tool, and hosted MCP tool.

```json
{
  "schema": "knowtation.section_source/v0",
  "path": "projects/example/note.md",
  "title": "Example",
  "sections": [
    {
      "section_id": "projects-example-note-md:h2-background-0001",
      "heading_id": "h2-background-0001",
      "level": 2,
      "heading_path": ["Research Plan", "Background"],
      "heading_text": "Background",
      "child_section_ids": [],
      "body_available": true,
      "body_returned": false,
      "snippet_returned": false
    }
  ],
  "truncated": false
}
```

## Field Rules

| Field | Rule |
| --- | --- |
| `schema` | Must be exactly `knowtation.section_source/v0` for the planned v0 shape. |
| `path` | Vault-relative note path supplied by the safe caller. Never absolute. |
| `title` | Same title derivation discipline as `DocumentTree v0`; may be null. |
| `sections` | Document-order list of section source candidates. |
| `section_id` | Deterministic and stable for identical path plus heading id. |
| `heading_id` | Existing heading id from `NoteOutline` / `DocumentTree`. |
| `level` | Markdown heading level, 1 through 6. |
| `heading_path` | Heading text ancestry. Private and untrusted. |
| `heading_text` | Heading text. Private and untrusted. |
| `child_section_ids` | Child section ids only, no child body text. |
| `body_available` | True when the source note has content under the heading, without disclosing that content. |
| `body_returned` | Must be false until a body policy is accepted. |
| `snippet_returned` | Must be false until a snippet policy is accepted. |
| `truncated` | True when caps are hit. |

## Explicitly Excluded Fields

`SectionSource v0` must not include:

- note body
- section body
- snippets
- source excerpts
- full frontmatter
- provider keys
- absolute filesystem paths
- rendered HTML
- byte offsets
- exact line ranges
- section body lengths
- LLM summaries
- vector scores
- label text
- media metadata
- attachment text
- OCR text
- PageIndex output
- memory events
- MCP resource URIs
- raw upstream canister payloads

## Authorization Rules

- A caller must be authorized to read the note before reading section sources.
- Section sources are private note-derived data.
- Hosted section source behavior must use the same active vault and effective canister
  user as `get_note`, `get_note_outline`, `get_document_tree`, and `get_metadata_facets`.
- Unauthorized and missing notes must not reveal more than existing note-read behavior.
- Output paths must be vault-relative and must not trust unsafe upstream paths.
- Classroom or Scooling use must respect learner, classroom, organization, and guardian
  policy before any section source is visible outside the private vault context.

## Body And Snippet Boundaries

The first runtime phase must return section source metadata only.

`docs/SECTION-SOURCE-BODY-SNIPPET-POLICY.md` accepts the Phase 1C body/snippet policy gate.
It blocks snippets for `SectionSource v0` and requires a separate implementation spec
before any future section body read can be added.

Section bodies and snippets must be treated as private note content. They are not model
instructions, not proof of correctness, and not safe to log.

## Prompt-Injection Handling

Every text field in `SectionSource v0` is untrusted:

- heading text
- heading path
- future snippet text
- future section body text
- future label text
- future metadata attached to sections

Agents and Scooling adapters must treat these fields as source material, not instructions.
Tests must include headings and section text that attempt to override system instructions,
exfiltrate secrets, trigger cloud routing, or bypass review gates.

## Deletion, Export, And Staleness Rules

Phase 1A and Phase 1B derive section sources on demand. They must not write sidecars,
indexes, vectors, memory, summaries, canister state, or cached provider output.

If a later phase persists or indexes section sources:

- deleting a note must delete or invalidate its section records
- editing a note must invalidate stale section boundaries
- changing a heading must update or invalidate descendant section ids
- export must explain which section records are derived and how to rebuild or discard them
- backup/restore must not require stale sidecars to preserve user-authored notes
- hosted vault isolation must be proven with multi-vault tests
- stale section snippets and summaries must be deleted or invalidated with the source note

## Scooling Adapter Consumption Boundary

Scooling may consume future `SectionSource v0` data only after Knowtation ships the tested
contract. Scooling must remain a consumer.

Scooling must not:

- parse Markdown as the canonical section parser
- derive canonical section ids
- persist section sources as truth
- treat section text as model instructions
- call PageIndex or OCR for canonical section extraction
- bypass Knowtation authorization
- expose private learner sections to classroom, mentor, public, or organization contexts
  without accepted policy
- write back learner knowledge without human review

When `SectionSource` is unavailable, Scooling must fall back to document-level retrieval
or body-free `NoteOutline`, `DocumentTree`, and `MetadataFacets` displays.

## Seven-Tier Test Plan

### Unit

- Builds deterministic section ids from path plus heading ids.
- Preserves document order.
- Builds correct heading paths.
- Handles repeated heading text with unique ids.
- Handles skipped heading levels.
- Marks `body_returned` and `snippet_returned` false.
- Caps large section lists.
- Rejects unsafe absolute and traversal paths.

### Integration

- Reuses `DocumentTree v0` heading ids without changing them.
- Local note integration derives section sources from current note content only.
- Traversal paths fail before file reads.
- Invalid Markdown remains safe and deterministic.
- Note read authorization gates section source reads.

### End To End

- Agent flow can inspect section candidates before fetching full note body.
- Scooling can display section availability/fallback state without body text.
- Scooling fallback remains intact when section sources are unavailable.

### Stress

- Large notes with many headings stay within caps.
- Deep heading nesting does not exceed call stack limits.
- Repeated builds with identical input are deterministic.
- Large body content does not produce unbounded output because body text is not returned.

### Data Integrity

- No writes to notes, sidecars, indexes, vectors, memory, summaries, or canister state.
- Output reflects current note content only.
- Input Markdown and tree objects are not mutated.
- Future persisted/indexed phases invalidate on note edit, heading edit, or note delete.

### Performance

- Pure section source construction is linear in heading count plus bounded body scanning.
- Output size is capped by section count and text caps.
- Hosted future phases must not scan a whole vault for one-note section sources.
- No external provider calls in v0.

### Security

- No body text in v0 output.
- No snippets in v0 output.
- No full frontmatter in output.
- No absolute filesystem paths in output.
- Unauthorized and missing notes do not leak extra details.
- Prompt-injection text remains plain source text.
- Hosted role and vault behavior are explicitly tested before hosted exposure.
- No PageIndex, OCR, LLM, vector, memory, media metadata, or provider-derived text appears
  in v0 output.

## Stop Conditions

Stop and re-plan if any work requires:

- returning note body text
- returning section body text
- returning snippets
- returning exact line ranges
- returning byte offsets
- returning section body lengths
- adding summaries
- adding vector or search behavior
- adding persistence or sidecars
- adding Hub REST, OpenAPI, Hub UI, hosted MCP, or canister routes
- adding Scooling runtime code
- adding MuseHub domain/plugin changes
- sending private content to cloud models
- routing private files or metadata to external providers
- calling PageIndex or OCR
- weakening hosted scope behavior

## Acceptance Criteria

The spec is acceptable when:

- It keeps `SectionSource` separate from `DocumentTree`, `MetadataFacets`, summaries, and
  search.
- It defines a body-free first runtime phase.
- It blocks snippets and section body text until a separate policy is accepted.
- It defines deletion, export, and stale-derived-data rules before persistence.
- It treats all text as private and untrusted.
- It includes seven-tier tests for the planned runtime phases.
- It keeps Scooling behind adapter boundaries.

## Recommendation

Phase 1A, Phase 1B, Phase 1C, Phase 1D, Phase 1E, Phase 1F, Phase 1G, Phase 1H, Phase 1I,
Phase 1K, Phase 1L, Phase 1M, Phase 1N, Phase 1O, and Phase 1P are implemented on local
Muse `main`.

Phase 1J is implemented in the Scooling repository at commit `ea5421e`.

The next safe Knowtation step, if more SectionSource capability is required, is a separate
implementation spec for search, persistence, body reads, snippets, summaries, PageIndex,
OCR, LLM calls, provider routing, MuseHub domain/plugin support, or write-back behavior. Do
not add those surfaces until separate implementation specs and seven-tier test plans are
accepted.

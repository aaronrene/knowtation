# DocumentTree v0 Spec

## Simple Summary

`DocumentTree v0` is the next hierarchical contract after `NoteOutline`.

`NoteOutline` shows a flat list of headings for one Markdown note. `DocumentTree v0`
defines a nested tree of those headings so future tools can understand parent and child
sections without reading the full note body.

This document started as the planning checkpoint for the tree contract. Phases 1A through
1E are now implemented and merged into local Muse `main`. Remaining work belongs to later,
separate phases: section retrieval, summaries, persistence, indexing, Hub REST/OpenAPI,
and label or provider-derived metadata. Section retrieval planning starts in
`docs/SECTION-SOURCE-V0-SPEC.md`.

## Technical Summary

`DocumentTree v0` is a derived, read-only, on-demand structure over one Markdown note.
It turns the existing heading-only `NoteOutline` sequence into a nested tree contract.

The current runtime implementation includes the pure builder, Markdown parser integration,
local CLI, self-hosted MCP, and hosted MCP. Section retrieval, indexing, persistence,
metadata facets, label text, summaries, and Scooling adapter integration remain separate
phases.

## Implementation Status

| Phase | Status |
| --- | --- |
| Phase 0: Spec | Implemented on local Muse `main`. |
| Phase 1A: Tree Builder Only | Implemented on local Muse `main`. |
| Phase 1B: Markdown Parser Integration | Implemented on local Muse `main`. |
| Phase 1C: CLI | Implemented on local Muse `main`. |
| Phase 1D: Self-Hosted MCP | Implemented on local Muse `main`. |
| Phase 1E: Hosted MCP | Implemented on local Muse `main`. |

## Relationship To Existing Work

### `NoteOutline`

`NoteOutline` is complete and implemented on local Muse `main`. It returns:

```text
schema, path, title, headings[], truncated
```

Each heading has:

```text
level, text, id
```

`DocumentTree v0` must reuse the same parser discipline, heading text normalization,
heading id rules, path safety, caps, and read authorization rules unless the spec
explicitly tightens them.

### Scooling Bridge

Scooling has a mock/fixture bridge that can recognize and display safe `NoteOutline`
data. Scooling must not become the canonical tree parser.

`DocumentTree v0` is the Knowtation-side contract that supports Scooling's future
tree-aware UI. Scooling should consume it only through adapter boundaries after tests
prove the consumer contract.

## Goals

- Define a nested, deterministic tree contract for one Markdown note.
- Keep the first tree version read-only and on-demand.
- Preserve the same privacy model as note body reads.
- Keep output body-free and summary-free.
- Give Scooling a future target without starting section search.
- Prepare for future section retrieval without committing to storage or vectors.

## Long-Term Direction

The larger goal is not only to draw a heading tree.

The larger goal is to help Knowtation and Scooling find every authorized source that can
ground a learning answer:

- headings
- section titles
- categories
- topics
- terms
- tags
- entities
- frontmatter fields
- link labels
- attachment labels
- image alt text
- image captions
- video titles
- video descriptions
- transcript labels
- any other user-visible labeled text

Those labels are source material. They may contain private learner content, secrets,
copyrighted text, or prompt injection. Future retrieval must therefore treat them as
scoped, untrusted content and serve them only through the same authorization and redaction
rules as note text.

`DocumentTree v0` is the first structural contract. It is intentionally small so later
metadata, media labels, and section retrieval can attach to a tested tree instead of being
added through ad hoc search fields.

## Remaining Non-Goals

- No Hub REST endpoint.
- No OpenAPI changes.
- No Hub UI.
- No canister storage changes.
- No sidecar files.
- No persistence.
- No search mode changes.
- No vector/index payload changes.
- No section search.
- No hybrid search.
- No LLM summaries.
- No memory events.
- No daemon or discover-pass changes.
- No line ranges in hosted output.
- No byte offsets.
- No section body text.
- No snippets.
- No PDF/DOCX extraction.
- No PageIndex.
- No OCR.

These are non-goals for `DocumentTree v0`, not declarations that the capabilities are
permanently unwanted. The later-goal classification below controls what can return in
future specs.

## Later-Goal Classification

### Planned Later Goals

These are expected future capabilities after separate specs, tests, and security review:

- Hub REST and OpenAPI for tree reads.
- Scooling adapter consumption of real Knowtation trees.
- Section body extraction under strict body/snippet rules.
- Section retrieval for authorized sections.
- Tree persistence or sidecars if deletion/export/lifecycle rules are accepted first.
- Index/vector payload changes for section-aware retrieval.
- Categories, topics, terms, tags, entities, and other note metadata as retrieval facets.
- Attachment labels, image alt text, captions, video titles, video descriptions, and
  transcripts as authorized retrieval material.
- LLM summaries after consent, retention, deletion, cost, and audit rules are accepted.
- PageIndex for scanned or complex documents when explicitly enabled.
- OCR for scanned pages, photographed pages, image-only PDFs, and inaccessible media text.
- Knowtation domain/plugin updates in MuseHub so structured trees and labeled metadata
  participate in versioning, review, provenance, and future domain-aware diffs.

### Always Separate Decisions

These require explicit approval before implementation because they change privacy,
storage, cost, or trust boundaries:

- Sending private learner content to cloud models.
- Sending private learner files to PageIndex or another external processor.
- Storing derived tree, label, summary, OCR, or provider data.
- Changing canister storage.
- Returning body text, snippets, line ranges, byte offsets, or section body lengths from
  hosted surfaces.
- Making labels or summaries visible to Scooling users outside the caller's authorized
  vault/workspace/classroom scope.

### Permanent Guardrails

These should remain true for every future phase:

- No unauthorized read of note body, headings, labels, media metadata, or derived data.
- No secrets in committed docs, fixtures, logs, telemetry, errors, prompts, or provenance.
- No direct agent write to canonical learner knowledge without human review.
- No external provider as source of truth.
- No Scooling-owned canonical parser or index.
- No fallback that weakens hosted scope behavior.

## Terminology

| Term | Meaning |
| --- | --- |
| `NoteOutline` | Existing flat heading list for one Markdown note. |
| `DocumentTree` | Nested heading tree for one Markdown note in this v0 spec. |
| `DocumentTreeNode` | One heading represented as a tree node. |
| `SectionBody` | Body content under a heading. Not part of v0 output. |
| `SectionSearch` | Retrieval over sections. Not part of v0. |
| `LabelText` | User-visible text attached to content, such as tags, image alt text, captions, video descriptions, transcript labels, and attachment labels. Not part of v0 output. |
| `MetadataFacet` | Structured metadata used to narrow retrieval, such as project, category, topic, tag, entity, source type, date, or attachment type. Not part of v0 output. |
| `DocumentOutline` | Reserved future term for non-Markdown or imported documents. |
| `PageIndexProvider` | Reserved future optional external provider. Not part of v0. |

## Completed Phase Order

### Phase 0: Spec

Created this document before runtime behavior changed.

### Phase 1A: Tree Builder Only

Added a pure tree builder that accepts `NoteOutline`-equivalent heading records and returns
`DocumentTree` JSON.

No file reads, CLI, MCP, hosted behavior, storage, search, summaries, imports, or UI.

### Phase 1B: Markdown Parser Integration

Added a local pure function that builds a `DocumentTree` from Markdown by reusing the
existing note outline parsing behavior.

At this phase boundary, no command surfaces were added.

### Phase 1C: CLI

Added a local CLI command after parser and tree tests passed:

```text
knowtation get-document-tree <path> --json
```

This command reads one vault-relative Markdown note and returns the `DocumentTree v0`
contract.

### Phase 1D: Self-Hosted MCP

Added self-hosted MCP after CLI behavior was stable:

```text
get_document_tree
```

The tool mirrors CLI semantics.

### Phase 1E: Hosted MCP

Hosted MCP was added after local CLI and self-hosted MCP tests passed, and after hosted
role behavior was reviewed.

This phase adds one hosted MCP tool:

```text
get_document_tree
```

The tool must mirror hosted `get_note_outline` and hosted `get_note` access:

- register only when `isToolAllowed('get_document_tree', role)` is true
- classify `get_document_tree` as a viewer-level read tool in hosted MCP ACL
- expose it for viewer, editor, evaluator, and admin roles
- fetch the note from the canister with `GET /api/v1/notes/:path`
- use the same `Authorization`, `X-Vault-Id`, effective `X-User-Id`, and
  `X-Gateway-Auth` behavior as hosted `get_note`
- parse canister frontmatter only to derive title, using the existing hosted
  frontmatter parser
- build the tree from the canister note body using the same `DocumentTree v0` builder as
  CLI and self-hosted MCP
- return the requested vault-relative path in output, not an unsafe or absolute upstream
  path supplied by the canister response
- preserve current hosted missing/forbidden note behavior by returning `UPSTREAM_ERROR`
  without adding existence details

Hosted output must not include body text, snippets, line ranges, byte offsets, source
excerpts, full frontmatter, summaries, vectors, labels, metadata facets, memory events,
resource URIs, bridge search results, or extra canister data.

Do not add Hub REST, OpenAPI, Hub UI, canister schema, bridge API, persistence, search,
indexing, vectors, summaries, PageIndex, OCR, media label extraction, or Scooling adapter
changes in this phase.

#### Phase 1E Tests

The dedicated hosted MCP test file is:

```text
test/mcp-hosted-document-tree.test.mjs
```

Covered assertions:

- viewer role lists `get_document_tree`
- editor, evaluator, and admin role tool lists include `get_document_tree`
- `get_document_tree` uses the exact same canister `GET /api/v1/notes/:path` route and
  auth headers as `get_note`
- success returns `schema: "knowtation.document_tree/v0"`
- success returns the requested vault-relative `path`
- success returns nested `root.children[]`
- success excludes `body`, `frontmatter`, `snippet`, `summary`, vectors, labels,
  metadata facets, absolute paths, and full note text
- upstream 404 returns `UPSTREAM_ERROR`
- upstream 403 returns `UPSTREAM_ERROR`
- unsafe upstream paths are ignored in favor of the requested path
- no `document-tree`, `tree`, or `get_document_tree` resource URI appears in
  `resources/list` or `resources/templates/list`
- hosted `get_note_outline`, self-hosted `get_document_tree`, CLI `get-document-tree`,
  and hosted tool-list tests still pass

#### Release-Readiness Review Gate

Before release, merge, push, or any new runtime phase, review and close the following
security-first items through focused tests:

- hosted MCP must reject unsafe requested paths before any upstream note fetch
- hosted ACL helpers should directly assert `get_document_tree` is viewer-level read
  access for viewer, editor, evaluator, and admin roles
- local vault reads should prove symlink paths cannot escape the configured vault root
- public `DocumentTree` builder entry points should preserve bounded behavior for
  untrusted direct outline input
- path normalizers should reject absolute-looking backslash paths consistently

These are release hardening items, not permission to add section retrieval, metadata,
label text, Scooling adapter code, storage, vectors, LLM calls, Hub REST, or OpenAPI.

### Later Phases

These require separate specs:

- section body extraction
- section retrieval (`docs/SECTION-SOURCE-V0-SPEC.md`)
- section summaries
- tree persistence
- index/vector integration
- metadata facets for categories, topics, terms, tags, and entities
- label text extraction for images, videos, attachments, transcripts, and captions
- Hub REST
- OpenAPI
- Hub UI
- imports for PDF/DOCX
- PageIndex
- OCR
- Knowtation domain/plugin integration in MuseHub

### Suggested Later Phase Order

This order keeps retrieval value moving while preserving privacy and lifecycle controls:

1. SectionSource planning for body-free section candidates
   (`docs/SECTION-SOURCE-V0-SPEC.md`).
2. Metadata facet contract for categories, topics, terms, tags, entities, and
   frontmatter-derived labels.
3. Label text contract for media and attachments, including image alt text, captions,
   video descriptions, and transcripts.
4. Section retrieval over authorized Markdown sections.
5. Persistence/index lifecycle spec covering deletion, export, retention, backups, and
   stale-derived-data cleanup.
6. Section-aware index/vector integration.
7. Scooling real adapter integration after Knowtation contracts are tested.
8. Hub REST/OpenAPI/UI surfaces.
9. Knowtation domain/plugin updates in MuseHub.
10. LLM summaries, PageIndex, OCR, and external providers after consent, retention,
    deletion, audit, and cost controls are accepted.

## JSON Contract

### Success Shape

```json
{
  "schema": "knowtation.document_tree/v0",
  "path": "inbox/example.md",
  "title": "Example",
  "root": {
    "children": [
      {
        "id": "h1-introduction-0001",
        "level": 1,
        "text": "Introduction",
        "children": [
          {
            "id": "h2-background-0002",
            "level": 2,
            "text": "Background",
            "children": []
          }
        ]
      }
    ]
  },
  "truncated": false
}
```

### Field Rules

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `schema` | string | Yes | Exactly `knowtation.document_tree/v0`. |
| `path` | string | Yes | Vault-relative note path. Never absolute. |
| `title` | string or null | Yes | Same title rule as `NoteOutline`. |
| `root` | object | Yes | Synthetic root. No `text`, `id`, or `level`. |
| `root.children` | array | Yes | Top-level heading nodes. Empty when no headings. |
| `truncated` | boolean | Yes | True when parser caps removed nodes from output. |

`DocumentTreeNode`:

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `id` | string | Yes | Same heading id as `NoteOutline` for the same heading sequence. |
| `level` | number | Yes | Markdown heading level, 1 through 6. |
| `text` | string | Yes | Plain heading text, never rendered HTML. |
| `children` | array | Yes | Child heading nodes in document order. |

### Explicitly Excluded Fields

`DocumentTree v0` must not include:

- note body
- section body
- snippets
- source excerpts
- full frontmatter
- provider keys
- absolute filesystem paths
- raw HTML rendering
- byte offsets
- exact line ranges
- section body lengths
- LLM summaries
- vector scores
- memory events
- MCP resource URIs
- canister internal ids beyond existing safe note-read behavior

## Tree Construction Rules

Input headings are processed in document order.

Rules:

- A heading becomes a node.
- A heading with a greater level than the previous heading becomes a child of the nearest
  preceding heading with a lower level.
- A heading with the same level becomes a sibling of the previous same-level node under
  the same parent.
- A heading with a lower level closes deeper ancestors until the nearest valid parent is
  found.
- Skipped levels are allowed. A `###` after `#` becomes a child of the `#`.
- Empty heading text is allowed and uses the same id behavior as `NoteOutline`.
- Duplicate heading text keeps distinct ids through ordinal numbering.

Example:

```markdown
# A
### B
## C
# D
```

Expected shape:

```text
root
  A
    B
    C
  D
```

## Caps And Truncation

`DocumentTree v0` inherits the current `NoteOutline` caps unless a later implementation
proves a stricter cap is needed.

Current baseline:

- max input characters parsed: 1,000,000
- max headings returned: 500

If headings are capped:

- include only the first capped headings in document order
- construct the tree from the included headings only
- set `truncated: true`

The implementation must not silently include partial body text to explain truncation.

## Error Contract

CLI JSON errors match the existing CLI JSON error shape:

```json
{ "error": "message", "code": "ERROR_CODE" }
```

MCP errors follow existing MCP JSON text error patterns.

Missing-note and unauthorized-note behavior must not reveal more than existing `get_note`
and `get_note_outline` behavior.

## Security Invariants

### General

- `DocumentTree` is note-content-derived data.
- A caller must be allowed to read the note before reading the tree.
- Heading text is private note content.
- Heading text is untrusted prompt content.
- Future label text and metadata facets are private, scoped, untrusted content.
- Output must never include note body or section body.
- Output must never include snippets or source excerpts.
- Output must never include full frontmatter.
- Output must never include absolute paths.
- Output must never render Markdown or HTML into executable markup.
- Logs must not include heading text, body text, secrets, or raw upstream responses.
- Errors must not reveal whether a forbidden path exists beyond existing note-read
  behavior.

### Local CLI And Self-Hosted MCP

- Resolve paths with existing vault path safety helpers.
- Only read files under the configured vault root.
- Respect existing note read behavior.
- Do not read `.env`, `config/local.yaml`, `data/`, or ignored/non-vault files.
- Reject traversal paths before reading.

### Hosted MCP

Hosted MCP is implemented as a transport-only extension of the `DocumentTree v0`
contract.

Hosted tree access must continue to:

- use the same effective canister user as `get_note`
- use the active `X-Vault-Id`
- include gateway/canister auth headers exactly like existing hosted note reads
- do not expose trees through `resources/list`
- do not add tree resource URIs
- test viewer, editor, evaluator, and admin roles explicitly
- ensure output path reflects the requested vault-relative path, not upstream unsafe data
- do not call the bridge, search route, indexer, memory store, LLM sampling, or any
  external provider
- do not write tree data to the canister, gateway, bridge, memory, logs, telemetry, or
  local disk

## Memory, Daemon, And Discover Interaction

`DocumentTree v0` does not write memory events.

Rationale:

- The tree is derived from current note content.
- Storing heading trees in memory duplicates private note content.
- Derived memory can become stale after note edits.

Future coarse events such as `document_tree_read` require a separate privacy review.

## Imports, PageIndex, And OCR

`DocumentTree v0` does not change imports.

Markdown notes created by existing import paths can be parsed later because they are normal
vault content.

PageIndex and OCR remain deferred. If a future provider creates structure from scanned or
complex documents, Knowtation must normalize provider output into a Knowtation-owned
contract. Provider output must not become the source of truth.

Before any provider ships, there must be a separate spec for:

- consent
- retention
- deletion
- audit
- provider keys
- cost caps
- hosted/private data routing
- fallback behavior

## Future Metadata And Label Retrieval

`DocumentTree v0` does not expose categories, topics, terms, tags, entities, media labels,
or attachment text. Those are planned later because they are central to Scooling's source
discovery goal.

Future retrieval should be able to find and cite authorized material from:

- Markdown headings and section titles
- frontmatter categories, projects, topics, terms, tags, entities, episodes, and causal
  chains
- inline labels and link text
- attachment filenames and explicit attachment labels
- image alt text and captions
- video titles, captions, descriptions, and transcript labels
- OCR text only after OCR consent and lifecycle controls exist
- PageIndex-derived page labels only after provider controls exist

This future layer needs its own contract because label text can be both useful and risky.
It can contain private student content, prompt injection, secrets, copyrighted excerpts,
or provider-derived data with deletion obligations.

Before metadata or label retrieval ships, the plan must define:

- which fields are canonical user-authored data
- which fields are derived data
- which labels are safe to display in Scooling
- which labels can be sent into model prompts
- how labels are deleted when source notes or attachments are deleted
- how stale labels are invalidated after edits
- how labels are exported
- how hosted vault scope is enforced
- how model/provider costs are capped when labels are produced by AI

## MuseHub Knowtation Domain Integration

Knowtation already has a domain/plugin direction in MuseHub for notes, sections, links,
frontmatter, entities, and attachments. `DocumentTree` and future label metadata must be
planned as additions to that domain.

This integration is not part of v0. It should be a later phase after the local Knowtation
contracts are stable.

Future MuseHub domain work should cover:

- `DocumentTree` nodes as structured domain entities
- metadata facets as typed fields, not ad hoc text
- label text for media and attachments
- provenance for derived labels, summaries, OCR, and provider output
- domain-aware diffs for tree or metadata changes
- merge behavior when headings, tags, labels, or attachments change independently
- review surfaces for derived metadata before it affects Scooling retrieval
- deletion and retention behavior for derived domain records
- compatibility with Scooling's adapter contracts

This phase should happen before any production claim that MuseHub fully understands
tree-aware Knowtation retrieval.

## Scooling Interaction

Scooling can continue using `NoteOutline` for mock and fixture display.

Scooling should not depend on `DocumentTree` until Knowtation ships a tested contract.

Future adapter target:

```text
KnowtationVaultAdapter.getDocumentTree(path)
```

Scooling must keep fallback behavior when `DocumentTree` is unavailable.

## Test Matrix

### Unit

- Empty heading list returns `root.children: []`.
- Single heading becomes one root child.
- Same-level headings become siblings.
- Deeper headings become children.
- Lower-level headings close ancestors correctly.
- Skipped heading levels nest under the nearest lower-level heading.
- Duplicate heading text keeps distinct ids.
- Empty heading text is preserved.
- Unknown top-level fields are rejected by schema tests.
- Node order matches document order.

### Integration

- Markdown parser output can feed tree builder without changing heading ids.
- CLI fixture returns valid `DocumentTree v0` JSON.
- Self-hosted MCP returns the same JSON shape as CLI.
- Hosted MCP returns the same JSON shape as CLI and self-hosted MCP while using hosted
  canister authorization.
- Traversal paths fail before file reads.
- Future metadata and label retrieval tests prove categories, topics, terms, tags, alt
  text, captions, and video descriptions stay scoped to authorized notes or attachments.
- Future MuseHub domain tests prove tree nodes and label metadata are typed domain
  records, not unstructured side effects.

### End To End

- Scooling can render a fixture tree without body text once its adapter slice is merged.
- Hosted MCP Phase 1E has no Scooling end-to-end path; hosted MCP tests are transport and
  authorization tests only.

### Stress

- Large heading lists stay within cap.
- Deeply nested heading patterns do not exceed call stack limits.
- Repeated builds with the same input are deterministic.

### Data Integrity

- Tree builder does not mutate input heading arrays.
- Parser does not mutate notes.
- Runtime does not write sidecars.
- Runtime does not update indexes, vectors, memory, or summaries.
- IDs are deterministic for identical input.
- Future label and metadata phases remove or invalidate derived records when notes,
  attachments, or source labels are edited or deleted.
- Future MuseHub domain phases preserve provenance for derived tree, label, OCR, summary,
  and provider output.

### Performance

- Tree construction is linear in heading count.
- Parser remains bounded by input and heading caps.
- Deep nesting does not create unbounded recursion.

### Security

- No body text in output.
- No snippets in output.
- No full frontmatter in output.
- No absolute paths in output.
- Path traversal fails.
- HTML/script-like heading text stays plain text.
- Unauthorized and missing notes do not leak extra information.
- Hosted role behavior is explicitly tested for hosted tree access.
- Future label text tests treat alt text, captions, video descriptions, transcript labels,
  and attachment labels as untrusted prompt-injection content.
- Future Scooling source-serving tests prove unauthorized labels cannot influence a
  learner answer or source list.

## Files Touched By Completed Phases

### Phase 1A

- `lib/document-tree.mjs`
- `test/document-tree.test.mjs`

### Phase 1B

- `lib/document-tree.mjs`
- `test/document-tree.test.mjs`
- possibly `lib/note-outline.mjs` only if a shared helper is needed

### Phase 1C

- `cli/index.mjs`
- `test/cli.test.mjs`
- `docs/SPEC.md`
- `docs/CLI-JSON-SCHEMA.md`
- `docs/RETRIEVAL-AND-CLI-REFERENCE.md`

### Phase 1D

- `mcp/create-server.mjs`
- self-hosted MCP tests
- `docs/AGENT-INTEGRATION.md`

### Phase 1E

- `hub/gateway/mcp-hosted-server.mjs`
- `hub/gateway/mcp-tool-acl.mjs`
- `test/mcp-hosted-document-tree.test.mjs`
- `test/mcp-hosted-tools-list.test.mjs`
- `test/mcp-hosted-note-outline.test.mjs` as a regression companion
- `docs/PARITY-MATRIX-HOSTED.md`
- `docs/AGENT-INTEGRATION.md`
- `docs/SPEC.md`

### Later Metadata And Domain Phases

- `docs/DOCUMENT-TREE-V0-SPEC.md`
- `docs/SPEC.md`
- `docs/RETRIEVAL-AND-CLI-REFERENCE.md`
- `docs/PARITY-MATRIX-HOSTED.md`
- metadata facet modules and tests
- label text extraction modules and tests, names to be chosen in the later spec
- MuseHub Knowtation domain/plugin files and tests, names to be confirmed in the later
  MuseHub-domain spec

## Stop Conditions

Stop and re-plan if any work requires:

- returning note body text
- returning section body text
- returning snippets
- returning line ranges in hosted output
- adding categories, topics, terms, tags, entities, labels, alt text, captions, video
  descriptions, transcripts, or attachment text to the v0 tree response
- adding a Hub REST route
- updating OpenAPI
- adding or changing a canister route or canister schema
- using the bridge, search route, vectors, memory, LLM sampling, or external providers for
  hosted `get_document_tree`
- changing search/index/vector behavior
- adding persistence
- adding sidecar files
- adding MuseHub Knowtation domain/plugin changes
- adding PageIndex
- adding OCR
- adding LLM summaries
- changing canister storage
- weakening hosted scope behavior
- returning the upstream canister `path` when it differs from the requested
  vault-relative path
- exposing tree resources through MCP resource listings
- sending private content to cloud models
- routing private files to external providers

## Acceptance Criteria

The spec is acceptable only when:

- It keeps `DocumentTree` separate from `NoteOutline`.
- It preserves the `NoteOutline` security invariants.
- It defines a body-free nested JSON contract.
- It defers section search, summaries, persistence, PageIndex, OCR, Hub REST, metadata
  facets, label text, and MuseHub domain/plugin updates into explicit later phases.
- It records the long-term goal that Scooling should eventually retrieve authorized
  categories, topics, terms, tags, entities, alt text, captions, video descriptions,
  transcript labels, and attachment labels.
- It includes seven-tier tests for future runtime phases.
- It defines explicit stop conditions.
- It gives Scooling a future target without requiring Scooling to parse Markdown.

## Recommendation

Do not implement additional runtime surfaces until their phase-specific review is complete.
Section retrieval planning begins in `docs/SECTION-SOURCE-V0-SPEC.md`.

The completed v0 transport sequence is:

1. Tree builder tests.
2. Pure tree builder.
3. Markdown parser integration.
4. CLI command.
5. Self-hosted MCP.
6. Hosted MCP.

The next phase must be planned separately before implementation.

Security-first next phase recommendation:

1. Complete release-readiness cleanup and hardening tests for the existing `DocumentTree`
   surfaces.
2. Use `docs/SECTION-SOURCE-V0-SPEC.md` to plan body-free section candidates before any
   section body, snippet, search, or persistence work.
3. Then plan a metadata facet contract for categories, topics, terms, tags, entities, and
   frontmatter-derived labels.
4. Keep future Scooling `SectionSource` integration behind adapter boundaries until
   section authorization, deletion behavior, and body/snippet invariants are accepted.

Do not bundle `DocumentTree v0` with section search, summaries, persistence, metadata
facets, label text, MuseHub domain/plugin changes, PageIndex, OCR, Hub REST, or OpenAPI.

# MetadataFacets v0 Spec

## Simple Summary

`MetadataFacets v0` is the tested contract for safe structured note metadata after
`DocumentTree v0`.

`DocumentTree v0` answers "what headings exist in this note?" without returning note
body text. `MetadataFacets v0` exposes selected existing note metadata as bounded,
body-free filters and source-discovery hints.

Local Muse `main` implements the pure normalizer, CLI read surface, self-hosted MCP read
surface, hosted MCP read surface, and Scooling adapter consumption slice.

## Technical Summary

`MetadataFacets v0` classifies existing vault metadata into canonical user-authored
facets, inferred facets, and deferred label text. The shipped v0 contract adds dedicated
body-free CLI and MCP read surfaces without changing search, indexes, Hub REST routes,
Hub UI, storage, or MuseHub domain/plugin behavior.

The first safe target is metadata already represented in current note frontmatter and
list/search metadata:

- `project`
- `tags`
- `date`
- `updated`
- `causal_chain_id`
- `entity`
- `episode_id`

Future fields such as categories, topics, and terms are planned here but must not ship
until their canonical field names, normalization, deletion behavior, and authorization
rules are accepted.

## Implementation Status

| Phase | Status |
| --- | --- |
| Phase 0: Spec | Implemented on local Muse `main`. |
| Phase 1A: Pure facet normalizer | Implemented on local Muse `main`. |
| Phase 1B: CLI read surface | Implemented on local Muse `main`. |
| Phase 1C: Self-hosted MCP read surface | Implemented on local Muse `main`. |
| Phase 1D: Hosted MCP read surface | Implemented on local Muse `main`. |
| Phase 1E: Scooling adapter consumption | Implemented, tested, merged, and published on Scooling `main`. |

## Relationship To Existing Work

### `DocumentTree v0`

`DocumentTree v0` remains heading-only and body-free. It must not grow metadata facet
fields. Metadata facets are a separate contract so callers cannot accidentally treat a
tree read as a broader metadata read.

### Existing List And Search Metadata

Current `list-notes` and `search` already expose limited metadata such as `project`,
`tags`, and `date` depending on fields/options. `MetadataFacets v0` does not redefine
those outputs. It provides a dedicated one-note contract that is tested independently.

### Temporal And Causal Fields

`INTENTION-AND-TEMPORAL.md` already reserves optional frontmatter fields such as
`causal_chain_id`, `entity`, and `episode_id`. This spec treats those as existing
optional structured facets when present.

### Label Text

Label text is not metadata facets v0.

Examples deferred to a separate label contract:

- inline link labels
- attachment labels
- image alt text
- image captions
- video titles
- video descriptions
- transcript labels
- OCR text
- PageIndex-derived labels

Those fields can contain prompt injection, copyrighted excerpts, private learner content,
or provider-derived data. They require a separate retention, deletion, provider, and
prompt-use review.

## Goals

- Define a small metadata facet vocabulary for body-free source discovery.
- Preserve the same authorization boundary as note reads.
- Keep canonical user-authored metadata separate from inferred or AI-derived labels.
- Give Scooling a metadata target without making Scooling the canonical parser.
- Keep tests ahead of each runtime surface.
- Avoid changing existing `DocumentTree v0`, search, list, index, Hub REST, Hub UI, or
  storage behavior in v0.

## Remaining Non-Goals

- No Hub REST endpoint.
- No OpenAPI change.
- No Hub UI.
- No canister schema or route change.
- No index or vector payload change.
- No persistence or sidecar files.
- No section retrieval.
- No section body extraction.
- No snippets.
- No full frontmatter output.
- No LLM summaries.
- No AI categorization.
- No label text extraction.
- No PageIndex.
- No OCR.
- No MuseHub domain/plugin change.

## Facet Classification

### Canonical User-Authored Facets

These are eligible for v0 planning because they can be authored directly in note
frontmatter or inferred from stable vault paths.

| Facet | Source | Normalization | Notes |
| --- | --- | --- | --- |
| `project` | frontmatter `project` or `projects/<slug>/` path inference | existing slug rules | Already used by list/search and bulk metadata operations. |
| `tags` | frontmatter `tags` | existing tag normalization | YAML list or comma-separated string. |
| `date` | frontmatter `date` | ISO/date string | Used for temporal filtering when present. |
| `updated` | frontmatter `updated` | ISO/date string | Optional freshness signal. |
| `causal_chain_id` | frontmatter `causal_chain_id` | existing slug rules | Reserved by temporal/causal docs. |
| `entity` | frontmatter `entity` | existing slug rules, array output | Reserved by temporal/causal docs. |
| `episode_id` | frontmatter `episode_id` | existing slug rules | Reserved by temporal/causal docs. |

### Planned Canonical Facets

These require a later acceptance pass before implementation:

- `category`
- `categories`
- `topic`
- `topics`
- `term`
- `terms`

Before implementation, the project must choose singular vs plural field names, array vs
string behavior, normalization rules, and compatibility with existing user notes.

### Inferred Facets

Inferred facets may come from deterministic local rules, such as path prefix, file type,
or import source. They must be marked as inferred in any future contract. They must not
pretend to be user-authored frontmatter.

Examples:

- folder path
- path prefix
- source type
- import source
- note kind such as approval log

### Deferred Derived Facets

Derived facets created by AI, OCR, PageIndex, external providers, or background
classification are out of scope. They require consent, audit, retention, deletion,
provider-key, and cost controls.

## JSON Contract Shape

The CLI command is `get-metadata-facets <path> --json`; the MCP tool name is
`get_metadata_facets`.

```json
{
  "schema": "knowtation.metadata_facets/v0",
  "path": "projects/example/note.md",
  "facets": {
    "project": "example",
    "tags": ["research"],
    "date": "2026-05-24",
    "updated": null,
    "causal_chain_id": null,
    "entity": [],
    "episode_id": null
  },
  "inferred": {
    "folder": "projects/example",
    "source_type": null
  },
  "truncated": false
}
```

## Explicitly Excluded Fields

`MetadataFacets v0` must not include:

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

## Security Invariants

- A caller must be authorized to read the note before reading its facets.
- Facets are private note-derived data.
- Facet values are untrusted prompt content.
- Hosted facets must be scoped to the active vault and effective canister user.
- Output paths must be vault-relative and must not use unsafe upstream paths.
- Errors must not reveal more than existing note-read behavior.
- Logs must not include raw facet values, raw frontmatter, note body text, secrets, or
  raw upstream responses.
- Future Scooling use must treat facets as source-discovery hints, not proof of answer
  content.

## Deletion, Export, And Staleness Rules

For v0, metadata facets are derived on demand from the current note. That avoids new
stale sidecars and deletion problems.

If a later phase persists facets or indexes them:

- deleting a note must delete or invalidate its facets
- editing frontmatter must update or invalidate stale facets
- export must include enough information to explain which facets came from user-authored
  frontmatter and which were inferred
- backups must preserve user-authored frontmatter without requiring derived sidecars
- hosted vault isolation must be proven with multi-vault tests

## Completed Phase Order

### Phase 0: Spec

Created this document and accepted the v0 boundary before runtime behavior changed.

### Phase 1A: Pure Facet Normalizer

Added a local pure function that accepts parsed note metadata and returns normalized,
body-free facets.

The normalizer has no file reads, writes, CLI, MCP, hosted, index, storage, Scooling,
Hub, MuseHub, AI, OCR, or PageIndex behavior.

### Phase 1B: CLI Read Surface

Added `get-metadata-facets <path> --json` as a body-free local CLI read after pure
tests passed.

### Phase 1C: Self-Hosted MCP Read Surface

Mirrored the CLI semantics over self-hosted MCP as `get_metadata_facets`.

### Phase 1D: Hosted MCP Read Surface

Added hosted MCP after local and self-hosted tests passed and hosted role behavior was
reviewed.

Hosted implementation must use the same canister read path, vault header, effective user,
and error behavior as `get_note` and `get_document_tree`.

### Phase 1E: Scooling Adapter Consumption

Scooling consumes metadata facets only after Knowtation shipped the tested contract.
Scooling remains a consumer and is not the canonical metadata parser.

## Test Matrix

### Unit

- Normalizes project with existing slug rules.
- Normalizes tags from strings and arrays.
- Normalizes entity arrays with existing slug rules.
- Preserves null/empty optional facets deterministically.
- Separates canonical user-authored facets from inferred facets.
- Rejects unsafe absolute and traversal paths.
- Does not mutate input frontmatter.

### Integration

- Facets derived from parsed vault notes match `list-notes` project/tag semantics.
- Path-inferred project matches `effectiveProjectSlug`.
- CLI output matches the pure normalizer contract.
- Self-hosted MCP output matches CLI shape.
- Hosted MCP output matches CLI shape while enforcing hosted authorization.

### End To End

- Scooling can render authorized metadata hints without body text.
- Scooling fallback behavior remains intact when metadata facets are unavailable.

### Stress

- Large tag/entity arrays are capped.
- Large frontmatter objects do not produce unbounded output.
- Repeated builds with identical input are deterministic.

### Data Integrity

- No writes to notes, sidecars, index, vectors, memory, or canister state.
- Derived outputs reflect current note content only.
- Persisted or indexed facets remain out of scope; any future persistence must
  invalidate on note edit or delete.

### Performance

- Pure normalization is linear in number of accepted facet values.
- Caps bound output size.
- Hosted implementation does not scan the whole vault for one-note facets.

### Security

- No body text in output.
- No snippets in output.
- No full frontmatter in output.
- No absolute paths in output.
- Unauthorized and missing notes do not leak extra details.
- Hosted role and vault behavior are explicitly tested.
- Facet values are treated as untrusted prompt-injection content.
- No label text, OCR, PageIndex output, media metadata, vectors, summaries, or memory
  events appear in v0 output.

## Stop Conditions

Stop and re-plan if any work requires:

- returning note body text
- returning section body text
- returning snippets
- exposing full frontmatter
- adding label text, media labels, OCR text, PageIndex labels, or attachment text
- changing search, index, vector, memory, or summary behavior
- adding persistence or sidecars
- adding Hub REST, OpenAPI, Hub UI, or canister routes
- making Scooling the canonical metadata parser
- adding MuseHub domain/plugin changes
- sending private content to cloud models
- routing private files or metadata to external providers

## Verification

Focused MetadataFacets verification command:

```bash
node --test test/metadata-facets.test.mjs test/cli.test.mjs test/mcp-metadata-facets.test.mjs test/mcp-hosted-metadata-facets.test.mjs test/mcp-hosted-tools-list.test.mjs
```

This covers the pure normalizer, CLI read surface, self-hosted MCP read surface, hosted
MCP read surface, role tool-list exposure, body-free output, traversal rejection, upstream
path distrust, missing/forbidden note behavior, truncation bounds, and input
immutability.

## Recommendation

The next highest-value closeout task is a hosted integration smoke on a persistent
gateway deployment where `/mcp` is mounted. It should call `get_metadata_facets` through
an authenticated hosted session, verify the same canister path and `X-Vault-Id` /
effective-user headers as `get_note`, and assert that no note body, full frontmatter,
absolute path, label text, OCR, PageIndex output, media metadata, vectors, summaries, or
memory events appear in the response.

Keep metadata facets separate from label text and section retrieval. Any future persisted
or indexed facet work must start with deletion, staleness, export, vault isolation, and
prompt-injection tests.

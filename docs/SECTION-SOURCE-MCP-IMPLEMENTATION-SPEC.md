# SectionSource Self-Hosted MCP Implementation Spec

## Simple Summary

This phase implements the self-hosted MCP tool for body-free `SectionSource v0`
metadata.

The implementation registers only the local self-hosted MCP tool. It keeps hosted MCP, Hub
routes, search, persistence, Scooling runtime behavior, section bodies, snippets,
summaries, PageIndex, OCR, LLM calls, and provider routing blocked.

## Technical Summary

The self-hosted MCP tool exposes the existing `readSectionSource` behavior through a single
note-scoped read tool. It mirrors the self-hosted `get_note_outline`, `get_document_tree`,
and `get_metadata_facets` tools:

- load local config
- accept exactly one vault-relative note path
- call `resolveVaultRelativePath`
- read one note through the existing local note-read path
- return body-free `SectionSource v0` metadata
- return MCP JSON errors for missing notes, traversal paths, and runtime failures

## Proposed Tool

```text
get_section_source
```

The tool name is accepted only for the self-hosted MCP implementation phase. It is not
accepted for hosted MCP, Hub routes, search, persistence, or Scooling runtime consumption.

## Input Schema

The tool accepts:

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
- `path` must not escape the vault.
- No batch paths are accepted.
- No body, snippet, search, filter, ranking, provider, or Scooling options are accepted.

## Accepted Output

The tool returns exactly the existing body-free `SectionSource v0` shape:

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

The tool must not output:

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

## Error Behavior

The tool must:

- fail when `path` is missing
- fail when `path` is not a string
- fail for traversal paths before note reads
- fail for missing notes using the same local note-read behavior as adjacent self-hosted
  read tools
- return MCP JSON errors with `RUNTIME_ERROR`
- not include note body text, snippets, full frontmatter, or absolute paths in errors

## Authorization And Path Safety

The tool preserves the self-hosted local note-read boundary:

- the caller may only read notes available through the configured local vault
- paths must be vault-relative
- absolute paths are rejected
- traversal paths are rejected before note reads
- symlinks that escape the vault remain blocked by existing vault behavior
- missing and unauthorized note behavior must not reveal more than `get_note_outline`,
  `get_document_tree`, or `get_metadata_facets`

## Transport Boundaries

This phase implements only the self-hosted MCP tool.

It does not approve:

- hosted MCP
- Hub REST
- OpenAPI
- Hub UI
- canister routes
- search
- persistence or sidecars
- Scooling runtime consumption
- section bodies
- snippets
- summaries
- PageIndex
- OCR
- LLM calls
- external provider routing

## Resource Boundary

The self-hosted MCP tool must not expose an MCP resource URI for section sources, section
bodies, snippets, or derived section records.

SectionSource metadata must remain a tool response only until a separate resource contract
is accepted.

## Seven-Tier Test Requirements

### Unit

- The tool name and required path field are documented.
- The output field allowlist matches `SectionSource v0`.
- `body_returned` and `snippet_returned` remain false.

### Integration

- The tool uses the existing config, path validation, and note-read behavior.
- Missing and traversal paths fail consistently with adjacent body-free MCP tools.
- The tool output matches `readSectionSource` for the same note.

### End To End

- A self-hosted MCP client can request one note's body-free section candidates.
- No MCP flow returns section body text or snippets.
- No MCP resource URI is exposed for section source content.

### Stress

- Large notes remain capped by heading count and input caps.
- Large outputs remain bounded by section count and text caps.
- Repeated calls are deterministic for unchanged notes.

### Data Integrity

- The tool does not write notes, sidecars, indexes, vectors, memory, summaries, or canister
  state.
- The tool reflects current note content only.
- No cached section record is created.

### Performance

- The tool reads one note only.
- The tool does not scan the whole vault.
- The tool does not call external providers.

### Security

- No note body text appears in output.
- No section body text appears in output.
- No snippets appear in output.
- No full frontmatter appears in output.
- No absolute filesystem paths appear in output.
- No MCP resource URI appears in output.
- Prompt-injection text remains untrusted source material.
- Hosted, Scooling, classroom, search, and persistence exposure remain blocked.

## Stop Conditions

Stop and re-plan if implementation requires:

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
- weakening existing local note-read behavior

## Acceptance Criteria

This implementation is accepted when:

- It registers the `get_section_source` tool name in self-hosted MCP.
- It requires one vault-relative note path.
- It limits output to body-free `SectionSource v0` metadata.
- It preserves local note-read path and authorization behavior.
- It blocks MCP resources for section source content.
- It keeps hosted, Hub, search, persistence, Scooling, body, snippet, provider, OCR,
  PageIndex, and LLM behavior blocked.
- Tests prove the runtime MCP tool is body-free and no blocked transport or provider surface
  was added.

## Recommendation

Phase 1G is complete when tests prove `get_section_source` returns body-free
`SectionSource v0` output and all blocked surfaces remain absent.

The next hosted-facing step is accepted separately in
`docs/SECTION-SOURCE-HOSTED-AUTHORIZATION-REVIEW-SPEC.md`. Do not add hosted runtime
exposure without a hosted implementation spec and seven-tier tests.

The Scooling consumer boundary is accepted separately in
`docs/SECTION-SOURCE-SCOOLING-ADAPTER-PLANNING-SPEC.md`. Do not add Scooling runtime
consumption without a Scooling implementation slice and seven-tier tests.

The Scooling implementation slice is complete in the Scooling repository at commit
`ea5421e` (`Add Scooling SectionSource transport boundary`).

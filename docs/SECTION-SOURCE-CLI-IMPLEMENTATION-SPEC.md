# SectionSource Local CLI Implementation Spec

## Simple Summary

Phase 1E implements the local CLI command for body-free `SectionSource v0` metadata.

This phase adds the local CLI command only. It does not add MCP, hosted MCP, Hub routes,
search, persistence, Scooling runtime behavior, section bodies, snippets, summaries,
PageIndex, OCR, LLM calls, or provider routing.

## Technical Summary

The local CLI command exposes the existing `readSectionSource` behavior through a single
note-scoped, JSON-only command. The command follows the existing `get-note-outline`,
`get-document-tree`, and `get-metadata-facets` CLI pattern:

- load local config
- require `--json`
- accept exactly one vault-relative note path
- call `resolveVaultRelativePath`
- read one note through the existing local note-read path
- return body-free `SectionSource v0` metadata
- exit non-zero for missing notes, traversal paths, invalid options, or non-JSON requests

## Proposed Command

```text
knowtation get-section-source <path> --json
```

The command is registered only in the local CLI.

## Accepted Output

The command returns exactly the existing body-free `SectionSource v0` shape:

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

The command must not output:

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

The command must:

- fail when `--json` is omitted
- fail when the note path is missing
- fail when more than one note path is supplied
- fail for traversal paths before note reads
- fail for missing notes using the same local note-read behavior as `get-note-outline`
- use existing CLI error handling and JSON error behavior
- not include note body text, snippets, full frontmatter, or absolute paths in errors

## Authorization And Path Safety

The command preserves the local note-read authorization boundary:

- the caller may only read notes available through the configured local vault
- paths must be vault-relative
- absolute paths are rejected
- traversal paths are rejected before note reads
- symlinks that escape the vault remain blocked by existing vault behavior

## Transport Boundaries

Phase 1E accepts only the local CLI implementation.

It does not approve:

- self-hosted MCP
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

## Seven-Tier Test Requirements

### Unit

- The command name and required `--json` behavior are documented.
- The output field allowlist matches `SectionSource v0`.
- `body_returned` and `snippet_returned` remain false.

### Integration

- The command uses the existing config, path validation, and note-read behavior.
- Missing and traversal paths fail consistently with adjacent body-free CLI commands.
- The command output matches `readSectionSource` for the same note.

### End To End

- A user can request one note's body-free section candidates through the CLI.
- No CLI flow returns section body text or snippets.
- Non-JSON usage fails rather than printing an informal body-bearing view.

### Stress

- Large notes remain capped by heading count and input caps.
- Large outputs remain bounded by section count and text caps.
- Repeated calls are deterministic for unchanged notes.

### Data Integrity

- The command does not write notes, sidecars, indexes, vectors, memory, summaries, or
  canister state.
- The command reflects current note content only.
- No cached section record is created.

### Performance

- The command reads one note only.
- The command does not scan the whole vault.
- The command does not call external providers.

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
- adding MCP, hosted MCP, Hub REST, OpenAPI, Hub UI, canister routes, or Scooling runtime
  code
- sending note-derived content to LLMs, OCR, PageIndex, or external providers
- weakening existing local note-read behavior

## Acceptance Criteria

Phase 1E is accepted when:

- The local CLI registers the `get-section-source` command name.
- The command requires JSON-only output.
- The command limits output to body-free `SectionSource v0` metadata.
- The command preserves local note-read path and authorization behavior.
- The command keeps MCP, hosted, Hub, search, persistence, Scooling, body, snippet, provider,
  OCR, PageIndex, and LLM behavior blocked.
- Tests prove no MCP, hosted, Hub, search, persistence, or Scooling runtime transport has
  been added.

## Recommendation

The self-hosted MCP implementation is accepted in
`docs/SECTION-SOURCE-MCP-IMPLEMENTATION-SPEC.md` and implemented in `mcp/create-server.mjs`.

Proceed next only with a separate hosted authorization review spec or Scooling adapter
planning spec. Do not add hosted, Hub, search, persistence, Scooling, body reads, snippets,
summaries, OCR, PageIndex, LLM calls, or provider routing without that separate plan.

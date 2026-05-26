# Note Outline MVP Spec

## Simple Summary

This MVP adds a safe way to ask Knowtation for the headings inside one Markdown note.

The first version does not change search, indexing, memory, imports, PageIndex, Hub REST,
OpenAPI, vectors, summaries, or persistence. It only defines a read-only note outline
contract that supports Scooling adapter consumption and future tree-aware retrieval.

## Technical Summary

`NoteOutline` is a derived, read-only view over a single Markdown note body. It is built
on demand from the current note content and returns a minimal JSON shape containing the
note path, display title, heading levels, heading text, deterministic heading IDs, and a
truncation flag.

The outline is treated as note-content-derived data. If a user cannot read the note body,
the user cannot read the note outline.

## Goals

- Add a deterministic contract for reading one note's Markdown heading outline.
- Keep the first implementation local and bounded: parser first, then CLI, then MCP.
- Keep output small and safe for agent use.
- Give Schooling a stable adapter target without forcing Knowtation to ship tree search.
- Create a foundation for future section-aware retrieval without committing to storage,
  vectors, PageIndex, or hosted document processing.

## Non-Goals

- No PageIndex integration.
- No OCR.
- No PDF/DOCX outline extraction.
- No vector indexing changes.
- No search mode changes.
- No LLM summaries.
- No memory events.
- No daemon or discover-pass changes.
- No Hub REST endpoint.
- No OpenAPI route.
- No Hub UI.
- No MCP resources or resource listing.
- No canister storage change.
- No persisted sidecar files.
- No migration.
- No source snippets, body excerpts, or frontmatter in output.

## Terminology

| Term | Meaning |
| --- | --- |
| `NoteOutline` | The read-only outline of one Markdown note's headings. |
| `DocumentOutline` | Reserved future term for imported documents that are not native notes. Not part of this MVP. |
| `VaultTree` | Reserved future term for folders/projects/notes across a vault. Not part of this MVP. |
| `SectionSearch` | Reserved future term for retrieval over note sections. Not part of this MVP. |
| `PageIndexProvider` | Reserved future provider name for optional external PageIndex processing. Not part of this MVP. |

Public phase 1 naming must use `note-outline` / `note_outline`, not `tree`, `page-index`,
or `document-tree`.

## Phase Order

### Phase 0: Spec

Create and review this document. No runtime behavior changes.

### Phase 1A: Parser Only

Add a pure module and parser tests:

- `lib/note-outline.mjs`
- `test/note-outline.test.mjs`

No CLI, MCP, Hub, storage, search, or import wiring in this phase.

### Phase 1B: CLI

Add:

```text
knowtation get-note-outline <path> --json
```

This command reads one vault-relative note and returns the `NoteOutline` JSON contract.

### Phase 1C: Self-Hosted MCP

Add local MCP tool:

```text
get_note_outline
```

The tool mirrors CLI semantics and returns the same JSON shape.

### Phase 1D: Hosted MCP

Add hosted MCP tool only after parser, CLI, local MCP, and security tests pass:

```text
get_note_outline
```

Hosted implementation reads the note through the same canister path and headers as
`get_note`, then derives the outline in the gateway session.

## Implementation Status

Status as of 2026-05-24 on Muse `main`:

| Phase | Status | Muse commit | Verification |
| --- | --- | --- | --- |
| Phase 0: Spec | Complete | `sha256:f223a66c467b` | Spec committed before runtime changes. |
| Phase 1A: Parser Only | Complete | `sha256:b584f61cbf00` | Parser tests cover block-aware Markdown behavior, caps, data integrity, performance, and security output boundaries. |
| Phase 1B: CLI | Complete | `sha256:91f5cde8cca6` | `get-note-outline <path> --json` returns the `NoteOutline` contract without body text or full frontmatter. |
| Phase 1C: Self-Hosted MCP | Complete | `sha256:971609defff9` | Self-hosted `get_note_outline` mirrors CLI semantics and uses the same safe JSON contract. |
| Phase 1D: Hosted MCP | Complete | `sha256:9e4301d69902` | Hosted `get_note_outline` is viewer/read-level, uses the same canister read path as `get_note`, and has tests for missing/forbidden notes, no outline resource exposure, and unsafe upstream path leakage. |

Full local verification after Phase 1D passed with:

```text
npm test
```

The local `config/local.yaml` indentation issue was repaired outside Muse history so the
test suite could load local configuration. That private config repair is not part of the
feature commits.

This work has been merged into local Muse `main`. Remote staging push remains blocked by
the ongoing Muse authentication redevelopment, so local `main` is the current source of
truth for follow-on Knowtation work.

## Deferred Phases

The following are explicitly deferred:

- `POST /api/v1/notes/outline`
- `docs/openapi.yaml` changes
- `knowtation://...` outline resources
- Hub UI display
- note section retrieval
- `DocumentTree` runtime implementation
- outline persistence
- vector payload fields
- PageIndex provider
- OCR provider
- section summaries
- line range exposure

The follow-on `DocumentTree v0` planning contract is documented separately in
`docs/DOCUMENT-TREE-V0-SPEC.md` and has since shipped through CLI, self-hosted MCP, and
hosted MCP read surfaces.

## JSON Contract

### Success Shape

```json
{
  "schema": "knowtation.note_outline/v1",
  "path": "inbox/example.md",
  "title": "Example",
  "headings": [
    {
      "level": 1,
      "text": "Introduction",
      "id": "h1-introduction-0001"
    }
  ],
  "truncated": false
}
```

### Field Rules

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `schema` | string | Yes | Must be exactly `knowtation.note_outline/v1` for this MVP. |
| `path` | string | Yes | Vault-relative note path. Never absolute. |
| `title` | string or null | Yes | Display title from frontmatter or path-derived title. No full frontmatter object. |
| `headings` | array | Yes | Ordered list of heading records. Empty when the note has no headings. |
| `truncated` | boolean | Yes | True when caps prevent returning all headings. |

Heading record:

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `level` | number | Yes | Markdown heading depth, 1 through 6. |
| `text` | string | Yes | Plain heading text after Markdown inline text extraction. |
| `id` | string | Yes | Deterministic, versioned-by-contract heading ID for this response. |

### Explicitly Excluded Fields

The MVP response must not include:

- note body
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

## Error Contract

CLI `--json` errors keep the existing shape:

```json
{ "error": "message", "code": "ERROR_CODE" }
```

MCP errors keep the existing JSON text error pattern used by other MCP tools.

Hosted missing-note and unauthorized-note behavior must not reveal more information than
the existing hosted `get_note` path already reveals. If future role/scope behavior becomes
stricter than body reads, outline reads must follow the stricter rule.

## Parser Decision

The parser must use a Markdown parser with block awareness and source positions. Regex-only
parsing is not acceptable for this feature.

Recommended dependency direction:

```text
unified + remark-parse
```

Reasons:

- Parses CommonMark into an mdast tree.
- Provides heading nodes rather than raw line matches.
- Avoids false headings inside fenced code blocks.
- Supports Setext headings.
- Provides position data if future local-only ranges are added.
- ESM-only packages align with this repository's `"type": "module"`.

Alternative:

```text
micromark
```

`micromark` is lower-level and precise, but requires more custom token handling. It should
be selected only if the implementation needs lower-level token control.

Before adding the dependency, run normal package-manager installation so `package.json`
and `package-lock.json` stay in sync. Do not hand-edit dependency versions.

## Markdown Behavior

### Must Support

- YAML frontmatter at the start of a note. Frontmatter is not outline content.
- ATX headings: `#` through `######`.
- Optional closing hashes: `## Title ##`.
- Setext headings:

```markdown
Title
=====

Subtitle
--------
```

- Duplicate headings.
- Empty heading text.
- Inline formatting inside headings.
- Links, images, code spans, escaped characters, and emphasis inside headings.
- CRLF and LF line endings.
- Notes with no headings.
- Empty notes.
- Large notes up to the configured cap.

### Must Not Treat As Headings

- Heading-like text inside fenced code blocks.
- Heading-like text inside indented code blocks.
- Heading-like text inside raw HTML blocks unless the parser returns a normal Markdown
  heading node.
- YAML frontmatter keys.

### Explicitly Deferred Or Unsupported

- MDX/JSX heading semantics.
- Custom HTML heading extraction from `<h1>` / `<h2>` tags.
- Notebook-style cell metadata.
- PDF page headings.
- OCR-derived headings.
- Wikilink graph hierarchy.

## Heading Text Normalization

Heading text must be plain text, not rendered HTML.

Rules:

- Strip Markdown formatting syntax through AST text extraction.
- Preserve visible text content.
- Normalize internal whitespace to a single space.
- Trim leading and trailing whitespace.
- Treat HTML or script-looking content as text, never executable markup.

Example:

```markdown
## **Bold** [Link](https://example.com) `code`
```

Expected text:

```text
Bold Link code
```

## Heading ID Contract

IDs are deterministic within one outline response and stable for the same path and same
heading sequence.

Recommended MVP format:

```text
h<level>-<slug>-<ordinal>
```

Example:

```text
h2-install-0002
```

Rules:

- `level` is the Markdown heading depth.
- `slug` is normalized from heading text using the same conservative slug discipline as
  Knowtation project/tag slugs where practical.
- `ordinal` is the one-based heading occurrence index in document order, zero-padded to
  four digits.
- Duplicate headings receive distinct ordinals.
- IDs are not persisted.
- IDs are not promised to survive heading reordering or major parser changes.

If future versions need stronger stability across edits, introduce a new schema version.

## Caps And Truncation

The parser must cap work to prevent accidental expensive calls on huge imported notes.

Initial recommended caps:

- max input characters parsed: 1,000,000
- max headings returned: 500

If input exceeds the character cap, parse only if the parser behavior is still safe and
bounded. Otherwise return a runtime error with a clear message.

If headings exceed the heading cap:

- return only the first capped set in document order
- set `truncated: true`

Caps must be constants in the parser module and covered by tests.

## Security Invariants

### General

- Outline is note-content-derived data.
- A caller must be allowed to read the note before reading the outline.
- The response must never include the note body.
- The response must never include full frontmatter.
- The response must never include absolute paths.
- The response must never render heading Markdown into HTML.
- The response must never execute or trust content from headings.
- Logs must not include heading text, body text, secrets, or raw upstream responses.

### Local CLI And Self-Hosted MCP

- Resolve paths with existing vault path safety helpers.
- Only read files under the configured vault root.
- Respect existing note read behavior.
- Do not read `.env`, `config/local.yaml`, `data/`, or any ignored/non-vault file.

### Hosted MCP

- Use the same effective canister user as `get_note`.
- Use the active `X-Vault-Id`.
- Include gateway/canister auth headers exactly like existing hosted note reads.
- Do not expose outlines through `resources/list`.
- Do not add outline resource URIs in phase 1.
- Viewer can read outlines only for notes the viewer can already read.
- Editor does not get broader outline visibility than viewer.
- Admin follows existing admin note-read behavior.
- Evaluator behavior must be explicitly tested before enabling hosted outline access for
  evaluator sessions.

## Memory, Daemon, And Discover Interaction

This MVP does not write memory events.

Rationale:

- Memory records activity over time.
- NoteOutline is a derived view of current note content.
- Duplicating heading text into memory creates unnecessary leakage and stale-data risk.

Future phases may record coarse lifecycle events such as `note_outline_read` only after a
separate privacy review. That event is not part of this MVP.

## Imports And PageIndex Interaction

This MVP does not change imports.

Existing imports can produce Markdown notes. The outline parser can read those notes after
import because they are normal vault content.

PageIndex remains deferred. When a future `PageIndexProvider` exists, it must normalize
provider output into a Knowtation-owned format. It must not become the source of truth.

Before any PageIndex provider ships, there must be a separate consent, retention, deletion,
audit, and provider-key spec.

## Schooling Interaction

Schooling can use this as a future adapter target:

```text
KnowtationVaultAdapter.getNoteOutline(path)
```

Schooling must not parse Markdown itself as the source of truth. Schooling can display a
placeholder until Knowtation exposes the relevant surface.

## Test Matrix

### Unit

- Frontmatter ignored as outline content.
- ATX headings parse correctly.
- Setext headings parse correctly.
- Fenced code block headings are ignored.
- Indented code block headings are ignored.
- Duplicate headings receive deterministic distinct IDs.
- Inline heading formatting becomes plain text.
- Malicious HTML/script-like heading text stays plain text.
- Empty note returns an empty headings array.
- No-heading note returns an empty headings array.
- CRLF input is handled.
- Heading cap sets `truncated: true`.

### Integration

- CLI reads a fixture vault note and returns valid JSON.
- CLI rejects missing paths.
- CLI rejects traversal paths.
- Self-hosted MCP tool returns the same JSON shape as CLI.

### End To End

- Schooling-facing adapter tests can later use the CLI/MCP shape without note bodies.
- Not part of parser-only phase.

### Stress

- Large Markdown note stays within parser time and memory budget.
- Many headings are capped deterministically.

### Data Integrity

- Parser output does not mutate notes.
- Parser output does not write sidecars.
- Parser output does not change vectors, memory, or indexes.
- IDs are deterministic for repeated calls with identical input.

### Performance

- Parser is linear or near-linear for normal Markdown fixtures.
- Huge-input cap prevents unbounded work.

### Security

- No body text in output.
- No full frontmatter in output.
- No absolute path in output.
- Path traversal fails.
- Hosted outline uses the same vault/user headers as `get_note`.
- Hosted unauthorized and missing notes do not leak extra information beyond existing
  note-read behavior.
- Hosted viewer cannot read outlines outside active vault/scope.
- Tool listing role tests include `get_note_outline` only when enabled for that role.

## Files To Modify By Phase

### Phase 1A

- `package.json`
- `package-lock.json`
- `lib/note-outline.mjs`
- `test/note-outline.test.mjs`

### Phase 1B

- `cli/index.mjs`
- `test/cli.test.mjs`
- `docs/SPEC.md`
- `docs/CLI-JSON-SCHEMA.md`
- `docs/RETRIEVAL-AND-CLI-REFERENCE.md`

### Phase 1C

- `mcp/create-server.mjs`
- local MCP tests
- `docs/AGENT-INTEGRATION.md`

### Phase 1D

- `hub/gateway/mcp-hosted-server.mjs`
- `hub/gateway/mcp-tool-acl.mjs`
- `test/mcp-hosted-tools-list.test.mjs`
- hosted MCP security/parity tests
- `docs/PARITY-MATRIX-HOSTED.md`

## Stop Conditions

Stop and re-plan if any of the following become necessary:

- returning note body text
- returning line ranges in hosted output
- adding a Hub REST route
- updating OpenAPI
- changing search/index/vector behavior
- adding persistence
- adding PageIndex
- adding OCR
- adding LLM summaries
- changing canister storage
- weakening hosted scope behavior
- exposing outline resources through MCP resource listings

## Acceptance Criteria

The MVP is acceptable only when:

- The spec is reviewed and accepted.
- Parser tests are written before parser implementation.
- Parser uses a block-aware Markdown parser.
- CLI and MCP surfaces return the same JSON contract.
- Hosted MCP access is gated exactly like note body reads.
- No runtime feature writes derived outline data.
- No output includes body text, full frontmatter, absolute paths, or secrets.
- Seven-tier tests are present for shipped phases.

## Recommendation

Completed MVP implementation sequence:

1. Spec review.
2. Parser tests.
3. Parser module.
4. CLI command.
5. Self-hosted MCP tool.
6. Hosted MCP tool after security tests pass.

Next, continue Knowtation development from local Muse `main` while remote staging
authentication is unavailable.

Do not begin PageIndex, section search, summaries, persistence, or Hub REST as a bundled
follow-on. Each of those needs a separate review pass, explicit scope, and tests before
implementation.

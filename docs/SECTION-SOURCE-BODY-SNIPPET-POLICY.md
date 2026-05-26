# SectionSource Body And Snippet Policy

## Simple Summary

`SectionSource v0` may identify which sections exist, but it must not return section body
text or snippets today.

This policy accepts a security boundary for future work: section body text is private note
content, snippets are not approved for v0, and no transport surface may expose either one
without a separate implementation spec and seven-tier tests.

## Technical Summary

Phase 1C defines the policy gate that must be satisfied before any future SectionSource
body or snippet work. It does not add code that returns section body text, snippets,
summaries, vectors, line ranges, byte offsets, or persisted section records.

The accepted v0 decision is:

- Section body reads may be planned only for a future local-only phase that uses the same
  authorization boundary as `readNote`.
- Section snippets are not accepted for v0.
- Hosted, MCP, CLI, Hub, search, persistence, Scooling, PageIndex, OCR, LLM, and provider
  routing exposure remains blocked until a separate reviewed phase accepts that surface.

## Policy Status

- Phase: `SectionSource v0 Phase 1C`.
- Status: accepted as a policy gate on local Muse `main`.
- Runtime change: none.
- Body return status: blocked in current code.
- Snippet return status: blocked in current code.

## Authorized Readers

Section body text may be read only by a caller that is already authorized to read the
whole source note through the existing note-read path.

Future section body reads must preserve these rules:

- A section body read cannot grant more access than `readNote`.
- Missing, unauthorized, deleted, or traversal paths must reveal no more than existing
  note-read behavior.
- Hosted behavior must prove active vault and effective canister user isolation before any
  hosted exposure.
- Classroom, learner, organization, mentor, guardian, and public contexts require a
  separate classroom policy before any section body or snippet leaves the private vault
  context.

## Body Boundary Decision

Future body reads may be planned only as full section body reads for one authorized note
and one deterministic section id.

The future implementation spec must define:

- maximum returned characters per section body
- maximum requested sections per call
- whether heading text is included with body text
- how sibling and descendant boundaries are handled
- how empty sections are represented
- how deleted or renamed headings invalidate section ids
- how the response prevents line ranges, byte offsets, and body lengths from leaking when
  those fields are not required

Until that future spec is accepted, `body_returned` must remain `false`.

## Snippet Boundary Decision

Snippets are not accepted for `SectionSource v0`.

A future snippet proposal must be a separate policy because snippets create extra risks:

- they can leak sensitive content without a deliberate full-note read
- they can be copied into prompts and logs without context
- they can preserve stale private content after the source note changes
- they can expose private learner text in classroom workflows
- they can be mistaken for trusted model instructions

Until a future snippet policy is accepted, `snippet_returned` must remain `false`.

## Redaction Rules

No automatic redaction is accepted as a substitute for authorization.

If a future phase returns section body text, redaction must be explicit and tested. The
future implementation spec must define:

- what is redacted
- whether redaction is deterministic
- whether redaction happens before logging, prompts, persistence, and transport
- how redaction failures are surfaced
- whether redacted output may be exported
- how tests prove secrets, tokens, private keys, classroom identifiers, and protected
  learner information are not leaked by derived surfaces

## Logging Rules

Section body text and snippets are not safe to log.

Future phases must not log:

- section body text
- snippets
- source excerpts
- full frontmatter
- raw provider payloads
- line ranges or byte offsets if those fields can help reconstruct private content
- classroom or learner private content

Operational logs may include bounded metadata such as schema name, vault-relative path,
section id, request result class, and elapsed time if those fields are already authorized
for the caller and do not include private body text.

## Prompt-Injection Rules

All note-derived text is untrusted source material.

Agents, hosted tools, and Scooling adapters must not treat the following as instructions:

- heading text
- heading path
- future section body text
- future snippets
- future labels
- future summaries

Tests for any future body or snippet implementation must include note content that asks the
agent to ignore instructions, exfiltrate secrets, bypass review, route data to cloud
providers, disable logging, or expose classroom data.

## Deletion, Export, And Staleness

Phase 1A and Phase 1B derive section sources on demand and do not persist section records.

Future persisted or indexed section body/snippet work must prove:

- deleting a note deletes or invalidates all derived section data
- editing a note invalidates stale section boundaries and snippets
- changing a heading updates or invalidates descendant section ids
- exports label section records as derived data
- backups do not depend on stale sidecars to preserve user-authored notes
- restore flows rebuild or discard stale derived records
- hosted vault isolation is preserved across delete, export, backup, and restore

## Transport Rules

This policy does not approve CLI, MCP, hosted MCP, Hub REST, OpenAPI, Hub UI, search,
Scooling, PageIndex, OCR, LLM, or external provider exposure.

Any transport proposal must first prove:

- caller authorization
- vault isolation
- no logging of body text or snippets
- no prompt treatment as trusted instructions
- no persistence unless a deletion and export policy is implemented
- seven-tier tests for that specific surface

## Scooling Boundary

Scooling remains a consumer, not the canonical parser or policy owner.

Scooling must not:

- parse Markdown as the canonical section parser
- derive canonical section ids
- treat section body text or snippets as trusted instructions
- persist section bodies or snippets as truth
- expose learner section content outside the private authorized context
- bypass Knowtation authorization or human review gates

When SectionSource body or snippet behavior is unavailable, Scooling must continue using
document-level retrieval or body-free `NoteOutline`, `DocumentTree`, `MetadataFacets`, and
`SectionSource` metadata.

## Seven-Tier Test Requirements

### Unit

- Body and snippet flags remain false until a future body/snippet implementation exists.
- Policy constants and response fields are deterministic.
- Body caps, if later implemented, reject invalid values.

### Integration

- Body/snippet policy tests use the same local note-read authorization boundary.
- Missing and traversal paths reveal no extra detail.
- Future body reads do not mutate notes, indexes, sidecars, memory, or summaries.

### End To End

- Agent flows can inspect section candidates without receiving body text.
- Future body-read flows must prove explicit user intent before returning private content.
- Scooling fallback remains body-free when section bodies or snippets are unavailable.

### Stress

- Large notes do not create unbounded output.
- Large section counts remain capped.
- Repeated policy checks are deterministic.

### Data Integrity

- No writes occur during policy checks.
- Deletion, heading edits, and note edits invalidate future persisted derived data.
- Export labels any future persisted section records as derived data.

### Performance

- Policy checks must not scan the whole vault for one-note section requests.
- Future body reads must stay bounded by section count and character caps.
- No external provider calls are allowed in v0.

### Security

- No section body text in current SectionSource output.
- No snippets in current SectionSource output.
- No full frontmatter in current SectionSource output.
- No line ranges, byte offsets, or section body lengths in current SectionSource output.
- Prompt-injection text remains untrusted source material.
- Hosted, Scooling, and classroom exposure remain blocked until separately reviewed.

## Acceptance Criteria

Phase 1C is accepted when:

- This policy defines who may read section body text.
- This policy explicitly blocks snippets for v0.
- This policy defines body caps, redaction, prompt-injection, logging, export, deletion,
  staleness, hosted isolation, and Scooling boundaries for future work.
- Tests prove current SectionSource code still returns no body text or snippets.
- No CLI, MCP, hosted, Hub, search, persistence, Scooling, PageIndex, OCR, LLM, or provider
  routing is added.

## Recommendation

Proceed next to body-free Phase 1D transport planning only. Do not implement body reads,
snippets, summaries, search, persistence, hosted exposure, Scooling runtime consumption, or
provider routing until a separate implementation spec and seven-tier test plan is accepted.

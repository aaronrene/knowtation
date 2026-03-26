# Optional post-import normalization (agent JSON, LLM)

Today, **import** is implemented as **format-specific parsers** in [`lib/importers/`](../lib/importers/). **LLM usage** in that path is limited to **Whisper transcription** for audio/video ([`lib/transcribe.mjs`](../lib/transcribe.mjs)).

## Problem

Agents or external tools may emit **JSON** or Markdown that does not match [SPEC.md](./SPEC.md) frontmatter (`title`, `tags`, optional intention fields in §2.3). MCP `write` currently accepts **string** key/value frontmatter only ([`lib/write.mjs`](../lib/write.mjs)); arrays must be represented in a way the writer can serialize correctly.

## Recommended approach (when needed)

Add an **explicit** stage so deterministic importers stay testable:

1. **Normalize (rules)** — Map known vendor keys to SPEC fields (no model).
2. **Normalize (LLM)** — Optional: one shot “produce YAML frontmatter + body only” with a **fixed schema** and validation; reject on parse failure.
3. **Validate** — Reject or quarantine notes missing required fields for your policy (e.g. inbox contract §2.2).

Implement as a **separate subcommand or Hub action** (e.g. `knowtation import normalize <path>` or “Normalize note” in UI), not hidden inside every importer.

## Contract

- **Input:** Path to a note or a JSON file + target vault path.
- **Output:** Updated note or new note under `inbox/` / staging, with machine-readable **`normalization_provenance`** (or equivalent) in frontmatter for audit.

## Related

- [IMPORT-EVALS.md](./IMPORT-EVALS.md) — import goldens vs retrieval vs proposal eval.
- [IMPORT-SOURCES.md](./IMPORT-SOURCES.md) — batch import source types.

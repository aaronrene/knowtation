# Knowtation — Architecture

## High-level

```
Capture (Telegram/WhatsApp/Discord) → vault/inbox
Audio/Video → transcribe → vault (one note per recording)
                    ↓
        Obsidian vault (Markdown) ← source of truth
                    ↓
        Index: chunk → embed → Qdrant (or sqlite-vec)
                    ↓
        CLI: knowtation search | get-note | list-notes | index
                    ↓
        Agents (Cursor, Claude, etc.) discover via SKILL.md and run CLI
                    ↓
        Optional: memory layer (Mem0/SAME), AIR (Null Lens) before write/export/analysis
```

## Interface: CLI first, MCP optional

- **Primary:** One CLI, `knowtation`, with subcommands. Agents discover usage via SKILL.md and `knowtation --help`; no large tool schema in context.
- **Optional:** MCP server that wraps the same backend for clients that only speak MCP.

## Vault layout

- `vault/inbox/` — Raw captures.
- `vault/captures/` — Processed captures.
- `vault/projects/` — Per-project notes (e.g. default, media).
- `vault/areas/` — Evergreen themes.
- `vault/archive/`, `vault/media/audio|video/`, `vault/templates/`, `vault/meta/`.

## Memory and AIR

- **Memory:** Optional integration (e.g. Mem0 or SAME) for decisions, provenance (“which notes fed this export”), cross-session context.
- **AIR:** Optional pre-execution intent attestation (e.g. Null Lens) before write (except inbox), export, publish, or analysis; log AIR id with the action.

See **docs/STANDALONE-PLAN.md** for full scenario coverage and tool options.

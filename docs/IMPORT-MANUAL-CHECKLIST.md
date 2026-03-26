# Import — manual test checklist

Use **self-hosted Hub** or **CLI** until [hosted import](./HOSTED-IMPORT-DESIGN.md) is implemented. Canonical `source_type` values: [`lib/import-source-types.mjs`](../lib/import-source-types.mjs).

## Prerequisites

- Configured vault (`config/local.yaml` or `KNOWTATION_VAULT_PATH`).
- After large imports: **Re-index** (Hub) or `knowtation index`.

## Per source type (one happy path each)

| Source type | What to run | Expect |
|-------------|-------------|--------|
| `markdown` | Single `.md` and a small folder; optional `--project`, `--tags` | Notes under chosen output dir; `source: markdown`, `date` |
| `chatgpt-export` | ZIP or folder containing `conversations.json` | `source: chatgpt`, `source_id`, `title`, transcript body |
| `claude-export` | Folder of `.md` or `.json` per [IMPORT-SOURCES.md](./IMPORT-SOURCES.md) | `source: claude`, `source_id`, `date` |
| `mem0-export` | Mem0 export JSON file | `source: mem0`, `source_id`, `date` |
| `mif` | `.memory.md`, `.memory.json`, or folder | `source: mif`; `mif:id` mapped to `source_id` when present |
| `notion` | Comma-separated page IDs (CLI/API); Hub upload N/A for IDs | `NOTION_API_KEY`; `source: notion` |
| `notebooklm` | Folder of `.md` or JSON with `sources` / array | `source: notebooklm` |
| `gdrive` | Folder of Markdown files only | `source: gdrive` |
| `jira-export` | `.csv` or folder with one `.csv` | `source: jira`, `source_id` = issue key |
| `linear-export` | Linear export `.csv` | `source: linear`, `source_id` |
| `audio` | Supported audio file | See **Audio / video** below |
| `video` | Supported video file | See **Audio / video** below |

## Audio / video

1. **Hub UI:** **Audio (transcribe)** is available on **self-hosted** Hub with **`OPENAI_API_KEY`**. **Video** in the import dialog is **coming soon**; use **CLI** `knowtation import video` or transcribe elsewhere and import **Markdown**.
2. Set **`OPENAI_API_KEY`** in the environment of the process running **Hub** or **CLI**.
3. Use a **Whisper-supported** extension: `.mp3`, `.mp4`, `.mpeg`, `.mpga`, `.m4a`, `.wav`, `.webm` (see [`lib/transcribe.mjs`](../lib/transcribe.mjs)).
4. **File size:** OpenAI’s transcription API enforces a **25MB** maximum per file (you may see **413 Payload Too Large** when the limit is exceeded). Prefer **compressed audio** (M4A/MP3) for longer recordings; split or downsample before import.
5. Import, then **index** and **search** for a phrase from the transcript.

## Agents (MCP)

1. MCP `import` accepts the same `source_type` strings as the CLI (see `import-source-types.mjs`).
2. **`input` must be a path visible to the MCP server process** (working directory, mounts, container volumes).
3. After import: `get_note` / `search` / `list_notes` to verify; use tiered retrieval per [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md).

## Hosted (production)

- `POST /api/v1/import` returns **501** until the gateway/bridge path in [HOSTED-IMPORT-DESIGN.md](./HOSTED-IMPORT-DESIGN.md) is shipped.
- Confirm the Hub shows the JSON error body (`NOT_AVAILABLE`) clearly after deploy.

## Automated regression

- `node --test test/import-importers-golden.test.mjs test/import-source-types.test.mjs test/import-markdown.test.mjs test/embedding-usage.test.mjs`

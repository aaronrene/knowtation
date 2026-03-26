# Knowtation — Import Sources and External Knowledge Bases

This document specifies how to bring data and memory **into** the Knowtation vault from other platforms and devices. It complements the [Message-interface contract](./SPEC.md#3-message-interface-capture-plugin-contract) (live capture) with **batch and one-time imports**. All importers output vault notes that conform to [SPEC §1–2](./SPEC.md) (frontmatter, project, tags).

---

## 1. Design principles

- **One vault format:** Every import produces Markdown notes with our frontmatter (or MIF-compatible notes that also satisfy our schema). No second schema inside the vault.
- **Traceable origin:** Every imported note has `source` (e.g. `chatgpt`, `claude`, `notebooklm`) and optional `source_id` (external id) and `date` so we can dedupe and attribute.
- **Re-import safe:** Importers should support idempotency (e.g. skip or update when `source` + `source_id` already exists) when the platform provides stable ids.
- **Agent- and human-friendly:** Imported notes are searchable, filterable by `--project` / `--tag`, and usable for blogs, podcasts, analysis, and marketing like any other vault content.

---

## 2. Supported import sources (spec)

The CLI command **`knowtation import <source-type> <input> [options]`** accepts the following source types. Each maps an external format to vault notes.

**Canonical list:** The same `source_type` strings are enforced in [`lib/import-source-types.mjs`](../lib/import-source-types.mjs) for the CLI, self-hosted Hub `POST /api/v1/import`, Hub import modal, and the MCP `import` tool. If you add an importer, update that module and the table below together.

**Manual verification:** See [IMPORT-MANUAL-CHECKLIST.md](./IMPORT-MANUAL-CHECKLIST.md).

| Source type       | Input (path or URI)     | Description |
|-------------------|-------------------------|-------------|
| `chatgpt-export`  | Path to OpenAI export ZIP or folder with `conversations.json` | ChatGPT data export (Settings → Export Data). One note per conversation or per message thread; frontmatter: `source: chatgpt`, `source_id`, `date`, optional `project`, `tags`. |
| `claude-export`   | Path to Claude export ZIP or folder (chat history / memory) | Claude data export (Settings → Privacy → Export) and/or memory export. One note per conversation or per memory entry; `source: claude`, `source_id`, `date`. |
| `mem0-export`     | Path to Mem0 export JSON | Mem0 memory export. One note per memory; `source: mem0`, `source_id`, `date`. |
| `notion`          | Comma-separated Notion page IDs | Fetches pages as markdown via Notion API. Requires `NOTION_API_KEY`. One note per page; `source: notion`, `source_id: page_id`. |
| `jira-export`     | Path to Jira CSV file (or folder with one .csv) | Jira Cloud/Server CSV export. One note per issue; `source: jira`, `source_id: issue key`, summary, description. |
| `notebooklm`      | Path to folder of .md files or to a .json export | NotebookLM: folder of markdown (e.g. from takeout/Apify) or JSON with sources/conversations array. One note per file or entry; `source: notebooklm`. |
| `gdrive`          | Path to folder of Markdown files | Google Drive: folder of .md files (e.g. from export or pandoc). One note per file; `source: gdrive`, `source_id` from filename. |
| `linear-export`   | Path to Linear CSV file | Linear workspace export (CSV). One note per issue; `source: linear`, `source_id`, title, description. |
| `mif`             | Path to `.memory.md` or `.memory.json` or folder of MIF files | [Memory Interchange Format](https://mif-spec.dev/). MIF is Obsidian-native; files can be copied in as-is or normalized to our frontmatter. |
| `markdown`        | Path to file or folder of Markdown files | Generic Markdown import. Preserve or infer frontmatter; add `source: markdown`, `date` if missing. For Evernote/Standard Notes/etc. exports that are already Markdown. |
| `audio`           | Path to audio file or URL (e.g. wearable webhook payload) | Audio → transcribe → one vault note per recording. Uses transcription pipeline; frontmatter: `source: audio`, `source_id` (filename or id), `date`. |
| `video`           | Path to video file or URL | Video → transcribe (and optionally extract chapters) → vault note(s). Same as audio; `source: video`. |

**Options (common):** `--project <slug>`, `--output-dir <vault-path>`, `--tags tag1,tag2`, `--dry-run`, `--json`. If `--output-dir` is omitted, default is `vault/inbox/` or `vault/projects/<project>/inbox/` when `--project` is set.

---

## 3. Platform-specific notes

### 3.1 ChatGPT (OpenAI)

- **How users get data:** Settings → Data Controls → Export Data (or Privacy Portal). Email link to ZIP containing `conversations.json` (and sometimes `chat.html`). Link expires in 24 hours; export can take up to 7 days.
- **Format:** `conversations.json` is a tree of messages (mapping of id → { message, parent, children }). Each message has `content.parts`, `author.role`, timestamps.
- **Importer behavior:** Parse `conversations.json`; for each conversation, produce one note (or one per thread) with body = concatenated or structured transcript. Frontmatter: `source: chatgpt`, `source_id: <conversation-id>`, `date`, `title` from conversation title. Optional: one note per message for fine-grained search (heavier).
- **Third-party:** Browser extensions (e.g. ChatGPT Exporter) can export per-conversation JSON/Markdown/HTML; importer can accept a folder of such files and treat as `chatgpt-export` or `markdown` with `source: chatgpt`.

### 3.2 Claude (Anthropic)

- **How users get data:** Settings → Privacy → Export data (chat history). Memory: Settings → Capabilities → View and edit your memory → export (and Claude supports importing memory from other AI providers via a prompt).
- **Format:** Export is account data (format may vary). Memory export is a user-facing list that can be copied; API or file format TBD.
- **Importer behavior:** Same pattern as ChatGPT: one note per conversation or per memory entry; `source: claude`, `source_id`, `date`. Third-party tools (e.g. claude-exporter) produce JSON/Markdown; we can accept that as `claude-export` or `markdown` with `source: claude`.

### 3.3 Mem0

- **How users get data:** Mem0 API: `create_memory_export()` with schema; then retrieve via `get_memory_export()`. Returns JSON (Pydantic-style schema).
- **Importer behavior:** Map Mem0 memories to vault notes. Each memory → one note; frontmatter can include Mem0 metadata (e.g. `mem0_id`, `user_id`) and our `source: mem0`, `source_id`, `date`. Optionally support MIF as output so Mem0 users can later use MIF-native tools.

### 3.4 Notion

- **How users get data:** Notion API: create an integration at notion.so/my-integrations, share pages with it, then use page IDs (from the page URL: notion.so/workspace/page_id).
- **Importer behavior:** `knowtation import notion <page_id>` or `knowtation import notion "id1,id2,id3"`. Requires `NOTION_API_KEY`. Fetches each page as markdown via `GET /v1/pages/{page_id}/markdown`; one note per page with `source: notion`, `source_id: page_id`.

### 3.5 Jira and Linear

- **Jira:** Export from Jira (list or search → Export CSV). Importer: `knowtation import jira-export /path/to/export.csv --output-dir imports/jira`. Maps Issue key, Summary, Description, Project to vault notes.
- **Linear:** Export from Linear (Command menu → Export data → CSV). Importer: `knowtation import linear-export /path/to/linear-export.csv --project myproject`.

### 3.6 NotebookLM and Google Drive

- **NotebookLM:** Accepts (1) a folder of markdown files (e.g. from Google takeout or third-party Apify export), or (2) a JSON file with an array of entries (`content`, `id`, `title`). One note per file or entry; `source: notebooklm`.
- **Google Drive:** Accepts a folder of Markdown files. Export Docs as .docx then convert to .md (e.g. pandoc), or use a sync script. Importer: `knowtation import gdrive /path/to/folder`; `source: gdrive`, `source_id` from filename.

### 3.7 Confluence

- **How users get data:** Confluence has no native markdown export. Use third-party tools (e.g. confluence-cli, nodejs-confluence-export) to export a space or page to a folder of markdown files.
- **Importer behavior:** Export to a folder with one of those tools, then run `knowtation import markdown /path/to/confluence-export --output-dir imports/confluence --tags confluence`. Optional: add a thin `confluence-export` importer that accepts the same folder and sets `source: confluence`, `source_id` from filename.

### 3.8 MIF (Memory Interchange Format)

- **What it is:** [mif-spec.dev](https://mif-spec.dev/) — vendor-neutral AI memory format. Dual representation: `.memory.md` (Markdown + YAML frontmatter) and `.memory.json` (JSON-LD). Obsidian-native.
- **Importer behavior:** Copy `.memory.md` into vault (they are already valid Obsidian notes). Optional: normalize to our frontmatter (e.g. map `mif:id` to `source_id`, add `source: mif`). No need to change body. Enables future interop with Mem0, Zep, etc. if they adopt MIF.

### 3.9 Audio and video (including wearables)

- **Smart glasses / wearables:** Devices (e.g. TranscribeGlass, Omi, Ray-Ban + GlassFlow, ViveGlass) often produce transcripts via app, webhook, or export. Omi supports webhooks for real-time transcript delivery. TranscribeGlass and similar may export text or send to a URL.
- **Importer behavior:** `import audio <file>` or `import video <file>` transcribes via OpenAI Whisper (OPENAI_API_KEY required) → one note with transcript as body; frontmatter `source: audio` or `video`, `source_id`, `date`. Formats: mp3, mp4, mpeg, mpga, m4a, wav, webm. Webhook receivers (e.g. Omi) can write transcripts directly to inbox per message-interface contract.
- **Past blogs/videos:** User exports blog text or video transcript (or uses our transcription). Import as `markdown` or `video`/`audio` so all historical content lives in the vault.

---

## 4. CLI surface (summary)

- **Command:** `knowtation import <source-type> <input> [--project <slug>] [--output-dir <path>] [--tags t1,t2] [--dry-run] [--json]`
- **Behavior:** Run the importer for the given source type; write notes to vault; optionally run indexer after (config or flag). Output: list of written paths; with `--json`, machine-readable summary.
- **Exit codes:** 0 success, 1 usage error, 2 runtime error (same as rest of CLI).

---

## 5. What we're not forgetting

- **Any audio:** Smart glasses, wearables, past blogs/videos, recordings → all go through transcription + vault note with `source` and `source_id`.
- **Any knowledge base:** Google Drive, NotebookLM, ChatGPT, Claude, Mem0, Evernote/Standard Notes (as Markdown), MIF → all have a defined `import` path into the vault.
- **Any agent or business use:** Once in the vault, content is searchable, project/tag-filterable, and usable for blogs, podcasts, videos, marketing, analysis, writing. No second-class content.

Implementors: see [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) for the phase that builds the importers.

---

## 6. How to run (examples)

**Markdown** (file or folder):
```bash
knowtation import markdown ./my-notes.md --output-dir imports/notes
knowtation import markdown ./exported-folder --project myproject
```

**ChatGPT export** — Extract the OpenAI ZIP first, then:
```bash
knowtation import chatgpt-export /path/to/extracted-folder --output-dir imports/chatgpt --tags chatgpt
```
The folder must contain `conversations.json` (Settings → Data Controls → Export Data).

**Claude export** — Folder of .md files (from third-party exporters) or JSON:
```bash
knowtation import claude-export /path/to/claude-export-folder --project myproject
```

**MIF** (.memory.md or folder):
```bash
knowtation import mif ./my-memories.memory.md --output-dir imports/mif
```

**Mem0 export** (JSON file):
```bash
knowtation import mem0-export ./mem0-export.json --project memories
```

**Notion** (requires NOTION_API_KEY; page IDs from Notion page URLs):
```bash
export NOTION_API_KEY=your_integration_secret
knowtation import notion "page-uuid-1,page-uuid-2" --output-dir imports/notion --project myproject
```

**Jira** (CSV from Jira export):
```bash
knowtation import jira-export ./jira-export.csv --output-dir imports/jira --tags jira
```

**NotebookLM** (folder of .md or JSON export):
```bash
knowtation import notebooklm ./notebooklm-export-folder --output-dir imports/notebooklm
knowtation import notebooklm ./notebooklm-sources.json --project research
```

**Google Drive** (folder of markdown files):
```bash
knowtation import gdrive /path/to/docs-as-markdown --output-dir imports/gdrive --project docs
```

**Linear** (CSV from Linear export):
```bash
knowtation import linear-export ./linear-export.csv --output-dir imports/linear --project myapp
```

**Audio / video** (transcription via OpenAI Whisper; requires OPENAI_API_KEY):
```bash
knowtation import audio ./recording.m4a --project born-free --output-dir media/audio
knowtation import video ./meeting.mp4 --output-dir media/video
```

**Dry run** (preview without writing):
```bash
knowtation import markdown ./notes --dry-run --json
```

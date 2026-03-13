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

| Source type       | Input (path or URI)     | Description |
|-------------------|-------------------------|-------------|
| `chatgpt-export`  | Path to OpenAI export ZIP or folder with `conversations.json` | ChatGPT data export (Settings → Export Data). One note per conversation or per message thread; frontmatter: `source: chatgpt`, `source_id`, `date`, optional `project`, `tags`. |
| `claude-export`   | Path to Claude export ZIP or folder (chat history / memory) | Claude data export (Settings → Privacy → Export) and/or memory export. One note per conversation or per memory entry; `source: claude`, `source_id`, `date`. |
| `mem0-export`     | Path to Mem0 export JSON or Mem0 API URL + credentials | Mem0 memory export (API or file). One note per memory; `source: mem0`, `source_id`, optional MIF-style fields. |
| `notebooklm`      | Google NotebookLM notebook ID or export path | NotebookLM sources → one note per source (or per section). `source: notebooklm`, `source_id` (notebook/source id). Requires Google auth or export files. |
| `gdrive`          | Google Drive folder ID or path to exported Docs | Google Drive / Google Docs as markdown or plain text. `source: gdrive`, `source_id` (file id). |
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

### 3.4 NotebookLM and Google Drive

- **NotebookLM:** Sources are Google Docs, Slides, PDFs, URLs, YouTube. NotebookLM Enterprise has an API (`notebooks.sources.batchCreate`). Third-party (e.g. notebooklm-py, notebooklm-kit) can export artifacts and sources. Importer: accept export folder or API + auth; one note per source (or per document) with `source: notebooklm`, `source_id` (notebook/source id).
- **Google Drive:** Export Docs as Markdown or plain text (manual or via Google Takeout / API). Importer: `gdrive` type for folder of exported files or Drive API with file IDs; `source: gdrive`, `source_id` (file id).

### 3.5 MIF (Memory Interchange Format)

- **What it is:** [mif-spec.dev](https://mif-spec.dev/) — vendor-neutral AI memory format. Dual representation: `.memory.md` (Markdown + YAML frontmatter) and `.memory.json` (JSON-LD). Obsidian-native.
- **Importer behavior:** Copy `.memory.md` into vault (they are already valid Obsidian notes). Optional: normalize to our frontmatter (e.g. map `mif:id` to `source_id`, add `source: mif`). No need to change body. Enables future interop with Mem0, Zep, etc. if they adopt MIF.

### 3.6 Audio and video (including wearables)

- **Smart glasses / wearables:** Devices (e.g. TranscribeGlass, Omi, Ray-Ban + GlassFlow, ViveGlass) often produce transcripts via app, webhook, or export. Omi supports webhooks for real-time transcript delivery. TranscribeGlass and similar may export text or send to a URL.
- **Importer behavior:** `import audio <file>` or `import audio <url>` runs the same pipeline as `scripts/transcribe.mjs`: transcribe → one note in `vault/media/audio/` or `vault/inbox/` with frontmatter `source: audio` (or `video`), `source_id`, `date`. Webhook receivers (e.g. from Omi) can write directly to inbox per message-interface contract; no separate “import” needed for real-time, but batch “import audio” for past recordings.
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

**Dry run** (preview without writing):
```bash
knowtation import markdown ./notes --dry-run --json
```

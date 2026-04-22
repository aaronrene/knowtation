# Import — manual test checklist

Use **self-hosted Hub** (`npm run hub`) or **CLI** for local file paths. **Hosted (gateway):** import is **bridge-backed** when `BRIDGE_URL` is set on the gateway; see [IMPORT-URL-AND-DOCUMENTS-PHASES.md](./IMPORT-URL-AND-DOCUMENTS-PHASES.md) §4V and [hub/gateway/README.md](../hub/gateway/README.md). Canonical `source_type` values: [`lib/import-source-types.mjs`](../lib/import-source-types.mjs).

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

- If **`BRIDGE_URL` is not set** on the **gateway**, `POST /api/v1/import` returns **501** with `code: NOT_AVAILABLE` and an error string (see [hub/gateway/server.mjs](../hub/gateway/server.mjs)). The Hub should surface that JSON clearly.
- When **`BRIDGE_URL` is set**, the gateway proxies to the **bridge** — same `POST /api/v1/import` as self-hosted Hub, including **4A₂**, **4B**, and **4C** (4C is client-only; no extra route). See [PARITY-MATRIX-HOSTED.md](./PARITY-MATRIX-HOSTED.md) and [IMPORT-URL-AND-DOCUMENTS-PHASES.md](./IMPORT-URL-AND-DOCUMENTS-PHASES.md) §4V.

## Hub — Phase 4A₂ (in-browser ZIP), 4B (sequential multi), and 4C (drop zone)

**When:** `npm run hub` (or hosted with bridge), signed in, **Import** modal.

1. **4A₂ — Markdown, two local `.md` (multi-select):** source **Markdown** → expect **one** `POST /api/v1/import` with a `hub-bulk.zip` (DevTools → Network) and >0 notes.
2. **4A₂ — Choose folder:** source **Markdown** → **Choose folder (ZIP in browser)** on a small tree of `.md` → one POST, **Re-index** if needed, notes present.
3. **4A₂ — ChatGPT:** a folder that includes `conversations.json` (or only that file) → source **ChatGPT** → one POST with client zip if not already a `.zip` upload; >0 notes.
4. **4B — Two PDFs:** source **PDF** → multi-select two small PDFs → **two** sequential `POST` / `import` and a **Batch: 2 of 2** success line (or failure text per file).
5. **4B — Stop batch:** start a 3+ PDF batch, **Stop batch** before the end; message indicates partial/bail.
6. **4C — Drop folder (Chromium):** source **Markdown** → **drag a small folder** of `.md` onto the dashed **Drop files or a folder** area → status shows file count, **Import** → same as **Choose folder** (one `hub-bulk.zip` POST for tree mode). In **Safari** / **Firefox**, directory drag may be flatter; if paths look wrong, use **Choose folder** or a desktop **ZIP** instead.
7. **Cap:** if you have no large fixtures, trust unit tests: `node --test test/hub-client-import-zip.test.mjs`.

### Hosted 4C + bridge (Chromium)

Run **after** a deploy to **production** or a **Netlify deploy preview** (same checks as 4C locally, but against the hosted **gateway** URL). **Prereq:** `BRIDGE_URL` set on the gateway, signed in, small fixture folder of `.md` files.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open Hub → **Import** | Modal includes dashed **#import-drop-zone** (inspect or visually confirm). |
| 2 | Source **Markdown** → **Choose folder** on the fixture → **Import** | One `POST /api/v1/import` in DevTools (e.g. `hub-bulk.zip` for client_zip mode), >0 notes. |
| 3 | **Same** fixture: **drag** folder onto the drop zone → **Import** | Same Network pattern and success as step 2 (4C is equivalent to **Choose folder** for the server). |
| 4 | (Optional) `GET {BRIDGE}/api/v1/bridge-version` | Record for PR evidence; see [IMPORT-URL-AND-DOCUMENTS-PHASES.md](./IMPORT-URL-AND-DOCUMENTS-PHASES.md) §4V. |

## Automated regression

- `node --test test/import-importers-golden.test.mjs test/import-source-types.test.mjs test/import-markdown.test.mjs test/embedding-usage.test.mjs test/hub-client-import-zip.test.mjs`

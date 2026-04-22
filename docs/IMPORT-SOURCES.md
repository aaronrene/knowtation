# Knowtation — Import Sources and External Knowledge Bases

This document specifies how to bring data and memory **into** the Knowtation vault from other platforms and devices. It covers **live capture** (messages and events → inbox) and **batch and one-time imports** (exports and files). Capture and import both produce vault notes that conform to [SPEC §1–2](./SPEC.md) (frontmatter, project, tags). The inbox contract for capture plugins is [CAPTURE-CONTRACT.md](./CAPTURE-CONTRACT.md).

---

## 1. Design principles

- **One vault format:** Every import produces Markdown notes with our frontmatter (or MIF-compatible notes that also satisfy our schema). No second schema inside the vault.
- **Traceable origin:** Every imported note has `source` (e.g. `chatgpt`, `claude`, `notebooklm`) and optional `source_id` (external id) and `date` so we can dedupe and attribute.
- **Re-import safe:** Importers should support idempotency (e.g. skip or update when `source` + `source_id` already exists) when the platform provides stable ids.
- **Agent- and human-friendly:** Imported notes are searchable, filterable by `--project` / `--tag`, and usable for blogs, podcasts, analysis, and marketing like any other vault content.

---

## 2. Live capture (messages → inbox)

**Capture** is the real-time path: platform messages and webhooks become **inbox notes** as they arrive. **Import** (§3) is for exports, uploads, and CLI batch runs. Both use the same frontmatter ideas (`source`, `source_id`, `date`).

**Hub endpoint:** `POST /api/v1/capture` with a JSON body. If the Hub has **`CAPTURE_WEBHOOK_SECRET`** set in its environment, clients must send header **`X-Webhook-Secret: <secret>`**.

### Capture at a glance

| | Channel | Setup |
|--|---------|--------|
| 💬 | **Slack** | Adapter default port **3132**; **`SLACK_SIGNING_SECRET`**; Slack Events API → adapter → Hub capture. Or Zapier/n8n: Slack trigger → HTTP POST to capture. |
| 🎮 | **Discord** | Adapter default port **3133**; webhook or bot POST → capture. Or Zapier/n8n → capture. |
| ✈️ | **Telegram** | Adapter default port **3134**; Bot API webhook or simplified JSON → capture. |
| 📱 | **WhatsApp** | No first-party adapter; use **Zapier**, **n8n**, or similar to forward messages to **`POST /api/v1/capture`**. |

**Scripts (self-hosted):** `scripts/capture-slack-adapter.mjs`, `capture-discord-adapter.mjs`, `capture-telegram-adapter.mjs`. Standalone local webhook: `node scripts/capture-webhook.mjs --port 3131` (see [CAPTURE-CONTRACT.md](./CAPTURE-CONTRACT.md)).

**Minimal JSON example:**

```json
{"body": "text", "source": "slack"}
```

**Details:** [CAPTURE-CONTRACT.md](./CAPTURE-CONTRACT.md) (plugin contract), [MESSAGING-INTEGRATION.md](./MESSAGING-INTEGRATION.md) (Slack / Discord / Telegram), [HUB-API.md](./HUB-API.md) §3.5 Capture.

---

## 3. Supported import sources (spec)

The CLI command **`knowtation import <source-type> <input> [options]`** accepts the following source types. Each maps an external format to vault notes.

**Canonical list:** The same `source_type` strings are enforced in [`lib/import-source-types.mjs`](../lib/import-source-types.mjs) for the CLI, self-hosted Hub `POST /api/v1/import`, Hub import modal, and the MCP `import` tool. If you add an importer, update that module and the table below together.

**Manual verification:** See [IMPORT-MANUAL-CHECKLIST.md](./IMPORT-MANUAL-CHECKLIST.md).

### At a glance

| | Source | Type | Format |
|--|--------|------|--------|
| 🤖 | **ChatGPT** | `chatgpt-export` | ZIP or folder export |
| 🧠 | **Claude** | `claude-export` | Chat + memory export |
| 💾 | **Mem0** | `mem0-export` | JSON memory export |
| 📝 | **Notion** | `notion` | API; page IDs + key |
| 🎫 | **Jira** | `jira-export` | CSV export |
| 📓 | **NotebookLM** | `notebooklm` | Markdown or JSON |
| 📁 | **Google Drive** | `gdrive` | Markdown folder |
| 📋 | **Linear** | `linear-export` | CSV export |
| 🔗 | **MIF** | `mif` | Memory Interchange Format |
| 📄 | **Markdown** | `markdown` | File or folder |
| 🎙️ | **Audio** | `audio` | Whisper transcription |
| 💰 | **Wallet CSV** | `wallet-csv` | Tx history; 11 formats |
| 🗄️ | **Supabase** | `supabase-memory` | Memory table import |
| 🦞 | **OpenClaw** | `openclaw` | Agent memory + chats |
| 💻 | **Local** | `markdown` | Files from disk |
| 👥 | **Team** | _(Hub UI)_ | Teammates contribute |

**Live inbox capture** (Slack, Discord, Telegram, WhatsApp via automation) is not a CLI `import` type: use **`POST /api/v1/capture`** and the adapters in **§2**.

### Full reference

| Source type       | Input (path or URI)     | Description |
|-------------------|-------------------------|-------------|
| 🤖 `chatgpt-export`  | Path to OpenAI export ZIP or folder with `conversations.json` | ChatGPT data export (Settings → Export Data). One note per conversation or per message thread; frontmatter: `source: chatgpt`, `source_id`, `date`, optional `project`, `tags`. |
| 🧠 `claude-export`   | Path to Claude export ZIP or folder (chat history / memory) | Claude data export (Settings → Privacy → Export) and/or memory export. One note per conversation or per memory entry; `source: claude`, `source_id`, `date`. |
| 💾 `mem0-export`     | Path to Mem0 export JSON | Mem0 memory export. One note per memory; `source: mem0`, `source_id`, `date`. |
| 📝 `notion`          | Comma-separated Notion page IDs | Fetches pages as markdown via Notion API. Requires `NOTION_API_KEY`. One note per page; `source: notion`, `source_id: page_id`. |
| 🎫 `jira-export`     | Path to Jira CSV file (or folder with one .csv) | Jira Cloud/Server CSV export. One note per issue; `source: jira`, `source_id: issue key`, summary, description. |
| 📓 `notebooklm`      | Path to folder of .md files or to a .json export | NotebookLM: folder of markdown (e.g. from takeout/Apify) or JSON with sources/conversations array. One note per file or entry; `source: notebooklm`. |
| 📁 `gdrive`          | Path to folder of Markdown files | Google Drive: folder of .md files (e.g. from export or pandoc). One note per file; `source: gdrive`, `source_id` from filename. |
| 📋 `linear-export`   | Path to Linear CSV file | Linear workspace export (CSV). One note per issue; `source: linear`, `source_id`, title, description. |
| 🔗 `mif`             | Path to `.memory.md` or `.memory.json` or folder of MIF files | [Memory Interchange Format](https://mif-spec.dev/). MIF is Obsidian-native; files can be copied in as-is or normalized to our frontmatter. |
| 📄 `markdown`        | Path to file or folder of Markdown files | Generic Markdown import. Preserve or infer frontmatter; add `source: markdown`, `date` if missing. For Evernote/Standard Notes/etc. exports that are already Markdown. |
| 🎙️ `audio`           | Path to audio file or URL (e.g. wearable webhook payload) | **Primary path for in-Hub transcription** (self-hosted). OpenAI Whisper; **max ~25 MB** per file. One note per file; frontmatter: `source: audio`, `source_id`, `date`. |
| 💰 `wallet-csv`      | Path to wallet/exchange transaction history CSV (or folder containing one .csv) | Converts wallet export files into vault notes with blockchain frontmatter. One note per row; `source: wallet-csv-import`, `source_id: tx_hash`, blockchain fields (`network`, `wallet_address`, `tx_hash`, `payment_status`, `amount`, `currency`, `direction`, `confirmed_at`, `block_height`). Notes land in `inbox/wallet-import/`. Auto-detects named formats: **Coinbase**, **Coinbase Pro**, **Exodus**, **ICP Rosetta**, **Kraken**, **Binance**, **MetaMask/Etherscan**, **Phantom (Solana)**, **Ledger Live**. Falls back to generic column alias matching for any other CSV. Re-import is safe: duplicate rows (same output path) are skipped. |
| 🗄️ `supabase-memory` | Supabase connection + table name | Import memory rows from a Supabase table. For users coming from database-centric stacks. |
| 🦞 `openclaw`        | Path to OpenClaw data export or memory dump | Import agent conversations and memory from [OpenClaw](https://github.com/openclaw/openclaw). One note per conversation or memory entry; `source: openclaw`, `source_id`, `date`. |

> **Video:** CLI and MCP still support `knowtation import video <file>` (same Whisper pipeline as audio), but video files are usually over 25 MB. Export audio first or transcribe with another service and import as Markdown.

**Options (common):** `--project <slug>`, `--output-dir <vault-path>`, `--tags tag1,tag2`, `--dry-run`, `--json`. If `--output-dir` is omitted, default is `vault/inbox/` or `vault/projects/<project>/inbox/` when `--project` is set.

> **See also:** [Templates and Skills](./TEMPLATES-AND-SKILLS.md) — starter vault templates, agent skill packs, and how they compose with import sources.

---

## 4. Platform-specific notes

### 🤖 4.1 ChatGPT (OpenAI)

- **How users get data:** Settings → Data Controls → Export Data (or Privacy Portal). Email link to ZIP containing `conversations.json` (and sometimes `chat.html`). Link expires in 24 hours; export can take up to 7 days.
- **Format:** `conversations.json` is a tree of messages (mapping of id → { message, parent, children }). Each message has `content.parts`, `author.role`, timestamps.
- **Importer behavior:** Parse `conversations.json`; for each conversation, produce one note (or one per thread) with body = concatenated or structured transcript. Frontmatter: `source: chatgpt`, `source_id: <conversation-id>`, `date`, `title` from conversation title. Optional: one note per message for fine-grained search (heavier).
- **Third-party:** Browser extensions (e.g. ChatGPT Exporter) can export per-conversation JSON/Markdown/HTML; importer can accept a folder of such files and treat as `chatgpt-export` or `markdown` with `source: chatgpt`.

### 🧠 4.2 Claude (Anthropic)

- **How users get data:** Settings → Privacy → Export data (chat history). Memory: Settings → Capabilities → View and edit your memory → export (and Claude supports importing memory from other AI providers via a prompt).
- **Format:** Export is account data (format may vary). Memory export is a user-facing list that can be copied; API or file format TBD.
- **Importer behavior:** Same pattern as ChatGPT: one note per conversation or per memory entry; `source: claude`, `source_id`, `date`. Third-party tools (e.g. claude-exporter) produce JSON/Markdown; we can accept that as `claude-export` or `markdown` with `source: claude`.

### 💾 4.3 Mem0

- **How users get data:** Mem0 API: `create_memory_export()` with schema; then retrieve via `get_memory_export()`. Returns JSON (Pydantic-style schema).
- **Importer behavior:** Map Mem0 memories to vault notes. Each memory → one note; frontmatter can include Mem0 metadata (e.g. `mem0_id`, `user_id`) and our `source: mem0`, `source_id`, `date`. Optionally support MIF as output so Mem0 users can later use MIF-native tools.

### 📝 4.4 Notion

- **How users get data:** Notion API: create an integration at notion.so/my-integrations, share pages with it, then use page IDs (from the page URL: notion.so/workspace/page_id).
- **Importer behavior:** `knowtation import notion <page_id>` or `knowtation import notion "id1,id2,id3"`. Requires `NOTION_API_KEY`. Fetches each page as markdown via `GET /v1/pages/{page_id}/markdown`; one note per page with `source: notion`, `source_id: page_id`.

### 🎫📋 4.5 Jira and Linear

- **Jira:** Export from Jira (list or search → Export CSV). Importer: `knowtation import jira-export /path/to/export.csv --output-dir imports/jira`. Maps Issue key, Summary, Description, Project to vault notes.
- **Linear:** Export from Linear (Command menu → Export data → CSV). Importer: `knowtation import linear-export /path/to/linear-export.csv --project myproject`.

### 📓📁 4.6 NotebookLM and Google Drive

- **NotebookLM:** Accepts (1) a folder of markdown files (e.g. from Google takeout or third-party Apify export), or (2) a JSON file with an array of entries (`content`, `id`, `title`). One note per file or entry; `source: notebooklm`.
- **Google Drive:** Accepts a folder of Markdown files. Export Docs as .docx then convert to .md (e.g. pandoc), or use a sync script. Importer: `knowtation import gdrive /path/to/folder`; `source: gdrive`, `source_id` from filename.

### 📚 4.7 Confluence

- **How users get data:** Confluence has no native markdown export. Use third-party tools (e.g. confluence-cli, nodejs-confluence-export) to export a space or page to a folder of markdown files.
- **Importer behavior:** Export to a folder with one of those tools, then run `knowtation import markdown /path/to/confluence-export --output-dir imports/confluence --tags confluence`. Optional: add a thin `confluence-export` importer that accepts the same folder and sets `source: confluence`, `source_id` from filename.

### 🔗 4.8 MIF (Memory Interchange Format)

- **What it is:** [mif-spec.dev](https://mif-spec.dev/) — vendor-neutral AI memory format. Dual representation: `.memory.md` (Markdown + YAML frontmatter) and `.memory.json` (JSON-LD). Obsidian-native.
- **Importer behavior:** Copy `.memory.md` into vault (they are already valid Obsidian notes). Optional: normalize to our frontmatter (e.g. map `mif:id` to `source_id`, add `source: mif`). No need to change body. Enables future interop with Mem0, Zep, etc. if they adopt MIF.

### 🎙️ 4.9 Audio and video (including wearables)

- **Product note:** **Audio** is the recommended path for in-app transcription (smaller files, usually under OpenAI’s **25&nbsp;MB** per-request limit). **Video** in the **self-hosted Hub** import dialog is **coming soon**; use **`knowtation import video`** from the CLI (same limit), or strip audio / transcribe elsewhere and import **Markdown**.
- **Smart glasses / wearables:** Devices (e.g. TranscribeGlass, Omi, Ray-Ban + GlassFlow, ViveGlass) often produce transcripts via app, webhook, or export. Omi supports webhooks for real-time transcript delivery. TranscribeGlass and similar may export text or send to a URL.
- **Importer behavior:** `import audio <file>` or `import video <file>` transcribes via OpenAI Whisper (`OPENAI_API_KEY` required) → one note with transcript as body; frontmatter `source: audio` or `source: video`, `source_id`, `date`. Formats: mp3, mp4, mpeg, mpga, m4a, wav, webm. The API rejects uploads over **25&nbsp;MB** (see `WHISPER_MAX_FILE_BYTES` in `lib/transcribe.mjs`). **Self-hosted:** if **ffmpeg** is available, Knowtation may transcode down first (`lib/ffmpeg-whisper-transcode.mjs`; disable via `transcription.transcode_oversized: false` or `KNOWTATION_TRANSCODE_OVERSIZED=0`). Webhook receivers (e.g. Omi) can write transcripts directly to inbox per message-interface contract.
- **Past blogs/videos:** User exports blog text or video transcript (or uses our transcription). Import as `markdown` or `audio`/`video` so historical content lives in the vault.

---

## 5. CLI surface (summary)

- **Command:** `knowtation import <source-type> <input> [--project <slug>] [--output-dir <path>] [--tags t1,t2] [--dry-run] [--json]`
- **Behavior:** Run the importer for the given source type; write notes to vault; optionally run indexer after (config or flag). Output: list of written paths; with `--json`, machine-readable summary.
- **Exit codes:** 0 success, 1 usage error, 2 runtime error (same as rest of CLI).

---

## 6. What we're not forgetting

- **Any audio:** Smart glasses, wearables, past blogs/videos, recordings → transcription (when under **25&nbsp;MB**) or external transcript → vault note with `source` and `source_id`.
- **Any knowledge base:** Google Drive, NotebookLM, ChatGPT, Claude, Mem0, Evernote/Standard Notes (as Markdown), MIF → all have a defined `import` path into the vault.
- **Any agent or business use:** Once in the vault, content is searchable, project/tag-filterable, and usable for blogs, podcasts, videos, marketing, analysis, writing. No second-class content.

Implementors: follow [SPEC.md](./SPEC.md) import contracts and extend `lib/importers/` with tests.

---

## 7. How to run (examples)

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

**Audio** (transcription via OpenAI Whisper; requires `OPENAI_API_KEY`; **max ~25&nbsp;MB** per file):
```bash
knowtation import audio ./recording.m4a --project born-free --output-dir media/audio
```
**Video** (same pipeline and limit; prefer exporting **audio** for long content):
```bash
knowtation import video ./short-clip.mp4 --output-dir media/video
```

**Wallet / exchange CSV** — one note per transaction row, format auto-detected:
```bash
# Generic CSV with any recognized headers
knowtation import wallet-csv ./wallet-export.csv --tags payment,on-chain

# Coinbase (Date, Transaction Type, Asset, Quantity Transacted, …)
knowtation import wallet-csv ./coinbase-export.csv --tags coinbase,payment

# Coinbase Pro / Advanced Trade (portfolio, type, time, amount, amount/balance unit, …)
knowtation import wallet-csv ./coinbase-pro-fills.csv --tags coinbase-pro

# Exodus (DATE, TYPE, FROMAMOUNT, FROMCURRENCY, TXID, …)
knowtation import wallet-csv ./exodus-transactions.csv --tags exodus

# ICP Rosetta (hash, block_index, timestamp, type, account, amount)
knowtation import wallet-csv ./icp-rosetta.csv --tags icp,on-chain

# Kraken ledger export (txid, refid, time, type, aclass, asset, amount, fee, balance)
knowtation import wallet-csv ./kraken-ledgers.csv --tags kraken,payment

# Binance deposit/withdrawal (Date(UTC), Coin, Network, Amount, TXID, Status, …)
knowtation import wallet-csv ./binance-history.csv --tags binance

# Binance spot wallet history (UTC_Time, Account, Operation, Coin, Change, Remark)
knowtation import wallet-csv ./binance-spot-wallet.csv --tags binance

# MetaMask / Etherscan address export (Txhash, Blockno, DateTime (UTC), From, To,
#   Value_IN(ETH), Value_OUT(ETH), Status, …)
knowtation import wallet-csv ./etherscan-export.csv --tags metamask,eth

# Phantom wallet (Transaction ID, Date, Type, Amount, Token, Status, Fee (SOL), Signature)
knowtation import wallet-csv ./phantom-history.csv --tags phantom,solana

# Ledger Live (Operation Date, Currency ticker, Operation Amount, Operation Hash, …)
knowtation import wallet-csv ./ledger-live-export.csv --tags ledger

# From Hub UI: Import modal → Source type → Wallet / exchange CSV → upload .csv file
```

Notes land in `inbox/wallet-import/<YYYY-MM-DD>-<tx_hash_prefix>.md`.  
Re-importing the same CSV is safe — rows with an existing output path are skipped.

### Named format auto-detection

The importer fingerprints the CSV header to pick the right normaliser automatically.
No user action required — just upload/pass the CSV as-is.

| Format | Fingerprint headers | `network` set to |
|--------|--------------------|--------------------|
| **Coinbase** | `Quantity Transacted`, `Transaction Type` | `coinbase` |
| **Coinbase Pro** | `portfolio`, `amount/balance unit` | `coinbase-pro` |
| **Exodus** | `FROMAMOUNT`, `FROMCURRENCY` | _(from row)_ |
| **ICP Rosetta** | `hash`, `block_index` (≤10 cols) | `icp` |
| **Kraken** | `refid`, `aclass` or `asset` | `kraken` |
| **Binance deposit/withdrawal** | `Date(UTC)`, `Coin` | from `Network` column |
| **Binance spot wallet** | `UTC_Time`, `Coin` | `binance` |
| **MetaMask / Etherscan** | `Value_IN(ETH)` or `Value_OUT(ETH)` or `Blockno` | `ethereum` |
| **Phantom** | `Signature` or `fee (sol)`, `token` | `solana` |
| **Ledger Live** | `Operation Date`, `Currency ticker` | inferred from ticker |
| **Generic** | any CSV with recognised aliases | from `network` column |

### Generic column alias table

For CSVs not matching a named format, the importer resolves these aliases (case-insensitive):

| Canonical field   | CSV column aliases |
|-------------------|--------------------|
| `tx_hash`         | `txhash`, `transaction_hash`, `hash`, `tx id`, `txid`, `transaction id`, `transaction_id` |
| `confirmed_at`    | `date`, `timestamp`, `time`, `confirmed at`, `confirmed_at`, `block time`, `block_time` |
| `amount`          | `amount`, `value`, `quantity` |
| `currency`        | `currency`, `asset`, `token`, `coin`, `symbol` |
| `direction`       | `type`, `direction`, `side` — `buy`/`receive`/`deposit`/`earn` → `received`; `sell`/`send`/`withdrawal` → `sent`; `swap`/`trade` → as-is |
| `payment_status`  | `status` — `completed`/`success`/`confirmed` → `settled`; `pending` → `pending`; `failed`/`error`/`rejected` → `failed` |
| `wallet_address`  | `from`, `to`, `address`, `wallet`, `sender`, `recipient`, `from_address`, `to_address` |
| `network`         | `network`, `chain`, `blockchain` |
| `block_height`    | `block`, `block number`, `block_number`, `block height`, `block_height` |

### Example note produced

```markdown
---
title: ICP transfer — 500 ICP sent
date: 2026-04-02
source: wallet-csv-import
source_id: 8a3c0d1b2e4f
network: icp
wallet_address: rrkah-fqaaa-aaaaa-aaaaq-cai
tx_hash: 8a3c0d1b2e4f
payment_status: settled
amount: 500
currency: ICP
direction: sent
confirmed_at: 2026-04-02T18:12:44Z
block_height: 12345678
tags: [payment, on-chain, icp-tx]
---

Transaction imported from wallet CSV export.
Amount: 500 ICP | Direction: sent | Status: settled
Block: 12,345,678 | Confirmed: 2026-04-02 18:12:44 UTC
```

**Dry run** (preview without writing):
```bash
knowtation import markdown ./notes --dry-run --json
```

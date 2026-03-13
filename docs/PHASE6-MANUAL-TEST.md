# Phase 6 — Import manual testing guide

How to manually verify the `knowtation import` command for each source type.

---

## Prerequisites

- **Config:** `config/local.yaml` with `vault_path` (or env `KNOWTATION_VAULT_PATH`). See [PHASE4-MANUAL-TEST.md](./PHASE4-MANUAL-TEST.md) for setup.
- **Vault:** A vault directory that exists.

From the **repo root**, run all commands.

---

## 1. Markdown (single file)

Create a test file and import it:

```bash
# Create a test markdown file
echo '---
title: Manual test
---
This is a test note.' > /tmp/phase6-test.md

# Import to vault inbox
node cli/index.mjs import markdown /tmp/phase6-test.md

# Check: vault should contain inbox/phase6-test.md (or similar)
node cli/index.mjs get-note inbox/phase6-test.md
```

Or import an existing vault note into a different folder:

```bash
node cli/index.mjs import markdown vault/inbox/foo.md --output-dir imports/test --dry-run --json
# (dry-run shows what would be written; remove --dry-run to actually write)
```

**Expected:** One note written; frontmatter includes `source: markdown` and `date`. Existing frontmatter preserved.

---

## 2. Markdown (folder)

Import a whole folder of `.md` files:

```bash
# Use the vault's projects folder as input
node cli/index.mjs import markdown vault/projects --output-dir imports/from-projects --project test
```

**Expected:** All `.md` files under `vault/projects/` are copied to `imports/from-projects/...` with `source: markdown`.

---

## 3. ChatGPT export

Use the included fixture (no real ChatGPT export required):

```bash
node cli/index.mjs import chatgpt-export scripts/fixtures/chatgpt-sample --output-dir imports/chatgpt
node cli/index.mjs get-note imports/chatgpt/Test_conversation.md
```

**Expected:** One note with frontmatter `source: chatgpt`, `source_id`, `date`, `title`. Body contains the conversation transcript.

**With a real ChatGPT export:** Extract the OpenAI ZIP, then pass the folder path:
```bash
node cli/index.mjs import chatgpt-export /path/to/extracted-folder --output-dir imports/chatgpt
```

---

## 4. Claude export

If you have a folder of Markdown files from a third-party Claude exporter:

```bash
node cli/index.mjs import claude-export /path/to/claude-export-folder --output-dir imports/claude
```

Or a JSON file with conversations:

```bash
# Create minimal JSON
echo '[{"title":"Test","content":"Hello","id":"c1"}]' > /tmp/claude.json
node cli/index.mjs import claude-export /tmp/claude.json --output-dir imports/claude
```

---

## 5. MIF (Memory Interchange Format)

```bash
# Create a .memory.md file
echo '---
title: MIF test
mif:id: mif-1
---
Memory content.' > /tmp/test.memory.md

node cli/index.mjs import mif /tmp/test.memory.md --output-dir imports/mif
node cli/index.mjs get-note imports/mif/test.md
```

**Expected:** Note has `source: mif`, `source_id: mif-1`, and the body preserved.

---

## 6. Mem0 export

Create a minimal Mem0-style JSON:

```bash
echo '[{"id":"m1","memory":"Test memory","created_at":"2026-03-13"}]' > /tmp/mem0.json
node cli/index.mjs import mem0-export /tmp/mem0.json --output-dir imports/mem0
```

**Expected:** One note per memory entry with `source: mem0`, `source_id`.

---

## 7. Dry run (preview)

Preview without writing:

```bash
node cli/index.mjs import markdown vault/inbox/foo.md --output-dir imports/preview --dry-run --json
```

**Expected:** JSON `{ "imported": [...], "count": n }` but no files written.

---

## 8. Options

- `--project <slug>` — Write to `projects/<slug>/inbox/` when `--output-dir` is omitted.
- `--output-dir <path>` — Custom vault-relative output folder.
- `--tags t1,t2` — Add tags to imported notes.
- `--dry-run` — List what would be imported without writing.
- `--json` — Machine-readable output.

---

## Quick smoke test (minimal)

From repo root:

```bash
node cli/index.mjs import markdown vault/inbox/foo.md --output-dir imports/smoke --dry-run
node cli/index.mjs import chatgpt-export scripts/fixtures/chatgpt-sample --output-dir imports/smoke
node cli/index.mjs list-notes --folder imports/smoke
```

If these succeed, core import paths work.

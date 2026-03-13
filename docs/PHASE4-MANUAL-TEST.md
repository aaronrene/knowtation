# Phase 4 — Manual testing guide (beginner-friendly)

This explains what the **vault** is and how to run a quick manual test of **write** and **export** so you can commit Phase 4 with confidence.

---

## What is the “vault”?

The **vault** is just the folder on your computer where Knowtation keeps your notes. All notes are normal Markdown files (`.md`) inside that folder. Think of it like “the root folder of your knowledge base.”

- In this repo, that folder is **`vault/`** (already present, with a couple of example notes).
- The CLI needs to know where this folder is. It gets that from either:
  1. A config file: **`config/local.yaml`**, with a line that sets `vault_path`, or  
  2. An environment variable: **`KNOWTATION_VAULT_PATH`**.

You only need one of these. Below we use the config file so you don’t have to type the env var every time.

---

## Step 1 — Tell Knowtation where your vault is

From the **repo root** (the `knowtation` folder):

1. Copy the example config:
   ```bash
   cp config/local.example.yaml config/local.yaml
   ```
2. Open **`config/local.yaml`** and set the vault path.

   You can use a **relative** path from the repo (e.g. the existing `vault/` folder):

   ```yaml
   vault_path: vault
   ```

   Or an **absolute** path, e.g.:

   ```yaml
   vault_path: /Users/aaronrenecarvajal/knowtation/vault
   ```

3. Save the file.  
   (Do **not** commit `config/local.yaml` — it’s in `.gitignore` and is for your machine only.)

After this, the CLI will know: “the vault is that folder,” and all paths you give to `write` and `export` are relative to that folder (e.g. `inbox/new.md` means `vault/inbox/new.md`).

---

## Step 2 — Test `write`

These commands create or update a note **inside the vault**.

**From the repo root**, run:

```bash
node cli/index.mjs write inbox/phase4-test.md --frontmatter source=cli date=2026-03-13
```

- This creates (or overwrites) **`vault/inbox/phase4-test.md`**.
- Because you didn’t use `--stdin`, the body will be empty (or minimal). That’s fine for a quick test.

**Check:** Open `vault/inbox/phase4-test.md`. You should see YAML frontmatter with `source: cli` and `date: 2026-03-13`, and a body.

**Optional — write with body from stdin:**

```bash
echo "Hello from Phase 4 manual test." | node cli/index.mjs write inbox/phase4-stdin.md --stdin --frontmatter source=cli
```

Then open **`vault/inbox/phase4-stdin.md`** and confirm the content is there.

**Optional — append to an existing note:**

```bash
echo "\n\nAppended line." | node cli/index.mjs write inbox/phase4-test.md --stdin --append
```

Re-open `vault/inbox/phase4-test.md` and confirm the new line was appended.

---

## Step 3 — Test `export`

Export reads one or more vault notes and writes them to a file or folder **outside** the vault (e.g. `./out/`).

**From the repo root:**

1. Create an output directory (if you don’t have one):
   ```bash
   mkdir -p out
   ```
2. Export a single note to a file:
   ```bash
   node cli/index.mjs export inbox/phase4-test.md out/phase4-test.md --format md
   ```
3. Check:
   - **`out/phase4-test.md`** should exist and contain the note content.
   - If the implementation adds provenance, the exported file may include frontmatter like `source_notes: [inbox/phase4-test.md]` or similar.

**Export to a directory** (multiple files go into that folder):

```bash
node cli/index.mjs export inbox/phase4-test.md out/ --format md
```

Check that the file appears under `out/` with an expected name (e.g. `phase4-test.md`).

---

## Step 4 — You’re ready to commit Phase 4

If:

- **write** created/updated the files under `vault/inbox/` as expected, and  
- **export** produced the expected file(s) under `out/`,

then Phase 4 behavior is verified. You can:

1. **Optionally** delete the test notes and export output if you don’t want them in the repo:
   - e.g. `vault/inbox/phase4-test.md`, `vault/inbox/phase4-stdin.md`, `out/phase4-test.md`, `out/phase4-stdin.md`.
2. **Commit** the Phase 4 code and docs (e.g. `lib/write.mjs`, `lib/air.mjs`, `lib/export.mjs`, CLI changes, and updates to `docs/IMPLEMENTATION-PLAN.md`). Do **not** commit `config/local.yaml`.

After that, you’re ready to move on to Phase 5 (capture plugin).

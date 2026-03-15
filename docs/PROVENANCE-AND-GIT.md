# Provenance and Git — Clarification

Two separate ideas are referenced in the spec under "provenance and git." They are **not** the same thing, and neither means "use Git instead of an inbox."

---

## 1. Provenance (traceability of outputs)

**What it is:** Recording **where an output came from** — which inputs were used to create it — and, when AIR is enabled, **who/what authorized** the action.

- **On export:** When you run `knowtation export ...`, the system records **which vault notes** were used as sources for that export (e.g. a list of paths or a manifest). That record is "provenance" for the exported artifact. Optional: store this in the memory layer (e.g. "last export used notes X, Y, Z") so agents can answer "what notes fed this blog post?"
- **On write (non-inbox):** When an agent or user writes to a note **outside** the inbox (e.g. `vault/projects/foo/note.md`), AIR can require an attestation before the write; the **AIR id** is then logged with that write. So you have a chain: "this note was written after attestation #xyz."
- **Governance:** Logging, agent-generated tags, and this provenance chain support audit and trust: you can see what was used to create an export and what was approved before a write.

**What it is not:** Provenance is not "using Git as the inbox." The **inbox** is still a folder in the vault (`vault/inbox/` or `vault/projects/<project>/inbox/`) where capture plugins and imports write notes. Provenance is about **tagging outputs** (exports and approved writes) with their sources and, when used, AIR ids.

---

## 2. Vault under Git (version history and backup) — crucial for production

**We recommend treating GitHub (or another Git remote) as a core part of your setup.** Backup and version history are not optional if your vault is important to you.

**What it is:** The **vault** (the folder of Markdown files that is the source of truth) can be placed inside a **Git repository**. You then get:

- **History:** Every change to any note is a commit; you can see who changed what and when, and revert.
- **Audit trail:** Git log is the history of your knowledge base.
- **Backup / portability:** Push to a remote (GitHub, GitLab, or a private server) for backup and sync across machines. The vault directory remains the same; Git is just the version-control layer around it.

**What it is not:** Git is not a *replacement* for the inbox. The inbox is still a **location** in the vault (`vault/inbox/`). You can put the whole vault (including the inbox) under Git. So:

- Capture plugins and importers **write files** into `vault/inbox/` (or project inbox) as today.
- You (or your workflow) **commit** those files to Git when you want a snapshot — e.g. after a capture run, or on a schedule, or manually. Git gives you history and backup; the inbox gives you a designated place for raw ingestion.

**Optional auto-sync:** In `config/local.yaml` under `vault.git` you can set `auto_commit: true` (and optionally `auto_push: true`). Then every Hub write (new note, capture, or approved proposal) triggers a git add, commit, and optionally push. So your GitHub backup stays up to date without running `knowtation vault sync` by hand. Manual `knowtation vault sync` remains available when you want to sync from the CLI.

**Summary:** "Vault under git" = recommend storing the vault folder in a Git repo so you have version history and an audit trail. It does **not** mean "use Git as the transport or storage for the inbox"; the inbox is still file-based inside the vault.

---

## 3. How they work together

| Concept | Role |
|--------|------|
| **Inbox** | Folder(s) in the vault where captures and imports write **new** notes (with frontmatter `source`, `date`, etc.). |
| **Provenance** | When you **export** or **write** (non-inbox), we record *which notes were used* and, with AIR, *which attestation* authorized the action. |
| **Vault under Git** | The whole vault (including inbox and all other folders) lives in a Git repo so you have **history, diff, and backup** of all note changes. |

So: you keep an inbox for incoming content; you record provenance on exports and approved writes; and you put the vault in Git to get history and a golden thread of changes over time. All three can be used together.

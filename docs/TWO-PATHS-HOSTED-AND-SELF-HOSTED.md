# Two paths: hosted and self-hosted (one product)

One codebase, same Hub UI. Users choose how they run it.

---

## The two paths

| | **Hosted** (what you're on now) | **Self-hosted** |
|--|----------------------------------|------------------|
| **Where** | Open **knowtation.store/hub/** in a browser | Run the Hub on **your machine** (or your server) |
| **Data** | Stored in our **canister** (cloud). Vault shows as "Canister" in Settings. | Stored in a **folder on your disk** (`KNOWTATION_VAULT_PATH`) |
| **Sign-in** | Google/GitHub via our gateway; name and role from our backend | Same OAuth; you add client ID/secret to your `.env`; roles in your `data/hub_roles.json` |
| **Backup** | Optional **Connect GitHub** → we commit and push **your** vault to **your** GitHub repo (bridge) | **Back up now** in Settings (or CLI `knowtation vault sync`); vault folder as a Git repo — see Hub **How to use** → Step 7 |
| **Semantic search** | We run indexing for you (no local Ollama/Qdrant required) | You run **`npm run index`** or Hub **Re-index** after configuring **sqlite-vec** (or Qdrant) + **Ollama or OpenAI** embeddings in `config/local.yaml` — see Hub **How to use** → Step 4 |

You do **not** need two separate products or two codebases. The **same** repo and UI support both. The only difference is **which URL you open** and **which backend** serves the API (our gateway + canister vs your Node Hub).

**Hosted billing:** **Free** plus **paid** tiers (Plus, Growth, Pro) with a **monthly indexing token** allowance visible in the Hub; **token packs** add rollover capacity; **search** is included under fair use. Billing is enforced in production. See [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md).

---

## How it looks to users

**On the landing (knowtation.store):**

- **"Open Knowtation Hub"** → goes to **knowtation.store/hub/** → **hosted path**. Sign in, use the Hub in the cloud. Optional: Connect GitHub for backup.
- **"Run it yourself"** or **"Self-host"** → goes to docs (e.g. GETTING-STARTED or a short **Quick start (self-hosted)** page): clone, set vault path + JWT secret, optionally OAuth, run `npm run hub`, open **http://localhost:3333/**.

So: **one site, two clear choices.** No switching code; we just document both and link accordingly.

---

## Quick start (self-hosted)

**Goal:** Run the Hub locally with your own vault folder, optional semantic search, OAuth, and GitHub backup.

The **same seven steps** appear in the Hub UI under **How to use** (after you open the app). Below is the command-oriented version; keep them in sync.

1. **Clone and install** (skip `git clone` if you already have the repo — e.g. you develop Knowtation)
   ```bash
   git clone https://github.com/aaronrene/knowtation.git
   cd knowtation
   npm install
   cd hub && npm install && cd ..
   ```

2. **Vault folder** — Create a directory for notes (outside the repo is fine, e.g. `~/knowtation-vault`):
   ```bash
   mkdir -p ~/knowtation-vault
   ```

3. **Config** — Copy `config/local.example.yaml` to `config/local.yaml`. Set **the same absolute path** as:
   - `vault_path:` in `config/local.yaml`
   - `KNOWTATION_VAULT_PATH` in `.env` at repo root  
   For **semantic search** without Qdrant: `vector_store: sqlite-vec`, `data_dir: data/`, and `embedding:` (Ollama `nomic-embed-text` or OpenAI — see [GETTING-STARTED.md](./GETTING-STARTED.md) §2). In `.env` also set **HUB_JWT_SECRET** (long random string).

4. **Start the Hub**
   ```bash
   npm run hub
   ```
   Open **http://localhost:3333/** (use `http://`, not `https://localhost`).

5. **Log in (OAuth)** — OAuth client IDs/secrets **do not** ship with the repo. Register your own Google/GitHub OAuth app, add redirect URIs (e.g. `http://localhost:3333/api/v1/auth/callback/google`), put credentials in `.env`, restart the Hub. See [hub/README.md](../hub/README.md).

6. **Index (semantic search)** — Listing notes works without this; **Search vault** needs an index:
   ```bash
   npm run index
   ```
   Or use **Re-index** in the Hub. After large imports, run again.

7. **Import / automate / GitHub backup** — Optional: import from other tools (CLI or capture); use the Hub for proposals and agents. For backup: **How to use** in the Hub → **Step 7** (empty GitHub repo, `git init` in vault if needed, Connect GitHub, Back up now). Checklist: [SELF-HOSTED-SETUP-CHECKLIST.md](./SELF-HOSTED-SETUP-CHECKLIST.md).

**Full detail:** [GETTING-STARTED.md](./GETTING-STARTED.md), [setup.md](./setup.md). **In-app walkthrough:** open the Hub → **How to use** (links to these docs at the top).

---

## Hosted path: GitHub backup (Connect GitHub, Back up now)

**What we offer:** On the **hosted** Hub you can connect **your** GitHub account so we push your vault (notes) to **your** repo. You don't run git yourself; you click **Connect GitHub** and **Back up now** in Settings.

**What “git” does under the hood (we run it, not the user):**

- **Connect GitHub:** OAuth to GitHub; we store a token (scope `repo`) and optionally the repo you want (e.g. `owner/repo-name`).
- **Back up now:** We fetch **notes** from the canister (`GET /api/v1/export`) and **full proposals** (list + one GET per id), then create a commit: **Markdown files** for each note plus **`.knowtation/backup/v1/snapshot.json`** (all proposal fields: status, review, enrich metadata, bodies). Push uses the **GitHub API** (blobs / tree / commit / ref), not a local `git` binary.

**Storage and limits:**

- **Content:** Vault = **Markdown and small text files**. No big binaries; no “file share” — just notes and metadata.
- **GitHub free tier:** 1 GB per repo (soft limit), 100 GB per account. For text/markdown, users are extremely unlikely to hit 1 GB. So: **no big files, just text** — and free tier is enough for normal use.
- **If you ever exceed free tier:** That’s a GitHub account limit (e.g. many repos or large repos). For a single “vault backup” repo with markdown, we don’t expect users to hit it. You can document: “Vault is markdown; well under GitHub’s free limits.”

**Summary:** One product, two paths (hosted + self-hosted). On hosted you can hook up GitHub so we commit and push your data to your repo; we use GitHub’s API, not raw git commands; storage is text-only and fits easily in GitHub’s free tier.

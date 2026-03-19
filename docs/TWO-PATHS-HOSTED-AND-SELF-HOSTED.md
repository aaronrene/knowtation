# Two paths: hosted and self-hosted (one product)

One codebase, same Hub UI. Users choose how they run it.

---

## The two paths

| | **Hosted** (what you're on now) | **Self-hosted** |
|--|----------------------------------|------------------|
| **Where** | Open **knowtation.store/hub/** in a browser | Run the Hub on **your machine** (or your server) |
| **Data** | Stored in our **canister** (cloud). Vault shows as "Canister" in Settings. | Stored in a **folder on your disk** (`KNOWTATION_VAULT_PATH`) |
| **Sign-in** | Google/GitHub via our gateway; name and role from our backend | Same OAuth; you add client ID/secret to your `.env`; roles in your `data/hub_roles.json` |
| **Backup** | Optional **Connect GitHub** → we commit and push **your** vault to **your** GitHub repo (when bridge is deployed) | You set `vault.git` in config and use **Back up now** (or CLI `knowtation vault sync`) to push to your repo |

You do **not** need two separate products or two codebases. The **same** repo and UI support both. The only difference is **which URL you open** and **which backend** serves the API (our gateway + canister vs your Node Hub).

---

## How it looks to users

**On the landing (knowtation.store):**

- **"Open Knowtation Hub"** → goes to **knowtation.store/hub/** → **hosted path**. Sign in, use the Hub in the cloud. Optional: Connect GitHub for backup.
- **"Run it yourself"** or **"Self-host"** → goes to docs (e.g. GETTING-STARTED or a short **Quick start (self-hosted)** page): clone, set vault path + JWT secret, optionally OAuth, run `npm run hub`, open **http://localhost:3333/**.

So: **one site, two clear choices.** No switching code; we just document both and link accordingly.

---

## Quick start (self-hosted)

**Goal:** Clone the repo, set two values, and open the Hub in a few minutes.

1. **Clone and install**
   ```bash
   git clone https://github.com/aaronrene/knowtation.git
   cd knowtation
   npm install
   cd hub && npm install && cd ..
   ```

2. **Set two required values** (in `.env` at repo root, or export):
   - **KNOWTATION_VAULT_PATH** — path to a folder for notes (e.g. `$(pwd)/vault` or `~/my-notes`).
   - **HUB_JWT_SECRET** — any long random string (for signing logins).

3. **Start the Hub**
   ```bash
   npm run hub
   ```

4. **Open** **http://localhost:3333/** in a browser.

You'll see the same Hub UI as hosted users. Without OAuth you can still use the API with a token; for **Continue with Google/GitHub** add `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (and the redirect URI in Google/GitHub) as in [hub/README.md](../hub/README.md).

**Optional:** A dedicated Quick start page in the repo or on the site with these steps and links to hub/README and GETTING-STARTED for config details.

---

## Hosted path: GitHub backup (Connect GitHub, Back up now)

**What we offer:** On the **hosted** Hub you can connect **your** GitHub account so we push your vault (notes) to **your** repo. You don't run git yourself; you click **Connect GitHub** and **Back up now** in Settings.

**What “git” does under the hood (we run it, not the user):**

- **Connect GitHub:** OAuth to GitHub; we store a token (scope `repo`) and optionally the repo you want (e.g. `owner/repo-name`).
- **Back up now:** We fetch your vault from the canister (GET `/api/v1/export`), then create a commit with all note files and push to your repo via the **GitHub API** (we don’t run a local `git` binary; we use GitHub’s “create blob / tree / commit / push” API). So the **commands** are effectively: create blobs, build tree, create commit, update ref (push). No raw `git add` / `git commit` in a terminal — it’s all through the API.

**Storage and limits:**

- **Content:** Vault = **Markdown and small text files**. No big binaries; no “file share” — just notes and metadata.
- **GitHub free tier:** 1 GB per repo (soft limit), 100 GB per account. For text/markdown, users are extremely unlikely to hit 1 GB. So: **no big files, just text** — and free tier is enough for normal use.
- **If you ever exceed free tier:** That’s a GitHub account limit (e.g. many repos or large repos). For a single “vault backup” repo with markdown, we don’t expect users to hit it. You can document: “Vault is markdown; well under GitHub’s free limits.”

**Summary:** One product, two paths (hosted + self-hosted). On hosted you can hook up GitHub so we commit and push your data to your repo; we use GitHub’s API, not raw git commands; storage is text-only and fits easily in GitHub’s free tier.

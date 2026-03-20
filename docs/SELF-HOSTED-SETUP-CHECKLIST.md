# Self-hosted setup checklist

Use this checklist to run the Knowtation Hub on your machine with the same capabilities as the live site (search, GitHub backup, proposals, OAuth). Follow the steps in order; each doc is the source of truth for that step.

**Aligned with the Hub UI:** After the Hub is running, **How to use** in the app walks through the **same seven steps** (vault → run Hub → log in → index & search → import → use & automate → GitHub backup). This checklist maps to those steps in a doc-first order.

---

## 1. Quick start (minimal)

**Doc:** [TWO-PATHS-HOSTED-AND-SELF-HOSTED.md](./TWO-PATHS-HOSTED-AND-SELF-HOSTED.md#quick-start-self-hosted)

- Clone repo, `npm install`, `cd hub && npm install && cd ..`
- Set in `.env`: `KNOWTATION_VAULT_PATH` (absolute path to vault folder), `HUB_JWT_SECRET` (long random string)
- Run `npm run hub`, open **http://localhost:3333**

---

## 2. Config and search (CLI) — Hub **How to use** Step 4

**Doc:** [GETTING-STARTED.md](./GETTING-STARTED.md)

- Copy `config/local.example.yaml` to `config/local.yaml`
- Set `vault_path` (same as `KNOWTATION_VAULT_PATH`) and `vector_store: sqlite-vec`, `data_dir: data/` — **or** `qdrant` + `qdrant_url` if you use Qdrant
- Set embedding (**Ollama** or **OpenAI** in config — embeddings for search, not a chat LLM)
- Run `npm run index` (or Hub **Re-index**), then try `node cli/index.mjs search "your query"` or **Search vault** in the Hub

---

## 3. Hub and OAuth (log in)

**Doc:** [hub/README.md](../hub/README.md)

- Add Google and/or GitHub OAuth to `.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (and same for GitHub)
- Add redirect URIs to your OAuth app:
  - `http://localhost:3333/api/v1/auth/callback/google`
  - `http://localhost:3333/api/v1/auth/callback/github`
  - `http://localhost:3333/api/v1/auth/callback/github-connect` (for Connect GitHub in Settings)
- Restart Hub → **Continue with Google** or **Continue with GitHub** should work

---

## 4. GitHub backup (Connect GitHub, Back up now)

**Doc:** How to use (in the Hub: **How to use** button or **New here? How to use** on login) → **Step 7**

- Create an **empty** repo on GitHub (no README/.gitignore); use **HTTPS** URL
- If your vault folder is not yet a Git repo: from vault folder run `git init && git add -A && git commit -m "Initial vault"`
- In Hub: **Settings → Backup**. Set vault path and backup repo URL → **Save setup**
- Click **Connect GitHub** (authorize with GitHub)
- Click **Back up now**. If first push fails with "no upstream branch", run once from vault folder: `git push -u origin main`

---

## 5. Optional: landing and MCP

- **Landing:** From repo root, `npx -y serve web -p 8888` → http://localhost:8888
- **MCP (Cursor/Claude):** `npm run mcp` and add Knowtation server to your MCP config. See [AGENT-ORCHESTRATION.md](./AGENT-ORCHESTRATION.md).

---

## Summary

| Step | Doc / location |
|------|-----------------|
| Quick start | [TWO-PATHS-HOSTED-AND-SELF-HOSTED.md#quick-start-self-hosted](./TWO-PATHS-HOSTED-AND-SELF-HOSTED.md#quick-start-self-hosted) |
| Config, index, search | [GETTING-STARTED.md](./GETTING-STARTED.md) |
| Hub + OAuth | [hub/README.md](../hub/README.md) |
| GitHub backup | How to use (Hub) → Step 7 |

When everything works: Hub loads, you can sign in, list/search notes, use Connect GitHub and Back up now. Same flows as the hosted product.

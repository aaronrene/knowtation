# Showcase notes (local + hosted)

Small **demo vault** so new users see **inbox**, **projects**, **areas**, tags, dates, and typical Markdown in the Hub list and note panel.

## Self-hosted (disk vault)

The folder **`vault/showcase/`** in the repo is part of the default vault layout. If `config/local.yaml` points `vault_path` at the repo `vault/`, open the Hub and browse **`showcase/`** in the tree—no script required.

Run **`npm run index`** if you want those notes included in semantic search.

## Hosted (canister, empty new account)

There is **no in-app “load demo notes” button** yet; onboarding points users to **+ New note**, **Import**, or the CLI seed below. A future Hub endpoint would need auth, quotas, and abuse review before wrapping this upload path.

Hosted storage is **per user** on the canister, so new accounts do not see your local `vault/` folder. After you sign in once:

```bash
cd /path/to/knowtation
KNOWTATION_HUB_URL="https://YOUR-GATEWAY.example" \
KNOWTATION_HUB_TOKEN="PASTE_JWT_HERE" \
npm run seed:hosted-showcase
```

- **JWT:** Browser devtools → Application → Local Storage → `hub_token`, or copy from the post-login URL hash `#token=...` (Phase 3.1 changed the OAuth redirect from `?token=` query param to `#token=` URL fragment).
- **Multi-vault:** set `KNOWTATION_VAULT_ID` if you use a non-default vault (default is `default`).

The script uploads every `.md` under `vault/showcase/` with the same paths (e.g. `showcase/inbox/quick-capture.md`). Re-running overwrites note content for those paths.

## Starter vault templates

Eight domain templates live under `vault/templates/`. Each has a README and 5+ example notes with proper frontmatter. Seed any of them into a hosted vault:

```bash
npm run seed:template-research-lab
npm run seed:template-business-ops
npm run seed:template-finance
npm run seed:template-engineering-team
npm run seed:template-personal-knowledge
npm run seed:template-smart-home
npm run seed:template-content-creation
npm run seed:template-education
```

Templates complement agent skill packs and MCP prompts. See [TEMPLATES-AND-SKILLS.md](./TEMPLATES-AND-SKILLS.md) for the full architecture.

## Other seed scripts

- **`scripts/seed-hosted-c-data.mjs`** — older, C-themed notes under `seed/c-data/` (still valid if you prefer that namespace).
- **`scripts/seed-vault-dir-to-hub.mjs`** — used by `npm run seed:hosted-showcase`; pass an optional second argument or `KNOWTATION_SEED_DIR` to upload a different subfolder of `vault/`.

## Proposals / Suggested

Showcase content is **notes only**. Proposals (Suggested / review flow) appear when agents or the UI create them; seeding proposals would need a separate small script against `POST /api/v1/proposals` if you want demo rows there later.

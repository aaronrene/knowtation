# Showcase notes (local + hosted)

Small **demo vault** so new users see **inbox**, **projects**, **areas**, tags, dates, and typical Markdown in the Hub list and note panel.

## Self-hosted (disk vault)

The folder **`vault/showcase/`** in the repo is part of the default vault layout. If `config/local.yaml` points `vault_path` at the repo `vault/`, open the Hub and browse **`showcase/`** in the tree—no script required.

Run **`npm run index`** if you want those notes included in semantic search.

## Hosted (canister, empty new account)

Hosted storage is **per user** on the canister, so new accounts do not see your local `vault/` folder. After you sign in once:

```bash
cd /path/to/knowtation
KNOWTATION_HUB_URL="https://YOUR-GATEWAY.example" \
KNOWTATION_HUB_TOKEN="PASTE_JWT_HERE" \
npm run seed:hosted-showcase
```

- **JWT:** Browser devtools → Application → Local Storage → `hub_token`, or copy from the post-login URL `?token=...`.
- **Multi-vault:** set `KNOWTATION_VAULT_ID` if you use a non-default vault (default is `default`).

The script uploads every `.md` under `vault/showcase/` with the same paths (e.g. `showcase/inbox/quick-capture.md`). Re-running overwrites note content for those paths.

## Other seed scripts

- **`scripts/seed-hosted-c-data.mjs`** — older, C-themed notes under `seed/c-data/` (still valid if you prefer that namespace).
- **`scripts/seed-vault-dir-to-hub.mjs`** — used by `npm run seed:hosted-showcase`; pass an optional second argument or `KNOWTATION_SEED_DIR` to upload a different subfolder of `vault/`.

## Proposals / Suggested

Showcase content is **notes only**. Proposals (Suggested / review flow) appear when agents or the UI create them; seeding proposals would need a separate small script against `POST /api/v1/proposals` if you want demo rows there later.

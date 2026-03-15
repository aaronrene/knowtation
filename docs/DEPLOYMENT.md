# Knowtation Hub: production deployment

This doc covers running the Knowtation Hub in a production-like environment: HTTPS, security, and operational checklist.

---

## Run behind HTTPS (reverse proxy)

The Hub serves HTTP by default. In production, run it behind a reverse proxy that terminates TLS.

**Recommended:** nginx or Caddy in front of the Hub.

**Example (Caddy):** Caddyfile:

```
your-domain.com {
  reverse_proxy localhost:3333
}
```

Caddy obtains and renews TLS certificates automatically.

**Example (nginx):** Use `proxy_pass http://127.0.0.1:3333` and terminate SSL at nginx (e.g. with certbot/Let’s Encrypt).

**Environment:** Set `HUB_BASE_URL` to the public URL (e.g. `https://hub.yourdomain.com`) so OAuth callbacks and redirects use HTTPS.

---

## Security checklist

| Item | Action |
|------|--------|
| **HUB_JWT_SECRET** | Set a long, random secret in `.env`. In `NODE_ENV=production`, the Hub refuses to start if this is missing. |
| **HUB_CORS_ORIGIN** | Set to your Hub UI origin(s), comma-separated (e.g. `https://hub.yourdomain.com`). Avoid `*` in production. |
| **Rate limiting** | Already enabled: 5/min for login, 100/15min for API. Adjust in code if needed. |
| **TLS** | Use the reverse proxy for HTTPS; do not expose the Hub port directly to the internet. |
| **OAuth callbacks** | Register the production callback URLs with Google/GitHub: login (e.g. `.../callback/google`, `.../callback/github`) and, if using Connect GitHub, `.../callback/github-connect`. |
| **Capture webhook** | If using `POST /api/v1/capture`, set `CAPTURE_WEBHOOK_SECRET` and send `X-Webhook-Secret` from clients. |
| **Setup write** | To disable changing vault/Git from the Hub UI, set `HUB_ALLOW_SETUP_WRITE=false`. Then `POST /api/v1/setup` returns 403. |
| **Vault backup** | Use Git (see PROVENANCE-AND-GIT.md and Phase 11 plan for `vault.git.*`) or another backup for the vault directory. |

---

## Disk and data

- **Vault and proposals:** Stored on the server filesystem. For sensitive data, use disk encryption (e.g. LUKS, FileVault) or an encrypted volume.
- **Audit log:** `data/hub_audit.log` records approve/discard actions. Rotate or archive as needed.
- **Proposals:** `data/hub_proposals.json` is plain JSON. Do not put secrets in proposal bodies; treat as sensitive if your workflow does.
- **Setup and GitHub:** `data/hub_setup.yaml` (vault path and vault.git overrides) and `data/github_connection.json` (GitHub OAuth token for push) live under `data/`. Do not commit them; they are already covered by `data/` in .gitignore. Restrict file permissions if the server is multi-user.

### Data directory: do not commit

The **data directory** (`data/`, or whatever `config.data_dir` / `KNOWTATION_DATA_DIR` is set to) holds runtime and user-specific files that must stay on the server and out of version control:

| File | What it is | Why not commit |
|------|------------|-----------------|
| `data/hub_setup.yaml` | Vault path and Git backup settings written from the Hub Setup form. | Per-instance; may contain absolute paths. Merged over config at load. |
| `data/github_connection.json` | GitHub OAuth token used for “Connect GitHub” and vault push. | Contains a live token; must never be in the repo. |
| `data/hub_proposals.json` | Pending and historical proposals. | Instance-specific; may contain sensitive content. |
| `data/hub_audit.log` | Log of approve/discard actions. | Instance-specific; may contain PII. |
| `data/*.db`, `data/knowtation_vectors.db` | Vector store (e.g. sqlite-vec) and other DBs. | Generated at runtime; large and instance-specific. |
| `data/hub_roles.json` | **Phase 13 (Teams):** Maps user identifiers to roles. Format: <code>{ "roles": { "provider:id": "admin" \| "editor" \| "viewer" } }</code> (e.g. <code>"github:123": "admin"</code>). If file is missing, everyone has full access (admin). If file exists, only listed users get that role; others are editor. | Do not commit; instance-specific. |

The repo’s `.gitignore` includes `data/`, so nothing under `data/` is committed by default. If you copy or deploy the app, treat the data dir as local state: back it up separately if needed, and never commit it or add it to version control.

---

## Process and ports

- Run the Hub with `npm run hub` or `node hub/server.mjs` from the project root.
- Default port: `3333`. Override with `HUB_PORT`.
- Use a process manager (systemd, PM2, Docker) so the Hub restarts on failure and runs as a non-root user.

---

## Optional: Docker

A Dockerfile is provided. Build and run the image; mount the vault (and optionally config and data) as volumes. Ensure `HUB_JWT_SECRET`, `HUB_CORS_ORIGIN`, and `KNOWTATION_VAULT_PATH` are set in the container environment.

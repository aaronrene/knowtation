# Knowtation Hub

REST API + OAuth (Google/GitHub) + JWT for the Knowtation vault and proposals. Phase 11. Run self-hosted (Node or Docker) or use the same API contract on ICP.

## Run locally (from repo root)

1. Install hub dependencies: `cd hub && npm install && cd ..`
2. Set env: `KNOWTATION_VAULT_PATH` (required), `HUB_JWT_SECRET` (required in production), optional OAuth and port (see below).
3. Start: `npm run hub` or `node hub/server.mjs`

Default port: 3333. **Open `http://localhost:3333/` in a browser** for the Rich Hub UI (served by the same process). Health: `GET http://localhost:3333/health`. API base: `http://localhost:3333/api/v1` (all routes require `Authorization: Bearer <jwt>` except health, static UI, and auth).

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `KNOWTATION_VAULT_PATH` | Yes | Absolute path to vault directory (or set in config/local.yaml). |
| `HUB_JWT_SECRET` | Yes (prod) | Secret for signing JWTs. Use a long random string in production. |
| `HUB_PORT` | No | Port (default 3333). |
| `HUB_BASE_URL` | No | Base URL for OAuth callbacks (default http://localhost:3333). |
| `HUB_UI_ORIGIN` | No | Redirect after login (defaults to Hub base URL, same tab). |
| `GOOGLE_CLIENT_ID` | For Google login | From Google Cloud Console. |
| `GOOGLE_CLIENT_SECRET` | For Google login | From Google Cloud Console. |
| `GITHUB_CLIENT_ID` | For GitHub login | From GitHub OAuth App. |
| `GITHUB_CLIENT_SECRET` | For GitHub login | From GitHub OAuth App. |

## Log in (OAuth) — required for the Hub UI

There is **no separate “Sign up”**. Identity is **Google or GitHub**: the first time you sign in, that account is tied to your session; there is no email/password form on Knowtation.

**Until OAuth is configured, Log in will not work.** Add at least one provider to `.env`, restart the Hub, then use **Continue with Google** or **Continue with GitHub**.

### Google

1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → **Credentials** → **Create credentials** → **OAuth client ID** (configure consent screen if asked). Application type: **Web application**.
2. **Authorized redirect URIs** (exact):  
   `http://localhost:3333/api/v1/auth/callback/google`  
   (For production, add your real Hub URL too.)
3. Copy **Client ID** and **Client secret** into `.env`:  
   `GOOGLE_CLIENT_ID=...`  
   `GOOGLE_CLIENT_SECRET=...`  
4. Restart `npm run hub` and open `http://localhost:3333/` → **Continue with Google**.

### GitHub

1. GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**.  
   **Authorization callback URL(s)** — add both (or the one you use):
   - `http://localhost:3333/api/v1/auth/callback/github` (login)
   - `http://localhost:3333/api/v1/auth/callback/github-connect` (Connect GitHub in Settings, for vault push)
2. Create the app; copy **Client ID** and generate a **Client secret** into `.env`:  
   `GITHUB_CLIENT_ID=...`  
   `GITHUB_CLIENT_SECRET=...`  
3. Restart the Hub → **Continue with GitHub**.  
   **If you use Connect GitHub:** the same OAuth App must list the `github-connect` callback above. If you see "redirect_uri is not associated with this application", add that URL to the app's callback list.  
   **Production:** set `HUB_BASE_URL=https://your-domain.com` and add `https://your-domain.com/api/v1/auth/callback/github` and `https://your-domain.com/api/v1/auth/callback/github-connect` to the GitHub app.

## Docker

From repo root:

```bash
docker build -f hub/Dockerfile -t knowtation-hub .
docker run -p 3333:3333 \
  -e KNOWTATION_VAULT_PATH=/data/vault \
  -e HUB_JWT_SECRET=your-secret \
  -e GOOGLE_CLIENT_ID=... \
  -e GOOGLE_CLIENT_SECRET=... \
  -v /path/to/vault:/data/vault \
  -v /path/to/data:/app/data \
  knowtation-hub
```

Proposals are stored under `data_dir` (e.g. `/app/data/hub_proposals.json`). Mount a volume for persistence.

## API contract

See [docs/HUB-API.md](../docs/HUB-API.md) for routes, request/response shapes, and auth (JWT, OAuth, ICP).

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

## Roles (Phase 13)

### First-run: no roles file (works for everyone)

**When there is no `data/hub_roles.json` file** (or the file has no entries), **everyone who logs in receives role admin**. No manual setup or hardcoded IDs. You see the **Team** tab in Settings and have full access. This is the default so every new install works without intervention.

When you want to **restrict** who can do what, use **Settings → Team** and add the first role (e.g. yourself as admin, or a teammate as viewer). That creates the roles file. From then on, only users listed in the file get the role you set; anyone not listed gets **member** (editor). To avoid locking yourself out, add your own User ID as admin in the Team tab before adding others with more restricted roles.

### Why roles?

Roles let you **control who can do what** on a shared vault without giving everyone full access. For example: give teammates **viewer** (read-only), **editor** (can add notes and create proposals but not approve them or change Setup), or **admin** (full access). That way you can share the Hub URL and still decide who can change backup settings or approve agent proposals.

### How assignment works (user ID, not email or handle)

Role assignment uses a **user ID** of the form **`provider:id`** — for example `github:12345678` or `google:109876543210987654321`. This is the OAuth subject ID from Google or GitHub, **not** the person’s email or GitHub username. So you do **not** put `alice@company.com` or `alice-github` in the file; you put the ID the Hub uses internally (e.g. `github:12345`).

**How to get someone’s user ID**

**How to assign a role:** A **backup repo is not required** for roles. Two options:

**Option A — From the Hub (recommended)**  
If you are an admin: open **Settings → Team** (only admins see it). Have the other person copy **Your user ID** from their Settings and send it to you. Paste it in the Team tab, choose Role (viewer / editor / admin), click **Add / update role**.

**Option B — Edit the file**  
On the server, create or edit `data/hub_roles.json` (see format below); restart the Hub or save Setup once to reload.

### The roles file

**No file or empty file:** Everyone is admin (see "First-run" above). **File with entries:** Only listed users get the assigned role; others get member (editor). To restrict access, create or edit `data/hub_roles.json` (or use Settings → Team). Format:

```json
{
  "roles": {
    "github:12345": "admin",
    "google:67890": "editor",
    "github:11111": "viewer"
  }
}
```

- **Viewer** — Can only read (notes, search, proposals). Cannot write, propose, approve, or change Setup.
- **Editor** — Can read, write notes, and create proposals; cannot change Setup or approve/discard proposals.
- **Admin** — Full access: everything above plus Setup and approve/discard.

The Hub UI shows **Your role** and **Your user ID** in Settings so users know their role and can share their ID with an admin. A future **invite flow** (Phase 13) may allow assigning by email or invite link so you don’t have to manage the JSON file by hand.

## API contract

See [docs/HUB-API.md](../docs/HUB-API.md) for routes, request/response shapes, and auth (JWT, OAuth, ICP).

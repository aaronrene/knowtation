# Next phase: two ways to set the repository (simple explanation)

This doc explains **two optional features** in plain language: what they are, what the user does, what we’d build, and what it means to **do both**.

---

## Where we are today

Right now, **the only way to set the Git repository** is to edit a config file on the server:

- Someone (you or your admin) opens `config/local.yaml`.
- They add something like:
  - `vault_path: ./vault`
  - `vault:` → `git:` → `enabled: true`, `remote: https://github.com/you/repo.git`
- They restart the Hub.

The Hub **Settings** page can show whether Git is configured and can run **“Back up now”**, but it **cannot** create or change that config. So “setting the repository” still means editing YAML (or env) where the Hub runs.

The two options below are about **letting users set or connect the repo without touching that file** — in two different contexts: **hosted** (we run the app) vs **self-hosted** (you run the app).

---

## Option A: Hosted product — “Connect GitHub”

**What it is (simple):**  
We run Knowtation for you (you sign up on our site). In the app, you click something like **“Connect GitHub”**. You sign in to GitHub and choose (or we create) a repo. From then on, we push your vault to that repo so you have a backup and history. You never see or edit any config file.

**What the user does:**
1. Signs up and logs into **our** Knowtation (e.g. app.knowtation.com).
2. Clicks **“Connect GitHub”** (or similar) in Settings or onboarding.
3. Is sent to GitHub to authorize our app (OAuth).
4. Picks an existing repo or says “create a new repo for me.”
5. Done. Their vault is now backed up to that repo; we push after each change (or on a schedule).

**What we do (behind the scenes):**
- We store **per user/org**: “this tenant’s vault is backed up to repo X” and a **token** (or deploy key) so we can push to that repo.
- When they add/edit notes or approve proposals, we push to **their** GitHub repo. They own the repo; we just have permission to push.
- We do **not** give them a `config/local.yaml` to edit — there is no server under their control. We manage everything; “config” is our database and our code.

**What we’d have to build:**
- **GitHub OAuth:** “Sign in with GitHub” (or “Connect GitHub”) so we get permission to act on their behalf (create repo, push, etc.).
- **Storing the link:** In our backend, save “tenant T → GitHub repo R + token” (and optionally “create repo if missing”).
- **Push on write:** When we write to their vault (or on a schedule), run `git add / commit / push` to **their** repo using the stored token. Same idea as today’s `vault sync`, but we decide when and we use the token we stored.
- **UI:** A simple “Connect GitHub” flow (wizard or Settings step) and a status line like “Backed up to github.com/you/repo.”

**Summary:**  
Hosted = **we** run the app; “Connect GitHub” = user connects **their** GitHub account/repo in the UI; we store the repo + token and push for them. No config file for the user at all.

---

## Option B: Self-hosted — Setup wizard that writes config

**What it is (simple):**  
You run the Hub yourself (on your machine or server). We add a **Setup wizard** in the Hub UI that asks a few questions (e.g. “Where is your vault folder?” and “GitHub repo URL?”) and then **writes** the `config/local.yaml` file for you (or the relevant slice of it). So you set the repository **through the browser** instead of editing the file by hand.

**What the user does:**
1. Runs the Hub (e.g. `npm run hub`) and opens it in the browser.
2. Opens **Settings** (or a first-time **Setup** flow).
3. Sees a form: e.g. “Vault path” (or leave default), “Git backup: enable?”, “GitHub repo URL.”
4. Fills it and clicks **Save** (or **Finish setup**).
5. The Hub **writes** to `config/local.yaml` (e.g. `vault_path`, `vault.git.enabled`, `vault.git.remote`). User may need to restart the Hub once, or we reload config if we add that.

**What we do (behind the scenes):**
- The Hub process already has access to the project directory (it loads config from there). We add an API that **writes** to `config/local.yaml` (or a dedicated “hub setup” file we then merge).
- We only write the fields the user is allowed to change (e.g. vault path, vault.git). We don’t overwrite the whole file blindly; we’d merge or overwrite only those keys.
- **Security:** Only an **authenticated** user (someone who’s logged in to the Hub) can call this. We might also restrict it to “first run” or “admin” if we add roles. The main risk is: anyone who can log in to your Hub could change where the vault is or which repo we push to. So we need a clear security model (e.g. “only the first user” or “only users with an admin flag”).

**What we’d have to build:**
- **API:** e.g. `GET /api/v1/setup` (read current config for the wizard) and `POST /api/v1/setup` or `PUT /api/v1/settings` (write vault_path + vault.git into config). Or we write to a file like `data/hub_setup.yaml` and merge it at startup (so the main config file is still “owned” by the human).
- **UI:** A Setup wizard (or an expanded Settings): a few form fields, validation (path exists? repo URL looks valid?), and a “Save” button that calls the API.
- **File writing:** Code that safely updates `config/local.yaml` (or the merge file) with the new values. We must not corrupt the file (e.g. use a temp file + rename, or a careful YAML update).
- **Security model:** Document who can run setup (e.g. any logged-in user vs first user only vs admin only) and what happens if two people try to change config at once.

**Summary:**  
Self-hosted = **you** run the Hub; Setup wizard = **one-time (or occasional) form** in the UI that writes vault path + Git repo into the config file so the user doesn’t have to edit YAML by hand.

---

## Can we do both? What that would entail

**Yes.** They target different **deployment modes**:

| | Option A: Hosted “Connect GitHub” | Option B: Self-hosted Setup wizard |
|--|----------------------------------|------------------------------------|
| **Who runs the app** | We do | You do |
| **Where “repo” is stored** | In our database (per tenant) | In your `config/local.yaml` (or merge file) |
| **How user sets repo** | OAuth + “Connect GitHub” in our UI | Form in Hub UI that writes config |
| **User ever touches config?** | No | No (wizard does it) |

So:

- **Option A** is part of the **hosted product** (see [HOSTED-PLUG-AND-PLAY.md](./HOSTED-PLUG-AND-PLAY.md)). It’s the only way hosted users can “set the repository” — there is no config file on their side.
- **Option B** is an improvement to the **self-hosted Hub**: same app you run today, but we add a wizard so you can set vault path and Git repo from the UI instead of editing YAML.

Doing **both** means:

1. **Hosted:** Implement “Connect GitHub” (OAuth, store repo + token, push on write). No config file in the picture.
2. **Self-hosted:** Implement the Setup wizard (API + UI that writes vault path + `vault.git` into config or a merge file). No GitHub OAuth on your server — you just type the repo URL (or paste it) and we write it to config.

**Shared vs different:**

- **Shared:** The **idea** is the same: “user sets the repository without editing config by hand.” The **UI copy** can be similar (“Connect GitHub” vs “Set GitHub backup”).
- **Different:**  
  - **Hosted:** We store the repo and token; we push using our backend.  
  - **Self-hosted:** We write the repo URL (and maybe a path) into **your** config file; the existing `vault sync` / “Back up now” logic (and optional auto_commit/auto_push) keeps working as today, using that config.

So we can do both: one flow for **our** hosted app, one flow for **your** self-hosted app. The code paths are different (DB + OAuth vs file write), but the **user-facing goal** is the same: set the repository easily, without touching YAML.

---

## Summary table

| Question | Option A (Hosted) | Option B (Self-hosted wizard) |
|----------|-------------------|-------------------------------|
| **Who runs Knowtation?** | We do | You do |
| **How does the user set the repo?** | Clicks “Connect GitHub,” signs in to GitHub, we store repo + token | Fills a form (vault path, repo URL); we write config |
| **Do we need GitHub OAuth?** | Yes (to create/link repo and push) | No (user pastes repo URL; they set up the repo and auth on their side) |
| **Where is “the repo” stored?** | In our database | In your `config/local.yaml` (or merge file) |
| **Main thing we build** | OAuth flow, token storage, push-to-their-repo | API + UI that safely write to config (or merge file) |

Doing both = implement Option A for the hosted product and Option B for the self-hosted Hub, so in **either** mode users can set the repository without editing config by hand.

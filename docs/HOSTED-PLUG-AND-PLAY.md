# Hosted Knowtation — plug-and-play plan (paid)

**Goal:** A **hosted, maintained** Knowtation offering so paid users get a **zero-config** experience: no YAML, no config files, no CLI setup, no OAuth or server setup. We host the platform; they sign up, log in, and use the Hub. This is crucial for adoption beyond technical users.

---

## 1. Why this matters

- **Self-hosted** today: user sets vault path, config, OAuth, runs Hub, runs indexer, optionally configures vault Git. That’s correct for developers and teams who want full control.
- **Many users** want: “I want a personal knowledge base that works with my agents and doesn’t lose my data—without editing YAML or running servers.”
- **Plug-and-play** = we run the vault, Hub, indexer, and backup; the user sees a **simple UI** and optional “connect GitHub” for their own backup. No config files, no terminal.

---

## 2. Product shape (target)

| Aspect | Self-hosted (today) | Hosted plug-and-play (target) |
|--------|----------------------|-------------------------------|
| **Vault** | User’s folder on their machine | We store per-account vault (e.g. in our infra or linked repo) |
| **Config** | `config/local.yaml`, env vars | None; we manage everything |
| **Hub** | User runs `npm run hub`, sets OAuth | We run Hub; user goes to app.knowtation.com (or similar) |
| **Auth** | User configures Google/GitHub OAuth | We provide login (e.g. email + password, or OAuth we manage) |
| **Indexer** | User runs `knowtation index` or Hub Re-index | We run indexer on write/import and on schedule |
| **Backup** | User sets `vault.git.remote`, runs `vault sync` | We back up; optional “Connect GitHub” so user gets a copy in their repo |
| **Onboarding** | Read How to use, edit config, run Hub | Sign up → verify email → land in Hub; optional “Connect GitHub” step |

**User journey (target):**

1. Sign up (email or OAuth we provide).
2. Land in Hub: empty vault, “Add note” or “Import” (paste, upload file, or connect Slack/Discord later).
3. Optional: “Connect GitHub” — we create or link a repo, push vault there for their backup and version history.
4. Optional: “Connect an agent” — we show a simple page: “Use this URL and token in Open CLAW / Abacus / etc.” (we issue an API token).
5. No YAML, no config files, no terminal required.

---

## 3. What we must build (high level)

- **Multi-tenant backend:** One Hub deployment; each user/org has an isolated vault (and optional linked GitHub repo). Data isolation and auth (per-user or per-org JWT, no cross-tenant access).
- **Vault storage:** Vault content stored by us (e.g. object store + metadata DB, or one Git repo per tenant we manage). No user-supplied `vault_path`; we assign it.
- **Indexer as a service:** On every write/import and on a schedule, we run the indexer for that tenant’s vault so search is always up to date. No “Re-index” required for normal use (we can still expose it).
- **Auth we control:** Sign-up, login, password reset, and/or OAuth (Google/GitHub) that **we** register so the user doesn’t configure callbacks or secrets.
- **Simple Hub UI:** Same Hub UI as today, but:
  - No “How to configure OAuth” or “set vault_path”—instead, “Connect GitHub” and “Connect an agent” wizards.
  - First-run: empty state with “Create your first note” or “Import from …”.
- **GitHub as backup (optional but emphasized):** “Connect GitHub” creates or links a repo; we push vault there (or mirror) so the user has backup and version history. We treat this as **crucial** in messaging, same as in self-hosted docs.
- **Billing and limits:** Paid tier(s): e.g. notes limit, storage, API calls. Free tier optional (limited). We don’t implement billing in this plan; we only define the product and technical template.

---

## 4. Technical template (implementation outline)

- **Phase A — Multi-tenant core**
  - Tenant model: user or org; each has `vault_id`, storage path, and optional `github_repo` (and token for push).
  - Auth: our own sign-up/login (or OAuth app we own); JWT scoped to tenant. No user-configured OAuth.
  - Vault storage: e.g. S3/GCS prefix per tenant, or Git repo per tenant in our Git service; API reads/writes go through our backend.

- **Phase B — Indexer and search per tenant**
  - On write/import/capture: enqueue or run indexer for that tenant.
  - Optional cron: full re-index per tenant (e.g. nightly).
  - Search/list/get-note API unchanged in contract; backend resolves vault from tenant.

- **Phase C — Hub UI for hosted**
  - Same Hub UI codebase; feature flags or build variant: hide “config/OAuth” steps, show “Connect GitHub” and “Connect an agent” and first-run empty state.
  - “Connect GitHub”: user authorizes us; we create or link repo; we push vault (or sync) so they have backup. We document that **GitHub backup is crucial** in-app.

- **Phase D — Backup and GitHub**
  - We run `vault sync` equivalent per tenant when `github_repo` is set: commit and push to their repo. Optional: auto-commit on write or on schedule.
  - User sees “Your vault is backed up to GitHub” and a link to the repo.

- **Phase E — Billing and limits (later)**
  - Metering: notes count, storage, API calls. Enforce limits; upgrade path for paid. Out of scope for initial plan.

---

## 5. What stays the same

- **Data contract:** Same note format (Markdown + frontmatter), same list/search/get-note/proposals/capture semantics. Self-hosted and hosted use the same Hub API contract.
- **Agents:** Agents can use the same API (with a tenant-scoped token). Docs (AGENT-INTEGRATION, HUB-API) apply; we add a “Hosted” section: “Get your API URL and token in Settings.”
- **Proposals:** Create via API/CLI; review in Hub. No difference in behavior.
- **GitHub as crucial:** In both self-hosted and hosted, we communicate that backup and version history (e.g. GitHub) are important; hosted users get that via “Connect GitHub.”

---

## 6. Risks and mitigations

- **Data ownership:** Users must clearly own their data. Hosted terms: export anytime; “Connect GitHub” gives them a copy. We don’t lock them in.
- **Cost and abuse:** Per-tenant indexing and storage have cost. Mitigate with limits, monitoring, and paid tiers.
- **Uptime and SLAs:** Hosted implies we maintain the platform. Plan for monitoring, backups, and incident response.

---

## 7. Success criteria for “plug-and-play”

- A non-technical user can **sign up and create a note in under 2 minutes** without opening a config file or terminal.
- **“Connect GitHub”** is visible and simple; after connecting, user has a backup and version history.
- **“Connect an agent”** (or “API access”) gives a single URL + token and a short copy-paste instruction set (e.g. for Open CLAW, Abacus).
- **No YAML or config files** are required for the hosted flow.

---

## 8. References

| Doc | Role |
|-----|------|
| [HUB-API.md](./HUB-API.md) | Same API contract for hosted |
| [PROVENANCE-AND-GIT.md](./PROVENANCE-AND-GIT.md) | GitHub backup as crucial; vault sync |
| [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) | Agents use same API; we add “Hosted” section when live |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Self-hosted deployment; hosted is separate infra |
| [TWO-PATHS-HOSTED-AND-SELF-HOSTED.md](./TWO-PATHS-HOSTED-AND-SELF-HOSTED.md) | Cloud (beta) vs self-hosted quick start |

This document is the **template and plan** for the hosted, plug-and-play product. Implementation order and phases can be refined (e.g. start with “vault in our storage + simple login” then add “Connect GitHub” then billing).

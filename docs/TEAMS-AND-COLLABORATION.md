# Teams and collaboration — current state and plan

This doc answers: **How does the platform handle Teams? Is it built? How do you invite others? What about GitHub collaborators?** No dedicated “Teams” feature exists yet; below is what works today and what is planned.

---

## Current state (no Teams product feature)

### How multiple people use the Hub today

- **One Hub instance = one vault.** Everyone who can log in sees the same vault and the same proposals.
- **Who can log in?** Anyone who can reach the Hub URL and sign in with the OAuth providers you configured (Google and/or GitHub). There is **no in-app invite flow** and **no team list** — you effectively “invite” people by sharing the Hub URL (e.g. `https://your-server:3333`) and ensuring OAuth is set up. If the Hub is reachable and they have a Google or GitHub account, they can log in and use it.
- **No roles.** Every logged-in user can do the same things: browse notes, search, create notes, approve/discard proposals, change Setup (unless you set `HUB_ALLOW_SETUP_WRITE=false`). There is no viewer / editor / admin distinction.

So today, **“team” = everyone who can access the Hub URL and log in** — shared vault, shared proposals, no formal invite or roles.

### GitHub collaborators (for the vault repo only)

- The **vault** can be backed up to a **Git repo** (e.g. on GitHub). That repo is separate from “who can log in to the Hub.”
- **GitHub repo collaborators** = people you add to that repo on GitHub (Settings → Collaborators). They can clone, push, and pull the vault repo. That controls **access to the Git repository**, not who can log in to the Knowtation Hub.
- So you can have:
  - **Hub:** Anyone with the URL + OAuth can log in (no invite list in the app).
  - **Vault backup repo:** You add collaborators on GitHub if you want them to push/pull the vault via Git. They might also use the Hub (same URL) or only use Git — that’s up to how you work.

**Summary:** Adding someone as a collaborator on the **GitHub repo** gives them access to the repo. It does **not** add them to a “team” in the Hub or change Hub behavior. The Hub does not read GitHub’s collaborator list.

---

## What is not built yet

| Area | Status | Notes |
|------|--------|--------|
| **Invite flow** | Built | Admins create an invite link (Settings → Team); invitee opens link and signs in; added to role. Pending list and revoke. |
| **Roles (viewer / editor / admin)** | Not built | Mentioned in SIMILAR-SERVICES and “post–Phase 11”; would allow “team vault” without giving everyone full access. |
| **Team or workspace concept** | Not built | No notion of “team” or “workspace” in the app; single vault per Hub instance. |
| **Hub reading GitHub collaborators** | Not built | Hub does not sync with GitHub’s collaborator list or use it for access control. |

---

## Where it lives in the plan (phase and roadmap)

- **Phase 11 (Hub)** is done for self-hosted: one vault, OAuth, proposals, review.
- **Phase 13 — Teams and collaboration:** **Roles are implemented.** Admins assign roles from the Hub: **Settings → Team** (admin-only tab). Paste the user’s **User ID** (they copy it from their own Settings → “Your user ID”), choose role, click Add/update. No backup repo required. Alternatively edit `data/hub_roles.json` on the server. **Invite flow:** Implemented (create link in Settings → Team; invitee signs in via link). See [hub/README.md](../hub/README.md) (Roles) and [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md).
- **"Teams" / invite / roles** are called out as **post–Phase 11** in [SIMILAR-SERVICES-AND-FEATURES.md](./SIMILAR-SERVICES-AND-FEATURES.md): *“Share links, roles, notifications, optional real-time sync, optional web UI.”* So there is no dedicated “Phase: Teams” yet; it’s part of the **later** work (roles, share, notifications).
- **Simple roles** (viewer / editor / admin per vault or per project) are listed as a way to enable a “team vault” without full Git permissions; that would be a future phase or part of a “Phase 13” style addition.
- **Hosted product** ([HOSTED-PLUG-AND-PLAY.md](./HOSTED-PLUG-AND-PLAY.md)) is multi-tenant (one deployment, one vault per tenant). That’s “one vault per org/user,” not “teams inside a tenant” — but the same codebase could later add team/invite/roles inside a tenant.

**Practical plan for Teams (when we do it):**

1. **Option A — Minimal (self-hosted):** Add **roles** (e.g. viewer / editor / admin) and optionally “first user is admin” or “admin list in config/env.” No invite flow; you still share the URL. Restrict who can change Setup or approve proposals by role.
2. **Option B — Invite (self-hosted or hosted):** Add an **invite flow** (e.g. invite by email; they get a link and sign up or log in with OAuth). Optionally tie to “team” or “workspace” so only invited users can access that vault.
3. **Option C — GitHub-backed (self-hosted):** Optional “sync with GitHub repo collaborators” so the Hub treats repo collaborators as allowed users (or as a role list). Bigger design; not started.

For now, **invite = share Hub URL (and repo URL if you use a shared backup repo); GitHub collaborators = for the vault repo only, not for Hub “team” membership.**

---

## Summary

| Question | Answer |
|----------|--------|
| **Have we developed Teams?** | **Roles are built** (viewer / editor / admin via `data/hub_roles.json`). Invite by link (Settings → Team) is built. |
| **How do you “invite” others today?** | Create an invite link (Settings → Team) and send it; they open and sign in. Or share the Hub URL. |
| **Do we add them as collaborators on GitHub?** | For the **vault backup repo**, yes — add them on GitHub if you want them to push/pull the repo. That does not control Hub login or “team” in the app. |
| **What is the phase and plan?** | **Phase 13** in [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md): roles and **invite flow done** (see hub/README.md). Next: optional GitHub-backed access. |

**Invite API:** POST /api/v1/invites body “{ role }” → invite_url; GET /api/v1/invites lists pending; DELETE /api/v1/invites/:token revokes. Invitee opens link and signs in; they are added to roles.

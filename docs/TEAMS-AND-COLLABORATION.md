# Teams and collaboration

This doc answers: **How does the platform handle Teams? How do you invite others? What roles exist? What about GitHub collaborators?**

Roles (viewer / editor / admin / evaluator) and invite-by-link are **built and shipped** as of Phase 13. See the Summary table below for current status.

---

## Current state

### Roles

Four roles are available: **viewer**, **editor**, **admin**, and **evaluator**.

- **Self-hosted:** Assign via **Settings → Team** (admin-only tab) — paste the user's User ID, choose a role, click Add/update. Alternatively, edit `data/hub_roles.json` on the server directly.
- **Hosted:** Roles are stored in a bridge blob. The gateway enforces approve/discard access before requests reach the canister.

Role capabilities:
- **Viewer** — browse notes, search, read proposals; no writes.
- **Editor** — all viewer actions plus create/edit notes and create proposals.
- **Admin** — all editor actions plus approve/discard proposals, manage team roles, Hub settings.
- **Evaluator** — records evaluations; may approve proposals if `HUB_EVALUATOR_MAY_APPROVE=1` is set or the evaluator is enabled per-user in Settings → Team.

### Invite flow

Invite-by-link is built. Admins create an invite link in **Settings → Team**; the invitee opens the link, signs in with OAuth, and is automatically added to the assigned role. Pending invites are listed and can be revoked. See the Invite API section below.

### How multiple people use the Hub

- **One Hub instance = one vault.** All users with access see the same vault and the same proposals; roles control what they can do, not which notes they can see.
- **Who can log in?** Anyone with a valid invite link (or who has been assigned a role directly by an admin).

### GitHub collaborators (for the vault backup repo only)

- The vault can be backed up to a Git repo (e.g. on GitHub). That repo is separate from "who can log in to the Hub."
- **GitHub repo collaborators** = people you add on GitHub (Settings → Collaborators). They can clone, push, and pull the vault repo. That controls access to the Git repository, not Hub login or roles.
- The Hub does not read GitHub's collaborator list.

---

## Feature status

| Area | Status | Notes |
|------|--------|-------|
| **Roles (viewer / editor / admin / evaluator)** | Built | Settings → Team; or `data/hub_roles.json` (self-hosted) |
| **Invite flow (link-based)** | Built | Settings → Team → Create invite link; invitee signs in |
| **Pending invite list and revoke** | Built | Admins see pending invites; can delete/revoke |
| **Per-note or per-project access control** | Not built | Roles apply to the whole vault; use separate Hub instances for isolation |
| **Hub reading GitHub collaborators** | Not built | GitHub collaborator list is not synced to Hub roles |
| **Real-time collaboration / presence** | Not built | Future consideration |

---

## Summary

| Question | Answer |
|----------|--------|
| **Have we developed Teams?** | **Roles are built** (viewer / editor / admin / **evaluator** via `data/hub_roles.json` hosted: bridge blob). **Evaluator** records evaluation; **approve** is allowed per evaluator in **Team** (checkbox) or via `data/hub_evaluator_may_approve.json` (self-hosted) / blob `hub_evaluator_may_approve` (hosted). If a user has **no** explicit row, **`HUB_EVALUATOR_MAY_APPROVE=1`** is the fallback for evaluators. **Discard** is admin-only. On hosted, the **gateway** enforces approve/discard before the canister. Invite by link is built. |
| **How do you “invite” others today?** | Create an invite link (Settings → Team) and send it; they open and sign in. Or share the Hub URL. |
| **Do we add them as collaborators on GitHub?** | For the **vault backup repo**, yes — add them on GitHub if you want them to push/pull the repo. That does not control Hub login or “team” in the app. |
| **What is the phase and plan?** | Roles and **invite flow** are shipped (see **`hub/README.md`**). Next: optional GitHub-backed access. |

**Invite API:** POST /api/v1/invites body “{ role }” → invite_url; GET /api/v1/invites lists pending; DELETE /api/v1/invites/:token revokes. Invitee opens link and signs in; they are added to roles.

**Stale `?invite=` in the URL:** After an invite is consumed, the token is removed from bridge storage. If the user bookmarks or revisits the same invite URL, `POST /api/v1/invites/consume` returns **404** (“not found or already used”). The Hub strips the `invite` query param without showing an error toast so returning users are not alarmed; **EXPIRED** (410) still shows a clear message.

---

## Sharing only part of the vault / multiple vaults

**What if I don't want teammates to see all my personal notes?** Roles (viewer / editor / admin) control **what** someone can do, not **which notes** they can see. Everyone with access to the Hub sees the **same vault**; project and folder filters are for convenience, not access control.

- **Today:** To separate personal and shared content, use **multiple vaults and multiple Hub instances** — e.g. one Hub for a team vault (invite people there) and another Hub or local-only CLI for your personal vault. Each instance uses its own `KNOWTATION_VAULT_PATH` and port. See **[MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md)** for current behavior, options, and what would be needed for scoped access or multi-vault in one Hub.

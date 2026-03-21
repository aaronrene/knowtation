# Plan addendum: Same capabilities on hosted (web) as self-hosted

**Add this section to the plan before beginning.** Use it as the brief overview; dive into nuts and bolts in a dedicated session.

---

## Section 0 (add before Section 1) — Hosted parity: same capabilities on the web service

**Goal:** Whatever users can do **self-hosted** (Hub at localhost, GitHub backup, search, index, proposals, roles, invites, setup, import, export) should be **available on the hosted product** (knowtation.store / our service) so we offer one product with two deployment choices, not a reduced “cloud” version.

### What it entails (brief)

- **API parity:** The Hub UI calls the same routes in both modes. On **hosted**, the gateway + canister + bridge must implement or stub every route that the self-hosted Node Hub implements. Today: canister holds notes/proposals/export; bridge handles search, index, vault/sync, GitHub connect; gateway does OAuth and proxies, and **stubs** routes the canister doesn’t implement (roles, invites, setup, facets, import 501). See [PARITY-PLAN.md](./PARITY-PLAN.md).
- **Behavior parity:** Same **flows** work: sign-in, Connect GitHub, Back up now, search, index, proposals (approve/discard), Settings (Team, Setup), Import (when we enable it on hosted). Any flow that works self-hosted should work on hosted, with clear messaging where a feature is “coming soon” (e.g. Import 501) instead of 404.
- **Data and limits:** Hosted stores vault in the canister; backup goes to the user’s GitHub via the bridge. We need to be clear on limits (e.g. vault size, rate) and backup behavior so users get the same mental model as self-hosted.

### Complexity (overview)

| Aspect | Complexity | Notes |
|--------|------------|--------|
| **Gateway stubs (Phase 1)** | Low | Done. Gateway returns valid responses so the UI doesn’t 404; canister unchanged. |
| **Bridge deploy and wire** | Medium | Bridge must be deployed (e.g. second Netlify site or Node host), env set (SESSION_SECRET same as gateway, etc.), gateway BRIDGE_URL pointed at it. [BRIDGE-DEPLOY-AND-PREROLL.md](./BRIDGE-DEPLOY-AND-PREROLL.md). |
| **Full parity (roles, invites, setup on hosted)** | Medium–high | Canister does not store roles/invites/setup. Options: (a) keep gateway stubs (no persistence on hosted for these), or (b) extend canister (or a backend) to store and serve them so “Save setup” / Team / invites actually persist. Dedicated session to choose and implement. |
| **Import on hosted** | Medium | Today 501. Requires canister or bridge to accept uploads, write to user’s vault in canister (or temp then merge), and possibly re-index. Storage and indexing path must be designed. |
| **Ongoing alignment** | Low | Any new self-hosted feature (new route or flow) should be added to parity checklist and either implemented on hosted or explicitly documented as “self-hosted only” / “coming soon.” |

### When to do it

- **Before we begin** the rest of the plan: no code in this addendum; it’s a reminder that hosted parity is in scope.
- **Dedicated session:** Use [PARITY-PLAN.md](./PARITY-PLAN.md), [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md), and [BRIDGE-DEPLOY-AND-PREROLL.md](./BRIDGE-DEPLOY-AND-PREROLL.md) for the nuts and bolts (bridge deploy, pre-roll checklist, and any Phase 2+ work for full persistence of setup/roles/invites and Import on hosted).

---

*This addendum is Section 0 of the Self-host / AgentCeption / Muse plan. Insert it at the top of the plan so “same capabilities on the web service” is explicit before Section 1 (self-hosted setup) and the rest.*

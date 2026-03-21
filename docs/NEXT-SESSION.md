# Next session — start here

**Purpose:** One place to pick up work after a break: **what to do first**, **copy-paste prompt** for your agent, and **links** to checklists.

---

## Copy-paste prompt (for Cursor / ChatGPT)

```
You are working on the Knowtation repo. Read docs/NEXT-SESSION.md, docs/STATUS-HOSTED-AND-PLANS.md, and docs/IMPLEMENTATION-PLAN.md (top “Status for next session”).

Context: `npm test` is green. Production (knowtation.store + gateway + canister) is live; bridge when BRIDGE_URL is set.

Goal this session (pick one track unless user says otherwise):
1) **Phase 15.1 hosted multi-vault** — Motoko partitions notes by vault_id per docs/MULTI-VAULT-AND-SCOPED-ACCESS.md § “Hosted multi-vault — what to build”; gateway settings vault list; backup/index per vault on bridge after export is scoped.
2) **Parity gaps** — Import/facets on hosted per PARITY-PLAN.md.
3) **Ops / docs** — Re-run DEPLOY-HOSTED.md §5 after deploys; update STATUS-HOSTED-AND-PLANS.md if reality changes.

Always run `npm test` from repo root before merging hub/cli changes.
```

---

## Which comes first: tests, ops, or hosted multi-vault?

| Order | Step | Why |
|-------|------|-----|
| **1** | **`npm test` green** | Keep CI trustworthy on every PR (`npm test` from repo root). |
| **2** | **Hosted re-verify when needed** | After deploy/env changes, walk [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5 — see [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md). |
| **3** | **Phase 15.1 hosted multi-vault** | Canister partitions by `vault_id` — [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md) § Hosted multi-vault — what to build. |

**Rule:** Do not ship Motoko or gateway changes without **`npm test`** green; add canister/hub tests **alongside** Phase 15.1 work where practical.

---

## Full roadmap (after MCP merge to `main`)

1. Keep **`npm test`** green on each PR.  
2. Hosted: production live; **§5 re-verify** after changes — [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md).  
3. **Phase 15.1:** hosted multi-vault on canister (greenfield / minimal migration OK).  
4. Issue #1 leftovers: MCP **D2/D3**, **F2–F5** — [BACKLOG-MCP-SUPERCHARGE.md](./BACKLOG-MCP-SUPERCHARGE.md).  
5. Issue #2 (AgentCeption): thin slices, later.

---

## After this session

Update **IMPLEMENTATION-PLAN.md** build status / “Status for next session” and bump this file if the next first task changes.

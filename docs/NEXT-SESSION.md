# Next session — start here

**Purpose:** One place to pick up work after a break: **what to do first**, **copy-paste prompt** for your agent, and **links** to checklists.

---

## Copy-paste prompt (for Cursor / ChatGPT)

```
You are working on the Knowtation repo. Read docs/NEXT-SESSION.md, docs/STATUS-HOSTED-AND-PLANS.md, docs/IMPLEMENTATION-PLAN.md (top “Status for next session”), docs/HOSTED-STORAGE-BILLING-ROADMAP.md, and docs/HOSTED-CREDITS-DESIGN.md.

Context: `npm test` is green. Production (knowtation.store + gateway + canister) is live; bridge when BRIDGE_URL is set. Before changing Motoko stable storage, follow HOSTED-STORAGE-BILLING-ROADMAP (V1 = multi-vault + reserved balance cents).

Goal this session (pick one track unless user says otherwise):
1) **Phase 15.1 hosted multi-vault** — Motoko partitions notes by vault_id per docs/MULTI-VAULT-AND-SCOPED-ACCESS.md § “Hosted multi-vault — what to build”; gateway settings vault list; backup/index per vault on bridge after export is scoped; align V1 migration with HOSTED-STORAGE-BILLING-ROADMAP.
2) **Parity gaps** — Import/facets on hosted per PARITY-PLAN.md.
3) **Billing groundwork** — Shadow metering logs (beta), Stripe/Resend env stubs, or implement Phase 16 per HOSTED-CREDITS-DESIGN (after pricing clarity).
4) **Ops / docs** — Re-run DEPLOY-HOSTED.md §5 after deploys; update STATUS-HOSTED-AND-PLANS.md if reality changes.

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
3. **Phase 15.1:** hosted multi-vault on canister + **V1 storage** per [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md).  
4. **Phase 16:** usage credits — beta shadow metering then Stripe + deductions — [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md).  
5. Issue #1 leftovers: MCP **D2/D3**, **F2–F5** — [BACKLOG-MCP-SUPERCHARGE.md](./BACKLOG-MCP-SUPERCHARGE.md).  
6. Issue #2 (AgentCeption): thin slices, later.

---

## After this session

Update **IMPLEMENTATION-PLAN.md** build status / “Status for next session” and bump this file if the next first task changes.

# Next session — start here

**Purpose:** One place to pick up work after a break: **what to do first**, **copy-paste prompt** for your agent, and **links** to checklists.

---

## Copy-paste prompt (for Cursor / ChatGPT)

```
You are working on the Knowtation repo. Read docs/NEXT-SESSION.md and docs/IMPLEMENTATION-PLAN.md (top “Status for next session”).

Goal this session (in order):
1) Fix failing `npm test` so CI is trustworthy (see test/cli.test.mjs get-note fixture, test/config.test.mjs hub_setup merge — run from repo root).
2) If tests are green, verify or document hosted Phase 2 ops: bridge deployed, BRIDGE_URL on gateway, pre-roll per DEPLOY-HOSTED / STATUS-HOSTED-AND-PLANS — do not start hosted multi-vault until baseline is clear.
3) Only after (1) and hosted baseline: implement Phase 15.1 hosted multi-vault per docs/MULTI-VAULT-AND-SCOPED-ACCESS.md § “Hosted multi-vault — what to build” (canister reads X-Vault-Id and partitions storage; vault list source for hosted; then backup/index per vault).

Execute (1) first; commit with a clear message. Do not skip tests to jump to Motoko unless the user explicitly reprioritizes.
```

---

## Which comes first: tests or hosted multi-vault?

| Order | Step | Why |
|-------|------|-----|
| **1** | **`npm test` green** | Today some tests fail; if you build multi-vault on top, you cannot tell what broke. Fixing tests is usually **fast** (fixtures, paths, hub_setup test data). |
| **2** | **Hosted Phase 2 baseline** | Bridge + `BRIDGE_URL` + smoke on knowtation.store — see [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md), [PARITY-PLAN.md](./PARITY-PLAN.md), [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md). |
| **3** | **Phase 15.1 hosted multi-vault** | Canister + gateway settings + backup/index — [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md) § Hosted multi-vault — what to build. |

**Rule:** **Tests first**, then **hosted ops**, then **multi-vault**. Multi-vault is not blocked by “more tests” forever — add canister/hub tests **alongside** Motoko changes after the baseline is green.

---

## Full roadmap (after MCP merge to `main`)

1. Fix `npm test` + keep green on each PR.  
2. Hosted Phase 2: bridge, env, pre-roll, manual smoke.  
3. Phase 15.1: hosted multi-vault (greenfield / minimal migration OK).  
4. Issue #1 leftovers: MCP **D2/D3**, **F2–F5** — [BACKLOG-MCP-SUPERCHARGE.md](./BACKLOG-MCP-SUPERCHARGE.md).  
5. Issue #2 (AgentCeption): thin slices, later.

---

## After this session

Update **IMPLEMENTATION-PLAN.md** build status / “Status for next session” and bump this file if the next first task changes.

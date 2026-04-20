# Hosted Hub (browser) and hosted MCP (Cursor): how they connect

This doc is for **operators and implementers** who need the **hosted website (Hub)** and **hosted MCP** (`knowtation-hosted` in Cursor) to stay aligned. It complements the MCP-only phases in the Cursor plan file *Hosted MCP: prompts and resources parity assessment* (`.cursor/plans/hosted_mcp_prompts_resources_2303a796.plan.md`) and the tool playbook [`HOSTED-MCP-TOOL-EXPANSION.md`](HOSTED-MCP-TOOL-EXPANSION.md).

---

## Plain answers

1. **Are the Hub and MCP the same thing?**  
   **No.** They are **two different clients** (two “doors”) into your **vault data**.

2. **If we build a feature only in the Hub, does Cursor’s MCP list update by itself?**  
   **No.** Cursor only shows what the **hosted MCP server** (`hub/gateway` MCP stack) advertises.

3. **If we build a feature only in MCP, does the Hub website show it by itself?**  
   **No.** The Hub only shows what **`web/hub`** (and related) implements.

4. **How *do* they stay aligned?**  
   Both should call the **same backend**: **Internet Computer canister** APIs, **bridge** HTTP APIs, and shared **`lib/`** where applicable. **One implementation of the rule**; two thin wrappers (Hub UI vs MCP tool/prompt/resource).

5. **Which do we build first?**  
   **Whichever matters more for users**—Hub first, MCP first, or **parallel** after agreeing the **shared API** (recommended: define **H0–H1** below before splitting work).

---

## Phased development (Hub + MCP together)

Use this table when a capability must exist in **both** the browser and Cursor.

| Phase | Name | Actions |
|-------|------|--------|
| **H0** | Outcome + contract | Name the user-visible outcome. List **exact** canister/bridge routes (or new ones) and auth headers. |
| **H1** | Shared core | Implement business logic **once** (canister method, bridge route, or shared `lib/` module). Add tests at this layer where possible. |
| **H2** | First surface | Ship **either** Hub UI **or** MCP tool/prompt (product priority). |
| **H3** | Second surface | Ship the **other** client, calling the **same H1** paths (no duplicate business rules). |
| **H4** | Verify both | Update operator docs; smoke Hub in browser; smoke MCP in Cursor (reconnect MCP after gateway deploy). |

**MCP-only work** (e.g. hosted **prompts/resources** parity, recipes) can follow the separate phases in the Cursor plan (Track A recipes, Track B top prompts) **without** Hub UI—but if marketing promises “same as Hub,” schedule **H2–H3** so neither door lies.

### Track B1 hosted prompts — H0–H4 (composition)

| Step | For B1 (`daily-brief`, `search-and-synthesize`, `project-summary`, `temporal-summary`, `content-plan`) |
|------|--------------------------------------------------------------------------------------------------------|
| **H0** | Outcome: MCP **`prompts/list` / `prompts/get`** return message templates backed by vault data. Contract: same **`GET {canister}/api/v1/notes`**, **`POST {bridge}/api/v1/search`**, **`GET …/notes/:path`** as tools; **`Authorization`**, **`X-Vault-Id`**, **`X-User-Id`** = **`canisterUserId`** on canister (see playbook § parity). |
| **H1** | No new shared core required — prompts call existing tool upstreams only. |
| **H2** | Shipped on hosted MCP (`hub/gateway/mcp-hosted-server.mjs`). |
| **H3** | Hub UI not required for parity (no new user-facing Hub action); users can still use list/search/read in the browser manually. |
| **H4** | Docs: playbook + parity matrix; smoke: reconnect MCP, confirm **`prompts/list`** shows **five** B1 prompts on **`main`** (ten after B2 merge for editor/admin; nine for viewer); **`getPrompt`** with real args after **`list_notes`** / **`search`**. |

### Track B2 hosted prompts — H0–H4 (composition)

| Step | For B2 (`meeting-notes`, `knowledge-gap`, `causal-chain`, `extract-entities`, `write-from-capture`) |
|------|-----------------------------------------------------------------------------------------------------|
| **H0** | Outcome: same **`prompts/list` / `prompts/get`** surface class as B1. Contract: **`POST {bridge}/api/v1/search`** (including **`chain`** for causal-chain), **`GET {canister}/api/v1/notes`**, **`GET …/notes/:path`**; **`write-from-capture`** is **no upstream** (instructions + user text only). Auth headers unchanged (**`X-User-Id`** = **`canisterUserId`** on canister). |
| **H1** | No new shared core — reuse bridge search + canister list/read. **Intentional difference vs local:** `causal-chain` uses vector index chain filter instead of filesystem graph enumeration; `write-from-capture` omits local-only `templates/capture.md` embed. |
| **H2** | Shipped on hosted MCP (`hub/gateway/mcp-hosted-server.mjs`). |
| **H3** | Hub UI not required (composition / agent prefill only). |
| **H4** | Docs: playbook prompt inventory + parity matrix row; tests: `mcp-hosted-prompts.test.mjs`; smoke: **`prompts/list`** nine (viewer) or ten (editor/admin); **`getPrompt`** for `knowledge-gap` / `causal-chain` after deploy. |

### Track B3 prep — hosted agent memory HTTP (**H0** contract)

**Outcome:** The Hub and (later) hosted MCP **prompts** use the **same** first-hop URLs under **`/api/v1/memory*`** — no second retention or partition rule in MCP. **B3 `registerPrompt` is not shipped** until **`GET /api/v1/memory`** and **`POST /api/v1/memory/search`** response JSON are mapped to prompt text (aligned with **`formatMemoryEventsAsync`** in [`mcp/prompts/helpers.mjs`](../mcp/prompts/helpers.mjs)) and covered by tests beyond the proxy smoke below.

| Step | Track B3 memory (list / key / search / writes / consolidation) |
|------|------------------------------------------------------------------|
| **H0** | This subsection + parity matrix § **Agent memory**; gateway forwards **`Authorization`** + **`X-Vault-Id`**; bridge **`bridgeMemoryAuth`** parses JWT `sub` and vault id. |
| **H1** | Shared core is **bridge** (`hub/bridge/server.mjs`) + **`lib/memory.mjs`** / **`lib/memory-event.mjs`** / providers; hosted raw events also use **Netlify Blobs** when `globalThis.__netlify_blob_store` is set. |
| **H2** | **Hub** already calls consolidation + list passes (`web/hub/hub.js`). |
| **H3** | **Hosted MCP** — future **`upstreamFetch`** from `mcp-hosted-server.mjs` to **gateway** paths (same as Hub), then map JSON → markdown lines for prompts. |
| **H4** | Extend **`mcp-hosted-prompts.test.mjs`** golden **`prompts/list`** when three prompt IDs register; run **`npm run verify:hosted-mcp-checklist`** + **`npm test`** before merge to **`main`**. |

#### Gateway proxy inventory (`hub/gateway/server.mjs`)

All of the following use **`proxyTo(BRIDGE_URL, …)`** except **`POST /api/v1/memory/consolidate`**, which runs **`runBillingGate`** then optional billing merge on **`req.body`**, then proxies. Forwarded headers match other bridge proxies: **`Host`**, allowlisted **`content-type`** and **`accept`**, **`accept-language`**, **`accept-encoding`**, **`authorization`**, **`x-vault-id`** (see **`PROXY_HEADER_ALLOWLIST`** plus explicit auth/vault copy in **`proxyTo`**).

| Gateway route | Upstream bridge path |
|---------------|----------------------|
| `GET /api/v1/memory/:key` | `GET /api/v1/memory/:key` (+ query preserved) |
| `POST /api/v1/memory/store` | `POST /api/v1/memory/store` |
| `GET /api/v1/memory` | `GET /api/v1/memory` (+ query preserved) |
| `POST /api/v1/memory/search` | `POST /api/v1/memory/search` |
| `DELETE /api/v1/memory/clear` | `DELETE /api/v1/memory/clear` |
| `GET /api/v1/memory-stats` | `GET /api/v1/memory-stats` |
| `POST /api/v1/memory/consolidate` | `POST /api/v1/memory/consolidate` (after billing gate) |
| `GET /api/v1/memory/consolidate/status` | `GET /api/v1/memory/consolidate/status` |

**Boundary tests (no live bridge):** [`test/gateway-memory-bridge-proxy.test.mjs`](../test/gateway-memory-bridge-proxy.test.mjs) asserts path, query, JSON body, **`Authorization`**, and **`X-Vault-Id`** reach a mock bridge for **`GET /api/v1/memory`**, **`GET /api/v1/memory/:key`**, and **`POST /api/v1/memory/search`**.

#### Bridge handlers (`hub/bridge/server.mjs`) — auth and shapes

**`bridgeMemoryAuth`:** **`Authorization: Bearer <JWT>`** required for JSON responses that need a user; JWT verified with bridge session secret; **`x-vault-id`** header or **`vault_id`** query selects vault; invalid/missing Bearer → **`401`** with **`{ error, code: 'UNAUTHORIZED' }`**.

| Bridge method | Path | Extra middleware | Response / notes |
|---------------|------|-------------------|------------------|
| `GET` | `/api/v1/memory/:key` | — | Latest event for semantic key: **`{ key, value, updated_at, id? }`**. |
| `POST` | `/api/v1/memory/store` | **`requireBridgeAuth`**, **`requireBridgeEditorOrAdmin`**, **`express.json()`** | Body **`{ key, value, ttl? }`**; **`400`** if missing key/value. |
| `GET` | `/api/v1/memory` | — | Query **`type`**, **`since`**, **`until`**, **`limit`** (cap **100**); **`{ events, count }`**. Events are **`createMemoryEvent`**-shaped objects (at minimum **`type`**, **`ts`**, **`data`**). |
| `POST` | `/api/v1/memory/search` | **`express.json()`** | **Stub:** **`{ results: [], count: 0, note: 'Hosted memory search requires vector provider (future.)' }`** — MCP **`memory-informed-search`** must treat as **no semantic recall** until replaced. |
| `DELETE` | `/api/v1/memory/clear` | **`requireBridgeAuth`**, **`requireBridgeEditorOrAdmin`** | Query **`type`**, **`before`**; passes through to **`MemoryManager.clear`**. |
| `GET` | `/api/v1/memory-stats` | — | **`MemoryManager.stats()`** JSON. |
| `POST` | `/api/v1/memory/consolidate` | **`requireBridgeAuth`**, **`requireBridgeEditorOrAdmin`**, **`express.json()`** | LLM + cooldown + cost; see bridge source for **`429`** / **`503`** codes. |
| `GET` | `/api/v1/memory/consolidate/status` | — | Cooldown + pass counts for UI. |

#### JSON → prompt text (`formatMemoryEventsAsync` parity)

Self-hosted prompts call **`mm.list()`** and format lines as **`- **${e.ts}** [${e.type}] ${JSON.stringify(e.data).slice(0, 200)}`**. Hosted MCP should consume **`GET /api/v1/memory`** **`events[]`** with the **same field names** so the markdown block matches user expectations. **`limit`:** local helper caps at **`MAX_MEMORY_EVENTS` (30)** with default **20**; bridge allows **`limit` ≤ 100** — prompts should pass an explicit **`limit`** (e.g. **20**) for stable parity until product aligns caps.

---

## Where code lives (quick map)

| Concern | Typical location |
|---------|------------------|
| Hub browser UI | `web/hub/` (and related static assets) |
| Hosted MCP tools + prompts | `hub/gateway/mcp-hosted-server.mjs`, `hub/gateway/mcp-proxy.mjs`, `hub/gateway/mcp-tool-acl.mjs` |
| Shared HTTP to bridge | Patterns in `hub/gateway/server.mjs` and gateway helpers used by MCP |
| Vault truth on ICP | `hub/icp/` canister |

---

## Related docs

- [`docs/PARITY-MATRIX-HOSTED.md`](PARITY-MATRIX-HOSTED.md) — **G0 living inventory:** capability → Hub → API → hosted MCP tool; G1 PR checklist (extend for hosted prompts when they add user-facing surface)
- [`docs/NEXT-SESSION-HOSTED-HUB-MCP.md`](NEXT-SESSION-HOSTED-HUB-MCP.md) — **next-session handoff**, pasteable prompt, **G0/G1 before Track B**, prompts B1–B3 + resources R0–R3 phasing
- [`docs/HOSTED-MCP-TOOL-EXPANSION.md`](HOSTED-MCP-TOOL-EXPANSION.md) — adding hosted MCP **tools**
- [`docs/AGENT-INTEGRATION.md`](AGENT-INTEGRATION.md) — MCP vs CLI vs Hub API overview
- [`docs/NEXT-SESSION-HOSTED-MCP.md`](NEXT-SESSION-HOSTED-MCP.md) — hosted MCP ops handoff (EC2, checklist)

---

## Jargon cheat sheet

| Term | Meaning here |
|------|----------------|
| **Thin client** | Hub or MCP only forwards user/agent intent to an API; little duplicated logic. |
| **Drift** | Hub and MCP behave differently because they implemented the same rule twice in two places. |
| **SSOT (single source of truth)** | One layer (canister/bridge/lib) owns the behavior; both clients read it. |

---

## Recommendation (read this before a big multi-phase build)

**You do not need a “big bang” rewrite** to head in the right direction. Hosted MCP tools were already designed to call **bridge + canister** (see [`HOSTED-MCP-TOOL-EXPANSION.md`](HOSTED-MCP-TOOL-EXPANSION.md)). The risk of drift is highest where **Hub JavaScript** and **MCP handlers** each encode **different** filtering, paths, or auth assumptions for the **same** user-visible action.

**Practical order:**

1. **Governance first (lightweight):** adopt **H0–H4** for every **new** capability that touches both Hub and MCP. Cost is mostly discipline, not code volume.
2. **Inventory second:** map “Hub feature ↔ API ↔ MCP tool” and mark **known gaps** (document only).
3. **Fix drift only where it hurts:** refactor duplicated logic into **shared bridge/canister/`lib/`** when you find real mismatches—not all at once.
4. **Prompts/resources on hosted** follow the separate Cursor plan tracks (recipes → top prompts), still calling the **same** upstream patterns as tools.

That is **safe to develop from here** if each change keeps **tests** (`npm run verify:hosted-mcp-checklist`, Hub smoke, canister checks where relevant) and you **avoid** copying business rules into a second place without a ticket that says “dedupe to API X.”

---

## Proper setup: what prevents drift?

| Practice | What it does |
|----------|----------------|
| **One behavior, one owner** | Rules for “who can read/write this vault path” live in **canister/bridge** (or one shared `lib/` helper both call). Hub and MCP only **call** that. |
| **Contract before UI** | For a new feature: write **H0** (routes, errors, auth) before building both surfaces. |
| **Server-side enforcement** | Never rely on “the Hub hid the button” as security; MCP and forged requests must hit the **same** checks. |
| **Parity matrix (living doc)** | A table: capability → Hub entry point → MCP tool → canonical API. Update when you add either side. |
| **Tests at the shared layer** | Where possible, test the **bridge/canister** behavior once; Hub/MCP tests stay thin (smoke). |

---

## Is this a major change? Can we break things?

| Question | Answer |
|----------|--------|
| **Major rewrite of everything?** | **No.** This is mostly **process + selective refactors** where duplication is proven. |
| **Safe to add prompts/resources under this model?** | **Yes**, if new handlers **reuse** the same `upstreamFetch` / canister patterns as existing tools and respect **roles** (same as [`mcp-tool-acl.mjs`](../hub/gateway/mcp-tool-acl.mjs)). |
| **Must we refactor all MCP tools first?** | **No.** Audit **incrementally**. Many tools already match Hub intent (e.g. canister user parity in the playbook). Revisit **only** areas where Hub and MCP disagree in production or tests. |

**What can break if you refactor carelessly:** delegated/workspace users (`effective_canister_user_id`), rate limits, export/import caps, billing on import paths. Mitigation: **small PRs**, **existing tests green**, **production smoke** after gateway deploy.

---

## Do existing MCP tools need restructuring?

**Default:** **No wholesale restructuring.** Hosted tools are already **API-shaped**.

**When to change a tool:** You find **two implementations** of the same rule (e.g. different list filters, different path normalization). Then: move the rule **up** into bridge/canister or a **single** gateway helper both Hub proxy and MCP import—**not** a new pattern per feature.

**What “good” looks like in code:** Hub’s gateway routes and `mcp-hosted-server` both call **the same** `GET/POST` paths with the **same** headers (`X-User-Id`, vault id, etc.) already documented in [`HOSTED-MCP-TOOL-EXPANSION.md`](HOSTED-MCP-TOOL-EXPANSION.md).

---

## Roadmap: anti-drift program (phased)

Use this as the **program** that runs **alongside** MCP prompt/resource tracks (recipes → hosted prompts). Phases are **ordered by risk reduction**, not all mandatory before any feature ships.

| Phase | Name | What you do | Outcome |
|-------|------|-------------|---------|
| **G0** | **Inventory** | Build a **parity matrix** (spreadsheet or markdown table): user capability → Hub UI/route → bridge/canister endpoint → MCP tool name. Flag **empty cells** and **duplicate logic**. | You **see** drift instead of guessing. |
| **G1** | **Governance** | Team rule: **H0–H4** for any feature that ships **both** Hub and MCP; optional H2-only if only one surface. | **New** work stops adding silent divergence. |
| **G2** | **Tighten hot spots** | Pick **1–3** worst duplicates from G0; refactor so **one** API or `lib/` module owns the behavior; Hub + MCP become thin. | Measurable reduction in bug class “works in browser, fails in Cursor.” |
| **G3** | **Track A + B (MCP)** | Hosted **recipes** doc, then **3–5 hosted prompts** calling same upstreams as tools (Cursor plan). | Better Cursor UX **without** inventing a second vault layer. |
| **G4** | **Resources (optional)** | Only if product needs `knowtation://`-style reads on hosted; implement **thin** resource handlers on top of **same** read APIs as `get_note`. | Parity for resource-oriented clients. |
| **G5** | **Ongoing** | PR checklist: “Does this touch Hub **or** MCP? If both, did we update H0 contract + matrix?” | Drift stays **visible**. |

**Timeline (rough):** G0–G1 can be **days** (mostly documentation and process). G2 is **variable** (small refactors vs large). G3 matches your **prompts** schedule. G4 is **larger** if you go beyond one note-read template.

---

## Precautions (what to be wary of)

- **Identity:** `X-User-Id` / `canisterUserId` / actor vs effective user — already a past bug class; any refactor must preserve [`HOSTED-MCP-TOOL-EXPANSION.md`](HOSTED-MCP-TOOL-EXPANSION.md) parity notes.
- **Rate limits and caps:** MCP-only limits (e.g. export size) vs Hub; document if they **must** differ.
- **Billing:** Import/transcribe paths that must hit metered gateway; do not add a second path that skips metering.
- **Secrets:** No new credentials in Hub client bundles; agents must not get broader scope than Hub OAuth/JWT allows.
- **Scope creep:** “Full resource parity with local stdio” is a **multi-sprint** program; keep G4 scoped until G0–G3 prove value.

---

## Final outcome you can expect

- **Process:** New features that matter in **both** places are built **API-first**, then Hub + MCP, with a **written** contract (H0).
- **Technical:** Fewer places where “fix it twice” happens; bugs fixed **once** at bridge/canister when possible.
- **Product:** Hub and Cursor **agree** on what the vault allows for the same account, except where you **document** an intentional difference (e.g. MCP-only export cap).
- **Not promised:** Pixel-identical UX between browser and chat; **behavioral** alignment on **data and permissions** is the bar.

---

## Simple summary (one paragraph)

**Stop drift** by making **bridge and canister** (plus shared `lib/`) the **only** place that encodes vault rules, and making Hub and hosted MCP **thin callers**. **Do not** rewrite all tools up front; **inventory** (G0), **adopt H0–H4** for new work (G1), then **fix duplicates** you actually find (G2). **Add** hosted prompts/resources (G3–G4) only on top of **those same APIs**. Expect **incremental**, **test-backed** changes—not a single risky rewrite—with **clearer** behavior for hosted users in both the **browser** and **Cursor**.

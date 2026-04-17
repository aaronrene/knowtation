# Next session: hosted MCP, EC2 vs Netlify, billing UI, more tools

Use this file as a handoff prompt for a future session.

## Mandatory gate (repo + production)

- **Before merge / locally:** run `npm run verify:hosted-mcp-checklist` — executes the hosted MCP schema guard (`hub/gateway/mcp-hosted*.mjs`) and the `tools/list` regression test. **CI** runs `npm run check:mcp-hosted-schema` plus full `npm test` on every PR to `main`.
- **Tool expansion:** follow [HOSTED-MCP-TOOL-EXPANSION.md](./HOSTED-MCP-TOOL-EXPANSION.md) (upstream proof, ACL, schema discipline, golden tool list updates).
- **After EC2 deploy:** same human checks as [§ Verify after deploy](#verify-after-deploy) below.

## What shipped (hosted MCP tools)

- **Symptom:** Cursor `knowtation-hosted` showed OAuth OK and `vault-info` resource, but **zero tools**.
- **Cause:** `hub/gateway/mcp-hosted-server.mjs` used `z.record(z.unknown())` on the `write` tool. **Zod v4** JSON Schema export throws during **`tools/list`**, so the whole list failed.
- **Fix:** `frontmatter: z.record(z.string(), z.unknown()).optional()`.
- **Where it runs:** Code lives in the repo; **production MCP** is served from **EC2** (`https://mcp.knowtation.store/mcp`) with **PM2** (`knowtation-gateway`). After merge: `git pull` on `/opt/knowtation`, `pm2 restart knowtation-gateway --update-env`.
- **Netlify:** The Netlify gateway path does **not** host the same stateful Streamable HTTP `/mcp` session router as EC2 (see `docs/AGENT-INTEGRATION.md`). Cursor’s remote MCP URL should stay on the **persistent Node** host, not the Netlify-only entrypoint.

## Cursor quirks (not regressions)

- Brief **red / “Server not initialized”** in MCP logs can appear when **toggling** the server or right after **PM2 restart**; **Logout → Connect** or retry usually clears it once `initialize` completes.
- After the schema fix and **`import`** tool, **eight tools** appear for admin: `search`, `get_note`, `list_notes`, `write`, `index`, `import`, `summarize`, `enrich`, plus resource **`vault-info`**.
- **`import` MCP** was **production-verified** on EC2 (2026-04): small markdown upload via tool → `inbox/mcp-import-smoke.md`, confirmed with **`list_notes`** / body match (see [HOSTED-MCP-TOOL-EXPANSION.md](./HOSTED-MCP-TOOL-EXPANSION.md) § *How to interpret results*).

## EC2 “test station” vs pack balances (beginner map)

| Piece | Typical host | Role |
|--------|----------------|------|
| **Hub UI** (Settings, Billing tab) | **4Everland** (`web/`) | Static pages; calls API via `web/hub/config.js` |
| **Hub API** (auth, notes, **`/api/v1/billing/summary`**) | **Netlify** (`knowtation-gateway.netlify.app` in production `config.js`) | JWT, canister proxy, billing |
| **Hosted MCP** (`/mcp`, OAuth, tools) | **EC2** (`mcp.knowtation.store`) | Cursor MCP only; **not** where the Hub loads billing JSON |

Pack balances and usage bars come from **`GET /api/v1/billing/summary` on the Netlify gateway**, not from the EC2 MCP process. Changing EC2 for MCP does **not** by itself change billing data (unless you pointed `HUB_API_BASE_URL` at the wrong host).

## Hosted MCP: more tools later

- **ACL:** `hub/gateway/mcp-tool-acl.mjs` — `ADMIN_TOOLS` / `WRITE_TOOLS` / `READ_TOOLS` already list names like `relate`, `backlinks`, `capture`, etc.
- **Registration:** `hub/gateway/mcp-hosted-server.mjs` only registers a **subset** that have implementations (bridge/canister + sampling + **`import`** multipart to bridge).
- **Next work:** For each missing tool, add a `registerTool` block (or shared helper) that calls the same upstreams as local stdio MCP (`mcp/` tree), and keep **input schemas** JSON-schema-safe (avoid open-ended `z.record` with unknown value types that break Zod v4 JSON Schema export; prefer `z.record(z.string(), z.unknown())` or explicit shapes) so **`tools/list`** never breaks again. See [HOSTED-MCP-TOOL-EXPANSION.md](./HOSTED-MCP-TOOL-EXPANSION.md).

## Billing tab: pack “flash” (Hub UI)

- **Not caused by the MCP commit** (that file is gateway-only on EC2).
- **Cause:** `loadBillingPanel()` in `web/hub/hub.js` hides **Token pack add-ons** when `stripe_configured && !isFreeTier && hasSub` is false (`beta`/`free` → `isFreeTier` true). The HTML used to show the pack grid **before** JS ran → visible **flash**, then `display: none`.
- **Fix in repo:** Default `#billing-pack-section` to `display:none` in `web/hub/index.html`; `setDash()` also hides `packSection` on errors or signed-out state.

## Verify after deploy

1. **MCP:** Cursor shows 8 tools for admin + green; `vault-info` reads correct `userId` / `vaultId` / `role`.
2. **MCP canister auth (EC2):** If **`list_notes` / `get_note` / `write` / `enrich`** return **`GATEWAY_AUTH_REQUIRED`** while **search** and **index** work, set **`CANISTER_AUTH_SECRET`** on the **same** MCP gateway process (PM2) to match Netlify + canister, then `pm2 restart … --update-env`. Details: [HOSTED-MCP-TOOL-EXPANSION.md](./HOSTED-MCP-TOOL-EXPANSION.md) (section *Troubleshooting: GATEWAY_AUTH_REQUIRED on canister-backed tools only*).
3. **Billing:** Open Settings → Billing; packs either stay **hidden** (beta/free) or stay **visible** (paid + Stripe + active sub); no half-second flash of pack cards for ineligible tiers.

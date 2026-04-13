# Muse thin bridge (Option C) — operators

Knowtation’s **canonical** state remains the vault (and ICP canister on hosted). **Muse** and **MuseHub** are **optional**: login, search, and normal writes do not depend on them.

This document describes the **thin bridge** shipped in-repo: optional env vars, **`external_ref` on approve**, and an **admin-only read-only HTTP proxy**. For product context and security posture, see [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) §4 (*Optional external lineage*) and [archive/MUSE-STYLE-EXTENSION.md](./archive/MUSE-STYLE-EXTENSION.md) §6.3.

## Enable / disable

| State | Behavior |
|-------|----------|
| **No effective base URL** | No outbound Muse calls. **`GET /api/v1/operator/muse/proxy`** returns **404** `NOT_FOUND` (generic). Approve works as before; optional **`external_ref`** from the client is still accepted on approve when valid. |
| **Effective base URL set** | Server may call **`GET {base}/knowtation/v1/lineage-ref?proposal_id=…&vault_id=…`** during approve when the client did not supply a valid **`external_ref`**. **Approve never fails** if Muse is down or returns an error; logs contain **`[knowtation:muse-bridge]`** warnings. Admin proxy is available. |

**Where the base URL comes from (self-hosted Node Hub):**

1. **`MUSE_URL`** in the Hub process environment (wins when set).
2. Otherwise **`muse.url`** in **`config/local.yaml`** (Hub **Settings → Integrations → Muse** writes this for admins when `MUSE_URL` is **not** set on the process).

**Hosted (gateway):** only **`MUSE_URL`** / related env on the gateway (operators). The Hub UI shows status only; **`POST /api/v1/settings/muse`** returns **501** on the gateway.

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| **`MUSE_URL`** | For Muse features (or use YAML below) | Base URL (`https://…`), no trailing slash required. Must be `http:` or `https:`. Overrides **`muse.url`** in **`config/local.yaml`**. |
| **`muse.url` (YAML)** | Self-hosted alternative to **`MUSE_URL`** | Same shape as **`MUSE_URL`**. Editable in **Settings → Integrations** when the process does **not** set **`MUSE_URL`**. |
| **`MUSE_API_KEY`** | No | If set, sent as **`Authorization: Bearer …`** on server-to-server calls (lineage ref + proxy). **Never** expose to browsers or end users. |
| **`MUSE_LINEAGE_TIMEOUT_MS`** | No | Timeout for lineage `GET` (default **5000**, clamped 1000–60000). |
| **`MUSE_PROXY_MAX_BYTES`** | No | Max bytes read for **`GET /api/v1/operator/muse/proxy`** (default **1 MiB**, capped at 10 MiB). |
| **`MUSE_PROXY_PATH_PREFIXES`** | No | Comma-separated path prefixes allowed for the proxy (default **`/knowtation/v1/`**). Only **`GET`**; paths must not contain **`..`**. |

## Lineage callback contract (operator-defined adapter)

Until a stable public Muse HTTP API is pinned, Knowtation documents this **minimal** contract so you can run a tiny adapter in front of Muse:

- **Method:** `GET`
- **Path on `MUSE_URL`:** `/knowtation/v1/lineage-ref`
- **Query:** `proposal_id`, `vault_id` (same values the Hub uses; **no proposal body** is sent)
- **Response:** JSON object with optional string field **`external_ref`**

The Hub normalizes **`external_ref`** (trim, max length **512**, no ASCII control characters).

## Approve behavior

- **Self-hosted:** [hub/server.mjs](../hub/server.mjs) resolves **`external_ref`** then persists it via [hub/proposals-store.mjs](../hub/proposals-store.mjs).
- **Hosted:** [hub/gateway/server.mjs](../hub/gateway/server.mjs) merges the resolved value into the POST body before the canister; [hub/icp/src/hub/main.mo](../hub/icp/src/hub/main.mo) stores it on the proposal record.

**Client-supplied** **`external_ref`** on the approve body **wins** over the lineage `GET`.

## Admin read-only proxy

- **`GET /api/v1/operator/muse/proxy?path=`** + URL-encoded path (e.g. `%2Fknowtation%2Fv1%2F…`)
- **Role:** **admin** (same rules as other hosted admin routes: **`HUB_ADMIN_USER_IDS`** and/or bridge **`/api/v1/role`**).
- **Self-hosted:** JWT via Hub; [hub/server.mjs](../hub/server.mjs).
- **Hosted:** [hub/gateway/server.mjs](../hub/gateway/server.mjs).

Do **not** place Muse on an unauthenticated public URL for Hub users. Credentials stay in **server env** only.

## What is not guaranteed

- No bulk “move entire vault to MuseHub” in this bridge.
- No replacement for GitHub backup or Connect Git flows.
- No MCP “history summary” tool in this slice (deferred; see [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) Option C).

## Hosted deploy note

After upgrading the **hub** canister, run your usual ICP deploy so approve persists **`external_ref`** on hosted. See [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md).

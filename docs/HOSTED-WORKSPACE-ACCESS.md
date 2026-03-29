# Hosted workspace access and scope

This document defines how **team vault access** and **per-user scope** work on the **hosted** product (gateway + bridge + ICP canister), aligned with self-hosted `hub_vault_access.json` and `hub_scope.json`. See also [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md).

## Trust boundary

- The **ICP canister** stores notes keyed by **`X-User-Id`** (and `X-Vault-Id`). It does **not** validate team membership or scope JSON today.
- The **gateway** is the public entrypoint: it verifies the JWT, resolves the **effective canister user**, enforces **vault allowlists** and **scope** before/after canister calls, and forwards **bridge** traffic with the same headers.
- **Operational assumption:** clients do not call the canister or bridge directly with forged `X-User-Id`; only the gateway is exposed to browsers for Hub API paths.

## Workspace owner

- **Bridge** stores `hub_workspace` (Netlify Blobs key or `data/hub_workspace.json`): `{ "owner_user_id": "provider:id" | null }`.
- **Admins** set `owner_user_id` to the OAuth user id whose canister partition is the **shared team vault** (usually the primary operator). **`null`** or missing disables delegation: every JWT uses its **own** `sub` as `X-User-Id` (legacy solo behavior).
- **API:** `GET /api/v1/workspace` and `POST /api/v1/workspace` (admin, JWT) — proxied from the gateway when `BRIDGE_URL` is set.

## Who uses the owner partition?

For JWT actor `sub = A`:

1. If **no** `owner_user_id` is configured → **effective** canister user = `A`.
2. If `owner_user_id = O` and `A === O` → effective = `O` (owner uses their own partition).
3. If `A !== O` and **either**:
   - `A` has an explicit row in **bridge `hub_roles`** with role `admin` | `editor` | `viewer` | `evaluator`, **or**
   - `A` is listed in **`HUB_ADMIN_USER_IDS`** on the bridge/gateway  
   → effective = `O` (**delegation**). Team members and env-listed admins work against the owner’s notes.
4. Otherwise → effective = `A` (solo signup: separate canister partition).

Resolution logic lives in [hub/lib/hosted-workspace-resolve.mjs](../hub/lib/hosted-workspace-resolve.mjs).

## Vault access (allowlist)

- **Bridge** stores the same shape as self-hosted **`hub_vault_access.json`**: map `user_id → vault_id[]`.
- Users **not** listed get **`["default"]`** only (same as Node Hub).
- For each request with **`X-Vault-Id`**, the gateway and bridge reject with **403** if the vault id is not in the actor’s allowlist **after** intersecting with vault ids that exist for the **effective** user on the canister.

## Scope (projects / folders)

- **Bridge** stores the same shape as self-hosted **`hub_scope.json`**: `user_id → { vault_id → { projects[], folders[] } }`.
- Omitted or empty rules mean **full vault** for that user/vault.
- The **gateway** applies [hub/lib/scope-filter.mjs](../hub/lib/scope-filter.mjs) to **GET note lists**, **facets**, and **GET single note** responses when scope is active (mirrors self-hosted `applyScopeFilter`).

## HTTP headers (gateway → canister)

- **`X-User-Id`**: effective canister user id (`provider:id`), i.e. partition owner.
- **`X-Actor-Id`**: JWT `sub` of the signed-in user (for provenance and future canister checks). The canister may ignore this until Motoko enforces ACLs.

## Bridge index / search / vault sync

- **Semantic index and search** use sqlite-vec paths keyed by **`(effective_canister_user_id, vault_id)`**, not the actor’s solo id, so results match the note list.
- **Back up now** (`POST /api/v1/vault/sync`) exports the **effective** user’s vault from the canister.

## Billing (Phase 16)

- **Metering** continues to use the JWT **`sub`** (actor), not the workspace owner, so usage is attributed to the signed-in account.

## API summary

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/v1/workspace` | Admin; `{ owner_user_id }` |
| POST | `/api/v1/workspace` | Admin; body `{ owner_user_id: string \| null }` |
| GET/POST | `/api/v1/vault-access` | Admin; same JSON as self-hosted |
| GET/POST | `/api/v1/scope` | Admin; same JSON as self-hosted |
| GET | `/api/v1/hosted-context` | JWT; internal + Hub debugging; returns effective id, allowlist, scope for current `X-Vault-Id` |

On the gateway, vault-access, scope, and workspace are **proxied to the bridge** when `BRIDGE_URL` is set.

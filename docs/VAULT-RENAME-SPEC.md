# Vault rename and display labels (spec)

This spec covers **renaming a vault** in the multi-vault Hub model. It is **not** the same as [renaming a project slug](./HUB-METADATA-BULK-OPS.md) inside a vault (`frontmatter project:`).

## Concepts

| Term | Self-hosted | Hosted (ICP) |
|------|-------------|----------------|
| **Vault id** | String in `data/hub_vaults.yaml` (e.g. `default`, `work`) | String partition key per user (`X-Vault-Id`); stored in canister stable layout |
| **Vault folder** | Filesystem path in YAML | N/A — notes are keyed by logical path string inside the vault id |
| **Display label** | Optional `label` in `hub_vaults.yaml` | Could be UI-only or future metadata (not required for correctness) |

## Option A: Rename vault **id** (hard migration)

**Meaning:** Change the canonical id from `old` to `new` everywhere the id is referenced.

**Must update (self-hosted):**

- [`data/hub_vaults.yaml`](../lib/hub-vaults.mjs) — row `id`
- [`data/hub_vault_access.json`](../hub/hub_vault_access.mjs) — every array value referencing `old`
- [`data/hub_scope.json`](../hub/hub_scope.mjs) — inner keys per user that are `old`
- JWT/session does not embed vault id; client uses `X-Vault-Id` and vault preference in [`web/hub/hub.js`](../web/hub/hub.js) — users may need to re-select vault after id change

**Hosted (canister):**

- Stable storage maps `(userId, vaultId)` → notes. Renaming `vaultId` requires **copying all note entries and proposals** from `old` to `new` and deleting `old`, or a controlled migration actor. **High risk** (partial failure, instruction limits on large vaults).
- Proposals carry `vault_id`; must be rewritten consistently.

**Recommendation:** Treat vault id rename as a **rare admin migration** with a dedicated script or guided wizard, backups, and idempotency — not a casual UI field.

## Option B: **Display label only** (soft rename)

**Meaning:** Keep stable id `work`; change only what the Hub switcher shows (`label` in YAML or a future hosted field).

**Self-hosted:** Edit `label` in `hub_vaults.yaml` via Settings → Vaults; no access/scope key changes.

**Hosted:** Add or use a label map without changing canister `vaultId`. Safer for production.

## Option C: New vault + move data

Create `work2`, grant access, **export/import** or scripted copy, deprecate `work`. Avoids in-place id surgery at the cost of duplication and user communication.

## Related documentation

- [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md)
- [HUB-API.md](./HUB-API.md) — `GET /settings`, vault list
- [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md) — stable evolution

## Status

**Not implemented as a product feature in this repo** beyond manual YAML/JSON edits self-hosted. This document is the **planning contract** for a future implementation (wizard, bridge migration, or label-only UI).

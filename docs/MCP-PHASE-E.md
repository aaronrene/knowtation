# MCP Issue #1 — Phase E (subscriptions + vault watcher) — shipped

## Behavior

- **Capability:** Server advertises `resources.subscribe: true` (merged with `listChanged` in initialization). See [`mcp/resources/register.mjs`](../mcp/resources/register.mjs).
- **Handlers:** `resources/subscribe` and `resources/unsubscribe` store subscribed URIs. Only `knowtation://` URIs are accepted on subscribe (others no-op).
- **Notifications:**
  - `notifications/resources/updated` is sent **only** for URIs that match a subscription (prefix match: a subscription to `knowtation://vault/inbox` receives updates for `knowtation://vault/inbox/note.md`).
  - `notifications/resources/list_changed` is sent on file/dir **unlink** (debounced with content updates), without requiring a prior subscription (per MCP spec).
- **Watcher:** After stdio `connect`, [`mcp/resource-subscriptions.mjs`](../mcp/resource-subscriptions.mjs) starts **chokidar** on `vault_path`. Ignores `.git` segments. Debounce **150ms** for bursts.
- **Index tool:** After a successful `index` run, emits `resources/updated` for `knowtation://index/stats`, `knowtation://tags`, `knowtation://projects`, and `knowtation://index/graph` when clients have subscribed to those URIs (Issue #1 E3).

## Disable watcher

Set `KNOWTATION_MCP_NO_WATCH=1` to skip the file watcher (tests or constrained environments).

## Hosted / no filesystem

On canister-hosted vaults there is no local tree; this phase applies to **self-hosted MCP** (stdio + local `vault_path`) only. Hub MCP gateway (Phase D) would proxy or omit watcher behavior per deployment docs.

## Manual check

1. Run MCP with a valid vault.
2. From a client that supports resource subscriptions, subscribe to `knowtation://vault/inbox` (or a specific note URI).
3. Add or edit a matching note on disk; confirm `notifications/resources/updated` (and list_changed on delete if applicable).

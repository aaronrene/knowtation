# Hermes MCP OAuth spike — Hostinger Managed (Phase A hard gate)

**Date:** 2026-07-12  
**Branch:** `feat/durable-mcp-oauth-refresh`  
**Verdict:** **partial** (not a clean Hostinger pass) → **Rank 1 ↔ Rank 2 swap** per Roadmap Phase A.

## Simple summary

Upstream Hermes Agent documents full MCP OAuth (`auth: oauth`), token cache on disk, and headless paste-back / SSH forward. We did **not** SSH into Aaron’s Hostinger Managed Hermes instance in this session to confirm that build includes the OAuth module. Until that is confirmed, treat **device authorization (Phase B)** as the primary connect path for headless Hostinger agents; keep durable MCP OAuth refresh (this phase) for Cursor and for Hermes once the Managed build is verified.

## Technical summary

| Check | Result | Evidence |
| --- | --- | --- |
| Hermes `mcp_servers.*.auth: oauth` | **Supported upstream** | [Hermes MCP docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp); PR [NousResearch/hermes-agent#5420](https://github.com/NousResearch/hermes-agent/pull/5420) (`tools/mcp_oauth.py`) |
| Token cache path | **Documented** | `~/.hermes/mcp-tokens/<server>.json` (mode `0o600`); client registration + metadata sidecars |
| Auto-refresh | **Documented** | MCP Python SDK `OAuthClientProvider` handles refresh / step-up |
| Headless paste-back | **Documented** | Docs: print authorize URL → approve in local browser → paste redirect URL (or bare `?code=&state=`) at Hermes prompt; alt: SSH `-L` forward |
| `hermes mcp login <name>` | **Documented** | Avoids 30s config-reload race when editing `config.yaml` inside a live session |
| Hostinger Managed Hermes version / OAuth module present | **Unverified** | No Hostinger SSH / version dump in this spike; operator must confirm Managed image includes MCP OAuth (≥ `#5420` / `mcp>=1.26.0` SDK auth types) |

## Rank swap (frozen contingency)

Because Hostinger Managed was **not** a clean pass:

- **Primary** for headless Hostinger: Phase B device authorization (RFC 8628) / Hub “Connect cloud agent”.
- **Fallback / still required:** Phase A durable MCP OAuth refresh (Cursor OAuth Sign-in + any Hermes build that already speaks `auth: oauth`).

## Operator follow-up (no secrets)

On Hostinger Managed Hermes:

```bash
hermes --version   # or package equivalent
# Confirm mcp_oauth / auth: oauth in docs or:
grep -R "auth: oauth\|mcp_oauth" ~/.hermes/ 2>/dev/null | head
```

Example config shape (URL only — no tokens):

```yaml
mcp_servers:
  knowtation:
    url: https://mcp.knowtation.store/mcp
    auth: oauth
```

Then: `hermes mcp login knowtation` from an interactive terminal; use paste-back or SSH forward.

## Secrets policy

This note contains **no** tokens, client secrets, refresh values, or Hostinger credentials.

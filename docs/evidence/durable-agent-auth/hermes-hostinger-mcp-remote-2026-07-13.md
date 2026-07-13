# Hermes Hostinger — verified mcp-remote path (2026-07-13)

**Date:** 2026-07-13  
**Context:** Born Free co-founder (Hostinger Managed Hermes + Telegram “BF CoFounder”) → Knowtation vault under `projects/born-free/**`  
**Hermes:** upgraded **0.16.0 → 0.18.2** (`pip install --upgrade hermes-agent`, `/opt/venv/bin/hermes`, `HOME=/data`)  
**Verdict:** **Connection verified** via desktop `mcp-remote` OAuth + token-folder copy + Hermes stdio. Native `hermes mcp login` on Hostinger still **unreliable** (hang after paste). Phase B device authorization is the product end-state.

**Related:** Spec [`docs/DURABLE-AGENT-AUTH-SPEC.md`](../../DURABLE-AGENT-AUTH-SPEC.md) · Roadmap [`docs/DURABLE-AGENT-AUTH-ROADMAP.md`](../../DURABLE-AGENT-AUTH-ROADMAP.md) · Prior spike [`hermes-oauth-spike-2026-07-12.md`](./hermes-oauth-spike-2026-07-12.md)

---

## Simple summary

Pasting the Hub “Copy token” JWT into Hermes `.env` fails when it expires. Running OAuth login on Hostinger itself hung after the browser paste-back. What worked: complete OAuth on a normal Mac with `mcp-remote`, securely copy the token folder to the Hermes host, and run Knowtation MCP through `npx mcp-remote`. After Restart, Telegram saw **23** Knowtation tools.

## Technical summary

- Paste path (`btn-copy-hub-api-env`) is session access JWT only — no refresh.
- Public MCP: `https://mcp.knowtation.store/mcp` (not `api.knowtation.store/mcp`, not Netlify `/mcp`).
- Hostinger curls to health/discover/token were ~0.3s; hang is in Hermes completing-flow, not network.
- Working shape: Hermes `mcp_servers.knowtation` = stdio `npx -y mcp-remote https://mcp.knowtation.store/mcp` with tokens under `/data/.mcp-auth/`.

---

## Failed approaches (do NOT recommend)

1. **Copy Hub JWT** into `/data/.env` as `KNOWTATION_HUB_TOKEN` — Hub health OK; vault REST/MCP **401**; access JWT expires; no refresh on paste path.
2. **Wrong MCP URL:** `https://api.knowtation.store/mcp` + Bearer / `X-Vault-Id` in `config.yaml` — must be `https://mcp.knowtation.store/mcp`.
3. **`hermes mcp login knowtation` with `auth: oauth` on Hostinger** — paste-back of callback/`?code=&state=` accepted (“completing flow”), then hang ~120–325s; **no** tokens under `~/.hermes/mcp-tokens/`. Upstream OAuth probe timeout history: NousResearch/hermes-agent#24097 (improved in recent Hermes; Hostinger still hung on completing-flow in this incident).
4. **lshell limits** on Hostinger web CLI (`nano +540`, multi-line heredocs) — use agent Allow Once / python edits.
5. **No File Manager** in Managed Hermes hPanel — upload via Open App / Telegram paperclip.
6. **Dual Hermes CLI tabs** → “Another CLI session is already active”.

---

## Verified working recipe (interim until Phase B is live for the agent)

1. Upgrade Hermes: `pip install --upgrade hermes-agent` → **≥ 0.18.2**.
2. On a **desktop Mac** (loopback works):

   ```bash
   npx -y mcp-remote https://mcp.knowtation.store/mcp
   ```

   Complete browser OAuth. Tokens land in `~/.mcp-auth/mcp-remote-0.1.37/` (version may differ), e.g. `{hash}_tokens.json`, `_client_info.json`, `_code_verifier.txt`, `_lock.json`.

3. Pack (no secrets in chat):

   ```bash
   tar czf ~/mcp-auth-knowtation.tgz -C ~ .mcp-auth/mcp-remote-0.1.37
   ```

4. Upload tarball to Hostinger `/data/` via Open App / Telegram paperclip. Agent: save as `/data/mcp-auth-knowtation.tgz`, `tar xzf` under `/data`, `ls` filenames only — **never print token contents**.

5. Hermes `/data/config.yaml` knowtation block (final working shape):

   ```yaml
   mcp_servers:
     knowtation:
       command: npx
       args:
         - -y
         - mcp-remote
         - https://mcp.knowtation.store/mcp
       timeout: 120
       connect_timeout: 60
       enabled: true
   ```

   Remove `url`, `auth: oauth`, and Bearer headers for knowtation. Leave unrelated servers alone.

6. Hostinger dashboard → **Restart** Hermes.

7. Telegram: “List Knowtation MCP tools…” → **23 tools** connected (search, relate, backlinks, extract_tasks, cluster, tag_suggest, get_note, get_note_outline, get_document_tree, get_metadata_facets, get_section_source, list_notes, write, hub_create_proposal, capture, transcribe, index, vault_sync, import, import_url, export, summarize, enrich).

**Note:** One search of `projects/born-free` returned no paths — may be vault id / empty folder / indexing. **Connection itself verified.**

---

## Loopback vs Hostinger callback (UX clarification)

Browser “Authorization successful” on `http://localhost:<port>/oauth/callback` is served by the **machine running the browser’s loopback listener**. Starting the flow from Hostinger CLI does **not** mean Hostinger received the callback unless paste-back/tunnel delivers the code to that process. Mac success can coexist with Hostinger still waiting.

After Mac `mcp-remote` shows “Proxy established / Press Ctrl+C to exit”, **Ctrl+C is fine** once tokens are on disk; the proxy need not keep running for the copy-tokens approach.

---

## Secrets policy

This note contains **no** JWTs, refresh tokens, Hostinger credentials, or token-file contents. Treat `~/.mcp-auth/` / `/data/.mcp-auth/` as secrets (mode `0600`); copy via secure tarball/upload — never paste JSON into Telegram.

---

## Product follow-through

| Path | Status |
| --- | --- |
| Phase A durable MCP OAuth refresh | **DONE** (Cursor / OAuth-capable clients) |
| Interim mcp-remote + folder copy | **Verified** (this note) — document in AGENT-INTEGRATION |
| Phase B Hub Connect cloud agent (RFC 8628) | **Build** — primary non-painful cloud connect |
| Composio catalog packaging | **Future** only — not required for vault auth |

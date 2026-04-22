# Evaluation: MCP tool “summarize pasted blob” (hosted parity)

**Date:** 2026-04-21  
**Outcome:** **Do not ship** a hosted MCP tool that accepts an arbitrary user-supplied blob and returns an LLM summary inside Knowtation’s gateway.

---

## Goal that was considered

A tool mirroring “paste a wall of text → get a short summary” for **hosted** MCP, analogous to local workflows where the **client** model summarizes text the user already pasted into chat.

---

## Findings (code and product boundaries)

1. **Auth and tenancy**  
   Hosted MCP already binds sessions to **JWT + vault id** (`hub/gateway/mcp-hosted-server.mjs`, `getHostedAccessContext`). A blob tool would still run **inside that tenant**, but the **input is not vault-scoped** until written to a note. Any bug in size limits or logging could leak **cross-request patterns** (operator logs, support exports) unless carefully redacted. Vault-scoped summarization today goes through **`summarize`** on a **path** with existing ACL (`hub/gateway/mcp-tool-acl.mjs`).

2. **Rate limits**  
   The gateway applies **per-user** limits on `/mcp` (documented in `docs/AGENT-INTEGRATION.md`). A blob summarizer becomes a **cheap LLM proxy**: attackers send huge bodies to burn **CPU, egress, and provider quotas** without touching the vault. Mitigations (strict byte caps, per-tool quotas, billing hooks) duplicate work already distributed between **bridge billing** and **client-side** summarization.

3. **Billing / credits**  
   Hosted **`summarize`** for notes uses **sampling** or configured server-side models with existing cost paths. A generic blob endpoint needs a **defined billing class** (per token? per request?) and alignment with **`runBillingGate`** on other expensive routes. Without that, it is either **loss-making** or **inconsistent** with other gated operations.

4. **Payload caps and abuse**  
   Enforcing a cap (e.g. 32 KiB) avoids the worst cases but **does not** remove abuse: many small requests still stress the gateway. **Compression bombs** and **pathological Unicode** still need parsing guards. Meeting-style summarization is already covered by the **`meeting-notes`** prompt (user-supplied transcript) with a **known** shape and existing prompt registration patterns.

5. **Parity vs local**  
   Self-hosted agents typically summarize **in the IDE** or via **sampling** without a dedicated “blob” tool. Adding a hosted-only blob tool **diverges** from the security model “read paths from the vault, don’t ingest arbitrary internet text into server-side LLM without review.”

---

## Decision

**No new MCP tool** for arbitrary pasted-blob summarization on hosted Knowtation in this phase.

**Alternatives (already supported):**

- Summarize **vault notes** via hosted MCP **`summarize`** (path + role ACL).  
- Paste transcripts into the **`meeting-notes`** prompt (bounded transcript slice in `mcp/prompts/register.mjs`).  
- Summarize **terminal or tool output locally** on the coding host (per `docs/TOKEN-SAVINGS.md` — terminal-side tooling is not a hosted product surface).

If this is revisited, treat it as **H0–H4** in `docs/PARITY-MATRIX-HOSTED.md`: explicit byte caps, abuse rate tier, billing class, and parity with any Hub UI that performs the same operation.

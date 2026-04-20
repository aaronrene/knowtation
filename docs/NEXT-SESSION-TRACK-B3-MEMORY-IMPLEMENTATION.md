# Next session: Track B3 — hosted memory prompts (implementation)

**Branch for this phase:** `feat/b3-memory-prompts-implementation` (from `main` after PR **#177**).  
**Policy:** Do **not** push or open a **docs-only** PR to `main`. Commit work on this branch; push and open **one** PR to `main` when **code + tests + docs** for this phase are ready (billing rule: avoid merge churn for documentation alone).

---

## Plain language — what this phase accomplishes

Today, **Knowtation in the browser (Hub)** and the **bridge** can read and write a per-user, per-vault **memory log** (things that happened: searches, writes, consolidation passes, and so on). **Cursor’s hosted MCP** can list notes and search the vault, but it **does not yet expose the three “memory-aware” prompts** that the self-hosted MCP has: short context from recent memory, search guided by memory, and “resume where we left off.”

This phase **wires those three prompts into the hosted gateway** using **`GET /api/v1/memory`** for the event log and, where self-hosted does, **vault** **`POST /api/v1/search`**—no second copy of security or storage rules inside Cursor.

### Decided scope: `POST /api/v1/memory/search` stub vs this branch

**Recommendation:** Ship **B3 on this branch without** implementing **`POST /api/v1/memory/search`**. Self-hosted **`memory-informed-search`** uses **vault search** plus **`GET`-style memory listing filtered by `type=search`**, not `POST …/memory/search`. The bridge stub is a **separate** “semantic search inside the memory store” feature—defer to a **later branch** with explicit rate limits, tenant isolation, and cost controls.

**Success in one sentence:** Hosted MCP **`prompts/list`** shows **13** prompts for editor/admin (**12** for viewer), and the memory trio matches self-hosted behavior using **`GET /api/v1/memory`** and vault **`POST /api/v1/search`** for **`memory-informed-search`**—without relying on **`POST /api/v1/memory/search`**.

---

## Jargon — map to the plain story

| Term | Meaning here |
|------|----------------|
| **Track B3** | Third batch of hosted prompts: `memory-context`, `memory-informed-search`, `resume-session`. |
| **`registerPrompt`** | MCP SDK call in `hub/gateway/mcp-hosted-server.mjs` that defines a named prompt, its Zod args, and handler. |
| **`upstreamFetch`** | Gateway helper that calls bridge/canister with the session JWT and `X-Vault-Id` (same pattern as `search`, `list_notes`). |
| **`bridgeFetchOpts`** | Options bundle: token, vault id, effective user id for bridge—must match existing tools. |
| **H0 / parity** | Written contract: routes, auth, JSON shapes—already documented in `HOSTED-HUB-MCP-INTERLOCK.md` § Track B3 prep and `PARITY-MATRIX-HOSTED.md` § Agent memory; PR **#177** added tests for gateway → bridge proxy. |
| **Stub `POST …/memory/search`** | Separate from B3 prompts: semantic search **inside** the memory event store; still returns empty `results` until a **later** bridge/gateway phase implements it. **Do not** use this endpoint for `memory-informed-search`—use **`GET …/memory?type=search`** + vault **`POST …/search`** instead (self-hosted parity). |
| **`formatMemoryEventsAsync`** | `mcp/prompts/helpers.mjs` helper used by self-hosted prompts to turn event lists into markdown lines—hosted should produce the **same line shape** from bridge JSON (`type`, `ts`, `data`). |

---

## Read before coding (order)

1. `docs/HOSTED-HUB-MCP-INTERLOCK.md` — § **Track B3 prep — hosted agent memory HTTP (H0 contract)**
2. `docs/PARITY-MATRIX-HOSTED.md` — § **Agent memory**
3. `mcp/prompts/register.mjs` — memory prompt blocks (reference only for copy and behavior)
4. `mcp/prompts/helpers.mjs` — `formatMemoryEventsAsync`
5. `hub/gateway/mcp-hosted-server.mjs` — existing `registerPrompt` patterns (B1/B2)
6. `hub/gateway/mcp-tool-acl.mjs` — `HOSTED_PROMPT_IDS`, `PROMPT_MIN_ROLE`
7. `hub/bridge/server.mjs` — memory routes (read **`GET /api/v1/memory`**; understand **`POST /api/v1/memory/search`** stub only for future phase, not B3 parity)
8. `test/mcp-hosted-prompts.test.mjs` — golden prompt lists
9. `test/gateway-memory-bridge-proxy.test.mjs` — gateway proxy smoke

---

## Paste this into a **new Cursor session** (implementation)

```
You are implementing Track B3 for hosted MCP: the three memory prompts with self-hosted parity (GET /api/v1/memory + vault POST /api/v1/search for memory-informed-search). Do NOT block on implementing POST /api/v1/memory/search (memory-store semantic search)—that is a separate later phase.

## Branch and merge policy
- Work on: feat/b3-memory-prompts-implementation (from main; includes PR #177 Track B3 prep).
- Do NOT open a PR to main for documentation alone. Ship code + tests + doc updates in one PR when the feature is ready.
- Unless the user explicitly asks, do not push or open a PR from this agent run.

## Goal (product)
Expose on knowtation-hosted the same three memory-related prompts self-hosted has:
- memory-context
- memory-informed-search
- resume-session

They must use hosted HTTP only: upstreamFetch for GET /api/v1/memory (and query variants), and existing bridge search for vault hits where the self-hosted prompt uses runSearch. No disk lib/memory in the gateway. Do not call POST /api/v1/memory/search for memory-informed-search unless you are explicitly implementing that future phase.

## Goal (technical)
1. hub/gateway/mcp-hosted-server.mjs — registerPrompt for each id; fetch GET /api/v1/memory (and variants) with bridgeFetchOpts; format events for prompt text consistent with formatMemoryEventsAsync (type, ts, data — JSON snippet cap like local).
2. hub/gateway/mcp-tool-acl.mjs — add the three ids to HOSTED_PROMPT_IDS; set PROMPT_MIN_ROLE (default viewer if read-only memory text only; raise if any prompt implies writes).
3. test/mcp-hosted-prompts.test.mjs — golden prompts/list: 13 prompts for roles that receive all B3 prompts; extend getPrompt tests for at least one memory prompt with mocked upstream memory JSON.
4. memory-informed-search: mirror register.mjs — vault search via upstreamFetch POST /api/v1/search; recent “search” memory events via GET /api/v1/memory?type=search&limit=… (not POST /api/v1/memory/search). Document in playbook that POST /api/v1/memory/search remains a future “memory store semantic search” phase.
5. Docs in the same eventual PR as code: HOSTED-MCP-TOOL-EXPANSION.md, PARITY-MATRIX-HOSTED.md, HOSTED-HUB-MCP-INTERLOCK.md (H3/H4 for B3), docs/NEXT-SESSION-HOSTED-HUB-MCP.md, and this file.

## Verification (before any merge to main)
npm run verify:hosted-mcp-checklist
npm test

## References
- docs/NEXT-SESSION-TRACK-B3-MEMORY-IMPLEMENTATION.md (this handoff)
- docs/HOSTED-HUB-MCP-INTERLOCK.md (H0 memory contract)
- docs/PARITY-MATRIX-HOSTED.md (Agent memory table)
```

---

## Related

- Main handoff: [`NEXT-SESSION-HOSTED-HUB-MCP.md`](./NEXT-SESSION-HOSTED-HUB-MCP.md)
- PR **#177** (merged): Track B3 **prep** — H0 docs + `test/gateway-memory-bridge-proxy.test.mjs`

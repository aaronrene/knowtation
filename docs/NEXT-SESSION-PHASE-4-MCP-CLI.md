# Next session — Phase 4 (MCP + CLI bolt-ons)

**Authoritative checklist:** [HUB-WIZARD-HOSTED-STORY.md](./HUB-WIZARD-HOSTED-STORY.md) — **Phase 4** only.  
**North star / tone:** [WHY-KNOWTATION.md](./WHY-KNOWTATION.md) (token layers, proposals, honest comparisons).  
**Hosted MCP context:** [HOSTED-HUB-MCP-INTERLOCK.md](./HOSTED-HUB-MCP-INTERLOCK.md), [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) §2 (hosted MCP).  
**Prompt / tool parity reference:** [PARITY-MATRIX-HOSTED.md](./PARITY-MATRIX-HOSTED.md) — use for **naming and inventory** of hosted MCP prompts/tools; do not expand unrelated gateway work unless Phase 4 requires it.

**Branch:** `feature/hub-wizard-hosted-story` (or `main` after merge — stay consistent with your team).

**Non-goals (from checklist):** No canister-side terminal hook claims; no unprovable “nobody else” marketing.

---

## Copy-paste prompt (fresh session)

```text
Repository: knowtation (local path as opened in Cursor).
Work branch: feature/hub-wizard-hosted-story (checkout unless told otherwise).

**Authoritative plan:** docs/HUB-WIZARD-HOSTED-STORY.md — **§ Phase 4 — MCP + CLI bolt-ons** ONLY. Implement those four checklist items and update their checkboxes when done.

**Do not treat as the execution plan for this session:** docs/NEXT-SESSION-HOSTED-HUB-MCP.md or open-ended gateway refactors unless Phase 4 explicitly requires a small, scoped change.

**North star:** docs/WHY-KNOWTATION.md — token story (vault vs terminal), proposals / human gate.

---

## Phase 4 scope (four deliverables)

### 1) `knowtation://…` bootstrap MCP resource + Hub **Copy prime**

- **Goal:** A small, documented MCP **resource** URI (bootstrap / “prime”) so clients can discover vault context or setup hints without pasting long JSON; Hub Integrations gains a **Copy prime** control next to (or after) **Copy Hub URL, token & vault** where product sense dictates.
- **Investigate first:** `mcp/resources/` registration (`mcp/server.mjs`, `mcp/resources/register.mjs`), existing `knowtation://` patterns (e.g. `test/mcp-image-resources.test.mjs`, `test/mcp-hosted-resources-r1.test.mjs`, `hub/gateway/mcp-hosted-server.mjs` for hosted resources). Align hosted vs stdio behavior with INTERLOCK doc.
- **Ship:** Resource handler + tests; Hub `web/hub/index.html` + `hub.js` wiring + copy UX; docs snippet in AGENT-INTEGRATION or AI-ASSISTED-SETUP as appropriate.

### 2) `knowtation doctor`

- **Goal:** CLI subcommand **`knowtation doctor`** that reports **hosted vs self-hosted** health and common misconfigurations, grounded in docs/WHY-KNOWTATION.md **two token layers** (vault retrieval vs terminal tooling — do not imply canister runs shell hooks).
- **Investigate first:** `cli/index.mjs` (or equivalent entry), existing env/config resolution (`config/local.yaml`, env vars used by Hub/MCP). Output should be machine-friendly (`--json`) and human-readable.
- **Ship:** Command + tests + short doc section (README or RETRIEVAL-AND-CLI-REFERENCE / new DOCTOR.md if justified).

### 3) Evaluate: MCP tool **summarize pasted blob** (hosted parity)

- **Goal:** Written **evaluation** (and only implement if the evaluation concludes go): auth, rate limits, billing/credits, payload caps, abuse model for a tool that accepts an arbitrary blob and returns a summary. If **no ship**, document decision and checklist checkbox note.
- **Investigate first:** `hub/gateway/mcp-tool-acl.mjs`, `mcp-hosted-server.mjs`, existing `summarize`-style tools in `mcp/tools/`, parity matrix hosted tool list.
- **Ship:** Either a minimal gated tool + tests **or** a committed design note in docs + checklist update.

### 4) Surface MCP prompts in docs + wizard

- **Goal:** Hosted (and where relevant, local) **MCP prompt names** and when to use them appear in **docs** and in **`web/hub/`** wizard or Integrations copy — names such as `temporal-summary`, `resume-session`, etc., per PARITY-MATRIX-HOSTED.md inventory; keep copy honest (no prompts that are not actually registered on the user’s deployment).
- **Investigate first:** `mcp/prompts/register.mjs`, hosted prompts list in gateway, existing wizard step `web/hub/onboarding-wizard.mjs` “Power tools” section, docs/AGENT-INTEGRATION.md §2.
- **Ship:** Doc edits + wizard/Hub copy + tests if strings are asserted.

---

## Verification

- Run **`npm test`** (full suite) before commit.
- If you add gateway or MCP server behavior, run any existing **`scripts/verify-hosted-mcp-checklist.mjs`** or targeted tests referenced in repo docs.
- **Git:** Commit in logical chunks with clear messages. Do **not** merge to `main` unless the user asks. Bundle checklist updates (`docs/HUB-WIZARD-HOSTED-STORY.md`) with code per repo rules.

---

## Suggested read order (first hour)

1. `docs/HUB-WIZARD-HOSTED-STORY.md` — Phase 4 checkboxes  
2. `docs/WHY-KNOWTATION.md` — token section (for `doctor` copy)  
3. `docs/HOSTED-HUB-MCP-INTERLOCK.md` — Hub vs MCP gateway boundaries  
4. `docs/PARITY-MATRIX-HOSTED.md` — MCP prompts/tools inventory  
5. `mcp/server.mjs` + `hub/gateway/mcp-hosted-server.mjs` — where to register resources/tools  
6. `web/hub/onboarding-wizard.mjs` — wizard step that mentions MCP prompts today  
7. `cli/index.mjs` — where to hang `doctor`
```

---

## After this session

Update [HUB-WIZARD-HOSTED-STORY.md](./HUB-WIZARD-HOSTED-STORY.md) Phase 4 checkboxes and, if scope bleeds into docs-only follow-ups, tie them to **Phase 5** instead of leaving orphan tasks.

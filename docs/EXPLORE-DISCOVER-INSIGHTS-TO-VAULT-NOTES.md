# Explore: Discover insights → vault notes (human-visible)

**Status:** exploration only — no implementation in this session.  
**Audience:** future branch work + product/design alignment.  
**Related code:** `lib/memory-consolidate.mjs` (`runDiscoverPass`, `consolidateMemory`), bridge `POST /api/v1/memory/consolidate`, Hub Settings → Consolidation, `docs/DAEMON-CONSOLIDATION-SPEC.md`, `docs/MEMORY-CONSOLIDATION-GUIDE.md`.

---

## 1. What exists today

- **Discover** runs **after** Consolidate, only when `daemon.passes.discover` / Hub equivalent is on.
- Input is **the consolidation outputs from the current run** (topic + distilled facts), not arbitrary vault-wide search by keyword.
- Output is **`mm.store('insight', { connections, contradictions, open_questions, topic_count })`** — a **memory event**, not a Markdown note.
- Hub product copy states Discover **augments memory, not a separate Hub screen** (`web/hub/index.html`). Humans mainly benefit when **agents** pull memory (e.g. MCP prompts) or when operators query the memory API.

**Implication:** “Discover by arbitrary word/theme across the whole vault” is **not** what the current pass does; that would be a **different feature** (semantic search + LLM synthesis) or a **second stage** that feeds Discover-like prompts from non-memory sources.

---

## 2. Product goal (what you asked for)

1. **Materialize** cross-topic insights so **humans** can read them in the normal vault (notes list, search, backlinks).
2. Support **automatic** (every consolidation that produces insights) and/or **on demand** (button, CLI, MCP tool).
3. Optional **criteria**: tag, project slug, folder prefix, keyword filter on *topics or facts*, minimum topic count, “only if open_questions non-empty”, etc.
4. **Hosted parity:** same behavior and settings whether consolidation runs on **local daemon** or **hosted Hub/bridge** schedule.

---

## 3. Design options (matrix)

| Dimension | Option A | Option B | Option C |
|-----------|----------|----------|----------|
| **Write target** | New note under e.g. `inbox/discover/YYYY-MM-DD-<id>.md` | Append section to a single **log note** `memory/discover-log.md` | **Proposal** instead of direct write (review before note exists) |
| **Trigger** | Always when `insight` event stored | Hub toggle “Also create vault note” | MCP / CLI `knowtation memory materialize-insights` |
| **Dedup** | Hash `(connections, contradictions, open_questions)` skip if unchanged | Always append (noisy) | Weekly digest merges into one note |
| **Criteria** | Config only (global) | Per-vault Hub settings JSON | Frontmatter on a “subscription” note agents read |

**Recommendation for v1:** **Option A + proposal path (C)** for hosted teams that want gates: materialize as **`POST /api/v1/proposals`** to a fixed path pattern `inbox/insights/discover-<pass_id>.md` with `intent: discover` — approver becomes the human filter. For power users / local: optional **direct write** to `inbox/discover/` with a setting flag.

---

## 4. “Criteria / word / theme” — two different problems

**A) Criteria on the existing Discover pass (cheap)**  
Filter **whether** to create a note from an insight event:

- `topic_count >= N`
- Non-empty `open_questions` or `contradictions`
- Substring match on **serialized** connections/questions (simple “keyword”)
- Encrypt mode: topic names only — criteria may be weaker; document privacy.

**B) Theme-driven discovery across the vault (expensive, new)**  
Not the same as current Discover:

- Run **search** (semantic or keyword) for a theme, bundle top-K snippets, call LLM → **insight-shaped** or **brief** output → note/proposal.
- That reuses **retrieval**, not only **memory events**.

**Plan:** label **A** as “Discover materialization” and **B** as “Thematic insight job” so scope does not creep in one PR.

---

## 5. Implementation sketch (engineering)

### 5.1 Core hook (shared local + hosted)

After `runDiscoverPass` returns (or inside it when `!dryRun`), if a new flag `daemon.discover.write_vault_note` / `discover_materialize` is true:

1. Build Markdown body from `{ connections, contradictions, open_questions, topic_count }` + optional links to consolidation `pass_id` / timestamps.
2. Choose path: `inbox/discover/${isoDate}-${passId}.md` or configurable prefix in `config/local.yaml` + Hub persisted prefs.
3. **Write path:**
   - **Local:** `writeNote` to vault + `knowtation index` hook or defer to next index.
   - **Hosted:** call existing **bridge/gateway** note write or **proposal** API with service identity or user JWT (must match **role** and **billing** rules — a server-side “system” writer may need a new internal path).

### 5.2 Files likely touched (indicative)

- `lib/memory-consolidate.mjs` — post-discover materialization hook; keep pure enough to unit test.
- `lib/config.mjs` — new keys under `daemon.passes` or sibling `discover_materialize: { enabled, mode: proposal|note, path_prefix, min_topic_count, … }`.
- `hub/bridge/server.mjs` — hosted consolidation response already includes `discover`; extend to optional note/proposal create + **cost** attribution.
- `hub/gateway` — persist settings; scheduler payload includes new flags.
- `web/hub/index.html` + `hub.js` — Settings UI: toggles + path prefix + “proposal vs direct” (if product agrees).
- **Tests:** `test/` for consolidate dry-run; bridge integration mock for “insight → proposal payload”.

### 5.3 Hosted parity checklist

- [ ] Same **JSON shape** for discover settings in local YAML and hosted user prefs.
- [ ] **One consolidation pass** billing story unchanged (Discover already bundled); **extra vault write** might need a new meter or be folded under “note write” (product decision).
- [ ] **AIR / attestation** if writes are compliance-sensitive: link `insight` event id to note frontmatter `source_memory_event_id`.
- [ ] **Encrypt mode:** redact or skip materialization if body would leak ciphertext-derived content.

---

## 6. Complexity (rough)

| Slice | Effort | Risk |
|-------|--------|------|
| Local only: after Discover, write `inbox/discover/*.md` | **S** (1–2 days) | Note spam; needs dedup |
| + Hub Settings + bridge write | **M** (3–5 days) | Auth, roles, vault_id, error handling |
| Proposals instead of direct write | **M** | UX: many small proposals |
| Criteria v1 (thresholds + keyword on output) | **S–M** | Edge cases on empty LLM parse |
| Thematic vault-wide job (search-driven) | **L** | Retrieval cost, hallucination guardrails |
| MCP tool `materialize_insights` | **S** | Duplicates UI/CLI |

---

## 7. Risks and mitigations

- **Noise:** default **proposal** or **weekly digest** note; cap files per day.
- **Wrong “facts”:** frontmatter `generated_by: discover`, `human_review: required`, link to raw `insight` event id.
- **PII in insights:** respect `memory.encrypt`; optional disable materialization when encrypt on.
- **Drift local vs hosted:** single implementation function in `lib/` called from daemon CLI **and** bridge consolidate handler.

---

## 8. Suggested phased roadmap

1. **Phase 0 — Spec lock:** product picks default path (`inbox/discover/` vs proposals), and whether **B** (thematic job) is in scope.
2. **Phase 1 — Local materialization:** config flag + Markdown writer + tests; manual `knowtation consolidate` or daemon.
3. **Phase 2 — Hosted:** bridge calls shared helper; Settings persisted; smoke on staging vault.
4. **Phase 3 — Criteria:** min topics, non-empty questions, optional keyword allowlist.
5. **Phase 4 — Optional:** MCP + Hub button “Run thematic insight…” (separate from Discover).

---

## 9. Session prompt (copy for a future Cursor / planning branch)

Use when opening a **new** implementation or design session:

```text
Read docs/EXPLORE-DISCOVER-INSIGHTS-TO-VAULT-NOTES.md in the Knowtation repo. Goal: design + implement Phase 1 (local) optional vault note materialization after runDiscoverPass, with tests; sketch Phase 2 bridge/gateway parity. Constraints: do not change default behavior when flags off; respect memory.encrypt; prefer shared lib helper used by daemon and (later) bridge. Deliver: short ADR or update to DAEMON-CONSOLIDATION-SPEC.md, code + tests, and a manual test checklist for hosted parity follow-up.
```

---

## 10. Open questions for product (answer before coding)

1. Should materialized insights be **proposals** (safer) or **direct notes** (faster) by default on hosted?
2. Max **notes per day** / per consolidation run?
3. Is **thematic vault search** in scope for v1 or a separate epic?
4. Should consolidated topics be **linkable** to vault paths automatically (Verify pass already knows paths — optional enrichment)?

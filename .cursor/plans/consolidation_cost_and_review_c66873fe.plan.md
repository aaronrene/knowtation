---
name: Token savings (branch + docs + UI)
overview: >-
  Billing: leave Discover inside one pass (no extra pass charge); revisit pricing only if usage strains margin — see TOKEN-SAVINGS.md. Docs + README done; remaining work is code/UI (requires Agent mode in Cursor). Phased sessions below.
todos:
  - id: branch-token-savings
    content: Work from git branch feature/token-savings
    status: completed
  - id: docs-token-savings-md
    content: >-
      docs/TOKEN-SAVINGS.md + README + docs/README links — phased checklist inside doc
    status: completed
  - id: advanced-settings-selfhosted
    content: >-
      Self-hosted — extend GET/POST /api/v1/settings/consolidation (hub/server.mjs) to read/write lookback_hours, max_events_per_pass, max_topics_per_pass, daemon.llm.max_tokens; extend GET /api/v1/settings daemon payload; Hub UI Advanced section + consolidation-ui-logic.mjs + tests
    status: completed
  - id: advanced-settings-hosted
    content: >-
      Hosted — add billing user fields (normalizeBillingUser, defaultUserRecord); POST /api/v1/settings/consolidation (gateway) save/load; GET settings merge into daemon display; consolidation-scheduler pass lookback + max opts in JSON body; bridge /memory/consolidate merge body with user defaults; tests
    status: completed
  - id: encrypt-consolidate-implement
    content: >-
      Encrypt-aware consolidate redaction — when memory.encrypt true, omit raw e.data from buildConsolidationPrompt (minimal lines only); tests; hosted bridge sets memory.encrypt when applicable
    status: completed
  - id: hub-privacy-copy
    content: Reconcile web/hub/index.html Memory consolidation Privacy section with actual behavior + TOKEN-SAVINGS.md
    status: completed
  - id: hub-howto-token-savings
    content: Hub How to use — Token savings tab/section + links to doc
    status: completed
  - id: hub-settings-intro-agents
    content: Settings Consolidation intro link + Agents/Integrations token blurb
    status: completed
  - id: hub-surface-discover
    content: >-
      Surface Discover + hosted billing truth — one POST /memory/consolidate = one pass + one COST_CENTS consolidation charge; Discover is extra LLM inside same run (not a second pass); Settings/Integrations/How to use + TOKEN-SAVINGS.md
    status: completed
  - id: audit-hosted-mcp-search
    content: Hosted MCP POST search + parity fields (fields, snippet_chars, count_only)
    status: completed
  - id: run-tests-manual
    content: Full test run + consolidation dry_run hosted and self-hosted
    status: pending
  - id: launch-checklist
    content: Pre-launch security/privacy table (subprocessors, tokens, logs)
    status: pending
isProject: false
---

# Token savings — final plan (backend facts, encrypt, privacy, phases)

## Product decisions (locked for now)

- **Discover + hosted billing:** Keep current behavior — **one** consolidation pass / **one** metered hit per `POST /memory/consolidate`; Discover is extra LLM work **inside** the same run. **No code change** to billing for Discover unless metrics later justify it.
- **Margin / “enough to absorb power users”:** The repo does not contain cost-of-goods or revenue; **whether** margin is sufficient is a **business** call. Structurally, power users with Discover on increase **provider token spend** while consuming the **same** pass count; monitor usage and revisit **TOKEN-SAVINGS.md** “Pricing may be revisited” if needed.

## Phased work — new chat sessions and model choice

| Phase | What | New session? | Model / review |
|-------|------|----------------|----------------|
| **A** | Hub HTML/JS: How to use “Token savings”, Settings intro, Integrations/Agents blurb, Discover + billing copy, privacy paragraph | Optional new chat | Default agent is fine |
| **B** | `lib/memory-consolidate.mjs` encrypt-aware `buildConsolidationPrompt` + tests; bridge `CONSOLIDATION_MEMORY_ENCRYPT` | Same or new | Default + run `npm test` |
| **C** | Self-hosted Advanced: `hub/server.mjs` GET/POST + Hub form + `consolidation-ui-logic.mjs` + tests | New chat if tired | Default |
| **D** | Hosted Advanced: billing fields, gateway, scheduler, bridge body merge | **Prefer dedicated session** | **Stronger model or human** — billing mistakes are high impact |
| **E** | Hosted MCP search POST + parity fields | Dedicated session | Stronger model or careful manual API test |
| **F** | Pre-launch security / privacy audit | Separate | **Human or Opus-class** for policy copy |

**All phases** can land on **`feature/token-savings`** (rebase/merge between sessions).

## Cursor: Agent mode required for code

Markdown updates are done (`docs/TOKEN-SAVINGS.md`, `README.md`, `docs/README.md`). Edits to **`.mjs`, `.html`, tests** were **blocked** while the workspace stayed in plan-only mode. **Switch to Agent mode** (or apply patches locally) to implement phases A–E.

---

## Backend reality check — Advanced knobs (“do now” scope)

**Your deployment stack (self-hosted Hub, hosted gateway, bridge, AWS MCP) does not, by itself, mean these four settings are already saved.** What the repo does today:

| Surface | Persisted today | lookback / max events / max topics / max_tokens |
|---------|-----------------|--------------------------------------------------|
| **Self-hosted** [`hub/server.mjs`](hub/server.mjs) `POST /api/v1/settings/consolidation` | Writes `config/local.yaml` under `daemon:` | **Not in handler** — only `enabled`, `interval_*`, `idle_*`, `run_on_start`, `max_cost_per_day_usd`, `passes`, `llm` (provider/model/base_url). **No `lookback_hours`, `max_events_per_pass`, `max_topics_per_pass`, `llm.max_tokens` in YAML from UI.** |
| **Self-hosted** `GET /api/v1/settings` | Returns subset of `daemon` | **Omits** lookback / max_events / max_topics / `llm.max_tokens` from the JSON shape (so UI cannot show current values without extending GET). |
| **Hosted** [`hub/gateway/server.mjs`](hub/gateway/server.mjs) `POST /api/v1/settings/consolidation` | Billing DB user record | **Only** `consolidation_enabled`, `consolidation_interval_minutes`, `consolidation_passes` ([`normalizeBillingUser`](hub/gateway/billing-logic.mjs)). **No fields for lookback or caps.** |
| **Hosted scheduler** [`netlify/functions/consolidation-scheduler.mjs`](netlify/functions/consolidation-scheduler.mjs) | Calls bridge | Body is `{ passes: user.consolidation_passes }` only — **no** `lookback_hours`, **no** max event/topic/token overrides. |
| **Bridge** [`hub/bridge/server.mjs`](hub/bridge/server.mjs) `/memory/consolidate` | Request body | Accepts `lookback_hours`; **`consolidateMemory` defaults** apply for max events/topics/tokens because `daemon: {}` and **no** `maxEventsPerPass` in opts unless added to body + scheduler. |

**Conclusion:** Infrastructure is **ready to be extended** (you are not blocked by missing servers), but **persisting and applying** Advanced knobs requires **intentional code changes**. This is **one cohesive feature**, split into two vertical slices:

1. **Slice A — Self-hosted (smaller):** Extend YAML read/write + GET response + Hub form + shared form helpers + tests. **Reasonable to ship entirely on `feature/token-savings`.**

2. **Slice B — Hosted (larger):** Billing schema + gateway save/load + scheduler JSON body + bridge reading body (and/or merging stored user defaults) + tests. **Same branch is fine** (separate commit or same PR); **separate chat/session is fine** as long as commits land on `feature/token-savings` and you merge/rebase before push. Not a “different repo branch” problem — just coordination.

**AWS MCP:** MCP transport is unrelated to **where consolidation tuning is stored**; MCP benefits from the separate **hosted MCP search POST/fields** work item.

---

## `memory.encrypt` vs consolidation — clarification

**Two different things:**

1. **`memory.encrypt` (at rest)** — Event log may be stored using an encrypted file provider ([`docs/MEMORY-AUGMENTATION-PLAN`](docs/IMPLEMENTATION-PLAN.md) / encrypted provider). That protects **disk** copies.

2. **Consolidation LLM (egress)** — [`buildConsolidationPrompt`](lib/memory-consolidate.mjs) builds lines like `[ts] type: JSON.stringify(e.data).slice(0, 300)`. Whatever is in `event.data` (paths, query strings, small structured fields, **possible snippets**) is sent to the configured chat model **unless** we redact it. **Discover** already has an `encrypt` branch (topic-only). **Consolidate does not.**

**Reasonable solution (recommended — “Big Yes” path):**

- **Product behavior:** When `config.memory.encrypt === true`, treat consolidation as **strict privacy mode for LLM egress**: **`buildConsolidationPrompt` must not include raw `e.data`**. Use a minimal line, e.g. `[ts] type: topic/slug only` or `type + redacted` (no free-form JSON). Accept that **merge quality may drop**; document that tradeoff in `TOKEN-SAVINGS.md`.

- **Optional refinement (later):** A separate flag `daemon.consolidation_include_event_payload` defaulting opposite to encrypt, only if you want encrypt-at-rest without LLM redaction — only if you explicitly want that complexity.

- **Hosted bridge:** Today [`consolidationConfig.memory`](hub/bridge/server.mjs) is `{ provider: 'file' }` with **no** `encrypt`. If hosted vaults can have encrypt semantics, bridge must set `memory.encrypt` consistently when building config (env or per-user flag) so behavior matches self-hosted.

- **Docs + UI:** One paragraph in Settings / How to use: **“Encrypted memory + consolidation: we minimize what is sent to the model.”**

---

## Hub Memory consolidation **Privacy** copy — recommendations

**Current text** ([`web/hub/index.html`](web/hub/index.html) how-to consolidation panel) claims, in effect, that only safe metadata is sent and **full note content is never sent**.

**Code fact:** Consolidation sends **truncated `JSON.stringify(e.data)`** per event, not full note files. That can still include **user-generated strings** if they were captured into event payloads (e.g. search queries, titles, fragments).

**Recommended replacement (until encrypt-redact ships):**

- State honestly: **“Consolidation sends short structured summaries derived from memory events (for example paths, types, timestamps, and small JSON snippets). It does not send your full note files as a single upload, but **event data may include fragments of text you previously captured in activity.**”**

- **“For stronger privacy:** use **self-hosted** with a **local model (Ollama)**, or **turn consolidation off**, or enable **encrypted memory + strict consolidation** (after we implement redaction).”**

**After encrypt-redact implements:**

- Tighten copy: **“With encrypted memory, consolidation prompts exclude raw event payloads; only … is sent.”** (List exactly what remains, matching code.)

---

## Execution order (updated — “do now” friendly)

1. **`docs/TOKEN-SAVINGS.md`** — three levers, Advanced knobs table, encrypt/egress subsection, hosted vs self-hosted differences.

2. **Slice A — Self-hosted Advanced settings** — API + YAML + GET shape + UI + tests.

3. **`memory.encrypt` + `buildConsolidationPrompt`** + bridge `memory.encrypt` if applicable + tests.

4. **Hub privacy + How to use + Settings intro + Agents blurb** — align copy with code.

5. **Slice B — Hosted Advanced settings** — billing fields + gateway + scheduler + bridge body + tests.

6. **Hosted MCP search** audit/fix.

7. **Manual dry runs** (hosted + self-hosted) + full test suite.

**Same branch:** `feature/token-savings` for all slices. **Separate session:** fine for Slice B if you want parallel work; rebase/merge before release.

---

## Discover pass — what it is, defaults, guidance (for docs + UI)

**What it does (simple):** After **Consolidate** turns many raw events into a few **topic fact lists**, **Discover** runs **one extra AI call** that reads those summaries and writes an **`insight`** memory event: suggested **connections between topics**, **contradictions**, and **open questions**. It does **not** replace Consolidate; it **adds a layer of “meta” notes** across topics.

**Off vs on — what changes in output:** With Discover **off**, you only get **consolidation** facts per topic + **verify** maintenance. With Discover **on**, you also get **periodic insight events** (cross-topic commentary). If Consolidate produces nothing in a run (no qualifying topics), Discover does not run.

**Default — hosted:** [`defaultUserRecord`](hub/gateway/billing-logic.mjs) / [`normalizeBillingUser`](hub/gateway/billing-logic.mjs) set `consolidation_passes.discover` to **`false`**. Gateway GET builds `passes` from that. **Hosted default = Discover off.**

**Default — self-hosted / daemon:** [`resolvePassNames`](lib/memory-consolidate.mjs) adds `discover` only when `daemon.passes.discover === true`. If YAML omits it, Discover is **off**.

**Should we encourage on or off?** **Default stance: off** for **cost and predictability** (one fewer model call per pass; passes already consume plan quota on hosted). **Encourage on** for users who explicitly want **synthesis across topics** and accept **extra tokens + slightly more “opinionated” AI output**. Copy should never imply Discover is required.

**How much difference (cost):** One **additional** chat completion per consolidation run **when** Consolidate wrote at least one topic; input size scales with **number of topics consolidated in that run** and fact text (capped by `max_topics_per_pass` and model `max_tokens`). Rough magnitude: same order as **one** extra consolidate batch — see [`docs/DAEMON-CONSOLIDATION-SPEC.md`](docs/DAEMON-CONSOLIDATION-SPEC.md) cost table for LLM passes (Discover is another pass in that spirit).

**Hosted billing — is Discover a second “pass” or a freebie?** **Neither.** Billing keys off **one HTTP request**: `POST …/memory/consolidate` ([`operationFromRequest`](hub/gateway/billing-middleware.mjs) → `op === 'consolidation'`). Each such request increments **`monthly_consolidation_jobs_used` by 1**, applies the **monthly pass cap / pack pass** logic once, and deducts **`COST_CENTS.consolidation`** (currently **5¢** per op when billing applies — [`billing-constants.mjs`](hub/gateway/billing-constants.mjs)) via [`tryDeduct`](hub/gateway/billing-logic.mjs). **Discover runs inside the same bridge call** as Consolidate/Verify ([`consolidateMemory`](lib/memory-consolidate.mjs)); it does **not** issue a second proxied request, so the user is **not** charged **two** pass allotments for one run. **Implication:** A power user with Discover on still consumes **one** consolidation pass per run and **one** flat credit line item per run, while **your** variable LLM spend (tokens) is **higher** than with Discover off. **Not** proportional to “file size” in the billing layer — billing is **per run**, not per token. **Docs/UI:** State explicitly: *“One scheduled or manual consolidation run counts as one pass toward your plan; enabling Discover adds extra AI work inside that same run (higher provider cost for us, same pass counter for you).”* **Optional later product change** (if margins tighten): increase `COST_CENTS.consolidation` when `passes.discover` is true, or count Discover as a fractional/extra pass — **not implemented today**; treat as a deliberate pricing decision.

**Where it is today:** Hub **Settings → Consolidation → Passes** already has **“Discover — cross-topic insights (uses more LLM tokens, optional)”** ([`web/hub/index.html`](web/hub/index.html) `pass-discover`). If you did not see it, likely **Consolidation tab** was not opened or an **older `hub.js` / cache** was loaded. **Plan:** make Discover **visible again** in **Integrations**, **How to use**, and **short helper text** next to the checkbox so it is not buried.

---

## Glossary: “encrypt-aware consolidate redaction” (simple)

**Problem:** **Encrypt at rest** protects data on disk. **Consolidation** still builds a **prompt** for the AI from event payloads. Without redaction, “encrypted memory” can feel misleading.

**Meaning of the phrase:** **Encrypt-aware consolidate redaction** = when **`memory.encrypt` is on**, the **consolidation** step **strips or avoids putting raw event `data` into the LLM prompt** (e.g. only topic + type + time). The model still runs merge logic on **minimal** lines, not full JSON blobs.

**Tradeoff:** **Privacy up, merge quality may down** (less context for the model). Document that next to the setting.

---

## Layman summary table (unchanged intent)

| Item | Plain English |
|------|----------------|
| Advanced settings | **How far back** to look, **how many events/topics** per run, **how long** the model’s answer can be — to control **cost and load**. |
| Self-hosted now | **We add** these to the same screen that already writes your `local.yaml`. |
| Hosted now | **We add** storage on your **account record** and teach the **scheduler** to pass them into each run — **new code**, not already there. |
| Encrypt + consolidate | **“Locked drawer”** (disk) vs **“what we read aloud to the AI”** — we align so **encrypt means minimal speech**, not just a locked drawer. |
| Encrypt-aware consolidate redaction | When encrypt is on, **don’t paste event contents into the consolidation prompt** — only the bare minimum labels. |
| Discover pass | **Optional** “meta” AI inside the **same** consolidation **run**; **one pass / one credit charge per run** on hosted ([`billing-middleware`](hub/gateway/billing-middleware.mjs)); **extra LLM tokens = your COGS**, not an extra pass count for the user today. |
| Privacy text | **Stop overpromising**; match what the code actually sends, then tighten again after redaction. |

---

## Review workflow

- After encrypt + copy changes: **re-read** `buildConsolidationPrompt` and bridge config paths so marketing and legal sentences stay true.
- Launch: full security table (subprocessors, XSS, logs).

# Session 10 Plan — Consolidation UI, Hosted Parity, Scheduling

**Branch:** `feature/consolidation-ui-testing`
**Branches off of:** `feature/daemon-consolidation` (Sessions 1–9, all daemon implementation)

---

## PR and Branch Situation (Clarification)

`feature/daemon-consolidation` contains **all 9 sessions of real implementation code** —
21 files changed, 8,617 insertions, 949 tests. It is absolutely ready to merge to main
and is NOT just documentation. The spec doc (`docs/DAEMON-CONSOLIDATION-SPEC.md`) was
added in Session 1 as part of writing the plan, which is normal.

The `SESSION-10-PLAN.md` file was never committed to `feature/daemon-consolidation`; it
lives only on this new branch. There is nothing in the daemon branch that would make it
a "docs only" PR — it is a complete, tested daemon implementation.

**Recommendation:** Merge `feature/daemon-consolidation` → `main` via PR now. This branch
(`feature/consolidation-ui-testing`) has been created off that exact HEAD, so all daemon
code is already here as a base to build on.

---

## Decisions Locked In

| # | Question | Decision |
|---|----------|----------|
| 1 | Billing model | Tier-included monthly pass cap + token pack overage (mirrors indexing pattern). No new billing infrastructure — just add a `consolidation` line item to existing system. |
| 2 | Cron scheduling (hosted) | **Yes, implement in Session 10.** Use Netlify Scheduled Functions — no separate server needed. |
| 3 | Settings persistence | Write back to `config/local.yaml` from the UI (same as all other settings). |
| 4 | Discover pass default | Off by default. UI makes it obvious it's an optional, higher-cost pass. |

---

## How to Test Locally (Before or After Merge)

### A. Automated Tests

```bash
node --test                              # 949 passing, 0 failures
node --test test/daemon.test.mjs         # lifecycle + Phase F cost guards
node --test test/daemon-cost.test.mjs    # cost module unit tests
node --test test/daemon-llm.test.mjs     # LLM provider resolution
node --test test/memory-consolidate.test.mjs  # core engine, verify, discover
```

### B. Manual CLI Smoke Test (needs real LLM + vault with memory events)

```bash
# config/local.yaml — minimal daemon config for testing:
# daemon:
#   enabled: true
#   interval_minutes: 5
#   idle_only: false
#   run_on_start: true
#   max_cost_per_day_usd: 0.05
#   llm:
#     model: gpt-4o-mini

knowtation memory consolidate --dry-run   # preview without writing
knowtation memory consolidate             # real pass
knowtation memory list --type consolidation
knowtation memory stats

knowtation daemon start                   # foreground (Ctrl+C to stop)
knowtation daemon status                  # check cost_today_usd + cost_cap_usd
knowtation daemon status --json
knowtation daemon log --tail 10
cat data/daemon-cost.json                 # verify cost accumulation

knowtation daemon start --background
knowtation daemon stop
```

### C. MCP Tools

```
daemon_status              → JSON with running, cost_today_usd, cost_cap_usd
memory_consolidate { "dry_run": true }    → preview
memory_consolidate { "passes": ["consolidate","verify"] } → real pass
```

### D. Cost Cap Smoke Test

Set `max_cost_per_day_usd: 0.001`, start daemon, run one pass, check log for
`cost_cap_reached` entries — daemon should keep running but skip subsequent passes.

---

## Session Status

| Stream | Title | Status |
|--------|-------|--------|
| Stream 1 | Bridge Consolidation Endpoint | ✅ Complete (committed) |
| Stream 0 | Cron Scheduling (Netlify Scheduled Function) | 🔲 Next |
| Stream 3 | MCP — consolidation_history, consolidation_settings, hosted routing | 🔲 Pending |
| Stream 2 | Hub UI — Settings tab, Dashboard card, Billing row | 🔲 Pending |
| Stream 4 | Docs — How to Use modal + MEMORY-CONSOLIDATION-GUIDE.md | 🔲 Pending |

### Stream 1 Deliverables (Done)

- `hub/bridge/server.mjs` — `POST /api/v1/memory/consolidate` + `GET /api/v1/memory/consolidate/status`
- `hub/gateway/server.mjs` — proxy both routes; `runBillingGate` on POST
- `hub/gateway/billing-middleware.mjs` — `consolidation` in `operationFromRequest`; free-tier block; counter increment
- `hub/gateway/billing-constants.mjs` — `COST_CENTS.consolidation = 5`; `CONSOLIDATION_PASSES_BY_TIER`; `COST_BREAKDOWN` entry
- `hub/gateway/billing-logic.mjs` — `monthly_consolidation_jobs_used`, `consolidation_last_pass_at`, `consolidation_interval_minutes`; `effectiveMonthlyConsolidationPassesIncluded`
- `hub/gateway/billing-http.mjs` — consolidation fields in `GET /api/v1/billing/summary`
- `hub/gateway/billing-store.mjs` — reset `monthly_consolidation_jobs_used` on period rollover
- `lib/memory-consolidate.mjs` — `opts.mm` injection in `consolidateMemory`, `runVerifyPass`, `runDiscoverPass`
- `.env.example` + `hub/bridge/.env.example` — documented `CONSOLIDATION_LLM_API_KEY`, `CONSOLIDATION_LLM_MODEL`, `CONSOLIDATION_COST_CAP_USD`
- `test/billing-consolidation.test.mjs` — 33 new tests (billing constants, logic, middleware, http, gateway integration)
- `test/bridge-consolidation.test.mjs` — 13 new tests (cost tracking, response shape, env resolution, opts.mm injection)
- **Test suite: 995 passing, 0 failing** (up from 949)

---

## Work Streams

---

### Stream 0: Cron Scheduling for Hosted (Prerequisite for Stream 1 UI)

**Why it comes first:** The hosted consolidation UI needs a schedule to show and configure.
The Netlify Scheduled Function is the engine that makes "automatic consolidation" real for
hosted users. Stream 1 (bridge endpoint) must exist first; Stream 0 wraps it.

#### What a "cron job" means here

A cron job is simply code that runs on a fixed schedule automatically — the system triggers
it without user interaction. For our Netlify setup, this is a **Netlify Scheduled Function**:
a serverless function with a schedule declaration that Netlify runs for you at the specified
interval. No separate server, no external service, no infrastructure change.

```js
// netlify/functions/consolidation-scheduler.mjs
export const config = { schedule: '0 * * * *' };  // Netlify runs this every hour
export default async (req) => {
  // 1. Load all users with consolidation enabled from billing DB
  // 2. For each user whose (last_pass_at + interval_minutes) <= now, call bridge
  // 3. POST /api/v1/memory/consolidate with server-side auth
  // 4. Log result + update last_pass_at in billing DB
};
```

#### Per-user schedule vs. global cron

The global cron runs hourly. Each user's *effective* schedule is controlled by their
`interval_minutes` setting (e.g. 60, 120, 1440 for daily). The cron function checks
each user's last pass time and only triggers users who are due. This is the same
pattern used for email digests, billing renewals, etc.

#### Files

| File | Change |
|------|--------|
| `netlify/functions/consolidation-scheduler.mjs` | New. Netlify scheduled function. Runs hourly. |
| `hub/gateway/billing-store.mjs` | Add `consolidation_last_pass_at`, `consolidation_interval_minutes`, `consolidation_enabled` fields to user record |
| `hub/bridge/server.mjs` | `POST /api/v1/memory/consolidate` (Stream 1 — required first) |

#### Complexity

Low. The scheduling logic is 30–50 lines. The heavy lifting (`consolidateMemory()`) is
already implemented. The cron function is just a loop over users + HTTP calls to the bridge.

#### Order within Session 10

1. Stream 1 (bridge endpoint) first
2. Stream 0 (scheduler) second — depends on Stream 1
3. Stream 2 (UI) last — surfaces the schedule setting

---

### Stream 1: Bridge Consolidation Endpoint (Hosted Parity)

**Goal:** `POST /api/v1/memory/consolidate` on the bridge enables hosted consolidation —
same `consolidateMemory()` function, server-side LLM key, scoped to user's vault.

**Files:**

| File | Change |
|------|--------|
| `hub/bridge/server.mjs` | Add `POST /api/v1/memory/consolidate` + `GET /api/v1/memory/consolidate/status` |
| `hub/gateway/server.mjs` | Proxy new routes to bridge (pattern: same as existing memory routes) |
| `hub/gateway/billing-middleware.mjs` | Add `consolidation` to `operationFromRequest` |
| `hub/gateway/billing-constants.mjs` | Add `COST_CENTS.consolidation` + monthly cap per tier |

**Route design:**

```
POST /api/v1/memory/consolidate
  Auth: bridgeMemoryAuth (JWT + X-Vault-Id)
  Billing: runBillingGate → operation "consolidation"
  Body: { dry_run?, passes?, lookback_hours? }
  Handler: consolidateMemory(config, opts) with CONSOLIDATION_LLM_API_KEY
  Response: { topics, total_events, verify, discover, cost_usd, pass_id }

GET /api/v1/memory/consolidate/status
  Auth: bridgeMemoryAuth
  Response: { last_pass, cost_today_usd, cost_cap_usd, pass_count_month }
```

**Billing (matching the existing indexing pattern):**

```js
// billing-constants.mjs additions
COST_CENTS.consolidation = 5;   // 5 cents per pass

// Per tier monthly pass cap (added to tier definitions)
CONSOLIDATION_PASSES_BY_TIER = {
  free:     0,     // no hosted consolidation on free
  starter: 10,
  pro:     30,
  team:   100,
};
// Overage: deducted from token pack balance. Same logic as index job overage.
```

**Server-side LLM env vars (added to `.env.example` and Netlify env):**
```
CONSOLIDATION_LLM_API_KEY=  # defaults to OPENAI_API_KEY if not set
CONSOLIDATION_LLM_MODEL=gpt-4o-mini
```

**Tests:**
- Bridge endpoint: mock LLM + mock memory manager, verify response shape
- Billing gate: consolidation operation deducts correctly, overage uses token pack
- Auth: rejects unauthenticated / wrong vault
- `GET /status` returns correct cost and last_pass fields

---

### Stream 2: Hub UI — Consolidation Dashboard and Settings

**Frontend facts:** Vanilla JS (`web/hub/hub.js`), HTML (`web/hub/index.html`), CSS (`web/hub/hub.css`).
Settings is a modal with tab panels. No React. No build step.

#### 2a. Settings Modal — New "Consolidation" Tab

Added alongside existing tabs: backup, team, vaults, integrations, appearance, billing, agents.

**HTML panel (in `index.html`):**

```html
<div id="settings-panel-consolidation" class="settings-panel">
  <h3>Memory Consolidation</h3>

  <div class="setting-row">
    <label>Mode</label>
    <div class="radio-group">
      <label><input type="radio" name="consol-mode" value="daemon"> Self-Hosted (daemon)</label>
      <label><input type="radio" name="consol-mode" value="hosted"> Hosted (Hub)</label>
      <label><input type="radio" name="consol-mode" value="off" checked> Off</label>
    </div>
    <p class="setting-desc">Self-hosted runs on your machine. Hosted uses the Hub's LLM (included in your plan).</p>
  </div>

  <!-- Daemon-only fields (hidden when mode = hosted or off) -->
  <div id="consol-daemon-settings">
    <div class="setting-row">
      <label>Interval <span class="hint">minutes between passes</span></label>
      <input type="number" id="consol-interval" value="120" min="30" max="10080">
    </div>
    <div class="setting-row">
      <label>Idle only</label>
      <input type="checkbox" id="consol-idle-only" checked>
      <span class="hint">Only run when you haven't used Knowtation recently</span>
    </div>
    <div class="setting-row">
      <label>Idle threshold <span class="hint">minutes</span></label>
      <input type="number" id="consol-idle-threshold" value="15" min="1">
    </div>
    <div class="setting-row">
      <label>Run on start</label>
      <input type="checkbox" id="consol-run-on-start">
      <span class="hint">Run one pass immediately when daemon starts</span>
    </div>
  </div>

  <!-- Hosted-only fields (hidden when mode = daemon or off) -->
  <div id="consol-hosted-settings">
    <div class="setting-row">
      <label>Schedule</label>
      <select id="consol-hosted-interval">
        <option value="60">Every hour</option>
        <option value="120" selected>Every 2 hours</option>
        <option value="360">Every 6 hours</option>
        <option value="720">Every 12 hours</option>
        <option value="1440">Daily</option>
        <option value="10080">Weekly</option>
      </select>
      <span class="hint">Hub runs consolidation automatically on this schedule</span>
    </div>
  </div>

  <!-- Shared fields -->
  <fieldset>
    <legend>Passes</legend>
    <label><input type="checkbox" id="pass-consolidate" checked> Consolidate — merge &amp; deduplicate events (recommended)</label>
    <label><input type="checkbox" id="pass-verify" checked> Verify — detect stale note references (recommended)</label>
    <label><input type="checkbox" id="pass-discover"> Discover — cross-topic insights (uses more LLM tokens, optional)</label>
  </fieldset>

  <fieldset id="consol-llm-settings">
    <legend>LLM Override <span class="hint">(self-hosted only — optional)</span></legend>
    <div class="setting-row">
      <label>Provider</label>
      <select id="consol-llm-provider">
        <option value="">auto-detect</option>
        <option value="openai">OpenAI</option>
        <option value="anthropic">Anthropic</option>
        <option value="ollama">Ollama (local, free)</option>
        <option value="openrouter">OpenRouter</option>
      </select>
    </div>
    <div class="setting-row">
      <label>Model</label>
      <input type="text" id="consol-llm-model" placeholder="e.g. gpt-4o-mini">
    </div>
    <div class="setting-row">
      <label>Base URL <span class="hint">for OpenAI-compatible endpoints</span></label>
      <input type="text" id="consol-llm-base-url" placeholder="https://openrouter.ai/api/v1">
    </div>
  </fieldset>

  <fieldset>
    <legend>Cost Guard <span class="hint">(self-hosted only)</span></legend>
    <div class="setting-row">
      <label>Daily cap (USD)</label>
      <input type="number" id="consol-cost-cap" placeholder="no limit" min="0" step="0.01">
      <span class="hint">Leave blank for no limit. Daemon skips passes once reached.</span>
    </div>
  </fieldset>

  <button id="btn-consol-save" class="btn-primary">Save Settings</button>
  <a href="#" id="link-consol-help">Learn more about Memory Consolidation ↗</a>
</div>
```

**JS logic (in `hub.js`):**

```js
// Load settings from GET /api/v1/settings → populate form
// Save: POST /api/v1/settings → write daemon section to config/local.yaml
// Mode radio change → show/hide daemon vs hosted fields
// Validate interval > 0, cap >= 0
```

#### 2b. Dashboard — Consolidation Status Card

Added to main dashboard view alongside vault stats, memory stats, etc.

```html
<div id="consolidation-card" class="dashboard-card">
  <div class="card-header">
    <h4>Memory Consolidation</h4>
    <span id="consol-status-badge">● Not configured</span>
  </div>
  <div class="card-body">
    <div id="consol-last-pass">Last pass: —</div>
    <div id="consol-next-pass">Next pass: —</div>
    <div id="consol-cost-meter" class="cost-meter">
      <span id="consol-cost-label">$0.000 today</span>
      <div class="meter-bar"><div id="consol-cost-fill"></div></div>
      <span id="consol-cost-cap-label"></span>
    </div>
  </div>
  <div class="card-actions">
    <button id="btn-consol-now">Consolidate Now</button>
    <button id="btn-consol-history">History</button>
    <button id="btn-consol-settings">Settings ⚙</button>
  </div>
</div>
```

**"Consolidate Now" flow:**
1. Shows a dry-run preview modal (what would be consolidated)
2. User confirms → calls bridge endpoint (hosted) or triggers MCP tool (self-hosted)
3. Shows progress spinner, then results summary

**"History" panel:**
- Reads `GET /api/v1/memory/consolidate/status` for hosted
- Reads `daemon_status` MCP tool + `daemon log` for self-hosted
- Table: date, events processed, topics, cost, pass duration, status (complete/error/skipped)

#### 2c. Billing Panel — Consolidation Usage Row

Extends the existing billing panel in `hub.js`:

```
Usage This Month
  Searches:        23 / 100
  Index jobs:       2 / 5
  Consolidations:   7 / 30      ← new row, from billing summary API
  Cost today:      $0.004        ← from consolidate/status endpoint
```

---

### Stream 3: MCP / Agent Accessibility

**Already working (no changes needed):**
- `daemon_status` → returns `cost_today_usd`, `cost_cap_usd`, all status fields
- `memory_consolidate` → triggers a pass with all options

**New MCP tools to add:**

| Tool | Description |
|------|-------------|
| `consolidation_history` | Returns last N consolidation events from memory (what the daemon distilled) |
| `consolidation_settings` | Read current daemon consolidation config. Optional write back to local.yaml. |

**Hosted routing for `memory_consolidate`:**
When running against a Hub (detected by presence of `bridge_url` in config or `HUB_URL` env var),
`memory_consolidate` should call `POST /api/v1/memory/consolidate` on the bridge rather than
running `consolidateMemory()` locally. This gives hosted users full consolidation via MCP
without needing a local LLM or the daemon installed.

**File:** `mcp/tools/memory.mjs`

---

### Stream 4: Documentation — How to Use + Settings

#### 4a. How to Use Modal (`web/hub/index.html` — `#modal-how-to-use`)

**Placement:** New section after the existing "Memory" section. Rendered as a tab or expandable accordion.

**Title:** "Memory Consolidation"

**Content:**

```
Memory Consolidation

Your knowledge vault accumulates activity events over time — searches, notes created,
topics explored. After weeks of use, you may have thousands of events, many redundant.
Memory consolidation uses an AI model to periodically clean this up automatically:

  ✦ Merge  — redundant observations become concise facts
  ✦ Verify — stale references to renamed or deleted notes are detected
  ✦ Discover — hidden connections across your topics are surfaced (optional)

Quick Start

  Hosted users: Open Settings → Consolidation, switch Mode to "Hosted", choose
  your schedule, and click Save. The Hub handles the rest — no API key needed.

  Self-hosted users: Add to config/local.yaml:

    daemon:
      enabled: true
      llm:
        model: gpt-4o-mini   # or any OpenAI-compatible model

  Then run:  knowtation daemon start

What does it cost?

  Using gpt-4o-mini, a typical pass costs $0.003–$0.009.
  At every-2-hours frequency, that's roughly $0.04–$0.11/day.
  Hosted plans include a monthly pass allowance; see your billing panel.
  Using a local Ollama model is free.

  Set a Daily Cap in Settings → Consolidation → Cost Guard to stay within budget.
  The daemon skips passes once the cap is reached, then resets the next calendar day.

Privacy

  Only memory event metadata is sent to the LLM (paths, query strings, timestamps).
  Your note content is never sent. For full privacy, use a local Ollama model.
```

**Linking:** The Settings modal's Consolidation tab includes a "Learn more ↗" link that opens this section directly.

#### 4b. Settings Tab Inline Help

Every setting has a `<span class="hint">` with a one-line description (as shown in the HTML above in Stream 2a). No separate doc page needed for settings — the inline hints are sufficient.

#### 4c. `docs/MEMORY-CONSOLIDATION-GUIDE.md` (technical reference)

Full technical reference for self-hosted users and developers:
- All config keys with types, defaults, env overrides
- CLI command reference with examples
- MCP tool reference with parameters and response shapes
- Cost estimation table (from the spec)
- Troubleshooting: LLM unreachable, stale PID file, cost cap hit, bridge auth errors

---

## Cron vs. Daemon: How They Differ

| | Self-Hosted | Hosted |
|---|---|---|
| **Scheduler** | Daemon loop (`startDaemon` in `lib/daemon.mjs`) — already built | Netlify Scheduled Function (Session 10) |
| **Trigger** | `setTimeout` loop inside the daemon process | Netlify infrastructure invokes the function hourly |
| **Per-user schedule** | `daemon.interval_minutes` in `config/local.yaml` | `interval_minutes` stored in billing DB; cron checks who's due |
| **User configures** | Settings modal → writes `config/local.yaml` | Settings modal → `POST /api/v1/settings` → billing DB |
| **LLM** | User's own API key (or Ollama) | Hub-owned key (`CONSOLIDATION_LLM_API_KEY`) |
| **Cost cap** | `daemon.max_cost_per_day_usd` in `daemon-cost.json` | Bridge enforces via billing gate (monthly pass cap) |

The scheduling for self-hosted is already fully implemented (Sessions 1–9). Session 10 adds the hosted scheduling layer only.

---

## Implementation Order Within Session 10

```
1. Stream 1 — Bridge endpoint (POST /api/v1/memory/consolidate)
             + GET /api/v1/memory/consolidate/status
             + billing: consolidation op + monthly cap per tier

2. Stream 0 — Netlify Scheduled Function (consolidation-scheduler.mjs)
             Depends on: Stream 1 bridge endpoint

3. Stream 3 — MCP: consolidation_history + consolidation_settings tools
             MCP hosted routing for memory_consolidate
             Can be done in parallel with Stream 0

4. Stream 2 — Hub UI: Settings tab + Dashboard card + Billing row
             Depends on: Streams 1 + 0 (needs endpoints to call)

5. Stream 4 — How to Use modal section + docs/MEMORY-CONSOLIDATION-GUIDE.md
             No dependencies; can be done last or in parallel

6. Tests at each step (unit + integration)
```

---

## Session 10 Deliverables at a Glance

| # | Deliverable | File(s) | Effort |
|---|-------------|---------|--------|
| 1 | Bridge consolidation endpoints | `hub/bridge/server.mjs` | 1.5h |
| 2 | Gateway proxy for new routes | `hub/gateway/server.mjs` | 30m |
| 3 | Billing: consolidation op + tier caps | `billing-constants.mjs`, `billing-middleware.mjs`, `billing-logic.mjs`, `billing-http.mjs` | 1h |
| 4 | Netlify scheduled function | `netlify/functions/consolidation-scheduler.mjs` | 1h |
| 5 | Billing DB: schedule fields | `billing-store.mjs`, `billing-logic.mjs` | 30m |
| 6 | MCP: 2 new tools + hosted routing | `mcp/tools/memory.mjs` | 1h |
| 7 | Settings modal — Consolidation tab | `index.html`, `hub.js`, `hub.css` | 1.5h |
| 8 | Dashboard — status card + cost meter | `index.html`, `hub.js`, `hub.css` | 1.5h |
| 9 | Billing panel — consolidation row | `hub.js` | 30m |
| 10 | How to Use modal section | `index.html` | 30m |
| 11 | `docs/MEMORY-CONSOLIDATION-GUIDE.md` | new file | 30m |
| 12 | Settings → writes `config/local.yaml` | `hub/gateway/server.mjs` or existing settings route | 30m |
| 13 | Tests for all new code | `test/` | 1.5h |
| **Total** | | | **~11–13h** |

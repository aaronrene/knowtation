# Session 10 — Stream 2 + 4 Starter Prompt

Copy the block below as your opening message for the next session.

---

I'm working on the Knowtation project on branch `feature/consolidation-ui-testing`.
Sessions 1–9 built the full daemon consolidation stack.
Session 10 Streams 1 (bridge endpoint), 0 (Netlify scheduler), and 3 (MCP tools) are committed.
Test suite: **1046 passing, 0 failing.**

Reference: `docs/SESSION-10-PLAN.md` — "Stream 2: Hub UI" and "Stream 4: Documentation".

---

## STREAM 2 SCOPE — Hub UI

**Frontend stack:** Vanilla JS (`web/hub/hub.js`), HTML (`web/hub/index.html`), CSS (`web/hub/hub.css`).
Settings is a modal with tab panels. No React. No build step.

Read these files fully before touching them:
- `web/hub/hub.js` — find the existing settings tab pattern (backup, team, vaults, integrations, appearance, billing, agents tabs)
- `web/hub/index.html` — find where settings panels live and where dashboard cards live
- `web/hub/hub.css` — understand existing class names (`.setting-row`, `.hint`, `.dashboard-card`, `.card-header`, `.card-body`, `.card-actions`, `.cost-meter`, `.meter-bar`, `.btn-primary`, `.badge-*`)

---

### 2a. Settings Modal — New "Consolidation" Tab

Add a "Consolidation" tab alongside the existing ones.

**Tab button** (in the settings modal tab bar):
```html
<button class="settings-tab" data-panel="consolidation">Consolidation</button>
```

**Panel** (in `index.html`, after the last existing `settings-panel`):
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
  <div id="consol-daemon-settings" class="consol-mode-section" style="display:none">
    <div class="setting-row">
      <label>Interval <span class="hint">minutes between passes</span></label>
      <input type="number" id="consol-interval" value="120" min="30" max="10080">
    </div>
    <div class="setting-row">
      <label>Idle only <span class="hint">only run when you haven't used Knowtation recently</span></label>
      <input type="checkbox" id="consol-idle-only" checked>
    </div>
    <div class="setting-row">
      <label>Idle threshold <span class="hint">minutes of inactivity</span></label>
      <input type="number" id="consol-idle-threshold" value="15" min="1">
    </div>
    <div class="setting-row">
      <label>Run on start <span class="hint">run one pass immediately when daemon starts</span></label>
      <input type="checkbox" id="consol-run-on-start">
    </div>
  </div>

  <!-- Hosted-only fields (hidden when mode = daemon or off) -->
  <div id="consol-hosted-settings" class="consol-mode-section" style="display:none">
    <div class="setting-row">
      <label>Schedule <span class="hint">Hub runs consolidation automatically on this schedule</span></label>
      <select id="consol-hosted-interval">
        <option value="60">Every hour</option>
        <option value="120" selected>Every 2 hours</option>
        <option value="360">Every 6 hours</option>
        <option value="720">Every 12 hours</option>
        <option value="1440">Daily</option>
        <option value="10080">Weekly</option>
      </select>
    </div>
  </div>

  <!-- Shared passes -->
  <fieldset>
    <legend>Passes</legend>
    <label><input type="checkbox" id="pass-consolidate" checked> Consolidate — merge &amp; deduplicate events (recommended)</label>
    <label><input type="checkbox" id="pass-verify" checked> Verify — detect stale note references (recommended)</label>
    <label><input type="checkbox" id="pass-discover"> Discover — cross-topic insights (uses more LLM tokens, optional)</label>
  </fieldset>

  <!-- LLM override (daemon only) -->
  <fieldset id="consol-llm-settings" style="display:none">
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

  <!-- Cost guard (daemon only) -->
  <fieldset id="consol-cost-guard" style="display:none">
    <legend>Cost Guard <span class="hint">(self-hosted only)</span></legend>
    <div class="setting-row">
      <label>Daily cap (USD) <span class="hint">leave blank for no limit; daemon skips passes once reached</span></label>
      <input type="number" id="consol-cost-cap" placeholder="no limit" min="0" step="0.01">
    </div>
  </fieldset>

  <div class="setting-row">
    <button id="btn-consol-save" class="btn-primary">Save Settings</button>
    <span id="consol-save-status" style="margin-left:0.75rem"></span>
  </div>
  <p style="margin-top:0.5rem"><a href="#" id="link-consol-help">Learn more about Memory Consolidation ↗</a></p>
</div>
```

**JS logic in `hub.js`:**

```js
// On settings modal open:
//   GET /api/v1/settings  →  populate consolidation form fields from response.daemon.*
//   mode radio = 'daemon' if daemon.enabled, 'hosted' if config.hub_url, else 'off'

// On mode radio change:
//   show/hide #consol-daemon-settings, #consol-hosted-settings, #consol-llm-settings, #consol-cost-guard

// On #btn-consol-save:
//   validate: interval must be ≥ 30 if daemon mode
//   call MCP tool consolidation_settings with the form values
//     OR POST /api/v1/settings if a hub settings endpoint exists (check which one the other tabs use)
//   show success/error in #consol-save-status

// On #link-consol-help: scroll to / open the "Memory Consolidation" section of the How to Use modal
```

**Settings endpoint research task:** Before writing any JS, read `hub.js` to find how the
existing tabs (e.g. backup, billing) currently load and save settings — replicate that exact
pattern for the consolidation tab.

---

### 2b. Dashboard — Consolidation Status Card

Add to the main dashboard view (alongside vault stats, memory stats). Locate the existing
dashboard card pattern in `index.html` and `hub.js`.

```html
<div id="consolidation-card" class="dashboard-card">
  <div class="card-header">
    <h4>Memory Consolidation</h4>
    <span id="consol-status-badge" class="badge-neutral">● Not configured</span>
  </div>
  <div class="card-body">
    <div id="consol-last-pass">Last pass: —</div>
    <div id="consol-next-pass">Next pass: —</div>
    <div id="consol-cost-meter" class="cost-meter" style="display:none">
      <span id="consol-cost-label">$0.000 today</span>
      <div class="meter-bar"><div id="consol-cost-fill" style="width:0%"></div></div>
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

**Populating the card (JS):**

- Daemon mode: call MCP tool `daemon_status` → read `last_pass_at`, `next_pass_at`,
  `cost_today_usd`, `cost_cap_usd`
- Hosted mode: call `GET /api/v1/memory/consolidate/status` →
  read `last_pass`, `cost_today_usd`
- Badge states: `badge-success` (active/running), `badge-warning` (enabled, not running),
  `badge-neutral` (off/not configured), `badge-error` (last pass errored)
- Cost meter: fill width = `(cost_today_usd / cost_cap_usd) * 100`%; hide if no cap

**"Consolidate Now" flow:**
1. Call MCP tool `memory_consolidate { dry_run: true }` → show preview in a confirm dialog
   (topics found, estimated cost)
2. User confirms → call `memory_consolidate { dry_run: false }`
3. Show spinner → on resolve, refresh the card

**"History" flow:**
- Call MCP tool `consolidation_history { limit: 20 }` → render a table in a modal/panel:
  columns: Date, Topics, Events Merged, Cost, Status

**"Settings ⚙" button:** opens the Settings modal at the Consolidation tab

---

### 2c. Billing Panel — Consolidation Usage Row

In the existing billing section of `hub.js` (wherever it calls `GET /api/v1/billing/summary`):
add a "Consolidations" row after the existing "Index jobs" row.

```
Usage This Month
  Searches:       23 / 100
  Index jobs:      2 / 5
  Consolidations:  7 / 30      ← new row
  Cost today:    $0.004         ← from /api/v1/memory/consolidate/status
```

Read the billing summary API response shape from `hub/gateway/billing-http.mjs` to confirm
the field names (`monthly_consolidation_jobs_used`, `consolidation_passes_included`).

---

## STREAM 4 SCOPE — Documentation

### 4a. How to Use Modal (in `index.html` — `#modal-how-to-use`)

Add a "Memory Consolidation" section after the existing "Memory" section. Match the structure
and tone of the existing sections exactly (read those first).

**Content to include:**
- What consolidation does (merge, verify, discover — one sentence each)
- Quick Start for hosted users (Settings → Consolidation → mode "Hosted" → Save)
- Quick Start for self-hosted users (YAML snippet + `knowtation daemon start`)
- Cost: "~$0.003–$0.009 per pass with gpt-4o-mini; local Ollama is free"
- Privacy: "only event metadata (paths, timestamps) is sent to the LLM — note content is never sent"
- Link to the consolidation settings tab

The "Learn more ↗" link in the Settings → Consolidation tab should deep-link to this section
(`#modal-how-to-use` + scroll to the consolidation heading, or open it directly).

### 4b. `docs/MEMORY-CONSOLIDATION-GUIDE.md`

Technical reference for self-hosted users and developers. Create this new file with:

1. **Overview** — what consolidation does, the three passes
2. **Config reference** — every `daemon.*` key with type, default, env override
3. **CLI reference** — `knowtation daemon start/stop/status/log`, `knowtation memory consolidate`
4. **MCP tool reference** — `daemon_status`, `memory_consolidate`, `consolidation_history`,
   `consolidation_settings` with input schemas and response shapes
5. **Hosted mode** — setting `KNOWTATION_HUB_URL` + `KNOWTATION_HUB_TOKEN`, billing panel
6. **Cost estimation table** — events/day × model → typical $/pass × frequency → $/day
7. **Troubleshooting** — LLM unreachable, stale PID file, cost cap hit, bridge auth errors,
   `HUB_TOKEN_REQUIRED`, `interval_minutes` validation

---

## TESTS

All JS logic in `hub.js` (settings load/save, card population, history, consolidate-now flow)
should be pure functions where possible so they can be unit-tested without a browser.

Write `test/hub-consolidation.test.mjs` covering:
- `populateConsolSettingsForm(settings, form)` — form fields match daemon config
- `buildConsolSettingsPayload(form)` — payload shape matches consolidation_settings schema
- `renderConsolidationHistory(events, container)` — renders correct row count
- `formatCostMeter(costUsd, capUsd)` — returns fill% and display strings

Mock strategy: inject DOM stubs; do not require a real browser.

---

## CODEBASE CONTEXT

Key files to read before editing:
- `web/hub/hub.js` — ~full file; find tab switching, settings load/save, dashboard card patterns
- `web/hub/index.html` — find settings modal structure, dashboard grid, how-to-use modal
- `web/hub/hub.css` — existing class names, badge variants, cost meter styles
- `hub/gateway/billing-http.mjs` — billing summary response shape
- `hub/gateway/billing-logic.mjs` — `monthly_consolidation_jobs_used`, `consolidation_passes_included`

MCP tools now available (Stream 3):
- `consolidation_history { limit? }` → `{ history: [...], count }`
- `consolidation_settings { enabled?, interval_minutes?, idle_only?, ... }` → `{ daemon }` or `{ ok, daemon }`
- `memory_consolidate { dry_run?, passes?, lookback_hours? }` → routes to Hub or local

Hub API endpoints (Stream 1):
- `POST /api/v1/memory/consolidate` — trigger pass (billing-gated)
- `GET /api/v1/memory/consolidate/status` — last pass, cost today

Test runner: `node --test` (Node 22).
Current passing count: **1046**. Do not break any existing test.
Run `node --test` after implementation to verify the full suite.

---

## AFTER STREAM 2 + 4

When both streams are done, Session 10 is complete. The next work is:
- PR: merge `feature/consolidation-ui-testing` → `main`
- Optionally: merge `feature/daemon-consolidation` → `main` first if not yet done
- Session 11 candidates: per the long-range roadmap — see `docs/PHASE12-BLOCKCHAIN-PLAN.md`
  or other backlog items

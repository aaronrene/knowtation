# Memory Consolidation — Technical Reference

Memory consolidation uses an LLM to periodically clean up your vault's activity events.
It runs as a **daemon** (self-hosted) or **cron job** (hosted Hub), grouping raw events
into concise knowledge entries.

---

## Overview

### Three Passes

| Pass | What it does | Default |
|------|-------------|---------|
| **Consolidate** | Groups events by topic, merges & deduplicates via LLM, stores concise fact summaries | On |
| **Verify** | Detects stale references to renamed or deleted notes | On |
| **Discover** | Surfaces hidden connections across topics (uses more LLM tokens) | Off |

After all passes, the pointer index is rebuilt automatically.

---

## Config Reference

All settings live under `daemon:` in `config/local.yaml`.

| Key | Type | Default | Env Override | Description |
|-----|------|---------|-------------|-------------|
| `daemon.enabled` | boolean | `false` | `KNOWTATION_DAEMON_ENABLED` | Enable the consolidation daemon |
| `daemon.interval_minutes` | number | `120` | `KNOWTATION_DAEMON_INTERVAL` | Minutes between passes (1–43200) |
| `daemon.idle_only` | boolean | `true` | — | Only run when user is inactive |
| `daemon.idle_threshold_minutes` | number | `15` | — | Minutes of inactivity before daemon runs |
| `daemon.run_on_start` | boolean | `false` | — | Run one pass immediately when daemon starts |
| `daemon.lookback_hours` | number | `24` | — | How far back to look for events |
| `daemon.max_events_per_pass` | number | `200` | — | Max events to process per pass |
| `daemon.max_topics_per_pass` | number | `10` | — | Max topics to consolidate per pass |
| `daemon.max_cost_per_day_usd` | number\|null | `null` | — | Daily cost cap; daemon skips passes when reached |
| `daemon.dry_run` | boolean | `false` | `KNOWTATION_DAEMON_DRY_RUN` | Preview mode — no writes |
| `daemon.log_file` | string\|null | `null` | — | Path to daemon log file |
| `daemon.passes.consolidate` | boolean | `true` | — | Run the merge/deduplicate pass |
| `daemon.passes.verify` | boolean | `true` | — | Run the stale reference detection pass |
| `daemon.passes.discover` | boolean | `false` | — | Run the cross-topic insights pass |
| `daemon.passes.rebuild_index` | boolean | `true` | — | Rebuild pointer index after passes |
| `daemon.llm.provider` | string\|null | `null` (auto) | `KNOWTATION_DAEMON_LLM_PROVIDER` | `openai`, `anthropic`, `ollama`, `openrouter` |
| `daemon.llm.model` | string\|null | `null` (auto) | `KNOWTATION_DAEMON_LLM_MODEL` | e.g. `gpt-4o-mini`, `llama3` |
| `daemon.llm.base_url` | string\|null | `null` | `KNOWTATION_DAEMON_LLM_BASE_URL` | OpenAI-compatible base URL |
| `daemon.llm.api_key_env` | string\|null | `null` | — | Name of env var containing the API key |
| `daemon.llm.max_tokens` | number | `1024` | — | Max tokens per LLM call |
| `daemon.llm.temperature` | number | `0.2` | — | LLM temperature |

### Minimal Example

```yaml
daemon:
  enabled: true
  llm:
    model: gpt-4o-mini
```

### Full Example

```yaml
daemon:
  enabled: true
  interval_minutes: 120
  idle_only: true
  idle_threshold_minutes: 15
  run_on_start: false
  max_cost_per_day_usd: 0.10
  passes:
    consolidate: true
    verify: true
    discover: false
  llm:
    provider: openai
    model: gpt-4o-mini
    base_url: https://api.openai.com/v1
```

---

## CLI Reference

### `knowtation daemon start`

Start the consolidation daemon. Runs in the foreground by default.

```bash
knowtation daemon start              # foreground (Ctrl+C to stop)
knowtation daemon start --background # background (writes PID file)
```

### `knowtation daemon stop`

Stop a background daemon by reading the PID file.

```bash
knowtation daemon stop
```

### `knowtation daemon status`

Show daemon status: running state, cost today, cost cap, last pass time.

```bash
knowtation daemon status
knowtation daemon status --json      # machine-readable output
```

### `knowtation daemon log`

View daemon log output.

```bash
knowtation daemon log --tail 10
```

### `knowtation memory consolidate`

Run a single consolidation pass (does not require the daemon to be running).

```bash
knowtation memory consolidate                # real pass
knowtation memory consolidate --dry-run      # preview without writing
knowtation memory consolidate --passes consolidate,verify
```

### `knowtation memory list --type consolidation`

List past consolidation events stored in memory.

```bash
knowtation memory list --type consolidation
knowtation memory stats
```

---

## MCP Tool Reference

### `daemon_status`

Returns current daemon state.

**Input:** (none)

**Response:**
```json
{
  "running": true,
  "pid": 12345,
  "cost_today_usd": 0.004,
  "cost_cap_usd": 0.10,
  "last_pass_at": "2026-04-05T10:30:00Z",
  "next_pass_at": "2026-04-05T12:30:00Z",
  "uptime_seconds": 3600
}
```

### `memory_consolidate`

Trigger a consolidation pass. When a Hub URL is configured, routes to the hosted endpoint.

**Input:**
```json
{
  "dry_run": true,
  "passes": ["consolidate", "verify"],
  "lookback_hours": 48
}
```

**Response:**
```json
{
  "topics": 5,
  "total_events": 42,
  "verify": { "stale_count": 2 },
  "discover": null,
  "cost_usd": 0.007,
  "pass_id": "abc123",
  "dry_run": false
}
```

### `consolidation_history`

Return the last N consolidation pass records from memory.

**Input:**
```json
{ "limit": 20 }
```

**Response:**
```json
{
  "history": [
    {
      "timestamp": "2026-04-05T10:30:00Z",
      "data": {
        "topics_count": 5,
        "total_events": 42,
        "cost_usd": 0.007
      }
    }
  ],
  "count": 1
}
```

### `consolidation_settings`

Read or write daemon consolidation settings in `config/local.yaml`.

**Input (read):** `{}` (no arguments)

**Input (write):**
```json
{
  "enabled": true,
  "interval_minutes": 60,
  "idle_only": true,
  "idle_threshold_minutes": 15,
  "run_on_start": false,
  "max_cost_per_day_usd": 0.05,
  "llm_model": "gpt-4o-mini"
}
```

**Response:**
```json
{
  "ok": true,
  "daemon": {
    "enabled": true,
    "interval_minutes": 60,
    "llm": { "model": "gpt-4o-mini" }
  }
}
```

**Validation:**
- `interval_minutes` must be 1–43200
- `llm_model` must not contain path separators or shell metacharacters

---

## Hosted Mode

For hosted users, consolidation runs via the Hub's Netlify Scheduled Function. No local daemon
or LLM key is required.

### Setup

1. Set `KNOWTATION_HUB_URL` and `KNOWTATION_HUB_TOKEN` in your environment (or use the Hub UI
   Settings → Integrations → Copy Hub URL, token & vault).
2. In the Hub UI: Settings → Consolidation → Mode "Hosted" → Save.

### How It Works

- A Netlify Scheduled Function runs hourly, checking which users are due for consolidation.
- Each user's effective schedule is controlled by `interval_minutes` in their billing record.
- The cron function calls `POST /api/v1/memory/consolidate` on the bridge with a service JWT.
- Billing gate enforces the monthly pass cap per tier.

### Hub API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/memory/consolidate` | Trigger a pass (billing-gated) |
| `GET`  | `/api/v1/memory/consolidate/status` | Last pass time, cost today, pass count |

### Billing

| Tier | Monthly passes included |
|------|------------------------|
| Free | 0 |
| Starter | 10 |
| Pro | 30 |
| Team | 100 |

Overage is deducted from token pack balance (same as index job overage). Each consolidation pass
costs 5 cents of platform billing.

---

## Cost Estimation

| Events/day | Model | Typical $/pass | Frequency | $/day |
|------------|-------|----------------|-----------|-------|
| 50 | gpt-4o-mini | $0.003 | Every 2 hours | $0.04 |
| 200 | gpt-4o-mini | $0.009 | Every 2 hours | $0.11 |
| 200 | gpt-4o-mini | $0.009 | Daily | $0.009 |
| Any | Ollama (local) | $0.000 | Any | $0.000 |

Use the **Cost Guard** setting to set a daily cap. The daemon skips passes once the cap is
reached and resets on the next calendar day (UTC).

---

## Troubleshooting

### LLM unreachable

**Symptom:** Daemon logs `LLM_NOT_CONFIGURED` or `ECONNREFUSED`.

**Fix:** Verify `daemon.llm.provider` and the corresponding API key env var are set.
For Ollama, ensure it's running (`ollama serve`) and `daemon.llm.base_url` is correct
(default: `http://localhost:11434`).

### Stale PID file

**Symptom:** `knowtation daemon status` reports running but the process is dead.

**Fix:** Delete `data/daemon.pid` and restart: `knowtation daemon start`.

### Cost cap hit

**Symptom:** Daemon is running but passes are skipped. Log shows `cost_cap_reached`.

**Fix:** This is normal — the daemon pauses consolidation until the next calendar day (UTC).
Increase `daemon.max_cost_per_day_usd` or switch to a cheaper model.

### Bridge auth errors (hosted)

**Symptom:** `POST /api/v1/memory/consolidate` returns 401.

**Fix:** Verify `KNOWTATION_HUB_TOKEN` is set and not expired. Re-copy from
Settings → Integrations → Copy Hub URL, token & vault.

### `HUB_TOKEN_REQUIRED`

**Symptom:** MCP `memory_consolidate` fails with `HUB_TOKEN_REQUIRED`.

**Fix:** Set `KNOWTATION_HUB_TOKEN` in your environment when using hosted mode.
The MCP tool detects `KNOWTATION_HUB_URL` and routes to the Hub, which requires auth.

### `interval_minutes` validation error

**Symptom:** Saving consolidation settings fails with validation error.

**Fix:** `interval_minutes` must be between 1 and 43200 (30 days). In daemon mode,
the Hub UI enforces a minimum of 30 minutes.

---

## Privacy

Only memory event metadata is sent to the LLM:
- File paths
- Query strings
- Timestamps
- Event types

**Your note content is never sent to the LLM.** For full privacy, use a local
Ollama model — all processing stays on your machine.

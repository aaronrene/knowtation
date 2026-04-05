# Background Memory Consolidation Daemon — Full Spec

## Overview

An opt-in, long-running background process that uses a **user-provided LLM** to autonomously maintain, consolidate, and improve the Knowtation memory layer while the user is idle. The daemon reads from the memory event log, identifies patterns and contradictions, merges redundant observations into concise facts, verifies stale references, and regenerates the memory pointer index — all without human intervention.

The daemon is architecturally independent of the memory improvements plan (pointer index, topic partitioning, skeptical memory, strict write discipline) but benefits from all of them. It can be implemented before or after those improvements, though topic partitioning and the pointer index make its output significantly more useful.

---

## Motivation

Memory event logs grow linearly. After weeks of use, a vault may accumulate thousands of events — many redundant ("searched for X" five times), some contradictory (a note path was renamed but old events still reference the original path), and some stale (referencing notes that were deleted). Without consolidation, agents either load too much context (expensive, slow) or miss important patterns buried in noise.

The daemon solves this by running periodic "maintenance passes" — similar in concept to database vacuuming or garbage collection, but with the added intelligence of an LLM to reason about semantic relationships, contradictions, and what matters.

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    User's Machine                     │
│                                                       │
│  ┌─────────────┐    ┌─────────────────────────────┐  │
│  │ Knowtation  │    │  Daemon Process (separate)   │  │
│  │ CLI / MCP   │    │                               │  │
│  │             │    │  ┌─────────┐  ┌────────────┐ │  │
│  │  writes to  │───▶│  │ Watcher │  │ Scheduler  │ │  │
│  │  events.jsonl    │  └────┬────┘  └─────┬──────┘ │  │
│  │             │    │       │              │        │  │
│  └─────────────┘    │  ┌────▼──────────────▼────┐  │  │
│                     │  │   Consolidation Engine  │  │  │
│                     │  │                         │  │  │
│                     │  │  1. Read recent events  │  │  │
│                     │  │  2. Group by topic      │  │  │
│                     │  │  3. LLM: merge/dedup    │  │  │
│                     │  │  4. Verify stale refs   │  │  │
│                     │  │  5. Write consolidation │  │  │
│                     │  │  6. Rebuild index       │  │  │
│                     │  └────────────┬────────────┘  │  │
│                     │               │               │  │
│                     │  ┌────────────▼────────────┐  │  │
│                     │  │  User-Provided LLM      │  │  │
│                     │  │  (OpenAI / Anthropic /   │  │  │
│                     │  │   Ollama / OpenRouter /  │  │  │
│                     │  │   any OpenAI-compat API) │  │  │
│                     │  └─────────────────────────┘  │  │
│                     └───────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

The daemon runs as a **separate Node.js process** — not inside the CLI or MCP server. This isolation ensures:
- The main agent's context window is never polluted by maintenance work.
- A crash in the daemon does not affect the user's active session.
- The daemon can be started, stopped, and configured independently.

---

## What the Daemon Does (Consolidation Passes)

Each pass performs these steps in order:

### Pass 1: Event Consolidation

1. **Read** events since the last consolidation (or last 24h if first run).
2. **Group** events by topic (if topic partitioning is enabled) or by event type.
3. **Send** each group to the LLM with a structured prompt:
   - "Here are N events about topic X. Merge redundant observations. Remove contradictions (keep the most recent). Distill into 3-5 concise factual statements."
4. **Store** the result as a `consolidation` event with the distilled facts.
5. **Update** the pointer index to reference the consolidation.

### Pass 2: Stale Reference Detection

1. **Scan** recent events for note path references.
2. **Check** each path against the vault filesystem — does the file still exist? Has it been modified since the event?
3. **Mark** stale events with `confidence: "stale"` (if skeptical memory is enabled).
4. **Optionally** store a `maintenance` event noting which references are stale.

### Pass 3: Relationship Discovery

1. **Read** the current memory index and recent consolidation events.
2. **Send** to LLM: "Given these topic summaries, what connections or patterns do you see across topics? Are there contradictions between topics? What questions remain unanswered?"
3. **Store** discovered relationships as `insight` events.
4. **Update** the pointer index with cross-references.

### Pass 4: Index Rebuild

1. Regenerate `memory-index.md` from the current state.
2. Rebuild topic files if topic partitioning is enabled.
3. Prune events beyond retention window.

---

## LLM Configuration

The daemon reuses Knowtation's existing `completeChat` infrastructure ([lib/llm-complete.mjs](../lib/llm-complete.mjs)) which already supports OpenAI, Anthropic, and Ollama. Users bring their own API key / local model.

A new **optional** `daemon.llm` config section allows users to specify a different (typically cheaper) model for background work, separate from the model used for interactive features like session summaries.

### Config Schema

```yaml
# config/local.yaml — daemon section
daemon:
  enabled: false                      # opt-in; daemon does nothing unless true
  
  # --- Scheduling ---
  interval_minutes: 120               # run consolidation every N minutes (default: 2 hours)
  idle_only: true                     # only run when no CLI/MCP activity detected in last N minutes
  idle_threshold_minutes: 15          # minutes of inactivity before daemon considers user "idle"
  run_on_start: false                 # run one pass immediately when daemon starts
  
  # --- Consolidation scope ---
  lookback_hours: 24                  # how far back to read events per pass (default: 24h)
  max_events_per_pass: 200            # cap events processed per pass (cost guard)
  max_topics_per_pass: 10             # cap topic groups sent to LLM per pass
  
  # --- Passes to enable ---
  passes:
    consolidate: true                 # merge/dedup events (Pass 1)
    verify: true                      # stale reference detection (Pass 2)
    discover: false                   # relationship discovery (Pass 3) — more expensive, opt-in
    rebuild_index: true               # always rebuild index after other passes (Pass 4)
  
  # --- LLM (optional override; falls back to main LLM config / env) ---
  llm:
    provider: null                    # openai | anthropic | ollama | openrouter | null (auto-detect from env)
    model: null                       # e.g. "gpt-4o-mini", "claude-3-5-haiku-20241022", "llama3.2"
    api_key_env: null                 # env var name for API key (e.g. "DAEMON_OPENAI_KEY"); null = use main key
    base_url: null                    # for OpenAI-compatible APIs (OpenRouter, local proxies, vLLM, etc.)
    max_tokens: 1024                  # per LLM call
    temperature: 0.2                  # low temperature for factual consolidation
  
  # --- Safety ---
  dry_run: false                      # if true, log what would happen but don't write events
  log_file: null                      # path to daemon log; null = data_dir/daemon.log
  max_cost_per_day_usd: null          # optional daily cost cap (requires token counting)
```

### Environment Variable Overrides

| Env Var | Overrides |
|---------|-----------|
| `KNOWTATION_DAEMON_ENABLED` | `daemon.enabled` |
| `KNOWTATION_DAEMON_INTERVAL` | `daemon.interval_minutes` |
| `KNOWTATION_DAEMON_LLM_PROVIDER` | `daemon.llm.provider` |
| `KNOWTATION_DAEMON_LLM_MODEL` | `daemon.llm.model` |
| `KNOWTATION_DAEMON_LLM_BASE_URL` | `daemon.llm.base_url` |
| `KNOWTATION_DAEMON_DRY_RUN` | `daemon.dry_run` |

---

## CLI Interface

```bash
# Start the daemon (foreground, Ctrl+C to stop)
knowtation daemon start

# Start as a background process (writes PID to data_dir/daemon.pid)
knowtation daemon start --background

# Stop a running daemon
knowtation daemon stop

# Check daemon status (running, last pass time, events processed)
knowtation daemon status

# Run a single consolidation pass (no daemon loop)
knowtation memory consolidate
knowtation memory consolidate --dry-run
knowtation memory consolidate --passes consolidate,verify

# Show daemon log
knowtation daemon log
knowtation daemon log --tail 50
```

### MCP Tools

| Tool | Description |
|------|-------------|
| `memory_consolidate` | Trigger a single consolidation pass. Params: `dry_run`, `passes`, `lookback_hours`. |
| `daemon_status` | Return daemon status (running, last pass, next scheduled, events processed). |

---

## New Event Types

| Type | Trigger | Shape |
|------|---------|-------|
| `consolidation` | Daemon Pass 1 | `{ topic, facts: string[], event_count, since, until }` |
| `maintenance` | Daemon Pass 2 | `{ stale_paths: string[], verified_paths: string[], checked_count }` |
| `insight` | Daemon Pass 3 | `{ connections: string[], contradictions: string[], open_questions: string[] }` |

These are added to `MEMORY_EVENT_TYPES` in [lib/memory-event.mjs](../lib/memory-event.mjs).

---

## LLM Prompts

### Consolidation Prompt (Pass 1)

```
System: You are a memory consolidation engine for a personal knowledge vault.
You receive a batch of timestamped activity events on a single topic.
Your job:
1. Merge redundant observations into single factual statements.
2. When events contradict each other, keep the most recent fact and discard the older one.
3. Distill the batch into 3-7 concise, factual statements.
4. Each statement must be a complete, standalone fact (no "as mentioned earlier").
5. Preserve note paths and dates when they add context.

Output format: JSON array of strings, one per fact. No commentary.

User: Topic: "{topic}"
Events ({count}):
{event_lines}
```

### Relationship Discovery Prompt (Pass 3)

```
System: You are an insight engine for a personal knowledge vault.
Given topic summaries from the vault's memory, identify:
1. Connections between topics that the user might not have noticed.
2. Contradictions between topics (a fact in one topic conflicts with another).
3. Open questions — things the vault seems to be exploring but hasn't resolved.

Be concise. Each item should be 1-2 sentences.

Output format: JSON object with three arrays: "connections", "contradictions", "open_questions".

User: Topic summaries:
{topic_summaries}
```

---

## Process Lifecycle

### Startup

1. Read config (`loadConfig()` + daemon section).
2. Validate LLM connectivity: send a trivial test prompt ("respond with OK"). Fail fast with a clear error if LLM is unreachable.
3. Write PID file to `{data_dir}/daemon.pid`.
4. Write startup event to daemon log.
5. If `run_on_start`, execute one full pass.
6. Enter scheduling loop.

### Scheduling Loop

```
while (running) {
  wait(interval_minutes)
  if (idle_only && !isIdle()) continue
  if (costCapExceeded()) { log("daily cost cap reached"); continue }
  runConsolidationPass()
}
```

### Idle Detection

The daemon checks the `mtime` of `events.jsonl` (and `state.json`) to determine when the last CLI/MCP activity occurred. If the file hasn't been modified in `idle_threshold_minutes`, the user is considered idle.

Alternative (if `events.jsonl` is not a reliable signal): the daemon can write and read a heartbeat file (`{data_dir}/daemon-heartbeat.json`) that the CLI/MCP update on every operation.

### Shutdown

1. On `SIGTERM` or `SIGINT`: finish current pass (or abort gracefully), write shutdown event to log, remove PID file, exit.
2. `knowtation daemon stop` reads PID from file, sends `SIGTERM`.
3. If process doesn't exit in 10s, send `SIGKILL`.

### Crash Recovery

- If daemon crashes mid-pass, no data is corrupted (consolidation events are only written after the full pass completes, per strict write discipline).
- On next startup, the daemon detects stale PID file (process not running), cleans it up, and starts fresh.
- Daemon log records the last completed pass timestamp; the next pass picks up from there.

---

## File Layout

```
lib/
  memory-consolidate.mjs          # Core consolidation engine (pure functions, no daemon loop)
  daemon.mjs                      # Daemon process lifecycle (start, stop, schedule, idle detect)
  daemon-llm.mjs                  # LLM wrapper: resolves daemon.llm config, falls back to completeChat

cli/
  index.mjs                       # New subcommands: daemon start|stop|status|log, memory consolidate

mcp/
  tools/memory.mjs                # New tool: memory_consolidate, daemon_status

data_dir/
  daemon.pid                      # PID file (written by daemon, read by CLI)
  daemon.log                      # Structured log (JSONL)
  daemon-heartbeat.json           # Last activity timestamp (updated by CLI/MCP)
  memory/{vault_id}/
    events.jsonl                  # (existing) — daemon reads from here
    state.json                    # (existing) — daemon reads from here
    consolidations/               # Consolidation output files (one per pass)
      2026-04-04T10-00Z.json
    topics/                       # (from topic partitioning) — daemon reads/rebuilds
```

---

## Security Considerations

1. **No new secrets**: The daemon uses the same API keys the user already has configured (or a dedicated env var name they specify in `daemon.llm.api_key_env`).
2. **Memory data sent to LLM**: The daemon sends memory event summaries (metadata, paths, query strings) to the LLM. This is the same data the session summary feature already sends. Users who are concerned about this can use a local Ollama model.
3. **No vault content sent**: The daemon does NOT read note bodies. It only reads memory events (which contain metadata like paths, query strings, counts — not full note text). Pass 2 (stale detection) checks file existence and mtime but does not read file content.
4. **Cost guardrails**: `max_events_per_pass`, `max_topics_per_pass`, and optional `max_cost_per_day_usd` prevent runaway API costs.
5. **Dry run**: `daemon.dry_run: true` lets users observe what the daemon would do without any writes.
6. **Process isolation**: The daemon is a separate process. A bug in the daemon cannot corrupt the main CLI/MCP session.
7. **Append-only writes**: The daemon only appends new events (consolidation, maintenance, insight). It never modifies or deletes existing events. Index regeneration is idempotent.

---

## Implementation Phases

### Phase A: Core Consolidation Engine (standalone, no daemon)

**Effort: ~2-3 days**

Files:
- `lib/memory-consolidate.mjs` — `consolidateMemory(config, opts)` function
- `lib/daemon-llm.mjs` — LLM wrapper with daemon config resolution
- `lib/memory-event.mjs` — add `consolidation`, `maintenance`, `insight` event types
- `cli/index.mjs` — `knowtation memory consolidate` command
- `mcp/tools/memory.mjs` — `memory_consolidate` tool
- `test/memory-consolidate.test.mjs` — unit tests

Deliverable: Users can manually run `knowtation memory consolidate` to trigger a single pass. No background process yet.

### Phase B: Daemon Lifecycle

**Effort: ~2-3 days**

Files:
- `lib/daemon.mjs` — process management (start, stop, schedule, idle detect, signal handling)
- `cli/index.mjs` — `knowtation daemon start|stop|status|log` commands
- `mcp/tools/memory.mjs` — `daemon_status` tool
- `test/daemon.test.mjs` — lifecycle tests (start, stop, idle detection, PID management)

Deliverable: `knowtation daemon start` runs consolidation on a schedule. `--background` for detached mode.

### Phase C: Stale Verification Pass

**Effort: ~1 day**

Files:
- `lib/memory-consolidate.mjs` — add `runVerifyPass(config, events)` 
- `test/memory-consolidate.test.mjs` — verify pass tests

Deliverable: Daemon detects stale note references and marks events accordingly.

### Phase D: Relationship Discovery Pass

**Effort: ~1-2 days**

Files:
- `lib/memory-consolidate.mjs` — add `runDiscoverPass(config, consolidations)`
- `test/memory-consolidate.test.mjs` — discovery pass tests

Deliverable: Daemon generates cross-topic insights. This pass is opt-in (`passes.discover: true`) since it's the most LLM-intensive.

### Phase E: OpenAI-Compatible API Support

**Effort: ~1 day**

Files:
- `lib/daemon-llm.mjs` — add `base_url` support for OpenRouter, vLLM, LM Studio, text-generation-webui, etc.
- `test/daemon-llm.test.mjs` — provider tests

Deliverable: Users can point the daemon at any OpenAI-compatible endpoint, not just the three built-in providers.

### Phase F: Cost Tracking and Guardrails

**Effort: ~1 day**

Files:
- `lib/daemon.mjs` — token counting (estimate from response), daily cost accumulator
- Config: `max_cost_per_day_usd`

Deliverable: Daemon stops making LLM calls if estimated daily cost exceeds the configured cap.

---

## Total Estimated Effort

| Phase | Days | Depends On |
|-------|------|------------|
| A: Core Engine | 2-3 | Memory improvements plan (optional but recommended) |
| B: Daemon Lifecycle | 2-3 | Phase A |
| C: Stale Verify | 1 | Phase A, skeptical memory (from improvements plan) |
| D: Discovery | 1-2 | Phase A |
| E: OpenAI-Compat | 1 | Phase A |
| F: Cost Guards | 1 | Phase B |
| **Total** | **8-11 days** | |

Phases A + B are the MVP. Phases C-F are incremental enhancements that can be added over time.

---

## Example User Experience

### Setup (30 seconds)

```yaml
# config/local.yaml
daemon:
  enabled: true
  interval_minutes: 60
  llm:
    model: gpt-4o-mini    # cheap, fast, good enough for consolidation
```

### Start

```bash
$ knowtation daemon start --background
Daemon started (PID 42891). Consolidation every 60 min when idle.
LLM: OpenAI gpt-4o-mini (from OPENAI_API_KEY).
Log: data/daemon.log
```

### Check Status

```bash
$ knowtation daemon status
Status: running (PID 42891, uptime 3h 12m)
Last pass: 2026-04-04T14:00:00Z (processed 47 events, 5 topics, 3 consolidations written)
Next pass: ~2026-04-04T15:00:00Z (if idle)
Estimated cost today: $0.003
```

### Manual Consolidation

```bash
$ knowtation memory consolidate --dry-run
[dry-run] Would process 23 events across 4 topics.
[dry-run] Topic "blockchain": 8 events → estimated 4-5 facts
[dry-run] Topic "architecture": 6 events → estimated 3-4 facts
[dry-run] Topic "testing": 5 events → estimated 2-3 facts
[dry-run] Topic "import": 4 events → estimated 2 facts

$ knowtation memory consolidate
Consolidated 23 events across 4 topics.
  blockchain: 5 facts written (consolidation event mem_a1b2c3d4e5f6)
  architecture: 4 facts written (consolidation event mem_f6e5d4c3b2a1)
  testing: 3 facts written
  import: 2 facts written
Index regenerated.
```

### Using Ollama (Fully Local, No API Costs)

```yaml
daemon:
  enabled: true
  interval_minutes: 30        # can run more often since it's free
  idle_threshold_minutes: 5
  llm:
    provider: ollama
    model: llama3.2
    # base_url defaults to http://localhost:11434
```

---

## Hosted Deployment (Hub)

### Architecture

On the hosted Hub, users do not run a persistent daemon process. Instead:

1. **Consolidation is an API endpoint**: `POST /api/v1/memory/consolidate` on the existing bridge, using the same JWT auth and `X-Vault-Id` scoping as all other memory endpoints.
2. **Scheduling is server-side**: a lightweight cron worker (or queue consumer) checks which users are due for consolidation and triggers the endpoint on their behalf. This avoids N persistent processes for N users.
3. **LLM calls are server-side**: the bridge calls the LLM directly (not the user's machine). The Hub provides the API key and model — the user does not need their own.

```
┌─────────────────────────────────────────────────────┐
│                     Hub Infrastructure               │
│                                                      │
│  ┌──────────┐    ┌──────────────┐    ┌───────────┐  │
│  │  Gateway  │───▶│    Bridge     │───▶│ LLM API   │  │
│  │ (proxy)   │    │              │    │ (GPT-4o-  │  │
│  └──────────┘    │  POST /api/  │    │  mini etc) │  │
│       ▲          │  v1/memory/  │    └───────────┘  │
│       │          │  consolidate │                    │
│  ┌────┴─────┐    └──────┬───────┘                    │
│  │  Cron     │───────────┘                           │
│  │  Worker   │  triggers per-user on schedule        │
│  └──────────┘                                        │
└─────────────────────────────────────────────────────┘
```

### Cost Model

Per-pass LLM cost using GPT-4o-mini ($0.15/1M input, $0.60/1M output):

| Pass intensity | Input tokens | Output tokens | Cost per pass |
|----------------|-------------|---------------|---------------|
| Light (50 events, 3 topics) | ~10K | ~3K | ~$0.003 |
| Medium (100 events, 5 topics) | ~25K | ~5K | ~$0.007 |
| Heavy (200 events, 5 topics) | ~40K | ~5K | ~$0.009 |

At default interval (every 2 hours, 12 passes/day): **$0.04-$0.11/day** or **$1.20-$3.30/month** per user.

### Pricing Recommendation

Follow the same per-use metering pattern already in place for indexing and search:

- **Add `consolidation` as a metered usage type** alongside `index` and `search` in the billing system.
- **Price per pass**: $0.005-$0.01 per consolidation pass (covers LLM cost + margin).
- **Bundle into tiers**: e.g., "Pro includes 10 consolidation passes/month, $0.01/pass after that."
- **No separate service**: the endpoint lives on the existing bridge. No new infrastructure beyond the cron worker.
- **No price increases needed**: consolidation is additive revenue. Users who don't enable it pay nothing extra. Users who want aggressive consolidation (every hour) pay proportionally more.

### Parity: Local vs Hosted

| Dimension | Local (Ollama) | Hosted (Hub) |
|-----------|---------------|--------------|
| LLM cost | $0 (user hardware) | Per-pass metered |
| LLM quality | Depends on model (llama3.2 is decent) | GPT-4o-mini or better (consistent quality) |
| Frequency | Unlimited (user controls) | Metered (cost scales with frequency) |
| Privacy | Full (nothing leaves machine) | Event metadata sent to Hub LLM (not note bodies) |
| Setup | Install Ollama + model | Zero setup (Hub manages LLM) |
| Availability | Only when machine is on | Always-on (server-side cron) |
| Feature parity | All passes available | All passes available |

The key tradeoff: local users get unlimited free runs but must manage their own hardware and model quality. Hosted users get zero-setup, always-on consolidation with higher-quality LLM output, but pay per use.

### Implementation Notes

- The bridge endpoint reuses the same `consolidateMemory()` function from `lib/memory-consolidate.mjs`.
- The cron worker is a simple script that queries the database for users with `daemon.enabled: true` and whose last consolidation was more than `interval_minutes` ago.
- Server-side LLM calls use a Hub-owned API key (configured in Hub environment, not user config).
- Per-user cost tracking: each pass logs its token usage to the billing meter.
- The `max_events_per_pass` and `max_topics_per_pass` limits apply on hosted too, preventing any single user from generating outsized LLM costs.

---

## Open Questions (for future refinement)

1. **Should consolidations replace or supplement raw events?** Current design: supplement only (consolidation events are additive). Raw events are never deleted by the daemon — only by retention pruning. This is conservative but means storage grows. A future "compact" mode could archive raw events after consolidation.

2. **Multi-vault coordination.** If a user has multiple vaults, should the daemon run one loop per vault or one shared loop? Current design: one loop, iterates over all configured vaults sequentially.

3. **MCP sampling vs. direct LLM.** The daemon currently calls the LLM directly via `completeChat` / `daemon-llm.mjs`. An alternative is to use MCP sampling (request the host client's LLM via `createMessage`). This would let the daemon use whatever model the user's IDE is configured with, but adds coupling to MCP transport. Worth exploring as an optional mode.

/**
 * Daemon process lifecycle: start, stop, status, scheduling, idle detection.
 * Phase B of the Daemon Consolidation Spec.
 * Phase F adds cost tracking and daily cap enforcement.
 *
 * Exports:
 *   getPidPath, getLogPath             — resolve file paths from config
 *   writePidFile, readPidFile,
 *   removePidFile, isProcessAlive,
 *   detectStalePid                     — PID file management
 *   appendDaemonLog, readDaemonLog     — structured JSONL log
 *   isIdle                             — idle detection via mtime
 *   validateLlmConnectivity            — LLM health check (trivial test prompt)
 *   getDaemonStatus                    — running state, last pass, next pass, cost
 *   stopDaemon                         — SIGTERM → SIGKILL with timeout
 *   startDaemon                        — full foreground lifecycle
 */

import fs from 'fs';
import path from 'path';
import { consolidateMemory } from './memory-consolidate.mjs';
import { completeChat } from './llm-complete.mjs';
import { resolveMemoryDir } from './memory.mjs';
import { computeCallCost, getDailyCost, recordCallCost } from './daemon-cost.mjs';

// ── Path helpers ──────────────────────────────────────────────────────────────

/**
 * Absolute path of the PID file.
 * @param {object} config — loadConfig() result
 * @returns {string}
 */
export function getPidPath(config) {
  return path.join(config.data_dir, 'daemon.pid');
}

/**
 * Absolute path of the daemon log file.
 * Falls back to {data_dir}/daemon.log when daemon.log_file is not set.
 * @param {object} config — loadConfig() result
 * @returns {string}
 */
export function getLogPath(config) {
  const explicitLogFile = config.daemon?.log_file;
  if (explicitLogFile) return explicitLogFile;
  return path.join(config.data_dir, 'daemon.log');
}

// ── PID file management ───────────────────────────────────────────────────────

/**
 * Write a PID to the PID file. Creates parent dirs as needed.
 * @param {string} pidPath
 * @param {number} pid
 */
export function writePidFile(pidPath, pid) {
  fs.mkdirSync(path.dirname(pidPath), { recursive: true });
  fs.writeFileSync(pidPath, String(pid), 'utf8');
}

/**
 * Read the PID from the PID file. Returns null if missing or unparseable.
 * @param {string} pidPath
 * @returns {number|null}
 */
export function readPidFile(pidPath) {
  try {
    const raw = fs.readFileSync(pidPath, 'utf8').trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Remove the PID file, silently ignoring missing-file errors.
 * @param {string} pidPath
 */
export function removePidFile(pidPath) {
  try {
    fs.unlinkSync(pidPath);
  } catch {
    // ignore
  }
}

/**
 * Check whether a given process is alive by sending signal 0.
 * @param {number} pid
 * @returns {boolean}
 */
export function isProcessAlive(pid) {
  if (!pid || typeof pid !== 'number' || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect a stale PID file (file exists but the process is no longer running).
 * @param {string} pidPath
 * @returns {{ stale: boolean, pid: number|null }}
 */
export function detectStalePid(pidPath) {
  const pid = readPidFile(pidPath);
  if (pid === null) return { stale: false, pid: null };
  return { stale: !isProcessAlive(pid), pid };
}

// ── Daemon log ────────────────────────────────────────────────────────────────

/**
 * Append a structured entry to the daemon log (JSONL).
 * Automatically adds a `ts` field.
 * @param {string} logPath
 * @param {object} entry
 */
export function appendDaemonLog(logPath, entry) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  // ts always reflects the time the entry was written, overriding any ts in entry
  const line = JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n';
  fs.appendFileSync(logPath, line, 'utf8');
}

/**
 * Read all entries from the daemon log, skipping malformed lines.
 * @param {string} logPath
 * @param {{ tail?: number }} [opts] — if tail > 0, return last N entries
 * @returns {object[]}
 */
export function readDaemonLog(logPath, { tail } = {}) {
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const entries = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // skip malformed
      }
    }
    if (tail && tail > 0) return entries.slice(-tail);
    return entries;
  } catch {
    return [];
  }
}

// ── Idle detection ────────────────────────────────────────────────────────────

/**
 * Determine whether the vault is idle by checking the mtime of the memory
 * activity files (events.jsonl, state.json).
 *
 * Returns true when:
 *  - the files don't exist (no recorded activity), or
 *  - the most recent mtime is older than idle_threshold_minutes.
 *
 * @param {object} config — loadConfig() result with daemon.idle_threshold_minutes
 * @returns {boolean}
 */
export function isIdle(config) {
  const thresholdMs = (config.daemon?.idle_threshold_minutes ?? 15) * 60_000;
  const now = Date.now();

  const memDir = resolveMemoryDir(config.data_dir, 'default');
  const filesToCheck = [
    path.join(memDir, 'events.jsonl'),
    path.join(memDir, 'state.json'),
  ];

  let latestMtime = 0;
  for (const f of filesToCheck) {
    try {
      const stat = fs.statSync(f);
      if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
    } catch {
      // file does not exist — skip
    }
  }

  // No files → no activity signal → treat as idle so daemon proceeds
  if (latestMtime === 0) return true;
  return now - latestMtime >= thresholdMs;
}

// ── LLM connectivity validation ───────────────────────────────────────────────

/**
 * Send a trivial test prompt to the LLM and verify we get a non-empty response.
 * Fails fast with a descriptive error if the LLM is unreachable.
 *
 * @param {object} config — loadConfig() result
 * @param {Function} [llmFn] — injectable LLM function (defaults to completeChat)
 * @returns {Promise<true>}
 * @throws {Error} when the LLM is unreachable or returns an empty response
 */
export async function validateLlmConnectivity(config, llmFn = completeChat) {
  let response;
  try {
    response = await llmFn(config, {
      system: 'You are a health check. Respond with exactly: OK',
      user: 'Health check. Respond with OK.',
      maxTokens: 10,
    });
  } catch (err) {
    throw new Error(`LLM unreachable: ${err.message}`);
  }
  if (!response || !String(response).trim()) {
    throw new Error('LLM connectivity check returned empty response');
  }
  return true;
}

// ── Status ────────────────────────────────────────────────────────────────────

/**
 * Return the current daemon status without side effects.
 *
 * @param {object} config — loadConfig() result
 * @returns {{
 *   running: boolean,
 *   pid: number|null,
 *   started_at: string|null,
 *   uptime_ms: number|null,
 *   last_pass: { ts: string, events_processed: number, topics: number }|null,
 *   next_pass_at: string|null,
 *   log_path: string,
 *   pid_path: string,
 *   cost_today_usd: number,
 *   cost_cap_usd: number|null,
 * }}
 */
export function getDaemonStatus(config) {
  const pidPath = getPidPath(config);
  const logPath = getLogPath(config);

  const pid = readPidFile(pidPath);
  const running = pid !== null && isProcessAlive(pid);

  const log = readDaemonLog(logPath);
  const startupEntry = log.find((e) => e.event === 'startup');
  const lastPassEntry = [...log].reverse().find((e) => e.event === 'pass_complete');

  const uptimeMs = running && startupEntry
    ? Date.now() - new Date(startupEntry.ts).getTime()
    : null;

  let nextPassAt = null;
  if (running && lastPassEntry) {
    const intervalMs = (config.daemon?.interval_minutes ?? 120) * 60_000;
    nextPassAt = new Date(new Date(lastPassEntry.ts).getTime() + intervalMs).toISOString();
  }

  return {
    running,
    pid: running ? pid : null,
    started_at: running ? (startupEntry?.ts ?? null) : null,
    uptime_ms: running ? uptimeMs : null,
    last_pass: lastPassEntry
      ? {
          ts: lastPassEntry.ts,
          events_processed: lastPassEntry.events_processed ?? 0,
          topics: lastPassEntry.topics ?? 0,
        }
      : null,
    next_pass_at: nextPassAt,
    log_path: logPath,
    pid_path: pidPath,
    cost_today_usd: getDailyCost(config),
    cost_cap_usd: config.daemon?.max_cost_per_day_usd ?? null,
  };
}

// ── Stop ──────────────────────────────────────────────────────────────────────

/**
 * Stop a running daemon.
 *
 * Reads the PID from the PID file, sends SIGTERM, and waits up to killTimeoutMs
 * for the process to exit. Falls back to SIGKILL if it doesn't exit in time.
 * Cleans up the stale PID file in all cases.
 *
 * @param {object} config — loadConfig() result
 * @param {{
 *   killTimeoutMs?: number,
 *   _signalFn?: (pid: number, signal: string) => void,
 * }} [opts]
 * @returns {Promise<{ stopped: boolean, pid?: number, signal?: string, reason?: string }>}
 */
export async function stopDaemon(config, { killTimeoutMs = 10_000, _signalFn } = {}) {
  const pidPath = getPidPath(config);
  const pid = readPidFile(pidPath);

  if (!pid) {
    return { stopped: false, reason: 'no PID file found' };
  }

  if (!isProcessAlive(pid)) {
    removePidFile(pidPath);
    return { stopped: false, reason: 'process not running (stale PID file cleaned up)', pid };
  }

  const sendSignal = _signalFn ?? ((p, sig) => process.kill(p, sig));
  sendSignal(pid, 'SIGTERM');

  const deadline = Date.now() + killTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    if (!isProcessAlive(pid)) {
      removePidFile(pidPath);
      return { stopped: true, pid, signal: 'SIGTERM' };
    }
  }

  // Process didn't exit — escalate to SIGKILL
  try {
    sendSignal(pid, 'SIGKILL');
  } catch {
    // may already be dead
  }
  await new Promise((r) => setTimeout(r, 200));
  removePidFile(pidPath);
  return { stopped: true, pid, signal: 'SIGKILL' };
}

// ── Start (foreground) ────────────────────────────────────────────────────────

/**
 * Start the daemon in the foreground. Blocks until shutdown.
 *
 * Lifecycle:
 *  1. Crash recovery: detects stale PID file and removes it.
 *  2. Validates LLM connectivity (trivial test prompt).
 *  3. Writes PID file.
 *  4. Logs startup to daemon log.
 *  5. If run_on_start: runs one full consolidation pass immediately.
 *  6. Enters scheduling loop: sleeps interval_minutes, checks idle, calls consolidateMemory.
 *  7. On SIGTERM/SIGINT: writes shutdown event, removes PID file, returns.
 *
 * Injectable options for testing (prefixed with _):
 *  - _sleep(ms): replaces the interval sleep (useful for fast test cycles)
 *  - _signalTarget: EventEmitter to listen on instead of process (avoids polluting process handlers)
 *  - consolidateFn: replaces consolidateMemory (mock in tests)
 *  - llmFn: replaces completeChat (mock in tests)
 *  - costRates: overrides DEFAULT_RATES for cost computation (lets tests use exact values)
 *
 * @param {object} config — loadConfig() result
 * @param {{
 *   consolidateFn?: Function,
 *   llmFn?: Function,
 *   costRates?: { input_per_token?: number, output_per_token?: number },
 *   _sleep?: (ms: number) => Promise<void>,
 *   _signalTarget?: import('events').EventEmitter,
 * }} [opts]
 * @returns {Promise<{ stopped: boolean }>}
 */
export async function startDaemon(config, opts = {}) {
  const {
    consolidateFn = consolidateMemory,
    llmFn = completeChat,
    costRates,
    _sleep: injectedSleep,
    _signalTarget = process,
  } = opts;

  // Wrap llmFn so every LLM call made during consolidation is recorded to the
  // daily cost accumulator. The raw llmFn is still used for the LLM health
  // check (validateLlmConnectivity) so startup overhead is not billed.
  const trackedLlmFn = async (cfg, llmOpts) => {
    const response = await llmFn(cfg, llmOpts);
    const cost = computeCallCost(llmOpts, String(response ?? ''), costRates);
    recordCallCost(config, cost);
    return response;
  };

  const pidPath = getPidPath(config);
  const logPath = getLogPath(config);
  const daemonCfg = config.daemon ?? {};

  // ── 1. Crash recovery ─────────────────────────────────────────────────────
  const { stale, pid: stalePid } = detectStalePid(pidPath);
  if (stale) {
    appendDaemonLog(logPath, { event: 'stale_pid_cleanup', stale_pid: stalePid });
    removePidFile(pidPath);
  }

  // Refuse to start a second instance
  const existingPid = readPidFile(pidPath);
  if (existingPid && isProcessAlive(existingPid)) {
    throw new Error(`Daemon already running (PID ${existingPid})`);
  }

  // ── 2. Validate LLM ───────────────────────────────────────────────────────
  await validateLlmConnectivity(config, llmFn);

  // ── 3. Write PID ──────────────────────────────────────────────────────────
  writePidFile(pidPath, process.pid);

  // ── 4. Log startup ────────────────────────────────────────────────────────
  appendDaemonLog(logPath, {
    event: 'startup',
    pid: process.pid,
    interval_minutes: daemonCfg.interval_minutes ?? 120,
    idle_only: daemonCfg.idle_only ?? true,
    dry_run: daemonCfg.dry_run ?? false,
  });

  // ── Signal handling ───────────────────────────────────────────────────────
  let running = true;
  let wakeUp = null; // resolves the current cancellable sleep early

  const shutdown = (signal) => {
    if (!running) return;
    running = false;
    if (wakeUp) wakeUp(); // cancel the waiting sleep
    appendDaemonLog(logPath, { event: 'shutdown', signal, pid: process.pid });
    removePidFile(pidPath);
  };

  const sigtermHandler = () => shutdown('SIGTERM');
  const sigintHandler = () => shutdown('SIGINT');
  _signalTarget.on('SIGTERM', sigtermHandler);
  _signalTarget.on('SIGINT', sigintHandler);

  // Cancellable sleep: wakeUp resolves it early when shutdown is called.
  // Tests may inject their own _sleep to skip the wait entirely.
  const cancellableSleep = (ms) =>
    new Promise((resolve) => {
      wakeUp = resolve;
      setTimeout(resolve, ms);
    });
  const sleepFn = injectedSleep ?? cancellableSleep;

  // ── 5. run_on_start ───────────────────────────────────────────────────────
  if (daemonCfg.run_on_start) {
    try {
      const result = await consolidateFn(config, { llmFn: trackedLlmFn });
      appendDaemonLog(logPath, {
        event: 'pass_complete',
        trigger: 'run_on_start',
        events_processed: result.total_events,
        topics: result.topics.length,
      });
    } catch (err) {
      appendDaemonLog(logPath, {
        event: 'pass_error',
        error: err.message,
        trigger: 'run_on_start',
      });
    }
  }

  // ── 6. Scheduling loop ────────────────────────────────────────────────────
  const intervalMs = (daemonCfg.interval_minutes ?? 120) * 60_000;
  const maxCostPerDay = daemonCfg.max_cost_per_day_usd ?? null;

  while (running) {
    await sleepFn(intervalMs);
    if (!running) break;

    if (daemonCfg.idle_only && !isIdle(config)) {
      appendDaemonLog(logPath, { event: 'skip_not_idle' });
      continue;
    }

    // Cost cap guard: skip the pass (but keep the daemon running) if the
    // daily budget has been met or exceeded. Null cap means no limit.
    if (maxCostPerDay !== null) {
      const costToday = getDailyCost(config);
      if (costToday >= maxCostPerDay) {
        appendDaemonLog(logPath, {
          event: 'cost_cap_reached',
          cost_today_usd: costToday,
          cap_usd: maxCostPerDay,
        });
        continue;
      }
    }

    try {
      const result = await consolidateFn(config, { llmFn: trackedLlmFn });
      appendDaemonLog(logPath, {
        event: 'pass_complete',
        trigger: 'scheduled',
        events_processed: result.total_events,
        topics: result.topics.length,
      });
    } catch (err) {
      appendDaemonLog(logPath, {
        event: 'pass_error',
        error: err.message,
        trigger: 'scheduled',
      });
    }
  }

  // Clean up signal listeners to avoid handler accumulation in tests
  _signalTarget.off('SIGTERM', sigtermHandler);
  _signalTarget.off('SIGINT', sigintHandler);

  return { stopped: true };
}

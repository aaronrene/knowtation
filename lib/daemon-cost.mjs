/**
 * Cost tracking for the daemon: token estimation, daily cost accumulation,
 * and cap-enforcement helpers. Phase F of the Daemon Consolidation Spec.
 *
 * The cost record lives in {data_dir}/daemon-cost.json, keyed by UTC date
 * (YYYY-MM-DD). The daily counter resets automatically each calendar day
 * because only the key matching today's date is ever read. Old keys are
 * ignored (they remain in the file but are never summed).
 *
 * Default model rates (gpt-4o-mini):
 *   $0.15 / 1M input tokens
 *   $0.60 / 1M output tokens
 *
 * All public functions accept an optional `rates` parameter so that tests
 * can use exact, deterministic values without depending on specific dollar
 * amounts tied to any particular model.
 *
 * Note on concurrency: reads and writes to daemon-cost.json are synchronous
 * and sequential within a single Node.js process (the daemon is single-
 * threaded). No locking is needed.
 *
 * Exports:
 *   DEFAULT_RATES          — default per-token USD rates
 *   estimateTokens         — char-count / 4 heuristic (swap for exact counter)
 *   computeCallCost        — USD cost for one LLM call (opts + raw response)
 *   getCostFilePath        — resolve {data_dir}/daemon-cost.json from config
 *   utcDateString          — injectable today-UTC helper (YYYY-MM-DD)
 *   getDailyCost           — read accumulated cost for a UTC date
 *   recordCallCost         — add a cost amount to today's running total
 *   resetDailyCost         — write an empty cost record (used by tests / manual resets)
 */

import fs from 'fs';
import path from 'path';

// ── Default rates ─────────────────────────────────────────────────────────────

export const DEFAULT_RATES = {
  /** USD per input token (gpt-4o-mini: $0.15 / 1M) */
  input_per_token: 0.15 / 1_000_000,
  /** USD per output token (gpt-4o-mini: $0.60 / 1M) */
  output_per_token: 0.60 / 1_000_000,
};

// ── Token estimation ──────────────────────────────────────────────────────────

/**
 * Estimate the number of tokens in a text string using a 4-chars-per-token
 * heuristic. Designed as a thin wrapper so it can be replaced with an exact
 * counter (e.g. tiktoken) without changing any call sites.
 *
 * @param {string} text
 * @returns {number} estimated token count (>= 0, integer)
 */
export function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
}

// ── Per-call cost computation ─────────────────────────────────────────────────

/**
 * Compute the USD cost for a single LLM call from the call options and
 * the raw response string.
 *
 * Input tokens  = estimateTokens(opts.system + opts.user)
 * Output tokens = estimateTokens(rawResponse)
 *
 * @param {{ system?: string, user?: string }} opts — LLM call options
 * @param {string} rawResponse — raw LLM response text
 * @param {{ input_per_token?: number, output_per_token?: number }} [rates]
 *   — overrides DEFAULT_RATES; callers may supply any finite positive values
 * @returns {number} USD cost >= 0
 */
export function computeCallCost(opts, rawResponse, rates) {
  const r = { ...DEFAULT_RATES, ...(rates ?? {}) };
  const inputText = (opts?.system ?? '') + (opts?.user ?? '');
  const inputTokens = estimateTokens(inputText);
  const outputTokens = estimateTokens(String(rawResponse ?? ''));
  return inputTokens * r.input_per_token + outputTokens * r.output_per_token;
}

// ── File path helper ──────────────────────────────────────────────────────────

/**
 * Absolute path of the cost tracking file.
 * @param {object} config — loadConfig() result
 * @returns {string}
 */
export function getCostFilePath(config) {
  return path.join(config.data_dir, 'daemon-cost.json');
}

// ── UTC date helper ───────────────────────────────────────────────────────────

/**
 * Return today's UTC date as a YYYY-MM-DD string.
 * Exported so callers can inject a different `now` for deterministic tests.
 *
 * @param {Date} [now] — defaults to new Date()
 * @returns {string} e.g. "2026-04-05"
 */
export function utcDateString(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// ── Daily cost read ───────────────────────────────────────────────────────────

/**
 * Read the accumulated USD cost for a given UTC calendar date from the cost
 * file. Returns 0 when the file is missing, cannot be parsed, or has no
 * entry for the requested date.
 *
 * @param {object} config — loadConfig() result
 * @param {string} [date] — YYYY-MM-DD; defaults to today UTC
 * @returns {number} total USD cost for that date (>= 0)
 */
export function getDailyCost(config, date) {
  const key = date ?? utcDateString();
  try {
    const raw = fs.readFileSync(getCostFilePath(config), 'utf8');
    const data = JSON.parse(raw);
    return typeof data[key] === 'number' && data[key] >= 0 ? data[key] : 0;
  } catch {
    return 0;
  }
}

// ── Daily cost write ──────────────────────────────────────────────────────────

/**
 * Add `costUsd` to the running total for the given date in the cost file.
 * Creates parent directories and the file itself if they do not exist.
 * Silently ignores zero or negative amounts (not an error, just a no-op).
 *
 * @param {object} config — loadConfig() result
 * @param {number} costUsd — amount to add (ignored if <= 0)
 * @param {string} [date] — YYYY-MM-DD; defaults to today UTC
 */
export function recordCallCost(config, costUsd, date) {
  if (typeof costUsd !== 'number' || costUsd <= 0) return;

  const key = date ?? utcDateString();
  const filePath = getCostFilePath(config);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (typeof data !== 'object' || data === null || Array.isArray(data)) data = {};
  } catch {
    // file missing or corrupt — start fresh
  }

  data[key] = (typeof data[key] === 'number' && data[key] >= 0 ? data[key] : 0) + costUsd;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ── Daily cost reset ──────────────────────────────────────────────────────────

/**
 * Reset the daily cost record by writing an empty JSON object to the cost
 * file. Intended for tests and manual operator resets.
 *
 * @param {object} config — loadConfig() result
 */
export function resetDailyCost(config) {
  const filePath = getCostFilePath(config);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({}), 'utf8');
}

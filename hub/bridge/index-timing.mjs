/**
 * Per-request timing instrumentation for POST /api/v1/index in hub/bridge/server.mjs.
 *
 * Why this exists: when a hosted re-index hits the Netlify sync-function timeout (~26–30 s
 * before this PR; ~60 s after), the gateway logs a generic 30 s duration but neither side
 * tells us which sub-step (canister export, embed loop, blob persist, etc.) dominated.
 * Without that signal we cannot tell whether the bottleneck is provider latency
 * (DeepInfra batch embed), the canister export, or the Netlify Blobs vector persist —
 * all of which require different fixes (parallelize embed, async/background, etc.).
 *
 * Logs a single JSON object per step under a stable `type` so Netlify / Datadog filters
 * can scrape reliably. No PII beyond vault_id + sanitized canister_uid (already in use).
 *
 * Pure module: side-effect is the injected logger only (default console.log).
 */

/**
 * @param {object} [opts]
 * @param {string|null} [opts.vaultId]
 * @param {string|null} [opts.canisterUid]
 * @param {(line: string) => void} [opts.logger] - Defaults to console.log; injected for tests.
 * @param {() => number} [opts.now] - Defaults to Date.now; injected for tests.
 * @returns {{ step: (name: string, extra?: object) => number, finish: (extra?: object) => number, totalMs: () => number }}
 */
export function createIndexTimer({ vaultId = null, canisterUid = null, logger = console.log, now = Date.now } = {}) {
  const t0 = now();
  let last = t0;
  let stepCount = 0;
  let finished = false;

  function step(name, extra = {}) {
    if (finished) return 0;
    if (typeof name !== 'string' || !name) {
      throw new Error('createIndexTimer.step requires a non-empty name');
    }
    const t = now();
    const ms = t - last;
    const totalMs = t - t0;
    last = t;
    stepCount++;
    const line = {
      type: 'knowtation_index_step',
      ts: new Date(t).toISOString(),
      vault_id: vaultId,
      canister_uid: canisterUid,
      step: name,
      ms,
      total_ms: totalMs,
      ...extra,
    };
    logger(JSON.stringify(line));
    return ms;
  }

  function finish(extra = {}) {
    if (finished) return now() - t0;
    finished = true;
    const t = now();
    const totalMs = t - t0;
    const line = {
      type: 'knowtation_index_done',
      ts: new Date(t).toISOString(),
      vault_id: vaultId,
      canister_uid: canisterUid,
      total_ms: totalMs,
      step_count: stepCount,
      ...extra,
    };
    logger(JSON.stringify(line));
    return totalMs;
  }

  function totalMs() {
    return now() - t0;
  }

  return { step, finish, totalMs };
}

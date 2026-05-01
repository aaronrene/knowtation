/**
 * Bounded-concurrency worker pool for embedding (or any other) batches.
 *
 * Why this exists: hub/bridge/server.mjs `POST /api/v1/index` historically embedded
 * batches strictly sequentially. After the OpenAI → DeepInfra (BAAI/bge-large-en-v1.5)
 * switch, per-batch latency roughly doubled (median 2.5s, tails 5–8.5s) and the
 * sequential loop on a 251-chunk vault exceeded Netlify's 60s synchronous-function
 * cap (see `hub/bridge/index-timing.mjs` post-mortem).
 *
 * `runWithConcurrency` lets the bridge fan out N requests to the embedding provider
 * in parallel while preserving:
 *   - input order in the returned array (so we can zip back to chunks);
 *   - "fail fast" semantics: as soon as one task throws, no new tasks are scheduled
 *     and `Promise.all` rejects with the first observed error;
 *   - stable concurrency (never more than `concurrency` workers in flight).
 *
 * No third-party dependency: this lives at the cold-start path of the bridge
 * Netlify Function, where every extra dep adds bundle size and load time.
 */

/**
 * Run `tasks` with at most `concurrency` in flight. Returns results in the same
 * order as `tasks`. If any task throws, the returned promise rejects with the
 * first error and remaining unstarted tasks are skipped (already-started tasks
 * are allowed to settle to avoid leaking unhandled rejections).
 *
 * @template T
 * @param {Array<() => Promise<T>>} tasks - Each task is a thunk that returns a Promise.
 *   Using thunks (not pre-started promises) is what enables true concurrency capping;
 *   if you pass `Promise[]` instead, all of them start immediately and `concurrency`
 *   becomes a no-op.
 * @param {{ concurrency?: number, onSettled?: (info: { index: number, ok: boolean, error?: unknown, ms: number }) => void }} [options]
 *   - `concurrency`: max workers in flight. Coerced to integer; floors at 1, ceils at `tasks.length`.
 *   - `onSettled`: optional per-task callback invoked after each task settles. Used by the
 *     bridge to feed per-batch timing into `createIndexTimer.step('embed_batch', ...)`.
 * @returns {Promise<T[]>} Results in `tasks`-input order.
 */
export async function runWithConcurrency(tasks, options = {}) {
  if (!Array.isArray(tasks)) {
    throw new TypeError('runWithConcurrency: tasks must be an array of thunks');
  }
  for (let i = 0; i < tasks.length; i++) {
    if (typeof tasks[i] !== 'function') {
      throw new TypeError(
        `runWithConcurrency: tasks[${i}] must be a thunk (() => Promise), got ${typeof tasks[i]}. ` +
          'If you have an array of pre-started promises, wrap each: tasks.map((p) => () => p).',
      );
    }
  }
  if (tasks.length === 0) return [];

  const rawConcurrency = options.concurrency;
  let concurrency = Number.isFinite(rawConcurrency) ? Math.floor(Number(rawConcurrency)) : 1;
  if (concurrency < 1) concurrency = 1;
  if (concurrency > tasks.length) concurrency = tasks.length;

  const onSettled = typeof options.onSettled === 'function' ? options.onSettled : null;

  const results = new Array(tasks.length);
  let nextIndex = 0;
  let firstError = null;

  async function worker() {
    while (true) {
      if (firstError) return;
      const myIndex = nextIndex++;
      if (myIndex >= tasks.length) return;
      const startedAt = Date.now();
      try {
        const value = await tasks[myIndex]();
        const ms = Date.now() - startedAt;
        results[myIndex] = value;
        if (onSettled) {
          try {
            onSettled({ index: myIndex, ok: true, ms });
          } catch (_) {
            // onSettled is observability-only; never let a logger bug fail the index.
          }
        }
      } catch (err) {
        const ms = Date.now() - startedAt;
        if (!firstError) firstError = err;
        if (onSettled) {
          try {
            onSettled({ index: myIndex, ok: false, error: err, ms });
          } catch (_) {}
        }
      }
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);
  if (firstError) throw firstError;
  return results;
}

/**
 * Parse `INDEXER_EMBED_CONCURRENCY` (env or override) and clamp to a safe range.
 * Default 5: balances DeepInfra rate-limit headroom with wall-clock speedup for
 * the bridge's 60s sync cap. Hard ceiling 16 so an env typo can't fork 1000 sockets.
 *
 * @param {string|number|null|undefined} raw
 * @returns {number}
 */
export function parseEmbedConcurrency(raw) {
  if (raw == null || raw === '') return 5;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 1) return 5;
  if (n > 16) return 16;
  return Math.floor(n);
}

/**
 * Parse `INDEXER_EMBED_BATCH_SIZE`. Default 50 (DeepInfra/OpenAI both accept ≥50
 * inputs per `/v1/embeddings` request without payload-size issues for 2KB chunks).
 * Hard ceiling 256 so accidental "1000" doesn't blow past provider per-request limits.
 *
 * @param {string|number|null|undefined} raw
 * @returns {number}
 */
export function parseEmbedBatchSize(raw) {
  if (raw == null || raw === '') return 50;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 1) return 50;
  if (n > 256) return 256;
  return Math.floor(n);
}

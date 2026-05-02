/**
 * Pure preflight estimator for `hub/bridge/server.mjs POST /api/v1/index`.
 *
 * The bridge runs as a Netlify synchronous function (60 s platform max). After the
 * OpenAI(1536) → DeepInfra(1024 BAAI/bge-large-en-v1.5) switch, per-batch embed
 * latency went from ~1.2 s to ~2.5 s median (5–8.5 s tails). With ~50 chunks/batch
 * and concurrency 5, that means a vault of ~1500+ chunks needing a full re-embed
 * can blow past 60 s and the gateway returns a 504 mid-request.
 *
 * Rather than always paying the latency tax of a background-function kickoff, the
 * sync handler does a cheap preflight (canister export + chunking + cache lookup
 * are already happening) and then asks THIS module: "given chunks_to_embed +
 * concurrency, will it fit in the sync budget?". When it won't, the handler kicks
 * off a Netlify background function (15 min cap) and returns 202 immediately.
 *
 * Pure module: no I/O, no env reads, no time. Tests must be deterministic.
 */

/**
 * Per-batch embedding latency (median ms) used by the estimator. Sourced from
 * `hub/bridge/index-timing.mjs` post-mortem on production logs after the DeepInfra
 * switch (median 2.5 s, p95 ~5 s). We use the median, NOT p95, because we already
 * have a hard ceiling (`SYNC_BUDGET_SECONDS_DEFAULT`) below the platform max — a
 * single tail batch that pushes us 4–5 s over our estimate is still safely under
 * 60 s, but planning every job for p95 would route 70 %+ of jobs to background
 * unnecessarily and cost an extra cold start each time.
 *
 * If you swap providers (e.g. back to OpenAI 1.2 s/batch, or to a faster
 * Anthropic embedding endpoint), update this constant — the rest of the math
 * scales linearly.
 */
export const DEFAULT_EMBED_MS_PER_BATCH = 2500;

/**
 * Sync budget. Netlify's platform max for synchronous functions is 60 s
 * (docs.netlify.com/build/functions/overview); we reserve 30 s as headroom for
 * preflight + post-embed steps (chunk hash compute, ensureCollection migration,
 * upserts, persistVectorsToBlob) so a 30 s embed phase still finishes inside the
 * function timeout.
 */
export const SYNC_BUDGET_SECONDS_DEFAULT = 30;

/**
 * Hard chunk-count ceiling for the sync path. Even when the time estimate looks
 * safe, indexing >= 500 chunks pulls in a lot of upsert + persist work whose
 * tail-latency is hard to predict (Blob upload contention, sqlite-vec single
 * writer). Routing those to background is cheaper than discovering at 58 s that
 * we're out of budget and the gateway already 504'd.
 */
export const MAX_SYNC_CHUNKS_DEFAULT = 500;

/**
 * Per-chunk overhead for the upsert + persist phases. ~5 ms is a conservative
 * upper bound observed in `index-timing.mjs` step `upsert_total` for the bridge
 * sqlite-vec backend (most upserts come in well under 2 ms/chunk; we round up).
 */
export const UPSERT_MS_PER_CHUNK = 5;

/**
 * Fixed overhead added to every estimate (canister export already done by the
 * time we reach the estimator, but ensureCollection + chunk hash compute +
 * persistVectorsToBlob still need to run after the embed phase).
 */
export const FIXED_OVERHEAD_MS = 3000;

/**
 * Estimate wall-clock seconds for the embed + upsert + persist phases of a
 * re-index, given how many chunks need re-embedding and the active parallelism
 * settings.
 *
 * Math: `embedBatches = ceil(chunksToEmbed / batchSize)` total embed batches.
 * With bounded concurrency `concurrency`, the wall-clock is
 * `ceil(embedBatches / concurrency) * msPerBatch` (round-robin worker pool;
 * matches `lib/parallel-embed-pool.mjs:runWithConcurrency`). Add per-chunk
 * upsert overhead and a fixed tail for the post-embed steps, divide by 1000,
 * round up.
 *
 * @param {{
 *   chunksToEmbed: number,
 *   batchSize: number,
 *   concurrency: number,
 *   msPerBatch?: number,
 *   upsertMsPerChunk?: number,
 *   fixedOverheadMs?: number,
 * }} input
 * @returns {number} Estimated whole seconds (>= 0). Returns 0 if `chunksToEmbed <= 0`.
 */
export function estimateEmbedSeconds(input) {
  if (input == null || typeof input !== 'object') {
    throw new TypeError('estimateEmbedSeconds: input is required');
  }
  const chunksToEmbed = numberOr(input.chunksToEmbed, 0);
  if (chunksToEmbed <= 0) return 0;
  const batchSize = numberOr(input.batchSize, 50);
  const concurrency = numberOr(input.concurrency, 5);
  if (batchSize < 1) throw new RangeError('estimateEmbedSeconds: batchSize must be >= 1');
  if (concurrency < 1) throw new RangeError('estimateEmbedSeconds: concurrency must be >= 1');
  const msPerBatch = numberOr(input.msPerBatch, DEFAULT_EMBED_MS_PER_BATCH);
  const upsertMsPerChunk = numberOr(input.upsertMsPerChunk, UPSERT_MS_PER_CHUNK);
  const fixedOverheadMs = numberOr(input.fixedOverheadMs, FIXED_OVERHEAD_MS);

  const embedBatches = Math.ceil(chunksToEmbed / batchSize);
  const parallelMs = Math.ceil(embedBatches / concurrency) * msPerBatch;
  const upsertMs = chunksToEmbed * upsertMsPerChunk;
  const totalMs = parallelMs + upsertMs + fixedOverheadMs;
  return Math.ceil(totalMs / 1000);
}

/**
 * Routing decision for the sync handler. Returns `{ shouldUseBackground, reason }`.
 * Background mode wins on ANY of the following so we never trip the 60 s wall:
 *   - estimated seconds >= sync budget
 *   - chunks to embed >= hard chunk ceiling (tail-latency safety)
 *   - dimension migration just happened (full re-embed of every prior vector)
 *   - first-time index of this vault (cache empty → full re-embed)
 *
 * The first matching reason is returned (not the union), because the calling
 * timer + 202 response only need one human-readable cause.
 *
 * @param {{
 *   chunksToEmbed: number,
 *   estimatedSeconds: number,
 *   syncBudgetSeconds?: number,
 *   maxSyncChunks?: number,
 *   dimMigrationRequired?: boolean,
 *   isFirstIndex?: boolean,
 * }} input
 * @returns {{ shouldUseBackground: boolean, reason: 'fits_in_sync' | 'estimate_exceeds_budget' | 'chunk_count_exceeds_max' | 'dim_migration' | 'first_index' }}
 */
export function shouldUseBackgroundIndex(input) {
  if (input == null || typeof input !== 'object') {
    throw new TypeError('shouldUseBackgroundIndex: input is required');
  }
  const chunksToEmbed = numberOr(input.chunksToEmbed, 0);
  const estimatedSeconds = numberOr(input.estimatedSeconds, 0);
  const syncBudgetSeconds = numberOr(input.syncBudgetSeconds, SYNC_BUDGET_SECONDS_DEFAULT);
  const maxSyncChunks = numberOr(input.maxSyncChunks, MAX_SYNC_CHUNKS_DEFAULT);
  const dimMigrationRequired = Boolean(input.dimMigrationRequired);
  const isFirstIndex = Boolean(input.isFirstIndex);

  if (dimMigrationRequired && chunksToEmbed > 0) {
    return { shouldUseBackground: true, reason: 'dim_migration' };
  }
  if (isFirstIndex && chunksToEmbed > 0) {
    return { shouldUseBackground: true, reason: 'first_index' };
  }
  if (chunksToEmbed >= maxSyncChunks) {
    return { shouldUseBackground: true, reason: 'chunk_count_exceeds_max' };
  }
  if (estimatedSeconds >= syncBudgetSeconds) {
    return { shouldUseBackground: true, reason: 'estimate_exceeds_budget' };
  }
  return { shouldUseBackground: false, reason: 'fits_in_sync' };
}

/**
 * Parse `INDEXER_SYNC_BUDGET_SECONDS` (env or override). Defaults to 30; clamps
 * to `[5, 55]` so a typo can't push the budget above the platform max (60 s) or
 * effectively disable sync mode.
 *
 * @param {string|number|null|undefined} raw
 * @returns {number}
 */
export function parseSyncBudgetSeconds(raw) {
  if (raw == null || raw === '') return SYNC_BUDGET_SECONDS_DEFAULT;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n)) return SYNC_BUDGET_SECONDS_DEFAULT;
  if (n < 5) return 5;
  if (n > 55) return 55;
  return Math.floor(n);
}

/**
 * Parse `INDEXER_MAX_SYNC_CHUNKS` (env or override). Defaults to 500; clamps
 * to `[50, 5000]` so a typo can't disable the chunk-count safety net.
 *
 * @param {string|number|null|undefined} raw
 * @returns {number}
 */
export function parseMaxSyncChunks(raw) {
  if (raw == null || raw === '') return MAX_SYNC_CHUNKS_DEFAULT;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n)) return MAX_SYNC_CHUNKS_DEFAULT;
  if (n < 50) return 50;
  if (n > 5000) return 5000;
  return Math.floor(n);
}

function numberOr(value, fallback) {
  if (value == null) return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

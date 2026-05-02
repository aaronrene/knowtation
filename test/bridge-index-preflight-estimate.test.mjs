/**
 * Unit tests for `lib/bridge-index-preflight-estimate.mjs`.
 *
 * The estimator is the single decision point that routes a `POST /api/v1/index`
 * call to either the synchronous path (returns indexed result inline, ~10 s) or
 * the background path (returns 202 + jobId, runs up to 15 min in a Netlify
 * background function). A regression here either:
 *   - routes too many jobs to background (slow UX, extra cold start), or
 *   - routes a too-large job to sync (gateway 504 mid-request).
 *
 * Both failure modes are exactly the things this PR exists to prevent, so the
 * routing math gets locked in here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateEmbedSeconds,
  shouldUseBackgroundIndex,
  parseSyncBudgetSeconds,
  parseMaxSyncChunks,
  DEFAULT_EMBED_MS_PER_BATCH,
  SYNC_BUDGET_SECONDS_DEFAULT,
  MAX_SYNC_CHUNKS_DEFAULT,
} from '../lib/bridge-index-preflight-estimate.mjs';

test('estimateEmbedSeconds: zero or negative chunks → 0', () => {
  assert.strictEqual(estimateEmbedSeconds({ chunksToEmbed: 0, batchSize: 50, concurrency: 5 }), 0);
  assert.strictEqual(estimateEmbedSeconds({ chunksToEmbed: -10, batchSize: 50, concurrency: 5 }), 0);
});

test('estimateEmbedSeconds: 251 chunks @ 50/batch, concurrency 5, 2.5s/batch', () => {
  // 251 chunks → 6 batches; 6/5 → ceil = 2 waves; 2 * 2500ms = 5000ms embed.
  // Upsert: 251 * 5 = 1255ms; fixed: 3000ms; total 9255ms → 10 s.
  const got = estimateEmbedSeconds({
    chunksToEmbed: 251,
    batchSize: 50,
    concurrency: 5,
    msPerBatch: 2500,
  });
  assert.strictEqual(got, 10);
});

test('estimateEmbedSeconds: 1500 chunks @ 50/batch, concurrency 5 → ~37 s (over budget)', () => {
  // 1500 / 50 = 30 batches; 30/5 → 6 waves; 6 * 2500 = 15000ms embed.
  // Upsert: 1500 * 5 = 7500ms; fixed: 3000ms; total 25500ms → 26 s.
  // Budget 30 s → still fits; but the chunk-count safety net (>=500) kicks in
  // and routes this to background regardless. estimate is just informational.
  const got = estimateEmbedSeconds({
    chunksToEmbed: 1500,
    batchSize: 50,
    concurrency: 5,
    msPerBatch: 2500,
  });
  assert.strictEqual(got, 26);
});

test('estimateEmbedSeconds: 3000 chunks @ 50/batch, concurrency 5, 2.5s/batch → exceeds budget', () => {
  // 3000 / 50 = 60 batches; 60/5 → 12 waves; 12 * 2500 = 30000ms embed.
  // Upsert: 3000 * 5 = 15000ms; fixed: 3000ms; total 48000ms → 48 s.
  const got = estimateEmbedSeconds({
    chunksToEmbed: 3000,
    batchSize: 50,
    concurrency: 5,
    msPerBatch: 2500,
  });
  assert.strictEqual(got, 48);
});

test('estimateEmbedSeconds: defaults match documented constants when overrides omitted', () => {
  // 500 chunks → 10 batches → 2 waves @ DEFAULT_EMBED_MS_PER_BATCH.
  const explicit = estimateEmbedSeconds({
    chunksToEmbed: 500,
    batchSize: 50,
    concurrency: 5,
    msPerBatch: DEFAULT_EMBED_MS_PER_BATCH,
    upsertMsPerChunk: 5,
    fixedOverheadMs: 3000,
  });
  const defaulted = estimateEmbedSeconds({
    chunksToEmbed: 500,
    batchSize: 50,
    concurrency: 5,
  });
  assert.strictEqual(defaulted, explicit, 'defaults should be the documented constants');
});

test('estimateEmbedSeconds: throws on invalid batch size / concurrency', () => {
  assert.throws(
    () => estimateEmbedSeconds({ chunksToEmbed: 100, batchSize: 0, concurrency: 5 }),
    /batchSize must be >= 1/,
  );
  assert.throws(
    () => estimateEmbedSeconds({ chunksToEmbed: 100, batchSize: 50, concurrency: 0 }),
    /concurrency must be >= 1/,
  );
});

test('shouldUseBackgroundIndex: small job (250 chunks, 10 s) → sync', () => {
  const got = shouldUseBackgroundIndex({
    chunksToEmbed: 250,
    estimatedSeconds: 10,
  });
  assert.deepStrictEqual(got, { shouldUseBackground: false, reason: 'fits_in_sync' });
});

test('shouldUseBackgroundIndex: estimate exceeds budget → background', () => {
  const got = shouldUseBackgroundIndex({
    chunksToEmbed: 100,
    estimatedSeconds: 35,
  });
  assert.deepStrictEqual(got, {
    shouldUseBackground: true,
    reason: 'estimate_exceeds_budget',
  });
});

test('shouldUseBackgroundIndex: chunk count >= max → background even when estimate is small', () => {
  // 500 chunks but estimate 20 s — still routed to background by the chunk-count safety.
  const got = shouldUseBackgroundIndex({
    chunksToEmbed: 500,
    estimatedSeconds: 20,
  });
  assert.deepStrictEqual(got, {
    shouldUseBackground: true,
    reason: 'chunk_count_exceeds_max',
  });
});

test('shouldUseBackgroundIndex: dim migration required → background even for tiny jobs', () => {
  const got = shouldUseBackgroundIndex({
    chunksToEmbed: 10,
    estimatedSeconds: 5,
    dimMigrationRequired: true,
  });
  assert.deepStrictEqual(got, { shouldUseBackground: true, reason: 'dim_migration' });
});

test('shouldUseBackgroundIndex: first-time index → background even for tiny jobs', () => {
  const got = shouldUseBackgroundIndex({
    chunksToEmbed: 10,
    estimatedSeconds: 5,
    isFirstIndex: true,
  });
  assert.deepStrictEqual(got, { shouldUseBackground: true, reason: 'first_index' });
});

test('shouldUseBackgroundIndex: dim_migration takes priority over first_index when both true', () => {
  const got = shouldUseBackgroundIndex({
    chunksToEmbed: 10,
    estimatedSeconds: 5,
    dimMigrationRequired: true,
    isFirstIndex: true,
  });
  assert.strictEqual(got.reason, 'dim_migration');
});

test('shouldUseBackgroundIndex: chunksToEmbed === 0 → never background (no work to do)', () => {
  // Empty diff (cache hit on every chunk) is the happy path: must stay synchronous,
  // no matter what flags say. Otherwise every cache-hit re-index becomes a 202 + cold start.
  for (const flags of [
    { dimMigrationRequired: true },
    { isFirstIndex: true },
    { dimMigrationRequired: true, isFirstIndex: true },
  ]) {
    const got = shouldUseBackgroundIndex({
      chunksToEmbed: 0,
      estimatedSeconds: 0,
      ...flags,
    });
    assert.deepStrictEqual(
      got,
      { shouldUseBackground: false, reason: 'fits_in_sync' },
      `chunksToEmbed=0 with ${JSON.stringify(flags)} must stay sync`,
    );
  }
});

test('shouldUseBackgroundIndex: respects custom syncBudgetSeconds + maxSyncChunks', () => {
  const got = shouldUseBackgroundIndex({
    chunksToEmbed: 100,
    estimatedSeconds: 20,
    syncBudgetSeconds: 15,
    maxSyncChunks: 200,
  });
  assert.deepStrictEqual(got, {
    shouldUseBackground: true,
    reason: 'estimate_exceeds_budget',
  });
});

test('parseSyncBudgetSeconds: defaults, parses, clamps', () => {
  assert.strictEqual(parseSyncBudgetSeconds(undefined), SYNC_BUDGET_SECONDS_DEFAULT);
  assert.strictEqual(parseSyncBudgetSeconds(''), SYNC_BUDGET_SECONDS_DEFAULT);
  assert.strictEqual(parseSyncBudgetSeconds('20'), 20);
  assert.strictEqual(parseSyncBudgetSeconds('not-a-number'), SYNC_BUDGET_SECONDS_DEFAULT);
  assert.strictEqual(parseSyncBudgetSeconds('1'), 5, 'floor at 5 s');
  assert.strictEqual(parseSyncBudgetSeconds('999'), 55, 'ceiling at 55 s (under platform 60 s max)');
});

test('parseMaxSyncChunks: defaults, parses, clamps', () => {
  assert.strictEqual(parseMaxSyncChunks(undefined), MAX_SYNC_CHUNKS_DEFAULT);
  assert.strictEqual(parseMaxSyncChunks(''), MAX_SYNC_CHUNKS_DEFAULT);
  assert.strictEqual(parseMaxSyncChunks('300'), 300);
  assert.strictEqual(parseMaxSyncChunks('xyz'), MAX_SYNC_CHUNKS_DEFAULT);
  assert.strictEqual(parseMaxSyncChunks('10'), 50, 'floor at 50');
  assert.strictEqual(parseMaxSyncChunks('99999'), 5000, 'ceiling at 5000');
});

/**
 * Contract tests for the `feat/bridge-embed-hash-cache` wiring inside
 * `hub/bridge/server.mjs POST /api/v1/index`. The handler is too tightly coupled
 * to Netlify Blobs / canister export / live embedding to boot in a Node test, so
 * we lock in the static wiring that PR 1 introduces with source-string asserts:
 *
 *   - imports the right helpers (computeChunkContentHashTagged, partitionChunksForReindex,
 *     runWithConcurrency, parseEmbedConcurrency, parseEmbedBatchSize);
 *   - calls store.getChunkHashes(vaultId) for cache lookup;
 *   - upsert payload includes content_hash;
 *   - response includes chunksSkippedCached + chunksEmbedded (so the UI can show savings);
 *   - timer logs cache_lookup step (post-mortem signal);
 *   - BATCH_EMBED + EMBED_CONCURRENCY are env-tunable, not hard-coded 10.
 *
 * If any of these regress in a future refactor, post-PR1 re-indexes silently fall
 * back to "embed everything" — the exact failure mode this PR exists to eliminate.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bridgeJs = readFileSync(join(root, 'hub/bridge/server.mjs'), 'utf8');

test('bridge imports content-hash + parallel-pool + partition helpers', () => {
  assert.match(
    bridgeJs,
    /from\s+['"]\.\.\/\.\.\/lib\/chunk-content-hash\.mjs['"]/,
    'must import from lib/chunk-content-hash.mjs',
  );
  assert.match(
    bridgeJs,
    /from\s+['"]\.\.\/\.\.\/lib\/parallel-embed-pool\.mjs['"]/,
    'must import from lib/parallel-embed-pool.mjs',
  );
  assert.match(
    bridgeJs,
    /from\s+['"]\.\.\/\.\.\/lib\/index-partition\.mjs['"]/,
    'must import from lib/index-partition.mjs',
  );
  assert.match(bridgeJs, /\bcomputeChunkContentHashTagged\b/);
  assert.match(bridgeJs, /\brunWithConcurrency\b/);
  assert.match(bridgeJs, /\bpartitionChunksForReindex\b/);
});

test('BATCH_EMBED + EMBED_CONCURRENCY are derived from env (not hard-coded 10)', () => {
  assert.match(
    bridgeJs,
    /parseEmbedBatchSize\(\s*process\.env\.INDEXER_EMBED_BATCH_SIZE\s*\)/,
    'INDEXER_EMBED_BATCH_SIZE must drive the batch size',
  );
  assert.match(
    bridgeJs,
    /parseEmbedConcurrency\(\s*process\.env\.INDEXER_EMBED_CONCURRENCY\s*\)/,
    'INDEXER_EMBED_CONCURRENCY must drive parallelism',
  );
  // The legacy serial-loop constant `const BATCH_EMBED = 10` is gone.
  assert.doesNotMatch(
    bridgeJs,
    /^\s*const\s+BATCH_EMBED\s*=\s*10\s*;/m,
    'BATCH_EMBED = 10 is the pre-PR sequential-loop default; must not return',
  );
});

test('handler queries store.getChunkHashes(vaultId) for cache lookup', () => {
  assert.match(
    bridgeJs,
    /store\.getChunkHashes\s*\(\s*vaultId\s*\)/,
    'index handler must call store.getChunkHashes(vaultId) to populate the cache',
  );
});

test('upsert payload includes content_hash so future runs can hit the cache', () => {
  // Look in a window around the upsert payload object literal.
  const upsertWindow = bridgeJs.match(
    /points\s*=\s*slice\.map\([\s\S]{0,1500}?content_hash:\s*item\.contentHash/,
  );
  assert.ok(
    upsertWindow,
    'upsert payload must include content_hash: item.contentHash for the cache to populate',
  );
});

test('response + timer surface chunksSkippedCached and chunksEmbedded', () => {
  assert.match(
    bridgeJs,
    /chunksSkippedCached:\s*chunks_skipped_cached/,
    'response JSON must expose chunksSkippedCached',
  );
  assert.match(
    bridgeJs,
    /chunksEmbedded:\s*toEmbed\.length/,
    'response JSON must expose chunksEmbedded',
  );
  assert.match(
    bridgeJs,
    /timer\.step\(['"]cache_lookup['"]/,
    'timer must emit cache_lookup step (post-mortem signal for cache hit rate)',
  );
});

test('parallel embed loop uses runWithConcurrency, not a serial for-of/await', () => {
  assert.match(
    bridgeJs,
    /runWithConcurrency\(\s*embedBatches\.map/,
    'embed step must call runWithConcurrency with embedBatches.map of thunks',
  );
});

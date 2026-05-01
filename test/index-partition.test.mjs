/**
 * Tests for `lib/index-partition.mjs` — the pure inner step the bridge index handler
 * uses to decide which chunks need embedding, which can be skipped (cache hit), and
 * which prior chunk_ids are orphans.
 *
 * Why this matters: skipping wrong chunks → stale vector for changed text → wrong
 * search results. Embedding wrong chunks → wasted DeepInfra spend. Missing orphan
 * detection → search returns paths for notes that were deleted. All three failure
 * modes are silent in production (no error log) so we lock the behavior here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { partitionChunksForReindex } from '../lib/index-partition.mjs';

function item(storeId, contentHash, extra = {}) {
  return {
    chunk: { id: storeId.split('::').slice(1).join('::') || storeId, text: extra.text || 't', path: extra.path || 'a.md' },
    storeId,
    contentHash,
  };
}

describe('partitionChunksForReindex', () => {
  it('first run (empty cache): every chunk goes into toEmbed, no orphans', () => {
    const chunks = [item('vA::a_0', 'v1:hash-a'), item('vA::b_0', 'v1:hash-b')];
    const out = partitionChunksForReindex(chunks, new Map());
    assert.equal(out.toEmbed.length, 2);
    assert.equal(out.skippedCachedCount, 0);
    assert.deepEqual(out.orphanIds, []);
    assert.equal(out.presentChunkIds.size, 2);
    assert.ok(out.presentChunkIds.has('vA::a_0'));
    assert.ok(out.presentChunkIds.has('vA::b_0'));
  });

  it('all hashes match: every chunk skipped, nothing to embed, no orphans', () => {
    const chunks = [item('vA::a_0', 'v1:H1'), item('vA::b_0', 'v1:H2')];
    const cache = new Map([
      ['vA::a_0', 'v1:H1'],
      ['vA::b_0', 'v1:H2'],
    ]);
    const out = partitionChunksForReindex(chunks, cache);
    assert.equal(out.toEmbed.length, 0);
    assert.equal(out.skippedCachedCount, 2);
    assert.deepEqual(out.orphanIds, []);
  });

  it('changed text → different hash → must embed (NOT skipped)', () => {
    const chunks = [item('vA::a_0', 'v1:NEW-HASH')];
    const cache = new Map([['vA::a_0', 'v1:OLD-HASH']]);
    const out = partitionChunksForReindex(chunks, cache);
    assert.equal(out.toEmbed.length, 1);
    assert.equal(out.toEmbed[0].storeId, 'vA::a_0');
    assert.equal(out.skippedCachedCount, 0);
  });

  it('mixed: some cached, some changed, some new → exact partition', () => {
    const chunks = [
      item('vA::cached_0', 'v1:keep'),
      item('vA::changed_0', 'v1:new'),
      item('vA::brand-new_0', 'v1:fresh'),
    ];
    const cache = new Map([
      ['vA::cached_0', 'v1:keep'],
      ['vA::changed_0', 'v1:OLD'],
    ]);
    const out = partitionChunksForReindex(chunks, cache);
    assert.equal(out.skippedCachedCount, 1);
    const toEmbedIds = out.toEmbed.map((x) => x.storeId).sort();
    assert.deepEqual(toEmbedIds, ['vA::brand-new_0', 'vA::changed_0']);
  });

  it('detects orphans: chunk_ids in cache but not in current export', () => {
    const chunks = [item('vA::keep_0', 'v1:K')];
    const cache = new Map([
      ['vA::keep_0', 'v1:K'],
      ['vA::deleted_0', 'v1:OLD-D'],
      ['vA::renamed-from_0', 'v1:OLD-R'],
    ]);
    const out = partitionChunksForReindex(chunks, cache);
    assert.equal(out.skippedCachedCount, 1);
    assert.equal(out.toEmbed.length, 0);
    const orphans = out.orphanIds.slice().sort();
    assert.deepEqual(orphans, ['vA::deleted_0', 'vA::renamed-from_0']);
  });

  it('handles null/undefined cache as empty (e.g. backend lacking getChunkHashes)', () => {
    const chunks = [item('vA::a_0', 'v1:h')];
    const out1 = partitionChunksForReindex(chunks, null);
    const out2 = partitionChunksForReindex(chunks, undefined);
    assert.equal(out1.toEmbed.length, 1);
    assert.equal(out2.toEmbed.length, 1);
    assert.deepEqual(out1.orphanIds, []);
    assert.deepEqual(out2.orphanIds, []);
  });

  it('empty chunks input: skip 0, embed 0, every cache key becomes an orphan', () => {
    const cache = new Map([
      ['vA::a_0', 'v1:h1'],
      ['vA::b_0', 'v1:h2'],
    ]);
    const out = partitionChunksForReindex([], cache);
    assert.equal(out.skippedCachedCount, 0);
    assert.equal(out.toEmbed.length, 0);
    assert.deepEqual(out.orphanIds.sort(), ['vA::a_0', 'vA::b_0']);
  });

  it('throws TypeError on non-array input — fail loud, never silently re-embed everything', () => {
    assert.throws(
      () => partitionChunksForReindex(null, new Map()),
      /chunksWithHash must be an array/,
    );
    assert.throws(
      () => partitionChunksForReindex({}, new Map()),
      /chunksWithHash must be an array/,
    );
  });

  it('throws TypeError when an item lacks storeId or contentHash (bridge bug must surface)', () => {
    assert.throws(
      () => partitionChunksForReindex([{ contentHash: 'h' }], new Map()),
      /storeId and contentHash/,
    );
    assert.throws(
      () =>
        partitionChunksForReindex([{ storeId: 'vA::x_0', contentHash: '' }], new Map()),
      /storeId and contentHash/,
    );
  });

  it('cache entry with empty string is treated as cache miss (defensive against bad legacy data)', () => {
    const chunks = [item('vA::a_0', 'v1:h')];
    // Note: an empty string is falsy but a Map.get returns it. partitionChunksForReindex
    // does a strict `prior && prior === item.contentHash` check, so empty string → no skip.
    const cache = new Map([['vA::a_0', '']]);
    const out = partitionChunksForReindex(chunks, cache);
    assert.equal(out.toEmbed.length, 1);
    assert.equal(out.skippedCachedCount, 0);
  });

  it('does not mutate the input cache or chunks arrays', () => {
    const chunks = [item('vA::a_0', 'v1:h')];
    const cache = new Map([['vA::a_0', 'v1:h']]);
    const cacheBefore = new Map(cache);
    const chunksBefore = chunks.slice();
    partitionChunksForReindex(chunks, cache);
    assert.deepEqual([...cache.entries()], [...cacheBefore.entries()]);
    assert.deepEqual(chunks, chunksBefore);
  });
});

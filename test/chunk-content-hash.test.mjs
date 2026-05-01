/**
 * Tests for `lib/chunk-content-hash.mjs`. The bridge will compare these hashes
 * against the `+content_hash` column in sqlite-vec to decide whether to skip
 * embedding a chunk on re-index, so the contract that matters here is:
 *   1. Same logical input → same digest, deterministically, across processes.
 *   2. Different text OR different search-relevant metadata → different digest.
 *   3. Tag/entity array order is not significant (chunks built in different
 *      orders must hash identically).
 *   4. Missing/null/undefined for optional fields hash identically (so a chunk
 *      with `tags: undefined` matches one with `tags: []`).
 *   5. Tagged variant carries the version prefix `v1:` so future algo bumps
 *      can be detected on read without touching every callsite.
 *   6. Bad input throws (so a bridge bug surfaces loudly, not silently).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeChunkContentHash,
  computeChunkContentHashTagged,
  CHUNK_CONTENT_HASH_VERSION,
} from '../lib/chunk-content-hash.mjs';

describe('computeChunkContentHash', () => {
  it('is deterministic and returns 32 lowercase hex chars (128 bits)', () => {
    const chunk = { text: 'hello world', path: 'notes/a.md' };
    const a = computeChunkContentHash(chunk);
    const b = computeChunkContentHash(chunk);
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{32}$/);
  });

  it('changes when text changes', () => {
    const a = computeChunkContentHash({ text: 'one', path: 'a.md' });
    const b = computeChunkContentHash({ text: 'two', path: 'a.md' });
    assert.notEqual(a, b);
  });

  it('changes when path changes (since path is part of the search-relevant payload)', () => {
    const a = computeChunkContentHash({ text: 'same', path: 'a.md' });
    const b = computeChunkContentHash({ text: 'same', path: 'b.md' });
    assert.notEqual(a, b);
  });

  it('changes when project, date, or tags change (so metadata edits invalidate the cache)', () => {
    const base = { text: 'x', path: 'a.md' };
    const baseHash = computeChunkContentHash(base);
    assert.notEqual(computeChunkContentHash({ ...base, project: 'p1' }), baseHash);
    assert.notEqual(computeChunkContentHash({ ...base, date: '2026-05-01' }), baseHash);
    assert.notEqual(computeChunkContentHash({ ...base, tags: ['x'] }), baseHash);
    assert.notEqual(
      computeChunkContentHash({ ...base, causal_chain_id: 'c1' }),
      baseHash,
    );
    assert.notEqual(
      computeChunkContentHash({ ...base, episode_id: 'ep1' }),
      baseHash,
    );
    assert.notEqual(computeChunkContentHash({ ...base, entity: ['e1'] }), baseHash);
  });

  it('treats tag/entity arrays as sets (order-independent)', () => {
    const a = computeChunkContentHash({
      text: 'x',
      path: 'a.md',
      tags: ['b', 'a'],
      entity: ['z', 'y'],
    });
    const b = computeChunkContentHash({
      text: 'x',
      path: 'a.md',
      tags: ['a', 'b'],
      entity: ['y', 'z'],
    });
    assert.equal(a, b);
  });

  it('treats undefined/null/missing equivalently for optional fields', () => {
    const minimal = { text: 'x', path: 'a.md' };
    const explicitNulls = {
      text: 'x',
      path: 'a.md',
      project: null,
      tags: null,
      date: null,
      causal_chain_id: null,
      entity: null,
      episode_id: null,
    };
    const explicitEmpty = {
      text: 'x',
      path: 'a.md',
      project: undefined,
      tags: [],
      date: undefined,
      causal_chain_id: undefined,
      entity: [],
      episode_id: undefined,
    };
    const h1 = computeChunkContentHash(minimal);
    const h2 = computeChunkContentHash(explicitNulls);
    const h3 = computeChunkContentHash(explicitEmpty);
    assert.equal(h1, h2);
    assert.equal(h1, h3);
  });

  it('throws on missing chunk', () => {
    assert.throws(() => computeChunkContentHash(null), /chunk is required/);
    assert.throws(() => computeChunkContentHash(undefined), /chunk is required/);
  });

  it('throws on missing/wrong-type text or path (bridge bug must surface loudly)', () => {
    assert.throws(
      () => computeChunkContentHash({ path: 'a.md' }),
      /chunk\.text must be a string/,
    );
    assert.throws(
      () => computeChunkContentHash({ text: 'x' }),
      /chunk\.path must be a string/,
    );
    assert.throws(
      () => computeChunkContentHash({ text: 123, path: 'a.md' }),
      /chunk\.text must be a string/,
    );
  });
});

describe('computeChunkContentHashTagged', () => {
  const cfg = { provider: 'deepinfra', model: 'BAAI/bge-large-en-v1.5' };

  it('format is "v<N>:<provider>:<model>:<32-hex>" with provider lowercased', () => {
    const tagged = computeChunkContentHashTagged({ text: 'hello', path: 'a.md' }, cfg);
    const parts = tagged.split(':');
    assert.equal(parts[0], 'v1');
    assert.equal(parts[1], 'deepinfra');
    assert.equal(parts[2], 'BAAI/bge-large-en-v1.5');
    assert.match(parts[3], /^[0-9a-f]{32}$/);
  });

  it('current version is v1', () => {
    assert.equal(CHUNK_CONTENT_HASH_VERSION, 'v1');
  });

  it('two equivalent chunks under same provider+model produce equal tagged hashes', () => {
    const a = computeChunkContentHashTagged({ text: 'x', path: 'a.md', tags: ['b', 'a'] }, cfg);
    const b = computeChunkContentHashTagged({ text: 'x', path: 'a.md', tags: ['a', 'b'] }, cfg);
    assert.equal(a, b);
  });

  it('changing provider invalidates the cache (different prefix)', () => {
    const chunk = { text: 'same', path: 'a.md' };
    const a = computeChunkContentHashTagged(chunk, { provider: 'openai', model: 'text-embedding-3-small' });
    const b = computeChunkContentHashTagged(chunk, { provider: 'deepinfra', model: 'BAAI/bge-large-en-v1.5' });
    assert.notEqual(a, b, 'same chunk under different providers must hash differently');
  });

  it('changing model (same provider, same dimension) invalidates the cache', () => {
    // The whole point of putting model in the prefix: BGE-large (1024) → BGE-m3 (1024)
    // is a same-dimension swap that the dimension check cannot catch. Without model in the
    // hash, every chunk would be a cache hit and we would silently keep stale vectors.
    const chunk = { text: 'same', path: 'a.md' };
    const a = computeChunkContentHashTagged(chunk, { provider: 'deepinfra', model: 'BAAI/bge-large-en-v1.5' });
    const b = computeChunkContentHashTagged(chunk, { provider: 'deepinfra', model: 'BAAI/bge-m3' });
    assert.notEqual(a, b, 'same chunk under different models must hash differently');
  });

  it('provider is lowercased + alphanumeric-stripped (deterministic across casing/typos)', () => {
    const chunk = { text: 'x', path: 'a.md' };
    const a = computeChunkContentHashTagged(chunk, { provider: 'DeepInfra', model: 'm' });
    const b = computeChunkContentHashTagged(chunk, { provider: 'deepinfra', model: 'm' });
    const c = computeChunkContentHashTagged(chunk, { provider: 'deepinfra ', model: 'm' });
    assert.equal(a, b);
    assert.equal(a, c);
  });

  it('model preserves slashes (e.g. BAAI/bge-large) but collapses whitespace', () => {
    const chunk = { text: 'x', path: 'a.md' };
    const tagged = computeChunkContentHashTagged(chunk, {
      provider: 'deepinfra',
      model: '  BAAI/bge-large-en-v1.5  ',
    });
    assert.match(tagged, /^v1:deepinfra:BAAI\/bge-large-en-v1\.5:[0-9a-f]{32}$/);
  });

  it('throws if embeddingConfig is missing — silent fallback would re-introduce the silent-corruption bug', () => {
    const chunk = { text: 'x', path: 'a.md' };
    assert.throws(
      () => computeChunkContentHashTagged(chunk),
      /embeddingConfig is required/,
    );
    assert.throws(
      () => computeChunkContentHashTagged(chunk, null),
      /embeddingConfig is required/,
    );
  });

  it('throws on missing/empty provider or model (caller bug surfaces loudly)', () => {
    const chunk = { text: 'x', path: 'a.md' };
    assert.throws(
      () => computeChunkContentHashTagged(chunk, { model: 'm' }),
      /provider must be a non-empty string/,
    );
    assert.throws(
      () => computeChunkContentHashTagged(chunk, { provider: '', model: 'm' }),
      /provider must be a non-empty string/,
    );
    assert.throws(
      () => computeChunkContentHashTagged(chunk, { provider: 'deepinfra' }),
      /model must be a non-empty string/,
    );
    assert.throws(
      () => computeChunkContentHashTagged(chunk, { provider: 'deepinfra', model: '   ' }),
      /model must be a non-empty string/,
    );
  });
});

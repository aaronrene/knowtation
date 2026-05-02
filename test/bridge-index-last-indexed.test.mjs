/**
 * Unit tests for `lib/bridge-index-last-indexed.mjs`.
 *
 * The sidecar is what makes the Hub UI's "Last indexed: 2 minutes ago" line
 * truthful regardless of which path (sync vs background) ran the index. Both
 * `set` and `get` must round-trip every field the UI displays without dropping
 * data on a rolling deploy where reader and writer might be different bridge
 * versions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setLastIndexedAt,
  getLastIndexedAt,
  lastIndexedKey,
} from '../lib/bridge-index-last-indexed.mjs';

function makeFakeBlobStore() {
  const store = new Map();
  return {
    _store: store,
    async get(key) {
      const v = store.get(key);
      if (v == null) return null;
      return String(v);
    },
    async set(key, value) {
      store.set(key, String(value));
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

test('lastIndexedKey: canonical path keyed by (canisterUid, vaultId)', () => {
  assert.strictEqual(lastIndexedKey('user_1', 'Business'), 'index-meta/user_1/Business.json');
});

test('lastIndexedKey: rejects empty canisterUid or vaultId', () => {
  assert.throws(() => lastIndexedKey('', 'v'), /canisterUid must be a non-empty string/);
  assert.throws(() => lastIndexedKey('u', ''), /vaultId must be a non-empty string/);
});

test('setLastIndexedAt + getLastIndexedAt: round-trip every field the UI shows', async () => {
  const store = makeFakeBlobStore();
  const fixedNow = Date.parse('2026-05-01T23:54:00.000Z');
  const written = await setLastIndexedAt(store, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    actorUid: 'actor_a',
    notesProcessed: 32,
    chunksIndexed: 251,
    chunksEmbedded: 0,
    chunksSkippedCached: 251,
    vectorsDeleted: 0,
    embeddingInputTokens: 0,
    durationMs: 1234,
    mode: 'sync',
    provider: 'deepinfra',
    model: 'BAAI/bge-large-en-v1.5',
    now: () => fixedNow,
  });
  assert.strictEqual(written.written, true);
  const got = await getLastIndexedAt(store, { canisterUid: 'user_1', vaultId: 'Business' });
  assert.deepStrictEqual(got, {
    lastIndexedAt: '2026-05-01T23:54:00.000Z',
    lastIndexedAtEpochMs: fixedNow,
    actorUid: 'actor_a',
    notesProcessed: 32,
    chunksIndexed: 251,
    chunksEmbedded: 0,
    chunksSkippedCached: 251,
    vectorsDeleted: 0,
    embeddingInputTokens: 0,
    durationMs: 1234,
    mode: 'sync',
    provider: 'deepinfra',
    model: 'BAAI/bge-large-en-v1.5',
  });
});

test('setLastIndexedAt: defaults missing numeric fields to 0 (no NaN/null surprises in UI)', async () => {
  const store = makeFakeBlobStore();
  await setLastIndexedAt(store, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    now: () => 1_000_000,
  });
  const got = await getLastIndexedAt(store, { canisterUid: 'user_1', vaultId: 'Business' });
  assert.strictEqual(got.notesProcessed, 0);
  assert.strictEqual(got.chunksIndexed, 0);
  assert.strictEqual(got.embeddingInputTokens, 0);
  assert.strictEqual(got.durationMs, 0);
  assert.strictEqual(got.mode, 'sync', 'omitting mode defaults to sync');
  assert.strictEqual(got.provider, null);
  assert.strictEqual(got.model, null);
});

test('setLastIndexedAt: invalid mode value normalizes to sync', async () => {
  const store = makeFakeBlobStore();
  await setLastIndexedAt(store, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    mode: 'asdf',
    now: () => 1,
  });
  const got = await getLastIndexedAt(store, { canisterUid: 'user_1', vaultId: 'Business' });
  assert.strictEqual(got.mode, 'sync');
});

test('setLastIndexedAt: mode "background" preserved', async () => {
  const store = makeFakeBlobStore();
  await setLastIndexedAt(store, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    mode: 'background',
    now: () => 1,
  });
  const got = await getLastIndexedAt(store, { canisterUid: 'user_1', vaultId: 'Business' });
  assert.strictEqual(got.mode, 'background');
});

test('getLastIndexedAt: returns null when never indexed', async () => {
  const store = makeFakeBlobStore();
  const got = await getLastIndexedAt(store, { canisterUid: 'user_1', vaultId: 'Business' });
  assert.strictEqual(got, null);
});

test('getLastIndexedAt: returns null on malformed JSON (older deploy / partial write)', async () => {
  const store = makeFakeBlobStore();
  await store.set(lastIndexedKey('user_1', 'Business'), 'not-valid-json{');
  const got = await getLastIndexedAt(store, { canisterUid: 'user_1', vaultId: 'Business' });
  assert.strictEqual(got, null);
});

test('getLastIndexedAt: blob get throwing returns null (does not block the UI render)', async () => {
  const erroringStore = {
    async get() {
      throw new Error('transient blob error');
    },
    async set() {},
    async delete() {},
  };
  const got = await getLastIndexedAt(erroringStore, {
    canisterUid: 'user_1',
    vaultId: 'Business',
  });
  assert.strictEqual(got, null);
});

test('setLastIndexedAt: distinct (canisterUid, vaultId) pairs do not overwrite each other', async () => {
  const store = makeFakeBlobStore();
  await setLastIndexedAt(store, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    chunksIndexed: 100,
    now: () => 1,
  });
  await setLastIndexedAt(store, {
    canisterUid: 'user_1',
    vaultId: 'Personal',
    chunksIndexed: 200,
    now: () => 2,
  });
  await setLastIndexedAt(store, {
    canisterUid: 'user_2',
    vaultId: 'Business',
    chunksIndexed: 300,
    now: () => 3,
  });
  const a = await getLastIndexedAt(store, { canisterUid: 'user_1', vaultId: 'Business' });
  const b = await getLastIndexedAt(store, { canisterUid: 'user_1', vaultId: 'Personal' });
  const c = await getLastIndexedAt(store, { canisterUid: 'user_2', vaultId: 'Business' });
  assert.strictEqual(a.chunksIndexed, 100);
  assert.strictEqual(b.chunksIndexed, 200);
  assert.strictEqual(c.chunksIndexed, 300);
});

/**
 * Unit tests for `lib/bridge-index-job-lock.mjs`.
 *
 * The lock is the only thing standing between a re-clicked Re-index button and
 * a duplicated DeepInfra-billed re-embed of the same vault. Tests cover the
 * three states that matter:
 *   1. No lock → acquire succeeds with a fresh jobId.
 *   2. Live lock (now < expiresAt) → acquire fails, returns existing record.
 *   3. Stale lock (now > expiresAt, e.g. background function crashed) →
 *      acquire silently overwrites; future re-indexes are not blocked forever.
 *
 * Plus the safety net for `releaseJobLock` with `expectedJobId`: a slow
 * finalize-on-success path must not delete a fresher lock that a different
 * background job has since acquired.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireJobLock,
  releaseJobLock,
  peekJobLock,
  jobLockKey,
  JOB_LOCK_TTL_MS,
} from '../lib/bridge-index-job-lock.mjs';

function makeFakeBlobStore() {
  const store = new Map();
  return {
    _store: store,
    async get(key, opts) {
      const v = store.get(key);
      if (v == null) return null;
      if (opts?.type === 'arrayBuffer') {
        const buf = Buffer.from(String(v), 'utf8');
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      }
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

test('jobLockKey: uses canonical path so two callers cannot collide', () => {
  assert.strictEqual(jobLockKey('user_1', 'Business'), 'index-jobs/user_1/Business.json');
});

test('jobLockKey: rejects empty canisterUid or vaultId', () => {
  assert.throws(() => jobLockKey('', 'v'), /canisterUid must be a non-empty string/);
  assert.throws(() => jobLockKey('u', ''), /vaultId must be a non-empty string/);
});

test('acquireJobLock: succeeds when no prior lock', async () => {
  const store = makeFakeBlobStore();
  const result = await acquireJobLock(store, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    actorUid: 'actor_a',
    chunksToEmbed: 1500,
    estimatedSeconds: 90,
    reason: 'chunk_count_exceeds_max',
    now: () => 1_000_000,
    randomUUID: () => '11111111-2222-3333-4444-555555555555',
  });
  assert.strictEqual(result.acquired, true);
  assert.strictEqual(result.jobId, '11111111-2222-3333-4444-555555555555');
  assert.strictEqual(result.record.startedAt, 1_000_000);
  assert.strictEqual(result.record.expiresAt, 1_000_000 + JOB_LOCK_TTL_MS);
  assert.strictEqual(result.record.chunksToEmbed, 1500);
  assert.strictEqual(result.record.reason, 'chunk_count_exceeds_max');
  assert.strictEqual(store._store.size, 1);
});

test('acquireJobLock: live lock blocks a second acquire', async () => {
  const store = makeFakeBlobStore();
  const first = await acquireJobLock(store, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    now: () => 1_000_000,
    randomUUID: () => 'job-1',
  });
  assert.strictEqual(first.acquired, true);

  const second = await acquireJobLock(store, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    now: () => 1_000_000 + 60_000, // 1 minute later, well within TTL
    randomUUID: () => 'job-2',
  });
  assert.strictEqual(second.acquired, false);
  assert.ok(second.existing, 'must surface the existing record');
  assert.strictEqual(second.existing.jobId, 'job-1');
});

test('acquireJobLock: stale lock (past TTL) is overwritten', async () => {
  const store = makeFakeBlobStore();
  await acquireJobLock(store, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    now: () => 1_000_000,
    randomUUID: () => 'crashed-job',
  });
  const fresh = await acquireJobLock(store, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    now: () => 1_000_000 + JOB_LOCK_TTL_MS + 1,
    randomUUID: () => 'recovery-job',
  });
  assert.strictEqual(fresh.acquired, true, 'stale lock must NOT block forever');
  assert.strictEqual(fresh.jobId, 'recovery-job');
});

test('acquireJobLock: distinct (canisterUid, vaultId) pairs do not block each other', async () => {
  const store = makeFakeBlobStore();
  const a = await acquireJobLock(store, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    now: () => 1_000_000,
    randomUUID: () => 'job-a',
  });
  const b = await acquireJobLock(store, {
    canisterUid: 'user_1',
    vaultId: 'Personal', // different vault
    now: () => 1_000_000,
    randomUUID: () => 'job-b',
  });
  const c = await acquireJobLock(store, {
    canisterUid: 'user_2', // different user
    vaultId: 'Business',
    now: () => 1_000_000,
    randomUUID: () => 'job-c',
  });
  assert.strictEqual(a.acquired, true);
  assert.strictEqual(b.acquired, true);
  assert.strictEqual(c.acquired, true);
});

test('releaseJobLock: unconditional delete (no expectedJobId)', async () => {
  const store = makeFakeBlobStore();
  await acquireJobLock(store, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    now: () => 1_000_000,
  });
  const released = await releaseJobLock(store, {
    canisterUid: 'user_1',
    vaultId: 'Business',
  });
  assert.deepStrictEqual(released, { released: true });
  assert.strictEqual(store._store.size, 0);
});

test('releaseJobLock: expectedJobId mismatch refuses to delete (protects newer in-flight job)', async () => {
  const store = makeFakeBlobStore();
  // Job A acquires, then crashes; Job B acquires a fresh lock after the TTL.
  await acquireJobLock(store, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    now: () => 1_000_000,
    randomUUID: () => 'job-a',
  });
  await acquireJobLock(store, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    now: () => 1_000_000 + JOB_LOCK_TTL_MS + 1,
    randomUUID: () => 'job-b',
  });
  // Job A's late finalize tries to release "its" lock — must NOT clobber Job B.
  const releasedA = await releaseJobLock(store, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    expectedJobId: 'job-a',
  });
  assert.deepStrictEqual(releasedA, { released: false, reason: 'lock_owned_by_other_job' });
  assert.strictEqual(store._store.size, 1, 'job-b lock must still be there');
});

test('releaseJobLock: expectedJobId on missing lock returns lock_already_gone', async () => {
  const store = makeFakeBlobStore();
  const released = await releaseJobLock(store, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    expectedJobId: 'job-x',
  });
  assert.deepStrictEqual(released, { released: false, reason: 'lock_already_gone' });
});

test('peekJobLock: returns the live record without mutation', async () => {
  const store = makeFakeBlobStore();
  await acquireJobLock(store, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    chunksToEmbed: 1500,
    now: () => 1_000_000,
    randomUUID: () => 'peek-job',
  });
  const peek1 = await peekJobLock(store, { canisterUid: 'user_1', vaultId: 'Business' });
  const peek2 = await peekJobLock(store, { canisterUid: 'user_1', vaultId: 'Business' });
  assert.strictEqual(peek1.jobId, 'peek-job');
  assert.strictEqual(peek1.chunksToEmbed, 1500);
  assert.deepStrictEqual(peek1, peek2, 'peek must be idempotent');
});

test('peekJobLock: returns null when no lock exists', async () => {
  const store = makeFakeBlobStore();
  const peek = await peekJobLock(store, { canisterUid: 'user_1', vaultId: 'Business' });
  assert.strictEqual(peek, null);
});

test('peekJobLock: returns null on malformed JSON in the blob', async () => {
  const store = makeFakeBlobStore();
  await store.set(jobLockKey('user_1', 'Business'), 'not-valid-json{');
  const peek = await peekJobLock(store, { canisterUid: 'user_1', vaultId: 'Business' });
  assert.strictEqual(peek, null);
});

test('acquireJobLock: blob get throwing (e.g. transient Blob error) is treated as no lock', async () => {
  const erroringStore = {
    async get() {
      throw new Error('transient blob error');
    },
    async set() {
      // accept
    },
    async delete() {},
  };
  const got = await acquireJobLock(erroringStore, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    now: () => 1_000_000,
    randomUUID: () => 'recovered-job',
  });
  assert.strictEqual(got.acquired, true, 'transient read failure must not block re-index forever');
});

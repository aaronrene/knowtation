/**
 * Background-index job lock for `hub/bridge/server.mjs POST /api/v1/index`.
 *
 * When the preflight (`lib/bridge-index-preflight-estimate.mjs`) decides a re-index
 * is too big for the synchronous path, the bridge writes a lock record to Netlify
 * Blobs, kicks off the `bridge-index-background` Netlify Function, and returns 202
 * to the client. The lock prevents:
 *   1. **Double-clicks** — a second `POST /api/v1/index` arriving while the
 *      background job is still running returns 409 instead of starting another
 *      DeepInfra-billed re-embed of the same vault.
 *   2. **Stale locks blocking forever** — if the background function crashes,
 *      every lock has a TTL (default 16 min, just past the 15-min Netlify
 *      background-function cap) after which `acquireJobLock` will overwrite it.
 *
 * Storage shape (Netlify Blob): one record per `(canisterUid, vaultId)` pair at
 * key `index-jobs/${canisterUid}/${vaultId}.json`. Keep the schema small and
 * append-only so older bridge deploys can still read newer lock records during
 * a rolling deploy.
 *
 * Pure-ish module: takes a `blobStore` arg shaped like the Netlify `@netlify/blobs`
 * `getStore({...})` return value (`get(key, { type })`, `set(key, value)`,
 * `delete(key)`). Tests inject an in-memory implementation; production uses the
 * real Netlify store mounted by `netlify/functions/bridge.mjs`.
 */

import crypto from 'crypto';

/**
 * TTL for a lock record. Netlify background functions max out at 15 min; the
 * extra minute lets a slow finalize-on-success path still find its own lock to
 * release without racing against a fresh re-index attempt.
 */
export const JOB_LOCK_TTL_MS = 16 * 60 * 1000;

/**
 * Build the canonical Blob key for a vault's job lock. Centralized so callers
 * can't accidentally collide with each other (e.g. `index-jobs/foo/bar` vs
 * `/index-jobs/foo/bar`) or read a stale legacy key.
 *
 * @param {string} canisterUid - Sanitized canister user id.
 * @param {string} vaultId - Sanitized vault id.
 * @returns {string}
 */
export function jobLockKey(canisterUid, vaultId) {
  if (typeof canisterUid !== 'string' || canisterUid === '') {
    throw new TypeError('jobLockKey: canisterUid must be a non-empty string');
  }
  if (typeof vaultId !== 'string' || vaultId === '') {
    throw new TypeError('jobLockKey: vaultId must be a non-empty string');
  }
  return `index-jobs/${canisterUid}/${vaultId}.json`;
}

/**
 * Try to acquire a lock for `(canisterUid, vaultId)`. Returns `{ acquired: true,
 * jobId, record }` on success, or `{ acquired: false, existing }` when a valid
 * (non-expired) lock is already held by another in-flight background job.
 *
 * Stale locks (where `now > expiresAt`) are silently overwritten — this is the
 * only safe recovery path when the previous background function crashed before
 * it could call `releaseJobLock`. Without overwrite-on-stale, a single crash
 * would block every future re-index until manual intervention.
 *
 * @param {{ get: Function, set: Function, delete: Function }} blobStore
 * @param {{
 *   canisterUid: string,
 *   vaultId: string,
 *   actorUid?: string,
 *   chunksToEmbed?: number,
 *   estimatedSeconds?: number,
 *   reason?: string,
 *   ttlMs?: number,
 *   now?: () => number,
 *   randomUUID?: () => string,
 * }} opts
 * @returns {Promise<
 *   | { acquired: true, jobId: string, record: object }
 *   | { acquired: false, existing: object }
 * >}
 */
export async function acquireJobLock(blobStore, opts) {
  if (!blobStore || typeof blobStore.set !== 'function' || typeof blobStore.get !== 'function') {
    throw new TypeError('acquireJobLock: blobStore with get/set is required');
  }
  if (opts == null || typeof opts !== 'object') {
    throw new TypeError('acquireJobLock: opts is required');
  }
  const { canisterUid, vaultId } = opts;
  const ttlMs = Number.isFinite(opts.ttlMs) && opts.ttlMs > 0 ? opts.ttlMs : JOB_LOCK_TTL_MS;
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const randomUUID =
    typeof opts.randomUUID === 'function' ? opts.randomUUID : () => crypto.randomUUID();

  const key = jobLockKey(canisterUid, vaultId);
  const tNow = now();
  const existing = await readLockRecord(blobStore, key);
  if (existing && Number.isFinite(existing.expiresAt) && existing.expiresAt > tNow) {
    return { acquired: false, existing };
  }

  const jobId = randomUUID();
  const record = {
    jobId,
    canisterUid,
    vaultId,
    actorUid: typeof opts.actorUid === 'string' ? opts.actorUid : null,
    chunksToEmbed: Number.isFinite(opts.chunksToEmbed) ? opts.chunksToEmbed : null,
    estimatedSeconds: Number.isFinite(opts.estimatedSeconds) ? opts.estimatedSeconds : null,
    reason: typeof opts.reason === 'string' ? opts.reason : null,
    startedAt: tNow,
    expiresAt: tNow + ttlMs,
  };
  await blobStore.set(key, JSON.stringify(record));
  return { acquired: true, jobId, record };
}

/**
 * Release the lock for `(canisterUid, vaultId)`. If the lock has already been
 * overwritten by a fresher acquire (different jobId), we DO NOT delete it —
 * that would clobber the in-flight job. Pass `expectedJobId` to opt into this
 * "release my lock only" semantics; pass nothing to delete unconditionally
 * (used by admin/operator recovery paths).
 *
 * @param {{ get: Function, set: Function, delete: Function }} blobStore
 * @param {{ canisterUid: string, vaultId: string, expectedJobId?: string }} opts
 * @returns {Promise<{ released: boolean, reason?: string }>}
 */
export async function releaseJobLock(blobStore, opts) {
  if (!blobStore || typeof blobStore.delete !== 'function') {
    throw new TypeError('releaseJobLock: blobStore with delete is required');
  }
  if (opts == null || typeof opts !== 'object') {
    throw new TypeError('releaseJobLock: opts is required');
  }
  const { canisterUid, vaultId, expectedJobId } = opts;
  const key = jobLockKey(canisterUid, vaultId);
  if (typeof expectedJobId === 'string' && expectedJobId !== '') {
    const current = await readLockRecord(blobStore, key);
    if (current && current.jobId !== expectedJobId) {
      return { released: false, reason: 'lock_owned_by_other_job' };
    }
    if (!current) {
      return { released: false, reason: 'lock_already_gone' };
    }
  }
  await blobStore.delete(key);
  return { released: true };
}

/**
 * Read the current lock record without modifying it. Returns `null` when no
 * lock exists or the record is malformed. Does NOT auto-clear stale records —
 * `acquireJobLock` does that on the write path so reads stay side-effect-free.
 *
 * @param {{ get: Function }} blobStore
 * @param {{ canisterUid: string, vaultId: string }} opts
 * @returns {Promise<object|null>}
 */
export async function peekJobLock(blobStore, opts) {
  if (!blobStore || typeof blobStore.get !== 'function') {
    throw new TypeError('peekJobLock: blobStore with get is required');
  }
  if (opts == null || typeof opts !== 'object') {
    throw new TypeError('peekJobLock: opts is required');
  }
  const { canisterUid, vaultId } = opts;
  const key = jobLockKey(canisterUid, vaultId);
  return await readLockRecord(blobStore, key);
}

async function readLockRecord(blobStore, key) {
  let raw;
  try {
    raw = await blobStore.get(key, { type: 'text' });
  } catch (_) {
    return null;
  }
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (_) {}
  return null;
}

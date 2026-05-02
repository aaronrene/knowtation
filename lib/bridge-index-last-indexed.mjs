/**
 * "Last indexed at" sidecar for `hub/bridge/server.mjs POST /api/v1/index`.
 *
 * Why a sidecar rather than reading from the vector store: the sqlite-vec
 * backend is downloaded into `/tmp` per Netlify cold start (see
 * `getVectorsDirForUser` in `hub/bridge/server.mjs`); fetching the whole DB
 * just to read one timestamp would be 50–500× more expensive than reading a
 * 1–2 KB JSON blob. The sidecar lets the Hub UI show a passive "Last indexed:
 * N minutes ago" line on every page load with one cheap blob read.
 *
 * The same record is updated by both the synchronous and background index paths
 * (`hub/bridge/server.mjs` + `netlify/functions/bridge-index-background.mjs`),
 * so the UI gets a consistent signal regardless of which route ran.
 *
 * Storage shape (Netlify Blob): one record per `(canisterUid, vaultId)` pair at
 * key `index-meta/${canisterUid}/${vaultId}.json`. Append-only fields so older
 * bridge deploys can still parse the record during a rolling deploy.
 */

/**
 * Build the canonical Blob key for a vault's last-indexed sidecar. Centralized
 * so callers can't accidentally collide with the job-lock key (which lives at
 * `index-jobs/...`) or with each other.
 *
 * @param {string} canisterUid - Sanitized canister user id.
 * @param {string} vaultId - Sanitized vault id.
 * @returns {string}
 */
export function lastIndexedKey(canisterUid, vaultId) {
  if (typeof canisterUid !== 'string' || canisterUid === '') {
    throw new TypeError('lastIndexedKey: canisterUid must be a non-empty string');
  }
  if (typeof vaultId !== 'string' || vaultId === '') {
    throw new TypeError('lastIndexedKey: vaultId must be a non-empty string');
  }
  return `index-meta/${canisterUid}/${vaultId}.json`;
}

/**
 * Persist a "last indexed at" record. Called from BOTH the synchronous index
 * handler (after a successful inline embed+upsert+persist) AND the background
 * function (after the same work runs out-of-band). The Hub UI reads this via
 * `GET /api/v1/index/status` to render "Last indexed: 2 minutes ago".
 *
 * Always overwrites the prior record — the most recent successful index is
 * always the source of truth, and a partial/failed run never reaches this code
 * path (errors are logged separately and DO NOT update the timestamp, which is
 * how the UI distinguishes "indexed 5 min ago" from "indexed never / failed").
 *
 * @param {{ get: Function, set: Function, delete: Function }} blobStore
 * @param {{
 *   canisterUid: string,
 *   vaultId: string,
 *   actorUid?: string|null,
 *   notesProcessed?: number,
 *   chunksIndexed?: number,
 *   chunksEmbedded?: number,
 *   chunksSkippedCached?: number,
 *   vectorsDeleted?: number,
 *   embeddingInputTokens?: number,
 *   durationMs?: number,
 *   mode?: 'sync' | 'background',
 *   provider?: string|null,
 *   model?: string|null,
 *   now?: () => number,
 * }} opts
 * @returns {Promise<{ written: true, record: object }>}
 */
export async function setLastIndexedAt(blobStore, opts) {
  if (!blobStore || typeof blobStore.set !== 'function') {
    throw new TypeError('setLastIndexedAt: blobStore with set is required');
  }
  if (opts == null || typeof opts !== 'object') {
    throw new TypeError('setLastIndexedAt: opts is required');
  }
  const { canisterUid, vaultId } = opts;
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const t = now();
  const record = {
    lastIndexedAt: new Date(t).toISOString(),
    lastIndexedAtEpochMs: t,
    actorUid: typeof opts.actorUid === 'string' ? opts.actorUid : null,
    notesProcessed: numberOr(opts.notesProcessed, 0),
    chunksIndexed: numberOr(opts.chunksIndexed, 0),
    chunksEmbedded: numberOr(opts.chunksEmbedded, 0),
    chunksSkippedCached: numberOr(opts.chunksSkippedCached, 0),
    vectorsDeleted: numberOr(opts.vectorsDeleted, 0),
    embeddingInputTokens: numberOr(opts.embeddingInputTokens, 0),
    durationMs: numberOr(opts.durationMs, 0),
    mode: opts.mode === 'background' ? 'background' : 'sync',
    provider: typeof opts.provider === 'string' ? opts.provider : null,
    model: typeof opts.model === 'string' ? opts.model : null,
  };
  await blobStore.set(lastIndexedKey(canisterUid, vaultId), JSON.stringify(record));
  return { written: true, record };
}

/**
 * Read the last-indexed sidecar. Returns `null` when the vault has never been
 * successfully indexed (no blob yet) or the blob is malformed (e.g. partial
 * write from an old deploy). The Hub UI treats `null` as "Last indexed: never".
 *
 * @param {{ get: Function }} blobStore
 * @param {{ canisterUid: string, vaultId: string }} opts
 * @returns {Promise<object|null>}
 */
export async function getLastIndexedAt(blobStore, opts) {
  if (!blobStore || typeof blobStore.get !== 'function') {
    throw new TypeError('getLastIndexedAt: blobStore with get is required');
  }
  if (opts == null || typeof opts !== 'object') {
    throw new TypeError('getLastIndexedAt: opts is required');
  }
  const { canisterUid, vaultId } = opts;
  const key = lastIndexedKey(canisterUid, vaultId);
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

function numberOr(value, fallback) {
  if (value == null) return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Hosted bridge: persist media store files in Netlify Blobs (SEC-SEAM-MEDIA-b / SM-C6).
 *
 * Self-hosted Hub uses DATA_DIR files only. On Netlify, DATA_DIR is ephemeral; this
 * module hydrates the media store files from Blobs before media propose/apply/list
 * reads and persists them after mutating writes (capture blob-sync parity).
 *
 * Merge strategy (documented per SM-C6, CAPTURE-STORE-STALE-MERGE lessons):
 * - `hub_attachment_external_refs.json`: id-keyed union per vault by attachment_id;
 *   on collision the newer `updated` wins (local wins ties). A warm lambda's stale
 *   local file must never mask a ref another instance persisted to Blobs.
 * - `hub_media_import_consent.json`: id-keyed union per vault by consent_id; on
 *   collision a `revoked` record wins over `active` (fail-closed — a revoke on one
 *   instance must never be resurrected), otherwise newer `granted_at` wins.
 * - `hub_media_connector_policy.json` / `hub_media_write_policy.json`: ops-managed
 *   documents — blob copy replaces local on hydrate (all mutations happen inside
 *   `withMediaBlobSync`, which persists after run, so blob ≥ local at hydrate time).
 */

import fs from 'fs';
import path from 'path';

/** @typedef {{ get: (key: string, opts?: { type?: string }) => Promise<string|ArrayBuffer|null>, set: (key: string, value: string) => Promise<void> }} BlobStore */

export const MEDIA_EXTERNAL_REFS_FILENAME = 'hub_attachment_external_refs.json';
export const MEDIA_IMPORT_CONSENT_FILENAME = 'hub_media_import_consent.json';
export const MEDIA_CONNECTOR_POLICY_FILENAME = 'hub_media_connector_policy.json';
export const MEDIA_WRITE_POLICY_FILENAME = 'hub_media_write_policy.json';

export const MEDIA_BLOB_FILES = [
  MEDIA_EXTERNAL_REFS_FILENAME,
  MEDIA_IMPORT_CONSENT_FILENAME,
  MEDIA_CONNECTOR_POLICY_FILENAME,
  MEDIA_WRITE_POLICY_FILENAME,
];

/**
 * @param {string} filename
 * @returns {string}
 */
export function mediaBlobKey(filename) {
  return `media/${filename}`;
}

/**
 * @param {string} raw
 * @returns {Record<string, unknown>|null}
 */
function parseStore(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Union `vaults.<vid>.<collection>` maps from local and blob copies of a store file.
 *
 * @param {string} localRaw
 * @param {string} blobRaw
 * @param {string} collection - e.g. 'refs' | 'consents'
 * @param {(localRec: Record<string, unknown>, blobRec: Record<string, unknown>) => Record<string, unknown>} pick
 * @returns {string}
 */
function mergeVaultKeyedStoreJson(localRaw, blobRaw, collection, pick) {
  const local = parseStore(localRaw);
  const blob = parseStore(blobRaw);
  if (!local && !blob) return blobRaw || localRaw || '';
  if (!local) return blobRaw;
  if (!blob) return localRaw;

  const localVaults =
    local.vaults && typeof local.vaults === 'object' ? /** @type {Record<string, any>} */ (local.vaults) : {};
  const blobVaults =
    blob.vaults && typeof blob.vaults === 'object' ? /** @type {Record<string, any>} */ (blob.vaults) : {};

  const vaultIds = new Set([...Object.keys(blobVaults), ...Object.keys(localVaults)]);
  /** @type {Record<string, any>} */
  const outVaults = {};
  for (const vid of vaultIds) {
    const localRows =
      localVaults[vid]?.[collection] && typeof localVaults[vid][collection] === 'object'
        ? localVaults[vid][collection]
        : {};
    const blobRows =
      blobVaults[vid]?.[collection] && typeof blobVaults[vid][collection] === 'object'
        ? blobVaults[vid][collection]
        : {};
    /** @type {Record<string, unknown>} */
    const merged = { ...blobRows };
    for (const [id, rec] of Object.entries(localRows)) {
      if (!rec || typeof rec !== 'object') continue;
      const existing = merged[id];
      if (!existing || typeof existing !== 'object') {
        merged[id] = rec;
        continue;
      }
      merged[id] = pick(
        /** @type {Record<string, unknown>} */ (rec),
        /** @type {Record<string, unknown>} */ (existing),
      );
    }
    outVaults[vid] = { ...(blobVaults[vid] ?? {}), ...(localVaults[vid] ?? {}), [collection]: merged };
  }

  return JSON.stringify({ ...blob, ...local, vaults: outVaults });
}

/**
 * External refs: newest `updated` wins; local wins ties.
 *
 * @param {string} localRaw
 * @param {string} blobRaw
 * @returns {string}
 */
export function mergeExternalRefStoreJson(localRaw, blobRaw) {
  return mergeVaultKeyedStoreJson(localRaw, blobRaw, 'refs', (localRec, blobRec) => {
    const tLocal = Date.parse(String(localRec.updated || localRec.created || '')) || 0;
    const tBlob = Date.parse(String(blobRec.updated || blobRec.created || '')) || 0;
    return tLocal >= tBlob ? localRec : blobRec;
  });
}

/**
 * Import consents: `revoked` wins over `active` (fail-closed); else newest granted_at
 * wins; local wins ties.
 *
 * @param {string} localRaw
 * @param {string} blobRaw
 * @returns {string}
 */
export function mergeImportConsentStoreJson(localRaw, blobRaw) {
  return mergeVaultKeyedStoreJson(localRaw, blobRaw, 'consents', (localRec, blobRec) => {
    const localRevoked = localRec.status === 'revoked';
    const blobRevoked = blobRec.status === 'revoked';
    if (localRevoked !== blobRevoked) return localRevoked ? localRec : blobRec;
    const tLocal = Date.parse(String(localRec.granted_at || '')) || 0;
    const tBlob = Date.parse(String(blobRec.granted_at || '')) || 0;
    return tLocal >= tBlob ? localRec : blobRec;
  });
}

const MERGERS = {
  [MEDIA_EXTERNAL_REFS_FILENAME]: mergeExternalRefStoreJson,
  [MEDIA_IMPORT_CONSENT_FILENAME]: mergeImportConsentStoreJson,
};

/**
 * Load media store files from Blobs into DATA_DIR (hosted cold-start hydration).
 *
 * @param {BlobStore|null|undefined} blobStore
 * @param {string} dataDir
 */
export async function hydrateMediaStoresFromBlob(blobStore, dataDir) {
  if (!blobStore || typeof blobStore.get !== 'function') return;
  fs.mkdirSync(dataDir, { recursive: true });
  for (const filename of MEDIA_BLOB_FILES) {
    const fp = path.join(dataDir, filename);
    try {
      const raw = await blobStore.get(mediaBlobKey(filename), { type: 'text' });
      if (typeof raw === 'string' && raw.trim()) {
        const merger = MERGERS[filename];
        if (merger && fs.existsSync(fp)) {
          const merged = merger(fs.readFileSync(fp, 'utf8'), raw);
          if (merged.trim()) fs.writeFileSync(fp, merged, 'utf8');
        } else {
          fs.writeFileSync(fp, raw, 'utf8');
        }
      }
    } catch {
      /* keep existing file or empty */
    }
  }
}

/**
 * Write media store files from DATA_DIR to Blobs after a mutation.
 *
 * @param {BlobStore|null|undefined} blobStore
 * @param {string} dataDir
 */
export async function persistMediaStoresToBlob(blobStore, dataDir) {
  if (!blobStore || typeof blobStore.set !== 'function') return;
  for (const filename of MEDIA_BLOB_FILES) {
    const fp = path.join(dataDir, filename);
    if (!fs.existsSync(fp)) continue;
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      if (raw.trim()) {
        await blobStore.set(mediaBlobKey(filename), raw);
      }
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * Run a media store mutation with hosted Blob hydrate/persist when available.
 * Persists only files whose content changed during the run.
 *
 * @template T
 * @param {{
 *   blobStore: BlobStore|null|undefined,
 *   dataDir: string,
 *   run: () => T | Promise<T>,
 * }} opts
 * @returns {Promise<T>}
 */
export async function withMediaBlobSync(opts) {
  if (!opts.blobStore || typeof opts.blobStore.get !== 'function') {
    return opts.run();
  }

  await hydrateMediaStoresFromBlob(opts.blobStore, opts.dataDir);

  const before = new Map();
  for (const filename of MEDIA_BLOB_FILES) {
    const fp = path.join(opts.dataDir, filename);
    if (fs.existsSync(fp)) {
      try {
        before.set(filename, fs.readFileSync(fp, 'utf8'));
      } catch {
        /* treat as absent */
      }
    }
  }

  const result = await opts.run();

  for (const filename of MEDIA_BLOB_FILES) {
    const fp = path.join(opts.dataDir, filename);
    if (!fs.existsSync(fp)) continue;
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      if (raw.trim() && raw !== before.get(filename)) {
        await opts.blobStore.set(mediaBlobKey(filename), raw);
      }
    } catch {
      /* non-fatal */
    }
  }

  return result;
}

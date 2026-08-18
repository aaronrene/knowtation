/**
 * Hosted bridge: persist external protocol state in Netlify Blobs.
 *
 * Self-hosted bridge uses DATA_DIR files only. On Netlify, DATA_DIR is ephemeral;
 * this module hydrates files from Blobs before protocol handlers and persists after writes.
 */

import fs from 'fs';
import path from 'path';
import { FLOW_STORE_FILENAME } from '../../lib/flow/flow-store.mjs';
import { hydrateDelegationStoresFromBlob } from './delegation-blob-store.mjs';

/** @typedef {{ get: (key: string, opts?: { type?: string }) => Promise<string|ArrayBuffer|null>, set: (key: string, value: string) => Promise<void> }} BlobStore */

export const EXTERNAL_PROTOCOL_BLOB_FILES = [
  FLOW_STORE_FILENAME,
  'hub_external_protocol_idempotency.json',
  'hub_delegation_audit.json',
];

/**
 * @param {string} filename
 * @returns {string}
 */
export function externalProtocolBlobKey(filename) {
  return `external-protocol/${filename}`;
}

/**
 * Merge local and blob flow stores without losing fresher task writes.
 * Task apply may land on a warm lambda before the external-protocol blob reflects it.
 *
 * @param {string} localRaw
 * @param {string} blobRaw
 * @returns {string}
 */
export function mergeFlowStoreJson(localRaw, blobRaw) {
  const parse = (raw) => {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const local = parse(localRaw);
  const blob = parse(blobRaw);
  if (!local && !blob) return blobRaw || localRaw || '';
  if (!local) return blobRaw;
  if (!blob) return localRaw;

  /**
   * Union local and blob records by natural key; on collision the newer
   * `updated`/`created` wins (local wins ties). Prevents a warm lambda's stale
   * local array from masking records another instance persisted to Blobs.
   *
   * @param {unknown[]} localArr
   * @param {unknown[]} blobArr
   * @param {(rec: Record<string, unknown>) => string|null} keyOf
   */
  const mergeByKey = (localArr, blobArr, keyOf) => {
    /** @type {Map<string, Record<string, unknown>>} */
    const byKey = new Map();
    for (const rec of blobArr || []) {
      if (!rec || typeof rec !== 'object') continue;
      const key = keyOf(/** @type {Record<string, unknown>} */ (rec));
      if (key != null) byKey.set(key, /** @type {Record<string, unknown>} */ (rec));
    }
    for (const rec of localArr || []) {
      if (!rec || typeof rec !== 'object') continue;
      const row = /** @type {Record<string, unknown>} */ (rec);
      const key = keyOf(row);
      if (key == null) continue;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, row);
        continue;
      }
      const tLocal = Date.parse(String(row.updated || row.created || '')) || 0;
      const tBlob = Date.parse(String(existing.updated || existing.created || '')) || 0;
      byKey.set(key, tLocal >= tBlob ? row : existing);
    }
    return [...byKey.values()];
  };

  /** @param {string} field @returns {(rec: Record<string, unknown>) => string|null} */
  const stringKey = (field) => (rec) => (typeof rec[field] === 'string' ? rec[field] : null);
  const mergeById = (localArr, blobArr, idField) => mergeByKey(localArr, blobArr, stringKey(idField));

  /** Flows are versioned: one record per (flow_id, version). */
  const flowKey = (rec) =>
    typeof rec.flow_id === 'string' ? `${rec.flow_id}\0${typeof rec.version === 'string' ? rec.version : ''}` : null;
  /** Steps key on (flow_id, flow_version, step_id) — 7A-10c store shape. */
  const stepKey = (rec) =>
    typeof rec.step_id === 'string' && typeof rec.flow_id === 'string'
      ? `${rec.flow_id}\0${typeof rec.flow_version === 'string' ? rec.flow_version : ''}\0${rec.step_id}`
      : null;

  if (!local.vaults) local.vaults = {};
  for (const [vaultId, blobVault] of Object.entries(blob.vaults || {})) {
    const localVault =
      local.vaults[vaultId] && typeof local.vaults[vaultId] === 'object'
        ? /** @type {Record<string, unknown>} */ (local.vaults[vaultId])
        : {};
    const blobVaultObj =
      blobVault && typeof blobVault === 'object'
        ? /** @type {Record<string, unknown>} */ (blobVault)
        : {};
    // candidates/flows must merge by id too: a warm lambda's stale local store
    // otherwise masks blob records written by another instance (this made the
    // approve-time capture apply refuse FLOW_CANDIDATE_NOT_PROMOTABLE while a
    // cold-lambda retry of the same apply succeeded — 2026-07-31 live).
    local.vaults[vaultId] = {
      ...blobVaultObj,
      ...localVault,
      tasks: mergeById(
        /** @type {unknown[]} */ (localVault.tasks),
        /** @type {unknown[]} */ (blobVaultObj.tasks),
        'task_id',
      ),
      task_loops: mergeById(
        /** @type {unknown[]} */ (localVault.task_loops),
        /** @type {unknown[]} */ (blobVaultObj.task_loops),
        'loop_id',
      ),
      candidates: mergeById(
        /** @type {unknown[]} */ (localVault.candidates),
        /** @type {unknown[]} */ (blobVaultObj.candidates),
        'candidate_id',
      ),
      flows: mergeByKey(
        /** @type {unknown[]} */ (localVault.flows),
        /** @type {unknown[]} */ (blobVaultObj.flows),
        flowKey,
      ),
      steps: mergeByKey(
        /** @type {unknown[]} */ (localVault.steps),
        /** @type {unknown[]} */ (blobVaultObj.steps),
        stepKey,
      ),
      runs: mergeById(
        /** @type {unknown[]} */ (localVault.runs),
        /** @type {unknown[]} */ (blobVaultObj.runs),
        'run_id',
      ),
      learning_paths: mergeById(
        /** @type {unknown[]} */ (localVault.learning_paths),
        /** @type {unknown[]} */ (blobVaultObj.learning_paths),
        'path_id',
      ),
    };
  }

  return JSON.stringify(local);
}

/**
 * Load external protocol store files from Blobs into DATA_DIR (hosted cold-start hydration).
 *
 * @param {BlobStore|null|undefined} blobStore
 * @param {string} dataDir
 */
export async function hydrateExternalProtocolStoresFromBlob(blobStore, dataDir) {
  if (!blobStore || typeof blobStore.get !== 'function') return;
  fs.mkdirSync(dataDir, { recursive: true });
  for (const filename of EXTERNAL_PROTOCOL_BLOB_FILES) {
    const fp = path.join(dataDir, filename);
    try {
      const raw = await blobStore.get(externalProtocolBlobKey(filename), { type: 'text' });
      if (typeof raw === 'string' && raw.trim()) {
        if (filename === FLOW_STORE_FILENAME && fs.existsSync(fp)) {
          const localRaw = fs.readFileSync(fp, 'utf8');
          const merged = mergeFlowStoreJson(localRaw, raw);
          if (merged.trim()) {
            fs.writeFileSync(fp, merged, 'utf8');
          }
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
 * Write external protocol store files from DATA_DIR to Blobs after a mutation.
 *
 * @param {BlobStore|null|undefined} blobStore
 * @param {string} dataDir
 */
export async function persistExternalProtocolStoresToBlob(blobStore, dataDir) {
  if (!blobStore || typeof blobStore.set !== 'function') return;
  for (const filename of EXTERNAL_PROTOCOL_BLOB_FILES) {
    const fp = path.join(dataDir, filename);
    if (!fs.existsSync(fp)) continue;
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      if (raw.trim()) {
        await blobStore.set(externalProtocolBlobKey(filename), raw);
      }
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * Run an external protocol mutation with hosted Blob hydrate/persist when available.
 * Pushes them back if changed.
 *
 * @template T
 * @param {{
 *   blobStore: BlobStore|null|undefined,
 *   dataDir: string,
 *   run: () => T | Promise<T>,
 * }} opts
 * @returns {Promise<T>}
 */
export async function withExternalProtocolBlobSync(opts) {
  if (!opts.blobStore || typeof opts.blobStore.get !== 'function') {
    return opts.run();
  }

  await hydrateExternalProtocolStoresFromBlob(opts.blobStore, opts.dataDir);
  await hydrateDelegationStoresFromBlob(opts.blobStore, opts.dataDir);

  // Snapshot before run to avoid unnecessary blob writes if unmodified
  const before = new Map();
  for (const filename of EXTERNAL_PROTOCOL_BLOB_FILES) {
    const fp = path.join(opts.dataDir, filename);
    if (fs.existsSync(fp)) {
      try { before.set(filename, fs.readFileSync(fp, 'utf8')); } catch {}
    }
  }

  const result = await opts.run();

  // Persist if changed
  for (const filename of EXTERNAL_PROTOCOL_BLOB_FILES) {
    const fp = path.join(opts.dataDir, filename);
    if (!fs.existsSync(fp)) continue;
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      if (raw.trim() && raw !== before.get(filename)) {
        await opts.blobStore.set(externalProtocolBlobKey(filename), raw);
      }
    } catch {
      /* non-fatal */
    }
  }

  return result;
}

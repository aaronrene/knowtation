/**
 * Hosted bridge: persist external protocol state in Netlify Blobs.
 *
 * Self-hosted bridge uses DATA_DIR files only. On Netlify, DATA_DIR is ephemeral;
 * this module hydrates files from Blobs before protocol handlers and persists after writes.
 */

import fs from 'fs';
import path from 'path';
import { FLOW_STORE_FILENAME } from '../../lib/flow/flow-store.mjs';
import { hydrateDelegationStoresFromBlob, persistDelegationStoresToBlob } from './delegation-blob-store.mjs';

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

  /** @param {unknown[]} localArr @param {unknown[]} blobArr @param {string} idField */
  const mergeById = (localArr, blobArr, idField) => {
    /** @type {Map<string, Record<string, unknown>>} */
    const byId = new Map();
    for (const rec of blobArr || []) {
      if (rec && typeof rec === 'object' && typeof rec[idField] === 'string') {
        byId.set(rec[idField], /** @type {Record<string, unknown>} */ (rec));
      }
    }
    for (const rec of localArr || []) {
      if (!rec || typeof rec !== 'object' || typeof rec[idField] !== 'string') continue;
      const row = /** @type {Record<string, unknown>} */ (rec);
      const existing = byId.get(row[idField]);
      if (!existing) {
        byId.set(row[idField], row);
        continue;
      }
      const tLocal = Date.parse(String(row.updated || row.created || '')) || 0;
      const tBlob = Date.parse(String(existing.updated || existing.created || '')) || 0;
      byId.set(row[idField], tLocal >= tBlob ? row : existing);
    }
    return [...byId.values()];
  };

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

  // External protocol claim/complete append delegation audit + bump grant action_count locally;
  // persist grants (and audit) to delegation/* blob keys so grant list reflects hosted mutations.
  await persistDelegationStoresToBlob(opts.blobStore, opts.dataDir);

  return result;
}

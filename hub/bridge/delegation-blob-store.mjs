/**
 * Hosted bridge: persist delegation index JSON in Netlify Blobs (7C-L1c).
 *
 * Self-hosted bridge uses DATA_DIR files only. On Netlify, DATA_DIR is ephemeral;
 * this module hydrates files from Blobs before delegation handlers and persists after writes.
 */

import fs from 'fs';
import path from 'path';
import {
  DELEGATION_POLICY_FILE,
  DELEGATION_IDENTITIES_FILE,
  DELEGATION_CONSENTS_FILE,
  DELEGATION_GRANTS_FILE,
  DELEGATION_AUDIT_FILE,
} from '../../lib/agent/delegation.mjs';

/** @typedef {{ get: (key: string, opts?: { type?: string }) => Promise<string|ArrayBuffer|null>, set: (key: string, value: string) => Promise<void> }} BlobStore */

export const DELEGATION_BLOB_FILES = [
  DELEGATION_POLICY_FILE,
  DELEGATION_IDENTITIES_FILE,
  DELEGATION_CONSENTS_FILE,
  DELEGATION_GRANTS_FILE,
  DELEGATION_AUDIT_FILE,
];

/**
 * @param {string} filename
 * @returns {string}
 */
export function delegationBlobKey(filename) {
  return `delegation/${filename}`;
}

/**
 * Load delegation store files from Blobs into DATA_DIR (hosted cold-start hydration).
 *
 * @param {BlobStore|null|undefined} blobStore
 * @param {string} dataDir
 */
export async function hydrateDelegationStoresFromBlob(blobStore, dataDir) {
  if (!blobStore || typeof blobStore.get !== 'function') return;
  fs.mkdirSync(dataDir, { recursive: true });
  for (const filename of DELEGATION_BLOB_FILES) {
    const fp = path.join(dataDir, filename);
    try {
      const raw = await blobStore.get(delegationBlobKey(filename), { type: 'text' });
      if (typeof raw === 'string' && raw.trim()) {
        fs.writeFileSync(fp, raw, 'utf8');
      }
    } catch {
      /* keep existing file or empty */
    }
  }
}

/**
 * Write delegation store files from DATA_DIR to Blobs after a mutation.
 *
 * @param {BlobStore|null|undefined} blobStore
 * @param {string} dataDir
 */
export async function persistDelegationStoresToBlob(blobStore, dataDir) {
  if (!blobStore || typeof blobStore.set !== 'function') return;
  for (const filename of DELEGATION_BLOB_FILES) {
    const fp = path.join(dataDir, filename);
    if (!fs.existsSync(fp)) continue;
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      if (raw.trim()) {
        await blobStore.set(delegationBlobKey(filename), raw);
      }
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * Run a delegation mutation with hosted Blob hydrate/persist when available.
 *
 * @template T
 * @param {{
 *   blobStore: BlobStore|null|undefined,
 *   dataDir: string,
 *   run: () => T | Promise<T>,
 * }} opts
 * @returns {Promise<T>}
 */
export async function withDelegationBlobSync(opts) {
  await hydrateDelegationStoresFromBlob(opts.blobStore, opts.dataDir);
  const result = await opts.run();
  await persistDelegationStoresToBlob(opts.blobStore, opts.dataDir);
  return result;
}

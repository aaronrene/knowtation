/**
 * Hosted bridge: persist external protocol state in Netlify Blobs.
 *
 * Self-hosted bridge uses DATA_DIR files only. On Netlify, DATA_DIR is ephemeral;
 * this module hydrates files from Blobs before protocol handlers and persists after writes.
 */

import fs from 'fs';
import path from 'path';
import { hydrateDelegationStoresFromBlob } from './delegation-blob-store.mjs';

/** @typedef {{ get: (key: string, opts?: { type?: string }) => Promise<string|ArrayBuffer|null>, set: (key: string, value: string) => Promise<void> }} BlobStore */

export const EXTERNAL_PROTOCOL_BLOB_FILES = [
  'hub_flow_store.json',
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
        fs.writeFileSync(fp, raw, 'utf8');
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

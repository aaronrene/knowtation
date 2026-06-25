/**
 * Hosted bridge: persist loop pass audit JSON in Netlify Blobs (Phase 2G hosted parity).
 */

import fs from 'fs';
import path from 'path';
import { LOOP_PASS_AUDIT_FILE, LOOP_PASS_AUDIT_POLICY_FILE } from '../../lib/task/loop-pass-audit.mjs';

/** @typedef {{ get: (key: string, opts?: { type?: string }) => Promise<string|ArrayBuffer|null>, set: (key: string, value: string) => Promise<void> }} BlobStore */

export const LOOP_PASS_AUDIT_BLOB_FILES = [LOOP_PASS_AUDIT_FILE, LOOP_PASS_AUDIT_POLICY_FILE];

/**
 * @param {string} filename
 * @returns {string}
 */
export function loopPassAuditBlobKey(filename) {
  return `loop_pass_audit/${filename}`;
}

/**
 * @param {BlobStore|null|undefined} blobStore
 * @param {string} dataDir
 */
export async function hydrateLoopPassAuditStoresFromBlob(blobStore, dataDir) {
  if (!blobStore || typeof blobStore.get !== 'function') return;
  fs.mkdirSync(dataDir, { recursive: true });
  for (const filename of LOOP_PASS_AUDIT_BLOB_FILES) {
    const fp = path.join(dataDir, filename);
    try {
      const raw = await blobStore.get(loopPassAuditBlobKey(filename), { type: 'text' });
      if (typeof raw === 'string' && raw.trim()) {
        fs.writeFileSync(fp, raw, 'utf8');
      }
    } catch {
      /* keep existing file or empty */
    }
  }
}

/**
 * @param {BlobStore|null|undefined} blobStore
 * @param {string} dataDir
 */
export async function persistLoopPassAuditStoresToBlob(blobStore, dataDir) {
  if (!blobStore || typeof blobStore.set !== 'function') return;
  for (const filename of LOOP_PASS_AUDIT_BLOB_FILES) {
    const fp = path.join(dataDir, filename);
    if (!fs.existsSync(fp)) continue;
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      if (raw.trim()) {
        await blobStore.set(loopPassAuditBlobKey(filename), raw);
      }
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * @template T
 * @param {{
 *   blobStore: BlobStore|null|undefined,
 *   dataDir: string,
 *   run: () => T | Promise<T>,
 * }} opts
 * @returns {Promise<T>}
 */
export async function withLoopPassAuditBlobSync(opts) {
  await hydrateLoopPassAuditStoresFromBlob(opts.blobStore, opts.dataDir);
  const result = await opts.run();
  await persistLoopPassAuditStoresToBlob(opts.blobStore, opts.dataDir);
  return result;
}

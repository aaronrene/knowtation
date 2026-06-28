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
 * Merge local and blob grants stores without losing fresher mints or revocations.
 * Warm bridge lambdas may mint/revoke on disk before the blob read in the next handler
 * reflects that write; blind overwrite caused flaky E2/E5 smokes.
 *
 * @param {string} localRaw
 * @param {string} blobRaw
 * @returns {string}
 */
export function mergeGrantsStoreJson(localRaw, blobRaw) {
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

  /** @param {Record<string, unknown>} grant */
  const grantScore = (grant) => (grant.revoked_at ? 2 : 1);

  /** @param {Record<string, unknown>} a @param {Record<string, unknown>} b */
  const pickGrant = (a, b) => {
    const scoreA = grantScore(a);
    const scoreB = grantScore(b);
    if (scoreA !== scoreB) return scoreA > scoreB ? a : b;
    const countA = typeof a.action_count === 'number' ? a.action_count : 0;
    const countB = typeof b.action_count === 'number' ? b.action_count : 0;
    if (countA !== countB) return countB > countA ? b : a;
    const timeA = Date.parse(String(a.issued_at || '')) || 0;
    const timeB = Date.parse(String(b.issued_at || '')) || 0;
    return timeB >= timeA ? b : a;
  };

  if (!local.vaults) local.vaults = {};
  for (const [vaultId, blobVault] of Object.entries(blob.vaults || {})) {
    const localVault = local.vaults[vaultId];
    if (!localVault || !Array.isArray(localVault.grants)) {
      local.vaults[vaultId] = blobVault;
      continue;
    }
    /** @type {Map<string, Record<string, unknown>>} */
    const byId = new Map();
    for (const grant of localVault.grants) {
      if (grant && typeof grant.grant_id === 'string') byId.set(grant.grant_id, grant);
    }
    for (const grant of blobVault.grants || []) {
      if (!grant || typeof grant.grant_id !== 'string') continue;
      const existing = byId.get(grant.grant_id);
      byId.set(grant.grant_id, existing ? pickGrant(existing, grant) : grant);
    }
    local.vaults[vaultId] = { grants: [...byId.values()] };
  }

  return JSON.stringify(local);
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
        if (filename === DELEGATION_GRANTS_FILE && fs.existsSync(fp)) {
          const localRaw = fs.readFileSync(fp, 'utf8');
          const merged = mergeGrantsStoreJson(localRaw, raw);
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

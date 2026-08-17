/**
 * Hosted bridge: persist docs connector store + encrypted OAuth token blobs in Netlify Blobs.
 *
 * Same strong-consistency hydrate rule as calendar-blob-store: OAuth begin and callback
 * often land on different Lambdas within seconds. Eventual consistency would yield
 * state_invalid on callback.
 *
 * Blob keys use docs/… — never calendar/oauth/….
 *
 * @see docs/KN-DOCS-SYNC-FREEZE.md D17
 * @see hub/bridge/calendar-blob-store.mjs
 */

import fs from 'fs';
import path from 'path';
import {
  DOCS_STORE_FILENAME,
  loadDocsStore,
} from '../../lib/docs/docs-connector-store.mjs';
import { oauthTokenVaultPath } from '../../lib/docs/oauth-token-vault.mjs';

/**
 * @typedef {{
 *   get: (key: string, opts?: { type?: string, consistency?: 'eventual' | 'strong' }) => Promise<string|ArrayBuffer|null>,
 *   set: (key: string, value: string) => Promise<void>
 * }} BlobStore
 */

export const DOCS_STORE_BLOB_KEY = `docs/${DOCS_STORE_FILENAME}`;

/**
 * @param {string} connectorId
 * @returns {string}
 */
export function docsOAuthBlobKey(connectorId) {
  return `docs/oauth/${connectorId}.enc`;
}

/**
 * @param {string} dataDir
 * @returns {string}
 */
export function docsOAuthDir(dataDir) {
  return path.join(dataDir, 'docs_oauth');
}

/**
 * @param {string} dataDir
 * @returns {string}
 */
export function getDocsStorePath(dataDir) {
  return path.join(dataDir, DOCS_STORE_FILENAME);
}

/**
 * Status preference for connector merge (higher wins).
 * @param {Record<string, unknown>} connector
 * @returns {number}
 */
function connectorStatusScore(connector) {
  const status = typeof connector.status === 'string' ? connector.status : '';
  if (status === 'pending' && connector.oauth_pending) return 4;
  if (status === 'connected') return 3;
  if (status === 'pending') return 2;
  if (status === 'needs_reauth') return 1;
  if (status === 'revoked') return 0;
  return 0;
}

/**
 * @param {Record<string, unknown>} connector
 * @returns {number}
 */
function connectorRecencyMs(connector) {
  const pending = connector.oauth_pending;
  if (pending && typeof pending === 'object' && typeof pending.expires_at === 'string') {
    const exp = Date.parse(pending.expires_at);
    if (Number.isFinite(exp)) return exp;
  }
  for (const key of ['last_sync_at', 'revoked_at']) {
    const raw = connector[key];
    if (typeof raw === 'string') {
      const ms = Date.parse(raw);
      if (Number.isFinite(ms)) return ms;
    }
  }
  return 0;
}

/**
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 * @returns {Record<string, unknown>}
 */
function pickConnector(a, b) {
  const scoreA = connectorStatusScore(a);
  const scoreB = connectorStatusScore(b);
  if (scoreA !== scoreB) return scoreA > scoreB ? a : b;
  const timeA = connectorRecencyMs(a);
  const timeB = connectorRecencyMs(b);
  return timeB >= timeA ? b : a;
}

/**
 * Merge local + blob docs stores so warm-Lambda pending OAuth is not wiped.
 * @param {string} localRaw
 * @param {string} blobRaw
 * @returns {string}
 */
export function mergeDocsStoreJson(localRaw, blobRaw) {
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

  if (!local.vaults || typeof local.vaults !== 'object') local.vaults = {};
  if (!blob.vaults || typeof blob.vaults !== 'object') blob.vaults = {};

  const vaultIds = new Set([...Object.keys(local.vaults), ...Object.keys(blob.vaults)]);
  /** @type {Record<string, unknown>} */
  const mergedVaults = {};

  for (const vaultId of vaultIds) {
    const localVault = local.vaults[vaultId];
    const blobVault = blob.vaults[vaultId];
    if (!localVault) {
      mergedVaults[vaultId] = blobVault;
      continue;
    }
    if (!blobVault) {
      mergedVaults[vaultId] = localVault;
      continue;
    }

    /** @type {Map<string, Record<string, unknown>>} */
    const byId = new Map();
    for (const connector of [
      ...(Array.isArray(blobVault.connectors) ? blobVault.connectors : []),
      ...(Array.isArray(localVault.connectors) ? localVault.connectors : []),
    ]) {
      if (!connector || typeof connector !== 'object') continue;
      const id = typeof connector.connector_id === 'string' ? connector.connector_id.trim() : '';
      if (!id) continue;
      const existing = byId.get(id);
      byId.set(id, existing ? pickConnector(existing, connector) : connector);
    }

    mergedVaults[vaultId] = {
      ...blobVault,
      ...localVault,
      connectors: [...byId.values()],
    };
  }

  return JSON.stringify({
    ...blob,
    ...local,
    vaults: mergedVaults,
  });
}

/**
 * @param {string} dataDir
 * @returns {string[]}
 */
export function listDocsConnectorIdsForBlobSync(dataDir) {
  const store = loadDocsStore(dataDir);
  /** @type {Set<string>} */
  const ids = new Set();
  for (const vault of Object.values(store.vaults ?? {})) {
    for (const connector of vault.connectors ?? []) {
      if (
        connector.status === 'connected'
        && typeof connector.connector_id === 'string'
        && connector.connector_id.trim()
        && connector.provider === 'google-drive'
      ) {
        ids.add(connector.connector_id.trim());
      }
    }
  }
  const oauthDir = docsOAuthDir(dataDir);
  if (fs.existsSync(oauthDir)) {
    for (const name of fs.readdirSync(oauthDir)) {
      if (name.endsWith('.enc')) ids.add(name.slice(0, -4));
    }
  }
  return [...ids];
}

/**
 * @param {BlobStore|null|undefined} blobStore
 * @param {string} dataDir
 */
export async function hydrateDocsStoresFromBlob(blobStore, dataDir) {
  if (!blobStore || typeof blobStore.get !== 'function') return;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(docsOAuthDir(dataDir), { recursive: true });

  const storePath = getDocsStorePath(dataDir);
  let localRaw = '';
  if (fs.existsSync(storePath)) {
    try {
      localRaw = fs.readFileSync(storePath, 'utf8');
    } catch {
      localRaw = '';
    }
  }

  try {
    const storeRaw = await blobStore.get(DOCS_STORE_BLOB_KEY, {
      type: 'text',
      consistency: 'strong',
    });
    if (typeof storeRaw === 'string' && storeRaw.trim()) {
      const merged = mergeDocsStoreJson(localRaw, storeRaw);
      if (merged.trim()) fs.writeFileSync(storePath, merged, 'utf8');
    }
  } catch {
    /* keep existing */
  }

  for (const connectorId of listDocsConnectorIdsForBlobSync(dataDir)) {
    try {
      const raw = await blobStore.get(docsOAuthBlobKey(connectorId), {
        type: 'text',
        consistency: 'strong',
      });
      if (typeof raw === 'string' && raw.trim()) {
        const dest = oauthTokenVaultPath(dataDir, connectorId);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, raw, 'utf8');
      }
    } catch {
      /* skip */
    }
  }
}

/**
 * @param {BlobStore|null|undefined} blobStore
 * @param {string} dataDir
 */
export async function persistDocsStoresToBlob(blobStore, dataDir) {
  if (!blobStore || typeof blobStore.set !== 'function') return;

  const storePath = getDocsStorePath(dataDir);
  if (fs.existsSync(storePath)) {
    try {
      const raw = fs.readFileSync(storePath, 'utf8');
      if (raw.trim()) await blobStore.set(DOCS_STORE_BLOB_KEY, raw);
    } catch {
      /* non-fatal */
    }
  }

  const oauthDir = docsOAuthDir(dataDir);
  if (!fs.existsSync(oauthDir)) return;
  for (const name of fs.readdirSync(oauthDir)) {
    if (!name.endsWith('.enc')) continue;
    const connectorId = name.slice(0, -4);
    try {
      const raw = fs.readFileSync(path.join(oauthDir, name), 'utf8');
      if (raw.trim()) await blobStore.set(docsOAuthBlobKey(connectorId), raw);
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
 *   persist?: boolean,
 *   run: () => T | Promise<T>,
 * }} opts
 * @returns {Promise<T>}
 */
export async function withDocsBlobSync(opts) {
  await hydrateDocsStoresFromBlob(opts.blobStore, opts.dataDir);
  const result = await opts.run();
  if (opts.persist !== false) {
    await persistDocsStoresToBlob(opts.blobStore, opts.dataDir);
  }
  return result;
}

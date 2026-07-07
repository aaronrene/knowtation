/**
 * Hosted bridge: persist calendar store + encrypted OAuth token blobs in Netlify Blobs.
 *
 * Self-hosted bridge uses DATA_DIR files only. On Netlify, DATA_DIR is ephemeral;
 * this module hydrates from Blobs before calendar handlers and persists after writes.
 *
 * @see hub/bridge/delegation-blob-store.mjs — same hydrate/persist pattern (7C-L1c)
 */

import fs from 'fs';
import path from 'path';
import {
  CALENDAR_OAUTH_DIR,
  CALENDAR_STORE_FILENAME,
  getCalendarStorePath,
  loadCalendarStore,
} from '../../lib/calendar/event-store.mjs';

/** @typedef {{ get: (key: string, opts?: { type?: string }) => Promise<string|ArrayBuffer|null>, set: (key: string, value: string) => Promise<void> }} BlobStore */

export const CALENDAR_STORE_BLOB_KEY = `calendar/${CALENDAR_STORE_FILENAME}`;

/**
 * @param {string} connectorId
 * @returns {string}
 */
export function calendarOAuthBlobKey(connectorId) {
  return `calendar/oauth/${connectorId}.enc`;
}

/**
 * @param {string} dataDir
 * @returns {string}
 */
export function calendarOAuthDir(dataDir) {
  return path.join(dataDir, CALENDAR_OAUTH_DIR);
}

/**
 * Connector ids that may have encrypted token blobs on disk.
 *
 * @param {string} dataDir
 * @returns {string[]}
 */
export function listCalendarConnectorIdsForBlobSync(dataDir) {
  const store = loadCalendarStore(dataDir);
  /** @type {Set<string>} */
  const ids = new Set();
  for (const vault of Object.values(store.vaults ?? {})) {
    for (const connector of vault.connectors ?? []) {
      if (
        connector.status === 'connected'
        && typeof connector.connector_id === 'string'
        && connector.connector_id.trim()
      ) {
        ids.add(connector.connector_id.trim());
      }
    }
  }
  const oauthDir = calendarOAuthDir(dataDir);
  if (fs.existsSync(oauthDir)) {
    for (const name of fs.readdirSync(oauthDir)) {
      if (name.endsWith('.enc')) {
        ids.add(name.slice(0, -4));
      }
    }
  }
  return [...ids];
}

/**
 * Load calendar store + OAuth token blobs from Blobs into DATA_DIR (hosted cold-start hydration).
 *
 * @param {BlobStore|null|undefined} blobStore
 * @param {string} dataDir
 */
export async function hydrateCalendarStoresFromBlob(blobStore, dataDir) {
  if (!blobStore || typeof blobStore.get !== 'function') return;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(calendarOAuthDir(dataDir), { recursive: true });

  try {
    const storeRaw = await blobStore.get(CALENDAR_STORE_BLOB_KEY, { type: 'text' });
    if (typeof storeRaw === 'string' && storeRaw.trim()) {
      fs.writeFileSync(getCalendarStorePath(dataDir), storeRaw, 'utf8');
    }
  } catch {
    /* keep existing file or empty */
  }

  const connectorIds = listCalendarConnectorIdsForBlobSync(dataDir);
  for (const connectorId of connectorIds) {
    try {
      const raw = await blobStore.get(calendarOAuthBlobKey(connectorId), { type: 'text' });
      if (typeof raw === 'string' && raw.trim()) {
        fs.writeFileSync(path.join(calendarOAuthDir(dataDir), `${connectorId}.enc`), raw, 'utf8');
      }
    } catch {
      /* keep existing file or skip */
    }
  }
}

/**
 * Write calendar store + OAuth token blobs from DATA_DIR to Blobs after a mutation.
 *
 * @param {BlobStore|null|undefined} blobStore
 * @param {string} dataDir
 */
export async function persistCalendarStoresToBlob(blobStore, dataDir) {
  if (!blobStore || typeof blobStore.set !== 'function') return;

  const storePath = getCalendarStorePath(dataDir);
  if (fs.existsSync(storePath)) {
    try {
      const raw = fs.readFileSync(storePath, 'utf8');
      if (raw.trim()) {
        await blobStore.set(CALENDAR_STORE_BLOB_KEY, raw);
      }
    } catch {
      /* non-fatal */
    }
  }

  const oauthDir = calendarOAuthDir(dataDir);
  if (!fs.existsSync(oauthDir)) return;

  for (const name of fs.readdirSync(oauthDir)) {
    if (!name.endsWith('.enc')) continue;
    const connectorId = name.slice(0, -4);
    const fp = path.join(oauthDir, name);
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      if (raw.trim()) {
        await blobStore.set(calendarOAuthBlobKey(connectorId), raw);
      }
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * Run a calendar handler with hosted Blob hydrate/persist when available.
 *
 * @template T
 * @param {{
 *   blobStore: BlobStore|null|undefined,
 *   dataDir: string,
 *   persist?: boolean,
 *   run: () => T | Promise<T>,
 * }} opts
 * @returns {Promise<T>}
 */
export async function withCalendarBlobSync(opts) {
  await hydrateCalendarStoresFromBlob(opts.blobStore, opts.dataDir);
  const result = await opts.run();
  if (opts.persist !== false) {
    await persistCalendarStoresToBlob(opts.blobStore, opts.dataDir);
  }
  return result;
}

/**
 * Hosted bridge: persist calendar store + encrypted OAuth token blobs in Netlify Blobs.
 *
 * Self-hosted bridge uses DATA_DIR files only. On Netlify, DATA_DIR is ephemeral;
 * this module hydrates from Blobs before calendar handlers and persists after writes.
 *
 * Calendar OAuth begin → Google → callback typically lands on a **different** Lambda
 * instance within seconds. Netlify Blobs default to **eventual** consistency (up to ~60s
 * edge drift). Hydrate therefore reads the calendar store with **strong** consistency so
 * pending `oauth_pending.state` is visible to the callback (avoids `state_invalid`).
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

/**
 * @typedef {{
 *   get: (key: string, opts?: { type?: string, consistency?: 'eventual' | 'strong' }) => Promise<string|ArrayBuffer|null>,
 *   set: (key: string, value: string) => Promise<void>
 * }} BlobStore
 */

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
 * Status preference for connector merge (higher wins when comparing fresh writes).
 *
 * @param {Record<string, unknown>} connector
 * @returns {number}
 */
function connectorStatusScore(connector) {
  const status = typeof connector.status === 'string' ? connector.status : '';
  if (status === 'pending' && connector.oauth_pending) return 4;
  if (status === 'connected') return 3;
  if (status === 'pending') return 2;
  if (status === 'revoked') return 1;
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
 * Merge local + blob calendar stores so warm-Lambda pending OAuth is not wiped by a
 * stale eventual blob read (same failure mode as delegation grants on Netlify).
 *
 * @param {string} localRaw
 * @param {string} blobRaw
 * @returns {string}
 */
export function mergeCalendarStoreJson(localRaw, blobRaw) {
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

  const vaultIds = new Set([
    ...Object.keys(local.vaults),
    ...Object.keys(blob.vaults),
  ]);

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

    /** @type {Map<string, Record<string, unknown>>} */
    const calendarsById = new Map();
    for (const row of [
      ...(Array.isArray(blobVault.source_calendars) ? blobVault.source_calendars : []),
      ...(Array.isArray(localVault.source_calendars) ? localVault.source_calendars : []),
    ]) {
      if (!row || typeof row !== 'object') continue;
      const id = typeof row.source_calendar_id === 'string' ? row.source_calendar_id.trim() : '';
      if (!id) continue;
      calendarsById.set(id, row);
    }

    /** @type {Map<string, Record<string, unknown>>} */
    const eventsByKey = new Map();
    for (const event of [
      ...(Array.isArray(blobVault.events) ? blobVault.events : []),
      ...(Array.isArray(localVault.events) ? localVault.events : []),
    ]) {
      if (!event || typeof event !== 'object') continue;
      const id = typeof event.event_id === 'string' ? event.event_id.trim() : '';
      const connectorId = typeof event.connector_id === 'string' ? event.connector_id.trim() : '';
      const key = id && connectorId ? `${connectorId}:${id}` : id || JSON.stringify(event);
      eventsByKey.set(key, event);
    }

    mergedVaults[vaultId] = {
      ...blobVault,
      ...localVault,
      connectors: [...byId.values()],
      source_calendars: [...calendarsById.values()],
      events: [...eventsByKey.values()],
    };
  }

  return JSON.stringify({
    ...blob,
    ...local,
    vaults: mergedVaults,
  });
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
 * Calendar store reads use **strong** consistency so OAuth callback can find pending state
 * written by begin on another Lambda within seconds.
 *
 * @param {BlobStore|null|undefined} blobStore
 * @param {string} dataDir
 */
export async function hydrateCalendarStoresFromBlob(blobStore, dataDir) {
  if (!blobStore || typeof blobStore.get !== 'function') return;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(calendarOAuthDir(dataDir), { recursive: true });

  const storePath = getCalendarStorePath(dataDir);
  let localRaw = '';
  if (fs.existsSync(storePath)) {
    try {
      localRaw = fs.readFileSync(storePath, 'utf8');
    } catch {
      localRaw = '';
    }
  }

  try {
    const storeRaw = await blobStore.get(CALENDAR_STORE_BLOB_KEY, {
      type: 'text',
      consistency: 'strong',
    });
    if (typeof storeRaw === 'string' && storeRaw.trim()) {
      const merged = mergeCalendarStoreJson(localRaw, storeRaw);
      if (merged.trim()) {
        fs.writeFileSync(storePath, merged, 'utf8');
      }
    }
  } catch {
    /* keep existing file or empty */
  }

  const connectorIds = listCalendarConnectorIdsForBlobSync(dataDir);
  for (const connectorId of connectorIds) {
    try {
      const raw = await blobStore.get(calendarOAuthBlobKey(connectorId), {
        type: 'text',
        consistency: 'strong',
      });
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

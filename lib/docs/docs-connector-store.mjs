/**
 * File-backed document connector metadata.
 *
 * Provider credentials live exclusively in the encrypted token vault or
 * process environment. This store contains connector state and opaque cursors.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { constantTimeEqual } from '../companion-oauth-pkce.mjs';

export const DOCS_STORE_FILENAME = 'docs_connectors.json';
const CONNECTOR_ID_RE = /^conn_[A-Za-z0-9_-]{8,64}$/;
const PROVIDERS = new Set(['google-drive', 'notion']);
const STATUSES = new Set(['pending', 'connected', 'needs_reauth', 'revoked']);
const SYNC_ERRORS = new Set(['auth_expired', 'rate_limited', 'provider_error', 'network_error', 'none']);

/**
 * Load the complete docs connector store. Malformed files fail closed to an
 * empty store rather than exposing partially parsed state.
 * @param {string} dataDir
 * @returns {{ vaults: Record<string, { connectors: object[] }> }}
 */
export function loadDocsStore(dataDir) {
  const filePath = path.join(dataDir, DOCS_STORE_FILENAME);
  if (!fs.existsSync(filePath)) return { vaults: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.vaults || typeof parsed.vaults !== 'object') {
      return { vaults: {} };
    }
    for (const vault of Object.values(parsed.vaults)) {
      if (!vault || typeof vault !== 'object' || !Array.isArray(vault.connectors)) {
        return { vaults: {} };
      }
    }
    return parsed;
  } catch {
    return { vaults: {} };
  }
}

/**
 * Atomically persist the complete docs connector store.
 * @param {string} dataDir
 * @param {{ vaults: Record<string, { connectors: object[] }> }} store
 */
export function saveDocsStore(dataDir, store) {
  if (!store || typeof store !== 'object' || !store.vaults || typeof store.vaults !== 'object') {
    throw new TypeError('Invalid docs connector store');
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const filePath = path.join(dataDir, DOCS_STORE_FILENAME);
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function vaultStore(store, vaultId) {
  if (typeof vaultId !== 'string' || !vaultId.trim()) throw new TypeError('vaultId is required');
  if (!store.vaults[vaultId]) store.vaults[vaultId] = { connectors: [] };
  if (!Array.isArray(store.vaults[vaultId].connectors)) store.vaults[vaultId].connectors = [];
  return store.vaults[vaultId];
}

/**
 * Return one stored connector.
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} connectorId
 */
export function getConnector(dataDir, vaultId, connectorId) {
  const store = loadDocsStore(dataDir);
  return vaultStore(store, vaultId).connectors.find((row) => row.connector_id === connectorId);
}

/**
 * List connectors for one vault.
 * @param {string} dataDir
 * @param {string} vaultId
 */
export function listConnectors(dataDir, vaultId) {
  const store = loadDocsStore(dataDir);
  return vaultStore(store, vaultId).connectors.slice();
}

function validateConnector(connector) {
  if (!connector || typeof connector !== 'object') throw new TypeError('Invalid docs connector');
  if (!CONNECTOR_ID_RE.test(connector.connector_id ?? '')) throw new TypeError('Invalid connector id');
  if (!PROVIDERS.has(connector.provider)) throw new TypeError('Invalid docs provider');
  if (typeof connector.display_name !== 'string' || connector.display_name.length > 128) {
    throw new TypeError('Invalid connector display name');
  }
  if (!STATUSES.has(connector.status)) throw new TypeError('Invalid connector status');
  if (connector.sync_cursor !== null && connector.sync_cursor !== undefined && typeof connector.sync_cursor !== 'string') {
    throw new TypeError('Invalid connector sync cursor');
  }
  if (!SYNC_ERRORS.has(connector.last_sync_error ?? 'none')) throw new TypeError('Invalid connector sync error');
  if (!Number.isFinite(connector.file_count) || connector.file_count < 0) {
    throw new TypeError('Invalid connector file count');
  }
}

/**
 * Insert or replace one connector record.
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {object} connector
 */
export function saveConnector(dataDir, vaultId, connector) {
  validateConnector(connector);
  const store = loadDocsStore(dataDir);
  const vault = vaultStore(store, vaultId);
  const idx = vault.connectors.findIndex((row) => row.connector_id === connector.connector_id);
  if (idx === -1) vault.connectors.push(connector);
  else vault.connectors[idx] = connector;
  saveDocsStore(dataDir, store);
  return connector;
}

/**
 * Produce the secret-free client projection.
 * @param {object} connector
 */
export function connectorForClient(connector) {
  return {
    connector_id: connector.connector_id,
    provider: connector.provider,
    display_name: connector.display_name,
    status: connector.status,
    last_sync_at: connector.last_sync_at ?? null,
    last_sync_error: connector.last_sync_error ?? 'none',
    file_count: Number.isFinite(connector.file_count) ? connector.file_count : 0,
    revoked_at: connector.revoked_at ?? null,
  };
}

/**
 * Locate a pending connector using constant-time state comparison.
 * @param {string} dataDir
 * @param {string} state
 * @returns {{ vaultId: string, connector: object } | null}
 */
export function findPendingByState(dataDir, state) {
  if (typeof state !== 'string' || !state) return null;
  const store = loadDocsStore(dataDir);
  for (const [vaultId, vault] of Object.entries(store.vaults)) {
    for (const connector of vault.connectors) {
      if (connector.status !== 'pending' || !connector.oauth_pending) continue;
      if (constantTimeEqual(connector.oauth_pending.state, state)) return { vaultId, connector };
    }
  }
  return null;
}

/**
 * Generate a connector id from 64 bits of UUID entropy.
 */
export function newConnectorId() {
  return `conn_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

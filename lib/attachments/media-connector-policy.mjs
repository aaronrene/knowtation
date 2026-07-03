/**
 * Per-vault media connector allowlist (Phase 2F-b-d-kn-b).
 *
 * Deny-by-default; holds enablement + display metadata only — no secrets.
 *
 * @see docs/MEDIA-WRITE-SURFACES-CONTRACT-2F-b-d-kn.md §5
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const STORE_FILENAME = 'hub_media_connector_policy.json';

export const CONNECTOR_ID_RE = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * @typedef {Object} ConnectorPolicyRow
 * @property {boolean} enabled
 * @property {string} [display_name]
 * @property {string} [updated]
 */

/**
 * @typedef {Object} MediaConnectorPolicyFile
 * @property {'knowtation.media_connector_policy/v0'} schema
 * @property {Record<string, { connectors?: Record<string, ConnectorPolicyRow> }>} vaults
 */

/**
 * @param {string} dataDir
 * @returns {string}
 */
export function getMediaConnectorPolicyPath(dataDir) {
  return path.join(dataDir, STORE_FILENAME);
}

/**
 * @param {string} dataDir
 * @returns {MediaConnectorPolicyFile}
 */
export function loadMediaConnectorPolicy(dataDir) {
  const filePath = getMediaConnectorPolicyPath(dataDir);
  if (!fs.existsSync(filePath)) {
    return { schema: 'knowtation.media_connector_policy/v0', vaults: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.vaults || typeof parsed.vaults !== 'object') {
      return { schema: 'knowtation.media_connector_policy/v0', vaults: {} };
    }
    return /** @type {MediaConnectorPolicyFile} */ ({
      schema: 'knowtation.media_connector_policy/v0',
      vaults: parsed.vaults,
    });
  } catch {
    return { schema: 'knowtation.media_connector_policy/v0', vaults: {} };
  }
}

/**
 * @param {string} dataDir
 * @param {MediaConnectorPolicyFile} store
 */
export function saveMediaConnectorPolicy(dataDir, store) {
  const filePath = getMediaConnectorPolicyPath(dataDir);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const payload = {
    schema: 'knowtation.media_connector_policy/v0',
    vaults: store.vaults ?? {},
  };
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @returns {Record<string, ConnectorPolicyRow>}
 */
export function getVaultConnectors(dataDir, vaultId) {
  const store = loadMediaConnectorPolicy(dataDir);
  const vault = store.vaults?.[vaultId];
  if (!vault || !vault.connectors || typeof vault.connectors !== 'object') {
    return {};
  }
  return vault.connectors;
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} connectorId
 * @returns {ConnectorPolicyRow|null}
 */
export function getEnabledConnector(dataDir, vaultId, connectorId) {
  if (!CONNECTOR_ID_RE.test(connectorId)) return null;
  const row = getVaultConnectors(dataDir, vaultId)[connectorId];
  if (!row || row.enabled !== true) return null;
  return row;
}

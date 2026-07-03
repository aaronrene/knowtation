/**
 * Per-vault media import consent store (Phase 2F-b-d-kn-b).
 *
 * Human-granted, revocable, expiry-aware — no connector credentials.
 *
 * @see docs/MEDIA-WRITE-SURFACES-CONTRACT-2F-b-d-kn.md §6
 */

import fs from 'fs';
import path from 'path';
import { randomUUID, randomBytes } from 'crypto';

const STORE_FILENAME = 'hub_media_import_consent.json';

export const CONSENT_ID_RE = /^mic_[a-f0-9]{16}$/;

/**
 * @typedef {'personal'|'project'|'org'} ConsentScope
 * @typedef {'active'|'revoked'} ConsentStatus
 */

/**
 * @typedef {Object} MediaImportConsentRecord
 * @property {string} connector_id
 * @property {ConsentScope} scope
 * @property {string} granted_by
 * @property {string} granted_at
 * @property {string|null} expires_at
 * @property {ConsentStatus} status
 */

/**
 * @param {string} dataDir
 * @returns {string}
 */
export function getMediaImportConsentPath(dataDir) {
  return path.join(dataDir, STORE_FILENAME);
}

/**
 * @param {string} dataDir
 * @returns {{ schema: string, vaults: Record<string, { consents?: Record<string, MediaImportConsentRecord> }> }}
 */
export function loadMediaImportConsentStore(dataDir) {
  const filePath = getMediaImportConsentPath(dataDir);
  if (!fs.existsSync(filePath)) {
    return { schema: 'knowtation.media_import_consent/v0', vaults: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.vaults || typeof parsed.vaults !== 'object') {
      return { schema: 'knowtation.media_import_consent/v0', vaults: {} };
    }
    return {
      schema: 'knowtation.media_import_consent/v0',
      vaults: parsed.vaults,
    };
  } catch {
    return { schema: 'knowtation.media_import_consent/v0', vaults: {} };
  }
}

/**
 * @param {string} dataDir
 * @param {object} store
 */
export function saveMediaImportConsentStore(dataDir, store) {
  const filePath = getMediaImportConsentPath(dataDir);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const payload = {
    schema: 'knowtation.media_import_consent/v0',
    vaults: store.vaults ?? {},
  };
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

/** @returns {string} */
export function mintConsentId() {
  return `mic_${randomBytes(8).toString('hex')}`;
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} connectorId
 * @param {ConsentScope} scope
 * @param {string|Date} [now]
 * @returns {MediaImportConsentRecord|null}
 */
export function getActiveConsent(dataDir, vaultId, connectorId, scope, now = new Date()) {
  const store = loadMediaImportConsentStore(dataDir);
  const vault = store.vaults?.[vaultId];
  if (!vault?.consents || typeof vault.consents !== 'object') return null;

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();

  for (const record of Object.values(vault.consents)) {
    if (!record || typeof record !== 'object') continue;
    if (record.connector_id !== connectorId) continue;
    if (record.scope !== scope) continue;
    if (record.status !== 'active') continue;
    if (record.expires_at != null) {
      const exp = new Date(record.expires_at).getTime();
      if (!Number.isNaN(exp) && exp <= nowMs) continue;
    }
    return record;
  }
  return null;
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {ConsentScope} [scopeFilter]
 * @returns {{ consent_id: string, record: MediaImportConsentRecord }[]}
 */
export function listVaultConsents(dataDir, vaultId, scopeFilter) {
  const store = loadMediaImportConsentStore(dataDir);
  const vault = store.vaults?.[vaultId];
  if (!vault?.consents) return [];
  const out = [];
  for (const [consentId, record] of Object.entries(vault.consents)) {
    if (!record || typeof record !== 'object') continue;
    if (scopeFilter && record.scope !== scopeFilter) continue;
    out.push({ consent_id: consentId, record });
  }
  out.sort((a, b) => a.consent_id.localeCompare(b.consent_id));
  return out;
}

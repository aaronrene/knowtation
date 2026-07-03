/**
 * Credential-free external media reference store (Phase 2F-b-d-kn-b).
 *
 * Apply target for media_external_link proposals; fourth read-model derivation source.
 *
 * @see docs/MEDIA-WRITE-SURFACES-CONTRACT-2F-b-d-kn.md §9.1
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const STORE_FILENAME = 'hub_attachment_external_refs.json';

/**
 * @typedef {'personal'|'project'|'org'} RefScope
 */

/**
 * @typedef {Object} ExternalRefRecord
 * @property {string} connector_id
 * @property {string} opaque_ref
 * @property {RefScope} scope
 * @property {string} display_label
 * @property {string} consent_id
 * @property {string} created
 * @property {string} updated
 */

/**
 * @param {string} dataDir
 * @returns {string}
 */
export function getExternalRefStorePath(dataDir) {
  return path.join(dataDir, STORE_FILENAME);
}

/**
 * @param {string} dataDir
 * @returns {{ schema: string, vaults: Record<string, { refs?: Record<string, ExternalRefRecord> }> }}
 */
export function loadExternalRefStore(dataDir) {
  const filePath = getExternalRefStorePath(dataDir);
  if (!fs.existsSync(filePath)) {
    return { schema: 'knowtation.attachment_external_ref/v0', vaults: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.vaults || typeof parsed.vaults !== 'object') {
      return { schema: 'knowtation.attachment_external_ref/v0', vaults: {} };
    }
    return {
      schema: 'knowtation.attachment_external_ref/v0',
      vaults: parsed.vaults,
    };
  } catch {
    return { schema: 'knowtation.attachment_external_ref/v0', vaults: {} };
  }
}

/**
 * @param {string} dataDir
 * @param {object} store
 */
export function saveExternalRefStore(dataDir, store) {
  const filePath = getExternalRefStorePath(dataDir);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const payload = {
    schema: 'knowtation.attachment_external_ref/v0',
    vaults: store.vaults ?? {},
  };
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @returns {Record<string, ExternalRefRecord>}
 */
export function getVaultExternalRefs(dataDir, vaultId) {
  const store = loadExternalRefStore(dataDir);
  const vault = store.vaults?.[vaultId];
  if (!vault?.refs || typeof vault.refs !== 'object') {
    return {};
  }
  return vault.refs;
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} attachmentId
 * @returns {ExternalRefRecord|null}
 */
export function getExternalRef(dataDir, vaultId, attachmentId) {
  const refs = getVaultExternalRefs(dataDir, vaultId);
  const row = refs[attachmentId];
  return row && typeof row === 'object' ? row : null;
}

/**
 * Idempotent upsert of an external reference record.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} attachmentId
 * @param {ExternalRefRecord} record
 */
export function upsertExternalRef(dataDir, vaultId, attachmentId, record) {
  const store = loadExternalRefStore(dataDir);
  if (!store.vaults[vaultId]) {
    store.vaults[vaultId] = { refs: {} };
  }
  if (!store.vaults[vaultId].refs) {
    store.vaults[vaultId].refs = {};
  }
  const existing = store.vaults[vaultId].refs[attachmentId];
  const now = new Date().toISOString();
  store.vaults[vaultId].refs[attachmentId] = {
    connector_id: record.connector_id,
    opaque_ref: record.opaque_ref,
    scope: record.scope,
    display_label: record.display_label,
    consent_id: record.consent_id,
    created: existing?.created ?? record.created ?? now,
    updated: now,
  };
  saveExternalRefStore(dataDir, store);
}

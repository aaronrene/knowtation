/**
 * Policy overlay persistence for derived attachments (Phase 2F-b-b).
 *
 * @see docs/ATTACHMENT-STORE-CONTRACT-2F-b.md §2
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const STORE_FILENAME = 'hub_attachment_store.json';

/**
 * @typedef {Object} AttachmentPolicy
 * @property {boolean} agent_visible
 * @property {'vault_lifetime'|'pinned'} retention
 * @property {string} updated
 */

/**
 * @typedef {Object} VaultAttachmentPolicies
 * @property {Record<string, AttachmentPolicy>} policies
 */

/**
 * @typedef {Object} AttachmentStoreFile
 * @property {'knowtation.attachment_store/v0'} [schema]
 * @property {Record<string, VaultAttachmentPolicies>} vaults
 */

/**
 * @param {string} dataDir
 * @returns {string}
 */
export function getAttachmentStorePath(dataDir) {
  return path.join(dataDir, STORE_FILENAME);
}

/**
 * @param {string} dataDir
 * @returns {AttachmentStoreFile}
 */
export function loadAttachmentStore(dataDir) {
  const filePath = getAttachmentStorePath(dataDir);
  if (!fs.existsSync(filePath)) {
    return { schema: 'knowtation.attachment_store/v0', vaults: {} };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.vaults || typeof parsed.vaults !== 'object') {
      return { schema: 'knowtation.attachment_store/v0', vaults: {} };
    }
    return /** @type {AttachmentStoreFile} */ ({
      schema: 'knowtation.attachment_store/v0',
      vaults: parsed.vaults,
    });
  } catch {
    return { schema: 'knowtation.attachment_store/v0', vaults: {} };
  }
}

/**
 * @param {string} dataDir
 * @param {AttachmentStoreFile} store
 */
export function saveAttachmentStore(dataDir, store) {
  const filePath = getAttachmentStorePath(dataDir);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const payload = { schema: 'knowtation.attachment_store/v0', vaults: store.vaults ?? {} };
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @returns {Record<string, AttachmentPolicy>}
 */
export function getVaultAttachmentPolicies(dataDir, vaultId) {
  const store = loadAttachmentStore(dataDir);
  const vault = store.vaults?.[vaultId];
  if (!vault || !vault.policies || typeof vault.policies !== 'object') {
    return {};
  }
  return vault.policies;
}

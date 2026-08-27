/**
 * Marker-aware delegation authority compatibility reader (RHF-b-KN0).
 *
 * Absent marker → legacy file stores. Present marker → envelope-only reads with
 * fail-closed validation. Unknown/missing/mismatched marker or envelope → unavailable.
 *
 * @see ~/scooling/docs/reviews/2026-08-27-retail-helper-finish.md §B2 migration step 1
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

export const DELEGATION_AUTHORITY_MARKER_SCHEMA = 'knowtation.delegation_authority_marker/v1';
export const DELEGATION_AUTHORITY_ENVELOPE_SCHEMA = 'knowtation.delegation_authority_envelope/v1';
export const DELEGATION_AUTHORITY_UNAVAILABLE = 'DELEGATION_AUTHORITY_UNAVAILABLE';

const MARKER_SCHEMA_VERSION = 1;
const ENVELOPE_SCHEMA_VERSION = 1;
const SHA256_PREFIX = 'sha256:';

/**
 * @param {string} vaultId
 * @returns {string}
 */
export function delegationAuthorityMarkerBlobKey(vaultId) {
  return `delegation/authority/v1/${encodeURIComponent(vaultId)}/marker`;
}

/**
 * @param {string} vaultId
 * @returns {string}
 */
export function delegationAuthorityMarkerFileName(vaultId) {
  return `hub_delegation_authority_marker_${vaultId}.json`;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isSha256Prefixed(value) {
  return isNonEmptyString(value) && String(value).startsWith(SHA256_PREFIX);
}

/**
 * Canonical JSON hash excluding `state_hash`.
 *
 * @param {object} envelope
 * @returns {string}
 */
export function computeDelegationAuthorityStateHash(envelope) {
  const clone = { ...envelope };
  delete clone.state_hash;
  /** @type {Record<string, unknown>} */
  const sorted = {};
  for (const key of Object.keys(clone).sort()) {
    sorted[key] = clone[key];
  }
  const canonical = JSON.stringify(sorted);
  return `${SHA256_PREFIX}${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

/**
 * @param {object} marker
 * @param {string} vaultId
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateDelegationAuthorityMarker(marker, vaultId) {
  if (!marker || typeof marker !== 'object') return { ok: false, reason: 'marker missing' };
  if (marker.schema !== DELEGATION_AUTHORITY_MARKER_SCHEMA) {
    return { ok: false, reason: 'marker schema mismatch' };
  }
  if (marker.vault_id !== vaultId) return { ok: false, reason: 'marker vault mismatch' };
  if (marker.envelope_schema_version !== MARKER_SCHEMA_VERSION) {
    return { ok: false, reason: 'marker envelope version unknown' };
  }
  if (!isNonEmptyString(marker.envelope_key)) return { ok: false, reason: 'marker envelope_key missing' };
  if (!isNonEmptyString(marker.lineage_id)) return { ok: false, reason: 'marker lineage missing' };
  if (!isSha256Prefixed(marker.origin_snapshot_hash)) {
    return { ok: false, reason: 'marker origin hash invalid' };
  }
  return { ok: true };
}

/**
 * @param {object} envelope
 * @param {object} marker
 * @param {string} vaultId
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateDelegationAuthorityEnvelope(envelope, marker, vaultId) {
  if (!envelope || typeof envelope !== 'object') return { ok: false, reason: 'envelope missing' };
  if (envelope.schema !== DELEGATION_AUTHORITY_ENVELOPE_SCHEMA) {
    return { ok: false, reason: 'envelope schema mismatch' };
  }
  if (envelope.schema_version !== ENVELOPE_SCHEMA_VERSION) {
    return { ok: false, reason: 'envelope version unknown' };
  }
  if (envelope.vault_id !== vaultId) return { ok: false, reason: 'envelope vault mismatch' };
  if (envelope.lineage_id !== marker.lineage_id) {
    return { ok: false, reason: 'envelope lineage mismatch' };
  }
  if (envelope.origin_snapshot_hash !== marker.origin_snapshot_hash) {
    return { ok: false, reason: 'envelope origin hash mismatch' };
  }
  if (typeof envelope.revision !== 'number' || envelope.revision < 0) {
    return { ok: false, reason: 'envelope revision invalid' };
  }
  if (!isSha256Prefixed(envelope.state_hash)) {
    return { ok: false, reason: 'envelope state hash invalid' };
  }
  const expected = computeDelegationAuthorityStateHash(envelope);
  if (expected !== envelope.state_hash) {
    return { ok: false, reason: 'envelope state hash mismatch' };
  }
  if (envelope.previous_state_hash != null && !isSha256Prefixed(envelope.previous_state_hash)) {
    return { ok: false, reason: 'envelope previous hash invalid' };
  }
  for (const field of ['identities_by_id', 'consents_by_id', 'grants_by_id']) {
    const map = envelope[field];
    if (map == null) continue;
    if (typeof map !== 'object' || Array.isArray(map)) {
      return { ok: false, reason: `${field} invalid` };
    }
  }
  return { ok: true };
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   blobStore?: { get?: (key: string, opts?: { type?: string }) => Promise<string|null> } | null,
 * }} input
 * @returns {Promise<string|null>}
 */
async function readMarkerRaw(input) {
  const { dataDir, vaultId, blobStore } = input;
  const blobKey = delegationAuthorityMarkerBlobKey(vaultId);
  if (blobStore && typeof blobStore.get === 'function') {
    try {
      const fromBlob = await blobStore.get(blobKey, { type: 'text' });
      if (typeof fromBlob === 'string' && fromBlob.trim()) return fromBlob;
    } catch {
      return null;
    }
  }
  const fp = path.join(dataDir, delegationAuthorityMarkerFileName(vaultId));
  try {
    if (!fs.existsSync(fp)) return null;
    const raw = fs.readFileSync(fp, 'utf8');
    return raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   envelopeKey: string,
 *   blobStore?: { get?: (key: string, opts?: { type?: string }) => Promise<string|null> } | null,
 * }} input
 * @returns {Promise<string|null>}
 */
async function readEnvelopeRaw(input) {
  const { dataDir, vaultId, envelopeKey, blobStore } = input;
  if (blobStore && typeof blobStore.get === 'function') {
    try {
      const fromBlob = await blobStore.get(envelopeKey, { type: 'text' });
      if (typeof fromBlob === 'string' && fromBlob.trim()) return fromBlob;
    } catch {
      return null;
    }
  }
  const localName = path.basename(envelopeKey);
  const fp = path.join(dataDir, localName || `hub_delegation_authority_envelope_${vaultId}.json`);
  try {
    if (!fs.existsSync(fp)) return null;
    const raw = fs.readFileSync(fp, 'utf8');
    return raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Resolve whether authority reads use legacy stores or a validated envelope.
 *
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   blobStore?: { get?: (key: string, opts?: { type?: string }) => Promise<string|null> } | null,
 * }} input
 * @returns {Promise<
 *   | { ok: true, mode: 'legacy' }
 *   | { ok: true, mode: 'envelope', marker: object, envelope: object }
 *   | { ok: false, code: typeof DELEGATION_AUTHORITY_UNAVAILABLE }
 * >}
 */
/**
 * Synchronous local-filesystem authority read mode (legacy delegation index paths).
 *
 * @param {{ dataDir: string, vaultId: string }} input
 * @returns {
 *   | { ok: true, mode: 'legacy' }
 *   | { ok: true, mode: 'envelope', marker: object, envelope: object }
 *   | { ok: false, code: typeof DELEGATION_AUTHORITY_UNAVAILABLE }
 * }
 */
export function resolveDelegationAuthorityReadModeSync(input) {
  const vaultId = typeof input.vaultId === 'string' ? input.vaultId.trim() : '';
  if (!vaultId) {
    return { ok: false, code: DELEGATION_AUTHORITY_UNAVAILABLE };
  }

  const fp = path.join(input.dataDir, delegationAuthorityMarkerFileName(vaultId));
  if (!fs.existsSync(fp)) {
    return { ok: true, mode: 'legacy' };
  }

  let markerRaw;
  try {
    markerRaw = fs.readFileSync(fp, 'utf8');
  } catch {
    return { ok: false, code: DELEGATION_AUTHORITY_UNAVAILABLE };
  }
  if (!markerRaw.trim()) {
    return { ok: true, mode: 'legacy' };
  }

  let marker;
  try {
    marker = JSON.parse(markerRaw);
  } catch {
    return { ok: false, code: DELEGATION_AUTHORITY_UNAVAILABLE };
  }

  const markerValid = validateDelegationAuthorityMarker(marker, vaultId);
  if (!markerValid.ok) {
    return { ok: false, code: DELEGATION_AUTHORITY_UNAVAILABLE };
  }

  const localName = path.basename(marker.envelope_key);
  const envelopeFp = path.join(input.dataDir, localName || `hub_delegation_authority_envelope_${vaultId}.json`);
  if (!fs.existsSync(envelopeFp)) {
    return { ok: false, code: DELEGATION_AUTHORITY_UNAVAILABLE };
  }

  let envelopeRaw;
  try {
    envelopeRaw = fs.readFileSync(envelopeFp, 'utf8');
  } catch {
    return { ok: false, code: DELEGATION_AUTHORITY_UNAVAILABLE };
  }

  let envelope;
  try {
    envelope = JSON.parse(envelopeRaw);
  } catch {
    return { ok: false, code: DELEGATION_AUTHORITY_UNAVAILABLE };
  }

  const envelopeValid = validateDelegationAuthorityEnvelope(envelope, marker, vaultId);
  if (!envelopeValid.ok) {
    return { ok: false, code: DELEGATION_AUTHORITY_UNAVAILABLE };
  }

  return { ok: true, mode: 'envelope', marker, envelope };
}

export async function resolveDelegationAuthorityReadMode(input) {
  const vaultId = typeof input.vaultId === 'string' ? input.vaultId.trim() : '';
  if (!vaultId) {
    return { ok: false, code: DELEGATION_AUTHORITY_UNAVAILABLE };
  }

  const markerRaw = await readMarkerRaw(input);
  if (!markerRaw) {
    return { ok: true, mode: 'legacy' };
  }

  let marker;
  try {
    marker = JSON.parse(markerRaw);
  } catch {
    return { ok: false, code: DELEGATION_AUTHORITY_UNAVAILABLE };
  }

  const markerValid = validateDelegationAuthorityMarker(marker, vaultId);
  if (!markerValid.ok) {
    return { ok: false, code: DELEGATION_AUTHORITY_UNAVAILABLE };
  }

  const envelopeRaw = await readEnvelopeRaw({
    dataDir: input.dataDir,
    vaultId,
    envelopeKey: marker.envelope_key,
    blobStore: input.blobStore ?? null,
  });
  if (!envelopeRaw) {
    return { ok: false, code: DELEGATION_AUTHORITY_UNAVAILABLE };
  }

  let envelope;
  try {
    envelope = JSON.parse(envelopeRaw);
  } catch {
    return { ok: false, code: DELEGATION_AUTHORITY_UNAVAILABLE };
  }

  const envelopeValid = validateDelegationAuthorityEnvelope(envelope, marker, vaultId);
  if (!envelopeValid.ok) {
    return { ok: false, code: DELEGATION_AUTHORITY_UNAVAILABLE };
  }

  return { ok: true, mode: 'envelope', marker, envelope };
}

/**
 * @param {object|null|undefined} envelope
 * @param {string} agentId
 * @returns {object|null}
 */
export function getEnvelopeStoredIdentity(envelope, agentId) {
  if (!envelope || typeof envelope !== 'object') return null;
  const map = envelope.identities_by_id;
  if (!map || typeof map !== 'object') return null;
  const record = map[agentId];
  return record && typeof record === 'object' ? record : null;
}

/**
 * @param {object|null|undefined} envelope
 * @param {string} consentId
 * @returns {object|null}
 */
export function getEnvelopeStoredConsent(envelope, consentId) {
  if (!envelope || typeof envelope !== 'object') return null;
  const map = envelope.consents_by_id;
  if (!map || typeof map !== 'object') return null;
  const record = map[consentId];
  return record && typeof record === 'object' ? record : null;
}

/**
 * @param {object|null|undefined} envelope
 * @param {string} grantId
 * @returns {object|null}
 */
export function getEnvelopeStoredGrant(envelope, grantId) {
  if (!envelope || typeof envelope !== 'object') return null;
  const map = envelope.grants_by_id;
  if (!map || typeof map !== 'object') return null;
  const record = map[grantId];
  return record && typeof record === 'object' ? record : null;
}

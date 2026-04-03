/**
 * AIR Improvements D + E — attestation storage layer.
 *
 * D: Creates signed attestation records (HMAC-SHA256) and stores them in
 *    Netlify Blobs (on Netlify) or a local JSON file (local dev).
 *
 * E: Dual-write — after the Blob/file write, attempts to anchor the record
 *    on the ICP attestation canister. ICP failure never blocks the write path;
 *    records are marked icp_status "pending" and can be reconciled later.
 *
 * Blob store handle comes from globalThis.__knowtation_attest_blob, set by
 * netlify/functions/gateway.mjs (same pattern as billing-store.mjs).
 */

import { createHmac, randomUUID } from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  isIcpAttestationConfigured,
  anchorAttestation,
  queryAttestation,
  getAttestationCanisterId,
} from './icp-attestation-client.mjs';

let projectRoot;
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  projectRoot = path.resolve(__dirname, '..', '..');
} catch (_) {
  projectRoot = process.cwd();
}

const ATTESTATIONS_FILE = path.join(projectRoot, 'data', 'hosted_attestations.json');

function getBlobStore() {
  return globalThis.__knowtation_attest_blob;
}

function getSecret() {
  const s = process.env.ATTESTATION_SECRET;
  return s && s.length >= 32 ? s : null;
}

/** @returns {boolean} */
export function isAttestationConfigured() {
  return getSecret() !== null;
}

/**
 * @param {string} id
 * @param {string} action
 * @param {string} notePath
 * @param {string} timestamp
 * @param {string} secret
 * @returns {string}
 */
function computeSig(id, action, notePath, timestamp, secret) {
  return createHmac('sha256', secret)
    .update(id + action + notePath + timestamp)
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Blob / file dual-path (mirrors billing-store.mjs)
// ---------------------------------------------------------------------------

function blobKey(id) {
  return `attestation/${id}`;
}

/** @param {string} id */
async function getRecord(id) {
  const store = getBlobStore();
  if (store) {
    const raw = await store.get(blobKey(id), { type: 'json' });
    return raw || null;
  }
  return getRecordFromFile(id);
}

/** @param {object} record */
async function putRecord(record) {
  const store = getBlobStore();
  if (store) {
    await store.setJSON(blobKey(record.id), record);
    return;
  }
  await putRecordToFile(record);
}

async function getRecordFromFile(id) {
  try {
    const raw = await fs.readFile(ATTESTATIONS_FILE, 'utf8');
    const db = JSON.parse(raw);
    return (db.records && db.records[id]) || null;
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function putRecordToFile(record) {
  let db;
  try {
    const raw = await fs.readFile(ATTESTATIONS_FILE, 'utf8');
    db = JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') db = {};
    else throw e;
  }
  if (!db.records || typeof db.records !== 'object') db.records = {};
  db.records[record.id] = record;
  await fs.mkdir(path.dirname(ATTESTATIONS_FILE), { recursive: true });
  await fs.writeFile(ATTESTATIONS_FILE, JSON.stringify(db, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a signed attestation record, store it, return { id, timestamp }.
 *
 * Improvement E: after writing to Blobs/file, attempts to anchor the record
 * on the ICP attestation canister. If ICP succeeds the Blob record is enriched
 * with canister_id and seq. If ICP fails or times out, icp_status is "pending".
 *
 * @param {string} action - "write" | "export"
 * @param {string} notePath - vault-relative path
 * @param {string|null} [contentHash] - optional SHA-256 of content
 * @returns {Promise<{ id: string, timestamp: string, icp_status?: string }>}
 * @throws {Error} if ATTESTATION_SECRET is not configured
 */
export async function createAttestation(action, notePath, contentHash = null) {
  const secret = getSecret();
  if (!secret) throw new Error('ATTESTATION_SECRET is not configured');

  const id = 'air-' + randomUUID();
  const timestamp = new Date().toISOString();
  const sig = computeSig(id, action, notePath, timestamp, secret);

  /** @type {Record<string, unknown>} */
  const record = { id, action, path: notePath, timestamp, content_hash: contentHash, sig };

  if (isIcpAttestationConfigured()) {
    record.icp_status = 'pending';
    record.canister_id = getAttestationCanisterId();
  } else {
    record.icp_status = 'disabled';
  }

  await putRecord(record);

  let icpStatus = record.icp_status;

  if (isIcpAttestationConfigured()) {
    try {
      const icpResult = await anchorAttestation(
        { id, action, path: notePath, timestamp, content_hash: contentHash || '', sig },
        { timeoutMs: 4000 },
      );
      if (icpResult) {
        record.icp_status = 'anchored';
        record.icp_seq = icpResult.seq;
        icpStatus = 'anchored';
        await putRecord(record);
      }
    } catch (e) {
      console.error('[attest] ICP anchor failed (non-fatal):', e?.message || String(e));
    }
  }

  return { id, timestamp, icp_status: icpStatus };
}

/**
 * Fetch a record by id, recompute HMAC, return verification result.
 * The sig field is never exposed in the response.
 * @param {string} id
 * @returns {Promise<{ verified: boolean, record: object|null }>}
 */
export async function verifyAttestation(id) {
  const secret = getSecret();
  if (!secret) throw new Error('ATTESTATION_SECRET is not configured');

  const record = await getRecord(id);
  if (!record) return { verified: false, record: null };

  const expected = computeSig(record.id, record.action, record.path, record.timestamp, secret);
  const verified = expected === record.sig;

  const { sig: _sig, ...safeRecord } = record;
  return { verified, record: safeRecord };
}

// ---------------------------------------------------------------------------
// Improvement E — ICP verification and reconciliation
// ---------------------------------------------------------------------------

/**
 * Verify an attestation against both Blobs/file storage and the ICP canister.
 * @param {string} id
 * @returns {Promise<{ id: string, verified: boolean, consensus: string, sources: object }>}
 */
export async function verifyWithIcp(id) {
  const secret = getSecret();
  if (!secret) throw new Error('ATTESTATION_SECRET is not configured');

  const blobRecord = await getRecord(id);
  const blobsResult = { found: false, hmac_valid: false, record: null };

  if (blobRecord) {
    const expected = computeSig(blobRecord.id, blobRecord.action, blobRecord.path, blobRecord.timestamp, secret);
    blobsResult.found = true;
    blobsResult.hmac_valid = expected === blobRecord.sig;
    const { sig: _s, ...safe } = blobRecord;
    blobsResult.record = safe;
  }

  const icpResult = { found: false, canister_id: null, seq: null, record: null };

  if (!isIcpAttestationConfigured()) {
    const consensus = blobsResult.found ? 'icp_not_configured' : 'not_found';
    return {
      id,
      verified: blobsResult.found && blobsResult.hmac_valid,
      consensus,
      sources: { blobs: blobsResult, icp: icpResult },
    };
  }

  try {
    const icpRecord = await queryAttestation(id, { timeoutMs: 3000 });
    if (icpRecord) {
      icpResult.found = true;
      icpResult.canister_id = getAttestationCanisterId();
      icpResult.seq = icpRecord.seq;
      icpResult.record = icpRecord;
    }
  } catch (e) {
    console.error('[attest] ICP query failed during verify:', e?.message || String(e));
  }

  let consensus;
  if (!blobsResult.found && !icpResult.found) {
    consensus = 'not_found';
  } else if (blobsResult.found && !icpResult.found) {
    const blobIcpStatus = blobRecord?.icp_status;
    if (blobIcpStatus === 'pending') {
      consensus = 'icp_pending';
    } else if (blobIcpStatus === 'disabled') {
      consensus = 'icp_not_configured';
    } else {
      consensus = 'blobs_only';
    }
  } else if (blobsResult.found && icpResult.found) {
    const icpRec = icpResult.record;
    const fieldsMatch =
      blobRecord.id === icpRec.id &&
      blobRecord.action === icpRec.action &&
      blobRecord.path === icpRec.path &&
      blobRecord.timestamp === icpRec.timestamp &&
      (blobRecord.content_hash || '') === (icpRec.content_hash || '') &&
      blobRecord.sig === icpRec.sig;
    consensus = fieldsMatch ? 'match' : 'mismatch';
  } else {
    consensus = 'icp_only';
  }

  return {
    id,
    verified: blobsResult.hmac_valid || icpResult.found,
    consensus,
    sources: { blobs: blobsResult, icp: icpResult },
  };
}

/**
 * Attempt to anchor Blob records that have icp_status "pending".
 * Intended for manual reconciliation or a scheduled job.
 * Only works with Blob store (not local file, for simplicity).
 * @param {string[]} pendingIds - IDs of attestations to retry
 * @returns {Promise<{ anchored: number, failed: number, errors: string[] }>}
 */
export async function anchorPendingAttestations(pendingIds) {
  if (!isIcpAttestationConfigured()) {
    return { anchored: 0, failed: 0, errors: ['ICP attestation not configured'] };
  }
  if (!pendingIds || pendingIds.length === 0) {
    return { anchored: 0, failed: 0, errors: [] };
  }

  let anchored = 0;
  let failed = 0;
  const errors = [];

  for (const id of pendingIds) {
    try {
      const record = await getRecord(id);
      if (!record) {
        errors.push(`${id}: record not found`);
        failed++;
        continue;
      }
      if (record.icp_status === 'anchored') {
        anchored++;
        continue;
      }

      const icpResult = await anchorAttestation(
        {
          id: record.id,
          action: record.action,
          path: record.path,
          timestamp: record.timestamp,
          content_hash: record.content_hash || '',
          sig: record.sig,
        },
        { timeoutMs: 6000 },
      );

      if (icpResult) {
        record.icp_status = 'anchored';
        record.icp_seq = icpResult.seq;
        record.canister_id = getAttestationCanisterId();
        await putRecord(record);
        anchored++;
      } else {
        errors.push(`${id}: ICP write returned null`);
        failed++;
      }
    } catch (e) {
      errors.push(`${id}: ${e?.message || String(e)}`);
      failed++;
    }
  }

  return { anchored, failed, errors };
}

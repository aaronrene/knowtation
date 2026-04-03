/**
 * AIR Improvement D — attestation storage layer.
 *
 * Creates signed attestation records (HMAC-SHA256) and stores them in
 * Netlify Blobs (on Netlify) or a local JSON file (local dev).
 *
 * Blob store handle comes from globalThis.__knowtation_attest_blob, set by
 * netlify/functions/gateway.mjs (same pattern as billing-store.mjs).
 */

import { createHmac, randomUUID } from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

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
 * @param {string} action - "write" | "export"
 * @param {string} notePath - vault-relative path
 * @param {string|null} [contentHash] - optional SHA-256 of content
 * @returns {Promise<{ id: string, timestamp: string }>}
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
  await putRecord(record);

  return { id, timestamp };
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

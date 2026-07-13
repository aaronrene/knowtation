/**
 * Durable store for RFC 8628 device authorization pending codes (Phase B).
 *
 * Survives gateway restart on the persistent MCP host (same durability pattern as
 * native-as-store.mjs). Device codes are hashed at rest; user codes are stored
 * uppercase for lookup. No access/refresh tokens appear in this file.
 *
 * Storage path: $KNOWTATION_GATEWAY_DATA_DIR/device_pending_codes.json
 *
 * Shape:
 *   {
 *     "devices": {
 *       "<device_code_hash>": {
 *         "userCode": "ABCD-EFGH",
 *         "clientId": "hermes-cloud",
 *         "clientName": "Hermes Agent",
 *         "scopes": ["vault:read", "vault:write"],
 *         "userId": null | "provider:id",
 *         "status": "pending" | "approved" | "denied",
 *         "interval": 5,
 *         "lastPollAt": 0,
 *         "expires": <unix-ms>,
 *         "vaultId": "default" | null
 *       }
 *     }
 *   }
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash, randomBytes, randomInt } from 'node:crypto';

/** Device authorization TTL (RFC 8628 recommends 15–30 minutes). */
export const DEVICE_CODE_TTL_MS = 15 * 60 * 1000;

/** Default minimum polling interval in seconds. */
export const DEVICE_POLL_INTERVAL_SEC = 5;

/** Alphabet for user_code (no ambiguous 0/O/1/I). */
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let _projectRoot;
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  _projectRoot = path.resolve(__dirname, '..', '..');
} catch (_) {
  _projectRoot = process.cwd();
}

/**
 * @returns {string}
 */
function _storePath() {
  const dataDir = process.env.KNOWTATION_GATEWAY_DATA_DIR || path.join(_projectRoot, 'data');
  return path.join(dataDir, 'device_pending_codes.json');
}

/**
 * Hash a device_code for at-rest storage (never store the raw secret).
 * @param {string} deviceCode
 * @returns {string}
 */
export function hashDeviceCode(deviceCode) {
  return createHash('sha256').update(String(deviceCode), 'utf8').digest('hex');
}

/**
 * Generate a human-typable user_code (XXXX-XXXX).
 * @returns {string}
 */
export function generateUserCode() {
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
    if (i === 3) out += '-';
  }
  return out;
}

/**
 * Generate an opaque device_code (URL-safe).
 * @returns {string}
 */
export function generateDeviceCode() {
  return randomBytes(32).toString('base64url');
}

/**
 * Normalize user codes for comparison (strip spaces/hyphens, uppercase).
 * @param {string} code
 * @returns {string}
 */
export function normalizeUserCode(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^([A-Z0-9]{4})([A-Z0-9]{4})$/, '$1-$2');
}

/**
 * @param {Record<string, object>} devices
 * @param {number} [now]
 * @returns {Record<string, object>}
 */
function _pruneExpired(devices, now = Date.now()) {
  const out = {};
  for (const [hash, entry] of Object.entries(devices)) {
    if (entry && typeof entry === 'object' && typeof entry.expires === 'number' && entry.expires > now) {
      out[hash] = entry;
    }
  }
  return out;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, object>}
 */
function _normalizeDevices(raw) {
  if (!raw || typeof raw !== 'object' || !raw.devices || typeof raw.devices !== 'object') return {};
  const out = {};
  for (const [hash, entry] of Object.entries(raw.devices)) {
    if (
      typeof hash === 'string' &&
      entry &&
      typeof entry === 'object' &&
      typeof entry.userCode === 'string' &&
      typeof entry.clientId === 'string' &&
      typeof entry.expires === 'number' &&
      typeof entry.status === 'string'
    ) {
      out[hash] = entry;
    }
  }
  return out;
}

/**
 * @returns {Promise<Record<string, object>>}
 */
async function _readDevices() {
  try {
    const raw = await fs.readFile(_storePath(), 'utf8');
    return _normalizeDevices(JSON.parse(raw));
  } catch (e) {
    if (e && e.code === 'ENOENT') return {};
    return {};
  }
}

/**
 * @param {Record<string, object>} devices
 * @returns {Promise<void>}
 */
async function _writeDevices(devices) {
  const filePath = _storePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(
    tmpPath,
    JSON.stringify({ devices: devices || {} }, null, 2),
    { encoding: 'utf8', mode: 0o600 }
  );
  await fs.rename(tmpPath, filePath);
}

/**
 * Create a pending device authorization.
 *
 * @param {{
 *   clientId?: string,
 *   clientName?: string,
 *   scopes?: string[],
 *   vaultId?: string | null,
 *   intervalSec?: number,
 * }} [opts]
 * @returns {Promise<{ deviceCode: string, userCode: string, expiresIn: number, interval: number }>}
 */
export async function createDeviceAuthorization(opts = {}) {
  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  const interval = Math.max(1, Number(opts.intervalSec) || DEVICE_POLL_INTERVAL_SEC);
  const expires = Date.now() + DEVICE_CODE_TTL_MS;
  const devices = _pruneExpired(await _readDevices());

  // Ensure unique user_code among live entries.
  let finalUser = userCode;
  const used = new Set(Object.values(devices).map((d) => normalizeUserCode(d.userCode)));
  let attempts = 0;
  while (used.has(normalizeUserCode(finalUser)) && attempts < 20) {
    finalUser = generateUserCode();
    attempts += 1;
  }

  devices[hashDeviceCode(deviceCode)] = {
    userCode: finalUser,
    clientId: String(opts.clientId || 'cloud-agent').slice(0, 128),
    clientName: String(opts.clientName || 'Cloud agent').slice(0, 128),
    scopes: Array.isArray(opts.scopes) && opts.scopes.length
      ? opts.scopes.filter((s) => typeof s === 'string').slice(0, 16)
      : ['vault:read', 'vault:write'],
    userId: null,
    status: 'pending',
    interval,
    lastPollAt: 0,
    expires,
    vaultId: opts.vaultId ? String(opts.vaultId).slice(0, 128) : null,
  };
  await _writeDevices(devices);
  return {
    deviceCode,
    userCode: finalUser,
    expiresIn: Math.floor(DEVICE_CODE_TTL_MS / 1000),
    interval,
  };
}

/**
 * Look up a pending entry by user_code (for Hub approval UI).
 * @param {string} userCode
 * @returns {Promise<{ hash: string, entry: object } | null>}
 */
export async function findByUserCode(userCode) {
  const normalized = normalizeUserCode(userCode);
  if (!normalized) return null;
  const devices = await _readDevices();
  const now = Date.now();
  for (const [hash, entry] of Object.entries(devices)) {
    if (entry.expires <= now) continue;
    if (normalizeUserCode(entry.userCode) === normalized) {
      return { hash, entry };
    }
  }
  return null;
}

/**
 * Approve a pending device flow for an authenticated Hub user.
 * @param {string} userCode
 * @param {string} userId
 * @param {{ vaultId?: string | null }} [opts]
 * @returns {Promise<{ ok: true, entry: object } | { ok: false, reason: string }>}
 */
export async function approveUserCode(userCode, userId, opts = {}) {
  if (!userId || typeof userId !== 'string') return { ok: false, reason: 'unauthorized' };
  const found = await findByUserCode(userCode);
  if (!found) return { ok: false, reason: 'not_found' };
  if (found.entry.status !== 'pending') return { ok: false, reason: 'not_pending' };
  if (Date.now() > found.entry.expires) return { ok: false, reason: 'expired' };

  const devices = await _readDevices();
  const entry = devices[found.hash];
  if (!entry || entry.status !== 'pending') return { ok: false, reason: 'not_pending' };
  devices[found.hash] = {
    ...entry,
    userId,
    status: 'approved',
    vaultId: opts.vaultId != null ? String(opts.vaultId).slice(0, 128) : entry.vaultId,
  };
  await _writeDevices(devices);
  return { ok: true, entry: devices[found.hash] };
}

/**
 * Deny a pending device flow.
 * @param {string} userCode
 * @param {string} userId
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function denyUserCode(userCode, userId) {
  if (!userId || typeof userId !== 'string') return { ok: false, reason: 'unauthorized' };
  const found = await findByUserCode(userCode);
  if (!found) return { ok: false, reason: 'not_found' };
  if (found.entry.status !== 'pending') return { ok: false, reason: 'not_pending' };

  const devices = await _readDevices();
  const entry = devices[found.hash];
  if (!entry || entry.status !== 'pending') return { ok: false, reason: 'not_pending' };
  devices[found.hash] = { ...entry, status: 'denied', userId };
  await _writeDevices(devices);
  return { ok: true };
}

/**
 * Poll outcome for a device_code (RFC 8628 token endpoint).
 * Consumes the entry on success (single-use).
 *
 * @param {string} deviceCode
 * @returns {Promise<
 *   | { status: 'authorization_pending' | 'slow_down' | 'access_denied' | 'expired_token' | 'invalid_grant' }
 *   | { status: 'approved'; entry: object }
 * >}
 */
export async function pollDeviceCode(deviceCode) {
  if (!deviceCode || typeof deviceCode !== 'string') return { status: 'invalid_grant' };
  const hash = hashDeviceCode(deviceCode);
  const devices = await _readDevices();
  const entry = devices[hash];
  const now = Date.now();
  if (!entry) return { status: 'invalid_grant' };
  if (now > entry.expires) {
    delete devices[hash];
    await _writeDevices(devices);
    return { status: 'expired_token' };
  }
  if (entry.status === 'denied') {
    delete devices[hash];
    await _writeDevices(devices);
    return { status: 'access_denied' };
  }
  if (entry.status === 'pending') {
    const intervalMs = (Number(entry.interval) || DEVICE_POLL_INTERVAL_SEC) * 1000;
    if (entry.lastPollAt && now - entry.lastPollAt < intervalMs) {
      devices[hash] = { ...entry, lastPollAt: now };
      await _writeDevices(devices);
      return { status: 'slow_down' };
    }
    devices[hash] = { ...entry, lastPollAt: now };
    await _writeDevices(devices);
    return { status: 'authorization_pending' };
  }
  if (entry.status === 'approved' && entry.userId) {
    delete devices[hash];
    await _writeDevices(devices);
    return { status: 'approved', entry };
  }
  return { status: 'invalid_grant' };
}

/**
 * List pending (not yet approved/denied) device flows for Hub UI (no secrets).
 * @returns {Promise<object[]>}
 */
export async function listPendingForDisplay() {
  const devices = _pruneExpired(await _readDevices());
  return Object.values(devices)
    .filter((d) => d.status === 'pending')
    .map((d) => ({
      userCode: d.userCode,
      clientName: d.clientName,
      clientId: d.clientId,
      scopes: d.scopes,
      expires: d.expires,
    }));
}

/**
 * @returns {Promise<{ removed: number }>}
 */
export async function pruneExpiredDeviceCodes() {
  const devices = await _readDevices();
  const pruned = _pruneExpired(devices);
  const removed = Object.keys(devices).length - Object.keys(pruned).length;
  if (removed > 0) await _writeDevices(pruned);
  return { removed };
}

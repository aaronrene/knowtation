/**
 * Durable store for native OAuth client pending authorization codes (C4).
 *
 * docs/COMPANION-APP-OAUTH-SERVERSIDE-GATE.md §6 change C4 requires that pending
 * authorization codes for the native client path survive process restart. This module
 * persists code records as an atomic-rename JSON file on the persistent gateway host
 * (knowtation-mcp-gateway, i-025679d93cf47aeab), using the same durability pattern as
 * hub/gateway/refresh-token-store.mjs.
 *
 * Records are keyed by the authorization code (a cryptographically random UUID v4).
 * Expired records are pruned on every write so the file never grows without bound.
 *
 * Storage path: $KNOWTATION_GATEWAY_DATA_DIR/native_pending_codes.json  (dev/test)
 *               data/native_pending_codes.json                           (default)
 *
 * Storage shape:
 *   {
 *     "codes": {
 *       "<uuid>": {
 *         "clientId": "...",
 *         "codeChallenge": "<sha256-base64url>",
 *         "redirectUri": "http://127.0.0.1:<port>/...",
 *         "state": "<opaque>|null",
 *         "scopes": ["vault:read", ...],
 *         "userId": "<provider:id>|null",
 *         "expires": <unix-ms>
 *       }
 *     }
 *   }
 *
 * Security properties:
 *   - Codes are opaque 128-bit random values (UUID v4); not predictable.
 *   - The PKCE code_challenge (hash) is stored; the code_verifier is NEVER stored.
 *   - No access token, refresh token, or session secret appears in this file.
 *   - File mode 0o600 (owner read/write only, not group or world).
 *   - Atomic write via temp-file + rename: a crash mid-write cannot corrupt the store.
 *   - Corrupt or unreadable file → fail-closed (empty store); users re-authenticate.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'node:crypto';

/** Lifetime of a pending authorization code (must match the client's expectations). */
export const NATIVE_AUTH_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let _projectRoot;
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  _projectRoot = path.resolve(__dirname, '..', '..');
} catch (_) {
  _projectRoot = process.cwd();
}

/**
 * Resolve the absolute path to the code store file.
 * KNOWTATION_GATEWAY_DATA_DIR allows tests to redirect to a temp directory.
 * @returns {string}
 */
function _nativeCodePath() {
  const dataDir = process.env.KNOWTATION_GATEWAY_DATA_DIR || path.join(_projectRoot, 'data');
  return path.join(dataDir, 'native_pending_codes.json');
}

/**
 * Return a new object containing only entries whose `expires` is in the future.
 * @param {Record<string, object>} codes
 * @param {number} [now]
 * @returns {Record<string, object>}
 */
function _pruneExpired(codes, now = Date.now()) {
  const out = {};
  for (const [code, entry] of Object.entries(codes)) {
    if (entry && typeof entry === 'object' && typeof entry.expires === 'number' && entry.expires > now) {
      out[code] = entry;
    }
  }
  return out;
}

/**
 * Coerce arbitrary persisted JSON to a safe codes map, dropping malformed entries.
 * A damaged file therefore degrades to "no pending codes" (fail-closed: user re-auths)
 * rather than throwing on every authorization attempt.
 * @param {unknown} raw
 * @returns {Record<string, object>}
 */
function _normalizeCodes(raw) {
  if (!raw || typeof raw !== 'object' || !raw.codes || typeof raw.codes !== 'object') return {};
  const out = {};
  for (const [code, entry] of Object.entries(raw.codes)) {
    if (
      typeof code === 'string' &&
      entry &&
      typeof entry === 'object' &&
      typeof entry.clientId === 'string' &&
      typeof entry.codeChallenge === 'string' &&
      typeof entry.redirectUri === 'string' &&
      typeof entry.expires === 'number'
    ) {
      out[code] = entry;
    }
  }
  return out;
}

/**
 * Load the current code records from disk.
 * @returns {Promise<Record<string, object>>}
 */
async function _readCodes() {
  try {
    const raw = await fs.readFile(_nativeCodePath(), 'utf8');
    return _normalizeCodes(JSON.parse(raw));
  } catch (e) {
    if (e && e.code === 'ENOENT') return {};
    // Unreadable/corrupt file: fail-closed rather than crashing.
    return {};
  }
}

/**
 * Atomically persist the code records to disk.
 * Uses a temp-file + rename strategy so a crash mid-write cannot corrupt the store.
 * @param {Record<string, object>} codes
 * @returns {Promise<void>}
 */
async function _writeCodes(codes) {
  const filePath = _nativeCodePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // Use a random suffix to prevent temp-file collisions under concurrent writes
  // (two callers in the same millisecond on the same PID would otherwise share a name).
  const tmpPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(
    tmpPath,
    JSON.stringify({ codes: codes || {} }, null, 2),
    { encoding: 'utf8', mode: 0o600 }
  );
  await fs.rename(tmpPath, filePath);
}

/**
 * Store a new pending authorization code.
 * Existing expired entries are pruned before writing.
 *
 * @param {string} code - authorization code (UUID v4)
 * @param {{
 *   clientId: string,
 *   codeChallenge: string,
 *   redirectUri: string,
 *   state?: string | null,
 *   scopes?: string[],
 * }} entry
 * @returns {Promise<void>}
 */
export async function savePendingCode(code, entry) {
  const codes = await _readCodes();
  const pruned = _pruneExpired(codes);
  pruned[code] = {
    clientId: entry.clientId,
    codeChallenge: entry.codeChallenge,
    redirectUri: entry.redirectUri,
    state: entry.state || null,
    scopes: Array.isArray(entry.scopes) ? entry.scopes : [],
    userId: null,
    expires: Date.now() + NATIVE_AUTH_CODE_TTL_MS,
  };
  await _writeCodes(pruned);
}

/**
 * Bind an authenticated userId to a pending code after the IDP callback.
 * Fails (returns false) if the code is unknown or expired.
 *
 * @param {string} code
 * @param {string} userId - authenticated user sub ("provider:id")
 * @returns {Promise<boolean>} true if the code was found and updated
 */
export async function bindUserToCode(code, userId) {
  const codes = await _readCodes();
  const entry = codes[code];
  if (!entry || Date.now() > entry.expires) return false;
  codes[code] = { ...entry, userId };
  await _writeCodes(codes);
  return true;
}

/**
 * Atomically consume (read-then-delete) a pending code.
 * Returns the entry, or null if the code is unknown or expired.
 * The record is deleted before returning so it cannot be replayed (single-use guarantee).
 *
 * @param {string} code
 * @returns {Promise<object|null>}
 */
export async function consumePendingCode(code) {
  const codes = await _readCodes();
  const entry = codes[code];
  if (!entry || Date.now() > entry.expires) return null;
  delete codes[code];
  await _writeCodes(codes);
  return entry;
}

/**
 * Opportunistically prune expired codes. Safe to call at startup or any time.
 * @returns {Promise<{ removed: number }>}
 */
export async function pruneExpiredCodes() {
  const codes = await _readCodes();
  const pruned = _pruneExpired(codes);
  const removed = Object.keys(codes).length - Object.keys(pruned).length;
  if (removed > 0) await _writeCodes(pruned);
  return { removed };
}

/**
 * Durable refresh-token store for the self-hosted Hub.
 *
 * Persists refresh-token records to `data/hub_refresh_tokens.json` and delegates ALL
 * security logic (rotation, reuse detection, hashing, expiry) to the pure, audited
 * `hub/lib/refresh-token-core.mjs`. This file is intentionally thin: it only does I/O.
 * The hosted product reuses the same core but persists to a Netlify Blob via the bridge,
 * so the dangerous logic lives in exactly one place.
 *
 * File format:
 *   { "tokens": { "<id>": { sub, family_id, token_hash, created_at, expires_at,
 *                           family_expires_at, rotated_to, used_at, revoked, meta } } }
 *
 * Writes are atomic (write to a temp file, then rename) so a crash mid-write cannot
 * corrupt the store or strand a half-written JSON file. The store is keyed only by
 * non-secret values; raw token secrets are never written to disk.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  issueToken,
  rotateToken,
  revokeToken,
  revokeAllForSub,
  pruneExpired,
} from './lib/refresh-token-core.mjs';

const REFRESH_TOKENS_FILE = 'hub_refresh_tokens.json';

/**
 * Resolve the absolute path to the refresh-token store file.
 * @param {string} dataDir
 * @returns {string}
 */
function filePathFor(dataDir) {
  return path.join(dataDir, REFRESH_TOKENS_FILE);
}

/**
 * Read the records map from disk. Returns an empty map if the file is missing or
 * unreadable/corrupt — a damaged store fails closed (everyone must re-authenticate)
 * rather than throwing on every request.
 * @param {string} dataDir
 * @returns {Record<string, object>}
 */
export function readRefreshTokens(dataDir) {
  if (!dataDir) return {};
  const filePath = filePathFor(dataDir);
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const tokens = data && typeof data.tokens === 'object' && data.tokens !== null ? data.tokens : {};
    const out = {};
    for (const [id, rec] of Object.entries(tokens)) {
      if (typeof id === 'string' && rec && typeof rec === 'object' && typeof rec.token_hash === 'string') {
        out[id] = rec;
      }
    }
    return out;
  } catch (_) {
    return {};
  }
}

/**
 * Persist the records map atomically (temp file + rename).
 * @param {string} dataDir
 * @param {Record<string, object>} records
 */
export function writeRefreshTokens(dataDir, records) {
  if (!dataDir) throw new Error('data_dir required');
  fs.mkdirSync(dataDir, { recursive: true });
  const filePath = filePathFor(dataDir);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify({ tokens: records || {} }, null, 2);
  fs.writeFileSync(tmpPath, payload, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

/**
 * Issue a new refresh token for a user at login and persist it.
 * @param {string} dataDir
 * @param {string} sub - e.g. "google:123"
 * @param {{ now?: number, tokenTtlMs?: number, familyTtlMs?: number, meta?: object }} [opts]
 * @returns {{ token: string, id: string, familyId: string }} the raw token to hand to the client
 */
export function issueRefreshToken(dataDir, sub, opts = {}) {
  const records = readRefreshTokens(dataDir);
  const result = issueToken(records, { sub, ...opts });
  writeRefreshTokens(dataDir, result.records);
  return { token: result.token, id: result.id, familyId: result.familyId };
}

/**
 * Validate + rotate a presented refresh token, persisting the new state. On reuse or
 * revocation the family is burned and persisted before returning the failure.
 * @param {string} dataDir
 * @param {string} token
 * @param {{ now?: number, tokenTtlMs?: number, meta?: object }} [opts]
 * @returns {{ ok: true, token: string, sub: string } | { ok: false, reason: string, sub: string|null }}
 */
export function rotateRefreshToken(dataDir, token, opts = {}) {
  const records = readRefreshTokens(dataDir);
  const result = rotateToken(records, token, opts);
  // Persist whenever the records changed (success rotates; reuse/revoked burns the family).
  writeRefreshTokens(dataDir, result.records);
  if (result.ok) return { ok: true, token: result.token, sub: result.sub };
  return { ok: false, reason: result.reason, sub: result.sub };
}

/**
 * Revoke a single refresh token (ordinary logout).
 * @param {string} dataDir
 * @param {string} token
 * @returns {{ revoked: boolean, sub: string|null }}
 */
export function revokeRefreshToken(dataDir, token) {
  const records = readRefreshTokens(dataDir);
  const result = revokeToken(records, token);
  if (result.revoked) writeRefreshTokens(dataDir, result.records);
  return { revoked: result.revoked, sub: result.sub };
}

/**
 * Revoke every refresh token for a user ("sign out all sessions" / compromise response).
 * @param {string} dataDir
 * @param {string} sub
 * @returns {{ count: number }}
 */
export function revokeAllRefreshTokensForSub(dataDir, sub) {
  const records = readRefreshTokens(dataDir);
  const result = revokeAllForSub(records, sub);
  if (result.count > 0) writeRefreshTokens(dataDir, result.records);
  return { count: result.count };
}

/**
 * Remove dead/stale records. Safe to call periodically or opportunistically at login.
 * @param {string} dataDir
 * @param {{ now?: number, graceMs?: number }} [opts]
 * @returns {{ removed: number }}
 */
export function pruneRefreshTokens(dataDir, opts = {}) {
  const records = readRefreshTokens(dataDir);
  const result = pruneExpired(records, opts);
  if (result.removed > 0) writeRefreshTokens(dataDir, result.records);
  return { removed: result.removed };
}

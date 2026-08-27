/**
 * Durable refresh-token store for the hosted gateway.
 *
 * This is the hosted analogue of the self-hosted `hub/refresh-tokens.mjs` file store. It
 * persists refresh-token records to a Netlify Blob in production (and a local JSON file in
 * dev/test) and delegates ALL security logic — rotation, reuse detection, hashing, expiry —
 * to the pure, audited `hub/lib/refresh-token-core.mjs`. The dangerous logic therefore lives
 * in exactly one place across every deployment surface; this module is intentionally thin and
 * only does I/O.
 *
 * ## Consistency model and the reuse-detection trade-off
 *
 * Refresh-token rotation depends on read-after-write. On Netlify (web-session cookies) the blob
 * store is eventual only (`globalThis.__knowtation_gateway_auth_blob`); reuse detection may lag
 * ≤60s. **MCP OAuth refresh MUST call `createGatewayRefreshStore({ consistency: 'strong' })`**
 * so the store is file-backed on the persistent MCP host and never uses the blob path
 * (docs/DURABLE-AGENT-AUTH-ROADMAP.md Phase A).
 *
 * ## Storage shape (matches the self-hosted file store)
 *   { "tokens": { "<id>": { sub, family_id, token_hash, created_at, expires_at,
 *                           family_expires_at, rotated_to, used_at, revoked, meta } } }
 * Only non-secret values are persisted; the raw token secret is returned to the caller exactly
 * once and never stored.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'node:crypto';
import {
  issueToken,
  rotateToken,
  revokeToken,
  revokeAllForSub,
  pruneExpired,
  parseToken,
  hashSecret,
} from '../lib/refresh-token-core.mjs';

const BLOB_KEY = 'refresh-tokens-v1';

// Safe when bundled (e.g. Netlify Functions CJS) where import.meta may be undefined.
let projectRoot;
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  projectRoot = path.resolve(__dirname, '..', '..');
} catch (_) {
  projectRoot = process.cwd();
}

/**
 * Local file fallback location (dev / self-run gateway / tests). KNOWTATION_GATEWAY_DATA_DIR
 * lets tests point this at a temp dir without touching the repo's data/ folder.
 */
function refreshFilePath() {
  const dataDir = process.env.KNOWTATION_GATEWAY_DATA_DIR || path.join(projectRoot, 'data');
  return path.join(dataDir, 'hosted_refresh_tokens.json');
}

/**
 * The (eventual-consistency) Netlify Blob store, set per-invocation by the Netlify function
 * wrapper. Absent outside Netlify (dev/test), in which case we fall back to a JSON file.
 * @returns {{ get: Function, setJSON: Function } | undefined}
 */
function getBlobStore() {
  return globalThis.__knowtation_gateway_auth_blob;
}

/**
 * Coerce arbitrary persisted JSON into a clean records map, dropping anything that is not a
 * well-formed record. A damaged/foreign payload thus degrades to "no sessions" (fail-closed:
 * users re-authenticate) rather than throwing on every refresh.
 * @param {unknown} raw
 * @returns {Record<string, object>}
 */
function normalizeRecords(raw) {
  const tokens = raw && typeof raw === 'object' && raw.tokens && typeof raw.tokens === 'object' ? raw.tokens : {};
  const out = {};
  for (const [id, rec] of Object.entries(tokens)) {
    if (typeof id === 'string' && rec && typeof rec === 'object' && typeof rec.token_hash === 'string') {
      out[id] = rec;
    }
  }
  return out;
}

async function readFromBlob() {
  const store = getBlobStore();
  try {
    const raw = await store.get(BLOB_KEY, { type: 'json' });
    return normalizeRecords(raw);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    throw new Error(`gateway-auth blob get ${BLOB_KEY} failed: ${msg}`);
  }
}

async function writeToBlob(records) {
  const store = getBlobStore();
  try {
    await store.setJSON(BLOB_KEY, { tokens: records || {} });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    const n = records && typeof records === 'object' ? Object.keys(records).length : 0;
    throw new Error(`gateway-auth blob setJSON ${BLOB_KEY} failed (n=${n}): ${msg}`);
  }
}

async function readFromFile() {
  try {
    const raw = await fs.readFile(refreshFilePath(), 'utf8');
    return normalizeRecords(JSON.parse(raw));
  } catch (e) {
    if (e && e.code === 'ENOENT') return {};
    // Unreadable/corrupt file: fail-closed to an empty store rather than crashing the gateway.
    return {};
  }
}

async function writeToFile(records) {
  const filePath = refreshFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // Atomic write: temp file + rename, so a crash mid-write cannot strand half-written JSON.
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify({ tokens: records || {} }, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmpPath, filePath);
}

/**
 * Load the current records map from the active backend (blob in prod, file otherwise).
 * @returns {Promise<Record<string, object>>}
 */
export async function loadRefreshRecords() {
  if (getBlobStore()) return readFromBlob();
  return readFromFile();
}

/**
 * Persist the records map to the active backend.
 * @param {Record<string, object>} records
 * @returns {Promise<void>}
 */
export async function saveRefreshRecords(records) {
  if (getBlobStore()) {
    await writeToBlob(records);
    return;
  }
  await writeToFile(records);
}

/**
 * Issue a new refresh token for a user at login and persist it.
 * @param {string} sub - e.g. "google:123"
 * @param {{ now?: number, tokenTtlMs?: number, familyTtlMs?: number, meta?: object }} [opts]
 * @returns {Promise<{ token: string, id: string, familyId: string }>}
 */
export async function issueRefreshToken(sub, opts = {}) {
  const records = await loadRefreshRecords();
  const result = issueToken(records, { sub, ...opts });
  await saveRefreshRecords(result.records);
  return { token: result.token, id: result.id, familyId: result.familyId };
}

/**
 * Validate + rotate a presented refresh token, persisting the new state. On reuse or
 * revocation the whole family is burned and persisted before the failure is returned.
 * @param {string} token
 * @param {{ now?: number, tokenTtlMs?: number, meta?: object }} [opts]
 * @returns {Promise<{ ok: true, token: string, sub: string } | { ok: false, reason: string, sub: string|null }>}
 */
export async function rotateRefreshToken(token, opts = {}) {
  const records = await loadRefreshRecords();
  const result = rotateToken(records, token, opts);
  // Persist whenever the records changed (success rotates; reuse/revoked burns the family).
  await saveRefreshRecords(result.records);
  if (result.ok) return { ok: true, token: result.token, sub: result.sub };
  return { ok: false, reason: result.reason, sub: result.sub };
}

/**
 * Revoke a single refresh token (ordinary logout).
 * @param {string} token
 * @returns {Promise<{ revoked: boolean, sub: string|null }>}
 */
export async function revokeRefreshToken(token) {
  const records = await loadRefreshRecords();
  const result = revokeToken(records, token);
  if (result.revoked) await saveRefreshRecords(result.records);
  return { revoked: result.revoked, sub: result.sub };
}

/**
 * Revoke every refresh token for a user ("sign out all sessions" / compromise response).
 * @param {string} sub
 * @returns {Promise<{ count: number }>}
 */
export async function revokeAllRefreshTokensForSub(sub) {
  const records = await loadRefreshRecords();
  const result = revokeAllForSub(records, sub);
  if (result.count > 0) await saveRefreshRecords(result.records);
  return { count: result.count };
}

/**
 * Remove dead/stale records. Safe to call opportunistically (e.g. at login).
 * @param {{ now?: number, graceMs?: number }} [opts]
 * @returns {Promise<{ removed: number }>}
 */
export async function pruneRefreshTokens(opts = {}) {
  const records = await loadRefreshRecords();
  const result = pruneExpired(records, opts);
  if (result.removed > 0) await saveRefreshRecords(result.records);
  return { removed: result.removed };
}

/**
 * Build the `{ issue, rotate, revoke, peek }` store object auth handlers expect, bound
 * to this gateway backend. All methods are async; the handlers `await` them.
 *
 * @param {{ consistency?: 'strong' | 'eventual' }} [opts]
 *   - `strong` — **always** use the local JSON file backend (read-after-write). Required for
 *     MCP OAuth refresh on the persistent MCP host. Prohibits the Netlify blob path even if
 *     `globalThis.__knowtation_gateway_auth_blob` is set (blob is eventual; ≤60s reuse lag).
 *   - omit / `eventual` — blob when provisioned (Netlify web refresh cookies), else file.
 * @returns {{
 *   issue: Function,
 *   rotate: Function,
 *   revoke: Function,
 *   peek: Function,
 *   consistency: 'strong' | 'eventual',
 * }}
 */
export function createGatewayRefreshStore(opts = {}) {
  const consistency = opts.consistency === 'strong' ? 'strong' : 'eventual';
  const forceFile = consistency === 'strong';

  async function load() {
    if (!forceFile && getBlobStore()) return readFromBlob();
    return readFromFile();
  }

  async function save(records) {
    if (!forceFile && getBlobStore()) {
      await writeToBlob(records);
      return;
    }
    await writeToFile(records);
  }

  return {
    consistency,
    issue: async (sub, issueOpts = {}) => {
      const records = await load();
      const result = issueToken(records, { sub, ...issueOpts });
      await save(result.records);
      return { token: result.token, id: result.id, familyId: result.familyId };
    },
    rotate: async (token, rotateOpts = {}) => {
      const records = await load();
      const result = rotateToken(records, token, rotateOpts);
      await save(result.records);
      if (result.ok) {
        return { ok: true, token: result.token, sub: result.sub, meta: result.meta || {} };
      }
      return { ok: false, reason: result.reason, sub: result.sub };
    },
    revoke: async (token) => {
      const records = await load();
      const result = revokeToken(records, token);
      if (result.revoked) await save(result.records);
      return { revoked: result.revoked, sub: result.sub };
    },
    /**
     * Validate a presented token's secret and return identity + meta without rotating.
     * Used by MCP OAuth to enforce client_id binding before rotate.
     * @param {string} token
     * @returns {Promise<null | {
     *   sub: string,
     *   meta: object,
     *   revoked: boolean,
     *   consumed: boolean,
     *   expires_at: number,
     *   family_expires_at: number,
     * }>}
     */
    peek: async (token) => {
      const records = await load();
      const parsed = parseToken(token);
      if (!parsed) return null;
      const rec = records[parsed.id];
      if (!rec || typeof rec.token_hash !== 'string') return null;
      const expected = Buffer.from(rec.token_hash);
      const actual = Buffer.from(hashSecret(parsed.secret));
      if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        return null;
      }
      return {
        sub: rec.sub,
        meta: rec.meta && typeof rec.meta === 'object' ? rec.meta : {},
        revoked: Boolean(rec.revoked),
        consumed: Boolean(rec.rotated_to),
        expires_at: rec.expires_at,
        family_expires_at: rec.family_expires_at,
      };
    },
  };
}

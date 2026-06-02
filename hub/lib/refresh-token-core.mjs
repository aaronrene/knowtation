/**
 * Refresh-token core — storage-agnostic logic for persistent, secure sessions.
 *
 * This module implements OAuth 2.0 refresh-token rotation with reuse detection
 * (the pattern recommended by OWASP and RFC 6819 §5.2.2.3). It deliberately holds
 * NO state and performs NO I/O: callers pass in a plain `records` object (the set
 * of currently-valid refresh-token records) and a `now` timestamp, and receive back
 * a new `records` object to persist however they like (a JSON file for the
 * self-hosted Hub, a Netlify Blob for the hosted bridge, a DB row, etc.). Keeping the
 * security logic pure makes it exhaustively unit-testable and reusable across every
 * deployment surface without duplicating the dangerous parts.
 *
 * ## Threat model and design choices
 *
 * - **Opaque, not a JWT.** A refresh token is high-entropy random bytes, never a
 *   signed claim. It is meaningless to anyone who cannot match it against the server
 *   store, so a leaked token is useless once revoked. This is the property the access
 *   JWT cannot provide (a valid JWT is accepted until it expires, with no server check).
 *
 * - **Hash at rest.** Only `sha256(secret)` is stored. The raw secret is returned to
 *   the caller exactly once (to hand to the client) and never persisted. A read-only
 *   leak of the store (e.g. a backup) therefore does not expose usable tokens. SHA-256
 *   (not bcrypt/scrypt) is appropriate here precisely because the secret is 256 bits of
 *   CSPRNG output — there is nothing to brute-force, so a slow KDF would add cost without
 *   adding security.
 *
 * - **Lookup id separate from secret.** The token presented to the client is
 *   `"<id>.<secret>"`. The `id` lets the server find the one record in O(1) and compare
 *   the secret in constant time, instead of scanning every record (which would be both
 *   slow and a timing-oracle).
 *
 * - **Rotation + reuse detection.** Every successful refresh consumes the presented
 *   token and issues a brand-new one in the same *family*. If a token that has already
 *   been rotated is presented again, that is the signature of a stolen token being
 *   replayed: the entire family is revoked immediately, logging out both the attacker
 *   and the victim (who must re-authenticate). This bounds the damage of a leaked
 *   refresh token to, at most, the window before either party next refreshes.
 *
 * - **Absolute family cap.** Rotation alone would let a session live forever. Each
 *   family carries `family_expires_at`, an absolute ceiling after which no rotation is
 *   honored regardless of per-token expiry — so re-authentication is eventually forced.
 *
 * Times are milliseconds since the Unix epoch (numbers), and `now` is always injected,
 * so behavior is deterministic and testable without faking the system clock.
 */

import crypto from 'node:crypto';

/** Default per-token lifetime: a single refresh token is valid for 30 days of inactivity. */
export const DEFAULT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Default absolute family lifetime: a session may be rotated for at most 90 days before re-auth. */
export const DEFAULT_FAMILY_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Bytes of entropy for the secret half of a token (256 bits). */
const SECRET_BYTES = 32;
/** Bytes of entropy for the lookup id (128 bits — collision-resistant, not secret). */
const ID_BYTES = 16;

/** Discriminated reasons a refresh attempt can fail. Stable strings — safe to map to API codes. */
export const REFRESH_FAILURE = Object.freeze({
  INVALID: 'invalid', // unknown id, malformed token, or secret mismatch
  EXPIRED: 'expired', // per-token or family lifetime elapsed
  REVOKED: 'revoked', // token was explicitly revoked (e.g. logout, or family compromise)
  REUSE: 'reuse', // an already-rotated token was replayed — family is revoked as a result
});

/**
 * Hash a token secret for storage/comparison. Uses SHA-256 over the high-entropy secret.
 * @param {string} secret - the random secret half of a token
 * @returns {string} base64url-encoded digest
 */
export function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('base64url');
}

/**
 * Constant-time string comparison that does not leak length via early return timing
 * beyond the unavoidable length check. Both inputs are hashed to fixed-length buffers
 * first so the comparison itself is always over equal-length buffers.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqualHashes(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Generate a new opaque refresh token.
 * @returns {{ id: string, secret: string, token: string, tokenHash: string }}
 *   `token` is what the client receives (`"<id>.<secret>"`); `tokenHash` is what the
 *   server persists. The raw `secret` must never be stored.
 */
export function generateRefreshToken() {
  const id = crypto.randomBytes(ID_BYTES).toString('base64url');
  const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url');
  return { id, secret, token: `${id}.${secret}`, tokenHash: hashSecret(secret) };
}

/**
 * Parse a client-presented token string into its id and secret halves.
 * @param {unknown} token
 * @returns {{ id: string, secret: string } | null} null if malformed
 */
export function parseToken(token) {
  if (typeof token !== 'string' || token.length === 0) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const id = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!id || !secret || secret.includes('.')) return null;
  return { id, secret };
}

/**
 * Shallow-clone a records map so core functions never mutate the caller's object.
 * @param {Record<string, object>} records
 * @returns {Record<string, object>}
 */
function cloneRecords(records) {
  const out = {};
  if (records && typeof records === 'object') {
    for (const [k, v] of Object.entries(records)) {
      if (v && typeof v === 'object') out[k] = { ...v };
    }
  }
  return out;
}

/**
 * Issue a brand-new refresh token, starting a new family (call at login).
 *
 * @param {Record<string, object>} records - current store contents
 * @param {{ sub: string, now?: number, tokenTtlMs?: number, familyTtlMs?: number, meta?: object }} opts
 * @returns {{ records: Record<string, object>, token: string, id: string, familyId: string }}
 * @throws {Error} if `sub` is missing
 */
export function issueToken(records, opts) {
  const { sub } = opts || {};
  if (typeof sub !== 'string' || !sub.trim()) {
    throw new Error('issueToken: sub is required');
  }
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const tokenTtlMs = Number.isFinite(opts.tokenTtlMs) ? opts.tokenTtlMs : DEFAULT_TOKEN_TTL_MS;
  const familyTtlMs = Number.isFinite(opts.familyTtlMs) ? opts.familyTtlMs : DEFAULT_FAMILY_TTL_MS;

  const next = cloneRecords(records);
  const { id, token, tokenHash } = generateRefreshToken();
  const familyId = crypto.randomBytes(ID_BYTES).toString('base64url');

  next[id] = {
    sub: sub.trim(),
    family_id: familyId,
    token_hash: tokenHash,
    created_at: now,
    expires_at: now + tokenTtlMs,
    family_expires_at: now + familyTtlMs,
    rotated_to: null,
    used_at: null,
    revoked: false,
    meta: sanitizeMeta(opts.meta),
  };

  return { records: next, token, id, familyId };
}

/**
 * Keep only small, known string fields from caller-supplied metadata (e.g. user agent,
 * IP) so we never persist arbitrary/unbounded data into the token store.
 * @param {object|undefined} meta
 * @returns {{ ua?: string, ip?: string }}
 */
function sanitizeMeta(meta) {
  const out = {};
  if (meta && typeof meta === 'object') {
    if (typeof meta.ua === 'string') out.ua = meta.ua.slice(0, 256);
    if (typeof meta.ip === 'string') out.ip = meta.ip.slice(0, 64);
  }
  return out;
}

/**
 * Mark every token in a family as revoked. Used both for explicit "log out everywhere"
 * within a family and automatically when token reuse is detected.
 * @param {Record<string, object>} records
 * @param {string} familyId
 * @param {number} now
 * @returns {Record<string, object>} new records
 */
export function revokeFamily(records, familyId, now = Date.now()) {
  const next = cloneRecords(records);
  for (const rec of Object.values(next)) {
    if (rec.family_id === familyId && !rec.revoked) {
      rec.revoked = true;
      rec.revoked_at = now;
    }
  }
  return next;
}

/**
 * Revoke (delete) the single token matching the presented token string. Safe no-op if
 * the token is unknown or malformed. Used for ordinary logout of one session.
 * @param {Record<string, object>} records
 * @param {string} token
 * @returns {{ records: Record<string, object>, revoked: boolean, sub: string|null }}
 */
export function revokeToken(records, token) {
  const parsed = parseToken(token);
  const next = cloneRecords(records);
  if (!parsed) return { records: next, revoked: false, sub: null };
  const rec = next[parsed.id];
  if (!rec) return { records: next, revoked: false, sub: null };
  // Only delete if the secret actually matches, so a known id alone cannot evict a session.
  if (!safeEqualHashes(rec.token_hash, hashSecret(parsed.secret))) {
    return { records: next, revoked: false, sub: null };
  }
  const sub = rec.sub;
  delete next[parsed.id];
  return { records: next, revoked: true, sub };
}

/**
 * Revoke every token belonging to a user (e.g. admin "sign out all sessions", or a
 * password/identity compromise). Returns count for audit logging.
 * @param {Record<string, object>} records
 * @param {string} sub
 * @returns {{ records: Record<string, object>, count: number }}
 */
export function revokeAllForSub(records, sub) {
  const next = cloneRecords(records);
  let count = 0;
  for (const [id, rec] of Object.entries(next)) {
    if (rec.sub === sub) {
      delete next[id];
      count += 1;
    }
  }
  return { records: next, count };
}

/**
 * Validate a presented refresh token and, on success, rotate it: consume the old token
 * and mint a new one in the same family. On detection of replay of an already-rotated
 * token, revoke the whole family.
 *
 * @param {Record<string, object>} records
 * @param {string} token - client-presented `"<id>.<secret>"`
 * @param {{ now?: number, tokenTtlMs?: number, meta?: object }} [opts]
 * @returns {
 *   { ok: true, records: Record<string, object>, token: string, id: string, sub: string, familyId: string }
 *   | { ok: false, records: Record<string, object>, reason: string, sub: string|null }
 * }
 */
export function rotateToken(records, token, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const tokenTtlMs = Number.isFinite(opts.tokenTtlMs) ? opts.tokenTtlMs : DEFAULT_TOKEN_TTL_MS;

  const parsed = parseToken(token);
  if (!parsed) {
    return { ok: false, records: cloneRecords(records), reason: REFRESH_FAILURE.INVALID, sub: null };
  }

  let next = cloneRecords(records);
  const rec = next[parsed.id];
  if (!rec) {
    return { ok: false, records: next, reason: REFRESH_FAILURE.INVALID, sub: null };
  }

  // Verify the secret before trusting any field on the record.
  if (!safeEqualHashes(rec.token_hash, hashSecret(parsed.secret))) {
    return { ok: false, records: next, reason: REFRESH_FAILURE.INVALID, sub: null };
  }

  // Already revoked (logout or prior family compromise): reject, and make sure the whole
  // family is down in case revocation was partial.
  if (rec.revoked) {
    next = revokeFamily(next, rec.family_id, now);
    return { ok: false, records: next, reason: REFRESH_FAILURE.REVOKED, sub: rec.sub };
  }

  // Replay of an already-rotated token == theft signal. Burn the entire family.
  if (rec.rotated_to) {
    next = revokeFamily(next, rec.family_id, now);
    return { ok: false, records: next, reason: REFRESH_FAILURE.REUSE, sub: rec.sub };
  }

  // Expiry checks (per-token inactivity AND absolute family ceiling).
  if (now >= rec.expires_at || now >= rec.family_expires_at) {
    delete next[parsed.id];
    return { ok: false, records: next, reason: REFRESH_FAILURE.EXPIRED, sub: rec.sub };
  }

  // Success: mint a successor in the same family, capped by the same absolute ceiling.
  const fresh = generateRefreshToken();
  next[fresh.id] = {
    sub: rec.sub,
    family_id: rec.family_id,
    token_hash: fresh.tokenHash,
    created_at: now,
    expires_at: now + tokenTtlMs,
    family_expires_at: rec.family_expires_at,
    rotated_to: null,
    used_at: null,
    revoked: false,
    meta: sanitizeMeta(opts.meta) || rec.meta,
  };

  // Consume the old token: keep a tombstone (marked used + pointing at successor) so a
  // later replay is detected as reuse rather than silently treated as "unknown".
  rec.used_at = now;
  rec.rotated_to = fresh.id;

  return { ok: true, records: next, token: fresh.token, id: fresh.id, sub: rec.sub, familyId: rec.family_id };
}

/**
 * Drop records that can never succeed again: expired tokens past a grace period, and
 * consumed/revoked tombstones older than the grace window. The grace window keeps recent
 * tombstones so reuse detection still fires for a stolen token replayed shortly after
 * rotation; after the window, the family is moot and the rows are just clutter.
 *
 * @param {Record<string, object>} records
 * @param {{ now?: number, graceMs?: number }} [opts]
 * @returns {{ records: Record<string, object>, removed: number }}
 */
export function pruneExpired(records, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  // Keep tombstones for the full family lifetime by default so reuse detection is reliable.
  const graceMs = Number.isFinite(opts.graceMs) ? opts.graceMs : DEFAULT_FAMILY_TTL_MS;
  const next = cloneRecords(records);
  let removed = 0;
  for (const [id, rec] of Object.entries(next)) {
    const familyDead = now >= (rec.family_expires_at ?? 0);
    const tokenDead = now >= (rec.expires_at ?? 0);
    const consumed = Boolean(rec.rotated_to) || rec.revoked === true;
    const pastGrace = now >= ((rec.used_at ?? rec.revoked_at ?? rec.created_at ?? 0) + graceMs);
    if (familyDead || (tokenDead && (!consumed || pastGrace)) || (consumed && pastGrace)) {
      delete next[id];
      removed += 1;
    }
  }
  return { records: next, removed };
}

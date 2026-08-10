/**
 * Apple Sign in with Apple identity-token verifier (KN-APPLE-NATIVE-HOSTED-EXCHANGE).
 *
 * Verifies Apple `identityToken` JWTs against Apple JWKS. Does not mint sessions,
 * does not touch Layer-2 `scooling_uid`, and never logs the raw assertion.
 *
 * @module hub/gateway/apple-identity-token
 */

import { createHash, createPublicKey } from 'node:crypto';
import jwt from 'jsonwebtoken';

/** @typedef {{ appleSub: string, email?: string }} AppleIdentityClaims */

export const APPLE_ISS = 'https://appleid.apple.com';
export const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';

/** Allowed request body keys for POST api/v1/auth/native-apple-exchange. */
export const APPLE_EXCHANGE_ALLOWED_FIELDS = Object.freeze(['identity_token', 'nonce', 'full_name']);

/** Client-supplied identity / authority fields — presence → BAD_REQUEST. */
export const APPLE_EXCHANGE_FORBIDDEN_FIELDS = Object.freeze([
  'sub',
  'provider',
  'id',
  'role',
  'scopes',
  'scooling_uid',
  'scoolingUid',
  'kid',
  'access_token',
  'refresh_token',
  'client_secret',
  'team_id',
  'authorization',
]);

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;

/**
 * Advertise `providers.apple` per freeze §KNA.3.7.
 * @param {{ appleClientId?: string|null, offlineLocked?: boolean }} opts
 * @returns {boolean}
 */
export function appleProviderAdvertised(opts = {}) {
  if (opts.offlineLocked) return false;
  const id = opts.appleClientId;
  return typeof id === 'string' && id.trim().length > 0;
}

/**
 * Parse / allowlist the native-apple-exchange JSON body.
 * @param {unknown} body
 * @returns {{ ok: true, identityToken: string, nonce?: string, fullName: string }
 *   | { ok: false, code: 'BAD_REQUEST', error: string }}
 */
export function parseAppleExchangeBody(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, code: 'BAD_REQUEST', error: 'Request body must be a JSON object' };
  }
  const keys = Object.keys(body);
  for (const key of keys) {
    if (APPLE_EXCHANGE_FORBIDDEN_FIELDS.includes(key)) {
      return { ok: false, code: 'BAD_REQUEST', error: `Forbidden field: ${key}` };
    }
    if (!APPLE_EXCHANGE_ALLOWED_FIELDS.includes(key)) {
      return { ok: false, code: 'BAD_REQUEST', error: `Unknown field: ${key}` };
    }
  }
  const identityToken = body.identity_token;
  if (typeof identityToken !== 'string' || identityToken.trim().length === 0) {
    return { ok: false, code: 'BAD_REQUEST', error: 'identity_token is required' };
  }
  let nonce;
  if (Object.prototype.hasOwnProperty.call(body, 'nonce')) {
    if (typeof body.nonce !== 'string' || body.nonce.trim().length === 0) {
      return { ok: false, code: 'BAD_REQUEST', error: 'nonce must be a non-empty string when present' };
    }
    nonce = body.nonce;
  }
  let fullName = '';
  if (Object.prototype.hasOwnProperty.call(body, 'full_name')) {
    if (typeof body.full_name !== 'string') {
      return { ok: false, code: 'BAD_REQUEST', error: 'full_name must be a string when present' };
    }
    fullName = body.full_name.slice(0, 128);
  }
  return { ok: true, identityToken: identityToken.trim(), nonce, fullName };
}

/**
 * Convert gateway JWT expiry strings (`24h`, `15m`, …) to seconds for `expires_in`.
 * @param {string|number} expiry
 * @returns {number}
 */
export function jwtExpiryToSeconds(expiry) {
  if (typeof expiry === 'number' && Number.isFinite(expiry) && expiry > 0) {
    return Math.floor(expiry);
  }
  const m = String(expiry || '').trim().match(/^(\d+)\s*([smhd])$/i);
  if (!m) return 86400;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  if (u === 's') return n;
  if (u === 'm') return n * 60;
  if (u === 'h') return n * 3600;
  return n * 86400;
}

/**
 * Apple nonce match: claim equals raw nonce OR SHA-256 hex of the raw nonce.
 * @param {string|undefined} claim
 * @param {string|undefined} presented
 * @returns {boolean}
 */
export function appleNonceMatches(claim, presented) {
  if (presented == null || presented === '') return true;
  if (typeof claim !== 'string' || claim.length === 0) return false;
  if (claim === presented) return true;
  const hex = createHash('sha256').update(presented, 'utf8').digest('hex');
  return claim === hex;
}

/**
 * Create a verifier with in-process JWKS cache (TTL ≤ 24h).
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   jwksUrl?: string,
 *   cacheTtlMs?: number,
 *   nowSeconds?: () => number,
 * }} [opts]
 */
export function createAppleIdentityVerifier(opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch.bind(globalThis);
  const jwksUrl = opts.jwksUrl || APPLE_JWKS_URL;
  const cacheTtlMs = Math.min(
    typeof opts.cacheTtlMs === 'number' ? opts.cacheTtlMs : DEFAULT_CACHE_TTL_MS,
    DEFAULT_CACHE_TTL_MS,
  );
  const nowSeconds = opts.nowSeconds || (() => Math.floor(Date.now() / 1000));

  /** @type {{ keys: object[], fetchedAt: number } | null} */
  let cache = null;

  /**
   * @returns {Promise<{ ok: true, keys: object[] } | { ok: false, code: 'APPLE_JWKS_UNAVAILABLE', error: string }>}
   */
  async function loadJwks() {
    const now = Date.now();
    if (cache && now - cache.fetchedAt < cacheTtlMs && Array.isArray(cache.keys) && cache.keys.length) {
      return { ok: true, keys: cache.keys };
    }
    try {
      const res = await fetchImpl(jwksUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!res || !res.ok) {
        if (cache?.keys?.length) return { ok: true, keys: cache.keys };
        return { ok: false, code: 'APPLE_JWKS_UNAVAILABLE', error: 'Apple JWKS fetch failed' };
      }
      const body = await res.json();
      const keys = Array.isArray(body?.keys) ? body.keys : [];
      if (!keys.length) {
        if (cache?.keys?.length) return { ok: true, keys: cache.keys };
        return { ok: false, code: 'APPLE_JWKS_UNAVAILABLE', error: 'Apple JWKS empty' };
      }
      cache = { keys, fetchedAt: now };
      return { ok: true, keys };
    } catch {
      if (cache?.keys?.length) return { ok: true, keys: cache.keys };
      return { ok: false, code: 'APPLE_JWKS_UNAVAILABLE', error: 'Apple JWKS fetch failed' };
    }
  }

  /**
   * @param {string} identityToken
   * @param {{ audience: string, nonce?: string }} verifyOpts
   * @returns {Promise<
   *   | { ok: true, claims: AppleIdentityClaims }
   *   | { ok: false, code: 'APPLE_ASSERTION_INVALID'|'APPLE_JWKS_UNAVAILABLE', error: string }
   * >}
   */
  async function verifyIdentityToken(identityToken, verifyOpts) {
    const audience = verifyOpts?.audience;
    if (typeof audience !== 'string' || !audience.trim()) {
      return { ok: false, code: 'APPLE_ASSERTION_INVALID', error: 'audience not configured' };
    }
    if (typeof identityToken !== 'string' || !identityToken.trim()) {
      return { ok: false, code: 'APPLE_ASSERTION_INVALID', error: 'malformed identity token' };
    }

    let header;
    try {
      const parts = identityToken.split('.');
      if (parts.length !== 3) {
        return { ok: false, code: 'APPLE_ASSERTION_INVALID', error: 'malformed identity token' };
      }
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    } catch {
      return { ok: false, code: 'APPLE_ASSERTION_INVALID', error: 'malformed identity token' };
    }

    const alg = header?.alg;
    if (!alg || alg === 'none' || alg !== 'RS256') {
      return { ok: false, code: 'APPLE_ASSERTION_INVALID', error: 'unsupported JWT alg' };
    }
    const kid = header?.kid;
    if (typeof kid !== 'string' || !kid) {
      return { ok: false, code: 'APPLE_ASSERTION_INVALID', error: 'missing kid' };
    }

    const jwks = await loadJwks();
    if (!jwks.ok) return jwks;

    const jwk = jwks.keys.find((k) => k && k.kid === kid && k.kty === 'RSA');
    if (!jwk) {
      return { ok: false, code: 'APPLE_ASSERTION_INVALID', error: 'unknown kid' };
    }

    let key;
    try {
      key = createPublicKey({ key: jwk, format: 'jwk' });
    } catch {
      return { ok: false, code: 'APPLE_ASSERTION_INVALID', error: 'invalid JWK' };
    }

    let payload;
    try {
      payload = jwt.verify(identityToken, key, {
        algorithms: ['RS256'],
        issuer: APPLE_ISS,
        audience: audience.trim(),
        clockTolerance: CLOCK_SKEW_SECONDS,
        clockTimestamp: nowSeconds(),
      });
    } catch {
      return { ok: false, code: 'APPLE_ASSERTION_INVALID', error: 'identity token verification failed' };
    }

    if (!payload || typeof payload !== 'object') {
      return { ok: false, code: 'APPLE_ASSERTION_INVALID', error: 'identity token verification failed' };
    }
    const appleSub = payload.sub;
    if (typeof appleSub !== 'string' || !appleSub.trim()) {
      return { ok: false, code: 'APPLE_ASSERTION_INVALID', error: 'missing sub' };
    }
    if (!appleNonceMatches(payload.nonce, verifyOpts.nonce)) {
      return { ok: false, code: 'APPLE_ASSERTION_INVALID', error: 'nonce mismatch' };
    }

    /** @type {AppleIdentityClaims} */
    const claims = { appleSub: appleSub.trim() };
    if (typeof payload.email === 'string' && payload.email.trim()) {
      claims.email = payload.email.trim();
    }
    return { ok: true, claims };
  }

  /** Test helper: seed JWKS cache without network. */
  function seedJwksCache(keys) {
    cache = { keys: Array.isArray(keys) ? keys : [], fetchedAt: Date.now() };
  }

  /** Test helper: clear JWKS cache. */
  function clearJwksCache() {
    cache = null;
  }

  return {
    verifyIdentityToken,
    loadJwks,
    seedJwksCache,
    clearJwksCache,
  };
}

/** Default process-wide verifier (real Apple JWKS URL). */
export const defaultAppleIdentityVerifier = createAppleIdentityVerifier();

/**
 * Hosted human-session claim admission (SESSION-DURABILITY).
 *
 * Accepts only type:session tokens with integer iat/exp, exp > iat, total lifetime in
 * the inclusive 3h–24h band, and (unless checking an already-expired token) unexpired exp.
 * Distinguishes SESSION_EXPIRED from SESSION_INVALID without leaking token detail.
 */

import jwt from 'jsonwebtoken';

/** Inclusive minimum total lifetime (3 hours) in seconds. */
export const HUMAN_SESSION_LIFETIME_MIN_SECONDS = 3 * 60 * 60;

/** Inclusive maximum total lifetime (24 hours) in seconds. */
export const HUMAN_SESSION_LIFETIME_MAX_SECONDS = 24 * 60 * 60;

/**
 * True when value is a finite integer (not a float string masquerading as number).
 * @param {unknown} v
 * @returns {v is number}
 */
export function isIntegerSeconds(v) {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v);
}

/**
 * Claim-shape check shared by live admission and expired-session classification.
 * Does not require exp > now.
 * @param {object} payload
 * @returns {boolean}
 */
export function humanSessionClaimsShapeOk(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.type !== 'session') return false;
  if (typeof payload.sub !== 'string' || payload.sub.trim() === '') return false;
  if (!isIntegerSeconds(payload.iat) || !isIntegerSeconds(payload.exp)) return false;
  if (payload.exp <= payload.iat) return false;
  const lifetime = payload.exp - payload.iat;
  return (
    lifetime >= HUMAN_SESSION_LIFETIME_MIN_SECONDS &&
    lifetime <= HUMAN_SESSION_LIFETIME_MAX_SECONDS
  );
}

/**
 * Admit a decoded human-session payload for live use.
 * @param {object} payload
 * @param {number} [nowSeconds]
 * @returns {{ ok: true, payload: object } | { ok: false, code: 'SESSION_EXPIRED' | 'SESSION_INVALID' }}
 */
export function admitHumanSessionPayload(payload, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!humanSessionClaimsShapeOk(payload)) {
    return { ok: false, code: 'SESSION_INVALID' };
  }
  if (payload.exp <= nowSeconds) {
    return { ok: false, code: 'SESSION_EXPIRED' };
  }
  return { ok: true, payload };
}

/**
 * Verify JWT signature (primary then previous) with optional ignoreExpiration.
 * @param {string} token
 * @param {string} primary
 * @param {string|null|undefined} previous
 * @param {{ ignoreExpiration?: boolean }} [opts]
 * @returns {object|null}
 */
function verifySignature(token, primary, previous, opts = {}) {
  if (typeof token !== 'string' || token === '') return null;
  if (typeof primary !== 'string' || primary === '') return null;
  const verifyOpts = opts.ignoreExpiration ? { ignoreExpiration: true } : {};
  try {
    return jwt.verify(token, primary, verifyOpts);
  } catch (e) {
    if (!opts.ignoreExpiration && e && e.name === 'TokenExpiredError') {
      throw e;
    }
  }
  if (typeof previous !== 'string' || previous === '' || previous === primary) return null;
  try {
    return jwt.verify(token, previous, verifyOpts);
  } catch (e) {
    if (!opts.ignoreExpiration && e && e.name === 'TokenExpiredError') {
      throw e;
    }
    return null;
  }
}

/**
 * Private discriminated verification for hosted human-session introspection / establish-refresh.
 * @param {string} token
 * @param {string} primary
 * @param {string|null|undefined} previous
 * @param {number} [nowSeconds]
 * @returns {{ ok: true, payload: object } | { ok: false, code: 'SESSION_EXPIRED' | 'SESSION_INVALID' }}
 */
export function verifyHumanSessionAccessToken(
  token,
  primary,
  previous,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (typeof token !== 'string' || token === '') {
    return { ok: false, code: 'SESSION_INVALID' };
  }

  let payload = null;
  let sawExpiry = false;
  try {
    payload = verifySignature(token, primary, previous, { ignoreExpiration: false });
  } catch (e) {
    if (e && e.name === 'TokenExpiredError') {
      sawExpiry = true;
      payload = verifySignature(token, primary, previous, { ignoreExpiration: true });
    } else {
      payload = null;
    }
  }

  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'SESSION_INVALID' };
  }

  if (!humanSessionClaimsShapeOk(payload)) {
    return { ok: false, code: 'SESSION_INVALID' };
  }

  if (sawExpiry || payload.exp <= nowSeconds) {
    return { ok: false, code: 'SESSION_EXPIRED' };
  }

  return { ok: true, payload };
}

/**
 * Hosted-gateway HUB_JWT_EXPIRY grammar: positive integer seconds, or case-insensitive
 * no-whitespace `^[0-9]+[smhd]$`, converted once to integer seconds in [3h, 24h].
 *
 * @param {unknown} raw
 * @returns {{ ok: true, seconds: number } | { ok: false, error: string }}
 */
export function parseHostedHubJwtExpirySeconds(raw) {
  const defaultRaw = raw == null || raw === '' ? '24h' : raw;
  let seconds = null;

  if (typeof defaultRaw === 'number') {
    if (!Number.isFinite(defaultRaw) || !Number.isInteger(defaultRaw) || defaultRaw <= 0) {
      return {
        ok: false,
        error: 'HUB_JWT_EXPIRY must be a positive integer number of seconds or N[smhd]',
      };
    }
    seconds = defaultRaw;
  } else if (typeof defaultRaw === 'string') {
    const s = defaultRaw.trim();
    if (/^\d+$/.test(s)) {
      seconds = Number(s);
    } else if (/^\d+[smhd]$/i.test(s) && !/\s/.test(s)) {
      const m = s.match(/^(\d+)([smhd])$/i);
      const n = Number(m[1]);
      const u = m[2].toLowerCase();
      if (u === 's') seconds = n;
      else if (u === 'm') seconds = n * 60;
      else if (u === 'h') seconds = n * 3600;
      else seconds = n * 86400;
    } else {
      return {
        ok: false,
        error:
          'HUB_JWT_EXPIRY must be a positive integer number of seconds or the form N[smhd] with no whitespace',
      };
    }
  } else {
    return {
      ok: false,
      error: 'HUB_JWT_EXPIRY must be a positive integer number of seconds or N[smhd]',
    };
  }

  if (
    !Number.isInteger(seconds) ||
    seconds < HUMAN_SESSION_LIFETIME_MIN_SECONDS ||
    seconds > HUMAN_SESSION_LIFETIME_MAX_SECONDS
  ) {
    return {
      ok: false,
      error: `HUB_JWT_EXPIRY must resolve to an integer in [${HUMAN_SESSION_LIFETIME_MIN_SECONDS}, ${HUMAN_SESSION_LIFETIME_MAX_SECONDS}] seconds (3h–24h)`,
    };
  }

  return { ok: true, seconds };
}

/**
 * Browser Origin allowlist for establish-refresh (reuses HUB_CORS_ORIGIN / BASE_URL rules).
 * @param {string|undefined|null} originHeader
 * @param {string[]} corsOrigins
 * @param {string} baseUrl
 * @param {(a: string, b: string) => boolean} [isWwwApexPair]
 * @returns {boolean}
 */
export function isEstablishRefreshBrowserOriginAllowed(
  originHeader,
  corsOrigins,
  baseUrl,
  isWwwApexPair,
) {
  if (originHeader == null || originHeader === '' || originHeader === 'null') return false;
  let origin;
  try {
    const u = new URL(originHeader);
    if (u.username || u.password || u.search || u.hash) return false;
    if (u.pathname !== '/' && u.pathname !== '') return false;
    origin = u.origin;
    if (String(originHeader) !== origin) return false;
  } catch {
    return false;
  }

  const list = Array.isArray(corsOrigins) ? corsOrigins : [];
  if (list.length > 0) {
    if (list.includes(origin)) return true;
    if (typeof isWwwApexPair === 'function') {
      for (const o of list) {
        if (isWwwApexPair(o, origin)) return true;
      }
    }
    return false;
  }

  try {
    return origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

/** CLI media type required when Origin is absent. */
export const REFRESH_TOKEN_CLI_ACCEPT = 'application/vnd.knowtation.refresh-token+json';

/**
 * @param {string|undefined|null} acceptHeader
 * @returns {boolean}
 */
export function acceptIncludesRefreshTokenCli(acceptHeader) {
  if (typeof acceptHeader !== 'string' || !acceptHeader) return false;
  return acceptHeader
    .split(',')
    .map((p) => p.split(';')[0].trim().toLowerCase())
    .includes(REFRESH_TOKEN_CLI_ACCEPT);
}

/**
 * Auth session orchestration — HttpOnly refresh-cookie handling + refresh/logout HTTP
 * handlers, built to be dependency-injected and therefore unit-testable without booting
 * a server.
 *
 * Security logic (rotation, reuse detection, hashing, expiry) lives in
 * `hub/lib/refresh-token-core.mjs` and is reached only through an injected `store`
 * (`{ rotate, revoke, issue }`). This module owns the transport-level concerns:
 *
 *   - The refresh token is delivered as an **HttpOnly, Secure, SameSite** cookie scoped
 *     to the auth path, so browser JavaScript (and therefore XSS) cannot read it. This is
 *     the property `localStorage` cannot provide.
 *   - The access token is returned in the JSON body for the client to hold in memory only.
 *   - On reuse/expiry/revocation the cookie is cleared and a stable error code is returned.
 *
 * Both the self-hosted Hub (synchronous file store) and the hosted gateway (asynchronous
 * Netlify-Blob store) reuse these factories by injecting their own store and cookie policy.
 * Every store call is `await`ed so a Promise-returning store works; awaiting a synchronous
 * return value is a no-op, so the same code drives both deployments with zero duplication of
 * the security-sensitive rotation logic.
 */

/** Name of the HttpOnly refresh-token cookie. */
export const REFRESH_COOKIE_NAME = 'ktn_refresh';

/** Path the refresh cookie is scoped to, so it is only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * Build the cookie options object for `res.cookie(...)`.
 * @param {{ secure?: boolean, sameSite?: 'lax'|'strict'|'none', path?: string, maxAgeMs?: number }} [opts]
 * @returns {object} express cookie options (always HttpOnly)
 */
export function refreshCookieOptions(opts = {}) {
  const sameSite = opts.sameSite || 'lax';
  // SameSite=None is only honored by browsers when Secure is also set; enforce that here
  // so a cross-origin deployment cannot accidentally ship a cookie browsers will drop.
  const secure = sameSite === 'none' ? true : opts.secure !== false;
  const out = {
    httpOnly: true,
    secure,
    sameSite,
    path: opts.path || REFRESH_COOKIE_PATH,
  };
  if (Number.isFinite(opts.maxAgeMs)) out.maxAge = opts.maxAgeMs;
  return out;
}

/**
 * Options used to CLEAR a cookie. Must match name/path/secure/sameSite/httpOnly of the set
 * cookie (but never maxAge/expires) or the browser will not remove it.
 * @param {object} setOptions - the object returned by refreshCookieOptions()
 * @returns {object}
 */
export function clearCookieOptions(setOptions) {
  const { httpOnly, secure, sameSite, path } = setOptions || {};
  return { httpOnly, secure, sameSite, path: path || REFRESH_COOKIE_PATH };
}

/** Map a core failure reason to a stable API error code + message (no internal detail leaked). */
function refreshError(reason) {
  switch (reason) {
    case 'reuse':
      // A rotated token was replayed — likely theft. Family is already revoked by the core.
      return { code: 'REFRESH_REUSE', message: 'Session was invalidated. Please sign in again.' };
    case 'expired':
      return { code: 'REFRESH_EXPIRED', message: 'Session expired. Please sign in again.' };
    case 'revoked':
      return { code: 'REFRESH_REVOKED', message: 'Session was revoked. Please sign in again.' };
    default:
      return { code: 'UNAUTHORIZED', message: 'Invalid session.' };
  }
}

/**
 * Read the presented refresh token from the request: cookie first (browser flow), then a
 * JSON body field (programmatic clients, matching the documented `POST /auth/refresh`).
 * @param {object} req
 * @param {string} cookieName
 * @returns {string|null}
 */
function readPresentedToken(req, cookieName) {
  const fromCookie = req && req.cookies && typeof req.cookies[cookieName] === 'string' ? req.cookies[cookieName] : null;
  if (fromCookie) return fromCookie;
  const fromBody = req && req.body && typeof req.body.refresh_token === 'string' ? req.body.refresh_token : null;
  return fromBody || null;
}

/**
 * Issue a fresh refresh token for a user and set it as the HttpOnly cookie. Call at the end
 * of a successful OAuth login.
 *
 * @param {object} res - express response
 * @param {{
 *   store: { issue: (sub: string, opts?: object) => ({ token: string } | Promise<{ token: string }>) },
 *   sub: string,
 *   cookieName?: string,
 *   cookieOptions: () => object,
 *   now?: number,
 *   meta?: object,
 * }} deps
 * @returns {Promise<string>} the raw refresh token (also set as the cookie)
 */
export async function issueRefreshCookie(res, deps) {
  const cookieName = deps.cookieName || REFRESH_COOKIE_NAME;
  const opts = deps.cookieOptions();
  const { token } = await deps.store.issue(deps.sub, { now: deps.now, meta: deps.meta });
  res.cookie(cookieName, token, opts);
  return token;
}

/**
 * Build the `POST /auth/refresh` handler. Rotates the presented refresh token, sets the new
 * cookie, and returns a freshly-signed access token in the body.
 *
 * @param {{
 *   store: { rotate: (token: string, opts?: object) => (object | Promise<object>) },
 *   issueAccessToken: (sub: string) => (string | Promise<string>),
 *   cookieName?: string,
 *   cookieOptions: () => object,
 *   now?: () => number,
 *   meta?: (req: object) => object,
 * }} deps
 * @returns {(req: object, res: object) => Promise<void>}
 */
export function createRefreshHandler(deps) {
  const cookieName = deps.cookieName || REFRESH_COOKIE_NAME;
  const nowFn = typeof deps.now === 'function' ? deps.now : () => Date.now();
  return async function refreshHandler(req, res) {
    res.set('Cache-Control', 'private, no-store, must-revalidate');
    const presented = readPresentedToken(req, cookieName);
    if (!presented) {
      return res.status(401).json({ error: 'Missing refresh token', code: 'UNAUTHORIZED' });
    }
    let result;
    try {
      result = await deps.store.rotate(presented, {
        now: nowFn(),
        meta: typeof deps.meta === 'function' ? deps.meta(req) : undefined,
      });
    } catch (_) {
      // A transient store fault (e.g. blob backend hiccup) must not be treated as token
      // theft: do NOT clear the cookie. Fail soft with 503 so the client can retry rather
      // than forcing the user to re-authenticate over an infrastructure blip.
      return res.status(503).json({ error: 'Session service temporarily unavailable.', code: 'SESSION_STORE_UNAVAILABLE' });
    }
    if (!result.ok) {
      res.clearCookie(cookieName, clearCookieOptions(deps.cookieOptions()));
      const e = refreshError(result.reason);
      return res.status(401).json({ error: e.message, code: e.code });
    }
    res.cookie(cookieName, result.token, deps.cookieOptions());
    const accessToken = await deps.issueAccessToken(result.sub);
    return res.json({ access_token: accessToken, token_type: 'Bearer' });
  };
}

/**
 * Build the `POST /auth/logout` handler. Revokes the presented refresh token server-side
 * (real revocation, not just clearing the client) and clears the cookie. Idempotent.
 *
 * @param {{
 *   store: { revoke: (token: string) => ({ revoked: boolean } | Promise<{ revoked: boolean }>) },
 *   cookieName?: string,
 *   cookieOptions: () => object,
 * }} deps
 * @returns {(req: object, res: object) => Promise<void>}
 */
/**
 * Build `POST /auth/establish-refresh`: exchange a valid human session access JWT for a durable
 * refresh token. Returns the refresh token in the JSON body (CLI bootstrap) and sets the HttpOnly
 * cookie (browser). Used when OAuth redirect cannot attach Set-Cookie reliably (Netlify).
 *
 * @param {{
 *   store: { issue: (sub: string, opts?: object) => ({ token: string } | Promise<{ token: string }>) },
 *   verifyAccessToken: (token: string) => (object | null),
 *   cookieName?: string,
 *   cookieOptions: () => object,
 *   meta?: (req: object) => object,
 * }} deps
 * @returns {(req: object, res: object) => Promise<void>}
 */
export function createEstablishRefreshHandler(deps) {
  const cookieName = deps.cookieName || REFRESH_COOKIE_NAME;
  return async function establishRefreshHandler(req, res) {
    res.set('Cache-Control', 'private, no-store, must-revalidate');
    const auth = req.headers && typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    const m = /^Bearer\s+(\S+)/i.exec(auth);
    if (!m) {
      return res.status(401).json({ error: 'Missing bearer token', code: 'UNAUTHORIZED' });
    }
    const payload = deps.verifyAccessToken(m[1]);
    if (!payload || typeof payload.sub !== 'string' || !payload.sub) {
      return res.status(401).json({ error: 'Invalid or expired session token', code: 'UNAUTHORIZED' });
    }
    const typ = typeof payload.type === 'string' ? payload.type : 'session';
    if (typ !== 'session') {
      return res.status(403).json({ error: 'Not a human session token', code: 'SESSION_ESTABLISH_DENIED' });
    }
    try {
      const { token } = await deps.store.issue(payload.sub, {
        meta: typeof deps.meta === 'function' ? deps.meta(req) : undefined,
      });
      res.cookie(cookieName, token, deps.cookieOptions());
      return res.json({ schema_version: 1, refresh_token: token, token_type: 'refresh' });
    } catch (_) {
      return res.status(503).json({
        error: 'Session service temporarily unavailable.',
        code: 'SESSION_STORE_UNAVAILABLE',
      });
    }
  };
}

export function createLogoutHandler(deps) {
  const cookieName = deps.cookieName || REFRESH_COOKIE_NAME;
  return async function logoutHandler(req, res) {
    res.set('Cache-Control', 'private, no-store, must-revalidate');
    const presented = readPresentedToken(req, cookieName);
    let revoked = false;
    if (presented) {
      try {
        const r = await deps.store.revoke(presented);
        revoked = Boolean(r && r.revoked);
      } catch (_) {
        revoked = false;
      }
    }
    res.clearCookie(cookieName, clearCookieOptions(deps.cookieOptions()));
    return res.json({ ok: true, revoked });
  };
}

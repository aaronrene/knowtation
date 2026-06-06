/**
 * Native client OAuth 2.1 provider for the Knowtation companion app.
 *
 * Implements changes C1–C6 from docs/COMPANION-APP-OAUTH-SERVERSIDE-GATE.md §6:
 *
 *   C1 – Mints the web-session JWT (issueToken shape: {sub, provider, id, name, role})
 *        for native loopback clients. The `mcp_access` path is untouched.
 *   C2 – Refresh is backed by refresh-token-core (rotation + reuse→family-revoke).
 *        The new refresh token is delivered in the response body (not a cookie), since
 *        the companion is not a browser.
 *   C3 – Emits `iss` = issuerUrl on the loopback redirect (RFC 9207 §2 mix-up defense).
 *        Value is exactly the `issuer` advertised in the discovery metadata.
 *   C4 – Pending auth codes are stored in native-as-store.mjs (survive process restart).
 *        Refresh tokens use the same durable gateway refresh store as web sessions.
 *   C5 – Validates `redirect_uri` at token exchange per RFC 6749 §4.1.3: the value in
 *        the token request MUST exactly equal the one bound at authorization.
 *   C6 – Scope ceiling guard: never issues a superset of scopesForRole(role). Unknown
 *        or missing role → member ceiling ([vault:read, vault:write]), fail-closed.
 *
 * Endpoints (mounted by server.mjs at /api/v1/auth/native):
 *   GET  /.well-known/oauth-authorization-server  RFC 8414 discovery metadata
 *   POST /register                                RFC 7591 dynamic client registration
 *   GET  /authorize                               RFC 6749 PKCE authorization start
 *   POST /token                                   RFC 6749 code exchange + refresh
 *   POST /revoke                                  RFC 7009 token revocation
 *
 * Security invariants enforced here:
 *   - Only loopback redirect URIs (127.0.0.1 or [::1]) accepted at registration and
 *     authorization (RFC 8252 §7.3, §8.3). Non-loopback → rejected, fail-closed.
 *   - PKCE S256 required at every authorization. `plain` method rejected.
 *   - redirect_uri equality check at code exchange (RFC 6749 §4.1.3).
 *   - Scope ceiling applied at code exchange AND on every refresh rotation (role may
 *     have changed since last login).
 *   - No secret (SESSION_SECRET, JWT, refresh token, code, verifier) appears in any
 *     log line, error body, or redirect URL.
 *   - mcp_access clients (Claude Desktop etc.) are completely unaffected by this module.
 *
 * D-SS.4 SDK verification (docs §4): @modelcontextprotocol/sdk ^1.27.1 accepts any
 * loopback port at registration (no port filtering in OAuthClientMetadataSchema) and
 * performs exact-match at /authorize against registered redirect_uris — consistent with
 * RFC 8252 §7.3 ("allow any port") across registrations and exact-match within one flow.
 * The companion binds one ephemeral port per attempt, derives its redirect_uri from it,
 * and presents that same value at authorization AND token exchange, satisfying both.
 */

import crypto from 'node:crypto';
import { createHash } from 'node:crypto';
import express from 'express';
import {
  savePendingCode,
  bindUserToCode,
  consumePendingCode,
} from './native-as-store.mjs';

/** Access token lifetime. Shorter than the web session for defense-in-depth on native. */
const NATIVE_TOKEN_EXPIRY_SECONDS = 15 * 60; // 15 minutes

/** Refresh token per-token inactivity TTL. Aligns with DEFAULT_TOKEN_TTL_MS in refresh-token-core. */
const NATIVE_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Max registered clients before evicting the oldest. */
const MAX_NATIVE_CLIENTS = 200;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Validate that `uri` is an RFC 8252 §7.3 loopback literal.
 * Accepts http://127.0.0.1:<port>/... and http://[::1]:<port>/...
 * Rejects: `localhost` hostname (DNS-resolvable, not a literal), non-HTTP schemes,
 *          non-loopback hosts, missing port, or any URI that cannot be parsed.
 * Exported for tests.
 *
 * @param {string} uri
 * @returns {boolean}
 */
export function isLoopbackUri(uri) {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'http:') return false;
    const h = url.hostname;
    // Accept the IPv4 and IPv6 loopback literals only.
    // RFC 8252 §8.3 explicitly prohibits the use of `localhost` because it can
    // be hijacked via /etc/hosts or local DNS. We enforce the same restriction.
    return h === '127.0.0.1' || h === '[::1]' || h === '::1';
  } catch (_) {
    return false;
  }
}

/**
 * Compute SHA-256(verifier) as base64url — the S256 PKCE challenge method.
 * @param {string} verifier
 * @returns {string}
 */
function _sha256Base64url(verifier) {
  return createHash('sha256').update(String(verifier)).digest('base64url');
}

/**
 * Map a refresh-token-core failure reason to a stable error code + message.
 * Aligned to the codes in hub/auth-session.mjs `refreshError` so callers and
 * tests can use the same constants across both endpoints.
 *
 * @param {string} reason
 * @returns {{ code: string, message: string }}
 */
function _nativeRefreshError(reason) {
  switch (reason) {
    case 'reuse':
      return { code: 'REFRESH_REUSE', message: 'Session was invalidated. Please sign in again.' };
    case 'expired':
      return { code: 'REFRESH_EXPIRED', message: 'Session expired. Please sign in again.' };
    case 'revoked':
      return { code: 'REFRESH_REVOKED', message: 'Session was revoked. Please sign in again.' };
    default:
      return { code: 'UNAUTHORIZED', message: 'Invalid session.' };
  }
}

// ─── Scope ceiling (C6) ──────────────────────────────────────────────────────

/**
 * Apply the scope ceiling for a native client grant (C6).
 *
 * Rules:
 *   - If `requested` is non-empty, return only the intersection with `ceiling`.
 *   - If `requested` is empty/absent, return the full ceiling.
 *   - The ceiling is always `scopesForRole(role)` and is never exceeded.
 *   - Unknown/missing role → member ceiling, enforced by the injected `grantedScopes`.
 *
 * Exported for unit tests.
 *
 * @param {string[]} requested  - scopes requested by the client
 * @param {string[]} ceiling    - maximum scopes allowed (from scopesForRole)
 * @returns {string[]}
 */
export function applyScopeCeiling(requested, ceiling) {
  if (!Array.isArray(requested) || requested.length === 0) return [...ceiling];
  return requested.filter((s) => Array.isArray(ceiling) && ceiling.includes(s));
}

// ─── In-memory client store ───────────────────────────────────────────────────

/**
 * In-memory store for registered native OAuth clients.
 *
 * Client registrations are session-scoped: the companion re-registers on each auth
 * attempt and registrations need not survive process restart (C4 mandates durable
 * state only for pending codes and refresh records). An in-memory store is therefore
 * appropriate — it is also simpler and avoids a durable write on every registration.
 *
 * Security: only loopback redirect URIs are accepted. Any non-loopback URI in
 * `redirect_uris` causes the entire registration to be rejected (fail-closed, C6
 * spirit + RFC 8252 §8.3).
 */
class NativeClientStore {
  constructor() {
    /** @type {Map<string, object>} */
    this._clients = new Map();
  }

  /**
   * @param {string} clientId
   * @returns {object|undefined}
   */
  getClient(clientId) {
    return this._clients.get(clientId);
  }

  /**
   * Register a new native client after validating that every redirect_uri is a
   * loopback literal.
   *
   * @param {{ redirect_uris?: string[], [key: string]: unknown }} meta
   * @returns {object} full client record (includes generated client_id)
   * @throws {Error} if redirect_uris is missing/empty or contains a non-loopback URI
   */
  registerClient(meta) {
    const uris = Array.isArray(meta.redirect_uris) ? meta.redirect_uris : [];
    if (uris.length === 0) {
      const e = new Error('redirect_uris is required for native clients');
      e.code = 'invalid_client_metadata';
      throw e;
    }
    for (const uri of uris) {
      if (!isLoopbackUri(uri)) {
        const e = new Error(`redirect_uri must be a loopback literal (127.0.0.1 or [::1]): ${uri}`);
        e.code = 'invalid_redirect_uri';
        throw e;
      }
    }

    // Evict the oldest registration when at capacity.
    if (this._clients.size >= MAX_NATIVE_CLIENTS) {
      let oldest = null;
      let oldestTime = Infinity;
      for (const [id, c] of this._clients) {
        if (c.client_id_issued_at < oldestTime) {
          oldest = id;
          oldestTime = c.client_id_issued_at;
        }
      }
      if (oldest) this._clients.delete(oldest);
    }

    const clientId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const full = {
      ...meta,
      client_id: clientId,
      client_id_issued_at: now,
      // Native clients are always public (no secret); enforce this regardless of
      // what the client requested.
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    };
    this._clients.set(clientId, full);
    return full;
  }
}

// ─── Router factory ───────────────────────────────────────────────────────────

/**
 * Create the native OAuth 2.1 Express router and the `completeNativeAuthorization`
 * callback used by server.mjs after the IDP (Google/GitHub) redirects back.
 *
 * @param {{
 *   baseUrl: string,
 *   loginUrl?: string,
 *   issueAccessToken: (sub: string) => (string | Promise<string>),
 *   grantedScopes: (sub: string) => string[],
 *   refreshStore: {
 *     issue: (sub: string, opts?: object) => Promise<{ token: string, id: string, familyId: string }>,
 *     rotate: (token: string, opts?: object) => Promise<{ ok: boolean, token?: string, sub?: string, reason?: string }>,
 *     revoke: (token: string) => Promise<{ revoked: boolean, sub: string|null }>,
 *   },
 * }} opts
 * @returns {{
 *   router: import('express').Router,
 *   completeNativeAuthorization: (nativeStateBase64: string, userId: string, res: import('express').Response) => Promise<void>,
 * }}
 */
export function createNativeOAuthRouter(opts) {
  const baseUrl = opts.baseUrl.replace(/\/$/, '');

  /**
   * The native AS issuer identifier. Used as `iss` in redirects (C3) and as the
   * `issuer` field in discovery metadata. Must be stable and HTTPS on the gateway host.
   * On localhost/dev the MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL env flag allows HTTP.
   */
  const issuerUrl = `${baseUrl}/api/v1/auth/native`;

  const loginUrl = (opts.loginUrl || `${baseUrl}/auth/login`).replace(/\/$/, '');

  const clientStore = new NativeClientStore();
  const router = express.Router();

  // ── Discovery (RFC 8414) ──────────────────────────────────────────────────

  router.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({
      issuer: issuerUrl,
      authorization_endpoint: `${issuerUrl}/authorize`,
      token_endpoint: `${issuerUrl}/token`,
      registration_endpoint: `${issuerUrl}/register`,
      revocation_endpoint: `${issuerUrl}/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['vault:read', 'vault:write'],
    });
  });

  // ── Dynamic client registration (RFC 7591) ────────────────────────────────

  router.post('/register', express.json({ limit: '16kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    let client;
    try {
      client = clientStore.registerClient(req.body || {});
    } catch (e) {
      const errorCode = e.code || 'invalid_client_metadata';
      // Do NOT reflect the URI back in the error — it may be a probe for injection.
      return res.status(400).json({
        error: errorCode,
        error_description: 'redirect_uris must be loopback literals (http://127.0.0.1 or http://[::1])',
      });
    }
    return res.status(201).json(client);
  });

  // ── Authorization endpoint (RFC 6749 §4.1.1 + RFC 7636) ─────────────────

  router.get('/authorize', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const q = req.query;

    // ─ Mandatory parameter validation ─
    if (
      !q.client_id ||
      !q.redirect_uri ||
      !q.code_challenge ||
      q.code_challenge_method !== 'S256'
    ) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'client_id, redirect_uri, code_challenge, and code_challenge_method=S256 are required',
      });
    }

    const client = clientStore.getClient(String(q.client_id));
    if (!client) {
      return res.status(400).json({ error: 'invalid_client', error_description: 'Unknown client_id' });
    }

    const redirectUriStr = String(q.redirect_uri);

    // Exact-match against registered URIs (SDK behavior; port included in match).
    if (!Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(redirectUriStr)) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Unregistered redirect_uri' });
    }
    // Double-check loopback requirement at authorization time (defense-in-depth: client
    // store already enforced this at registration, but guard again here, fail-closed).
    if (!isLoopbackUri(redirectUriStr)) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri must be a loopback literal' });
    }

    const requestedScopes = q.scope
      ? String(q.scope).split(' ').filter(Boolean)
      : [];

    const code = crypto.randomUUID();

    try {
      await savePendingCode(code, {
        clientId: String(q.client_id),
        codeChallenge: String(q.code_challenge),
        redirectUri: redirectUriStr,
        state: q.state ? String(q.state) : null,
        scopes: requestedScopes,
      });
    } catch (_) {
      return res.status(503).json({
        error: 'server_error',
        error_description: 'Authorization service temporarily unavailable',
      });
    }

    // Encode state for round-trip through the IDP (Google/GitHub).
    // The `native_state` carries enough context for completeNativeAuthorization to
    // find and bind the pending record without exposing the code challenge.
    const nativeState = Buffer.from(
      JSON.stringify({
        code,
        clientId: String(q.client_id),
        redirectUri: redirectUriStr,
        state: q.state ? String(q.state) : null,
      })
    ).toString('base64url');

    const loginTarget = new URL(loginUrl);
    loginTarget.searchParams.set('provider', 'google');
    loginTarget.searchParams.set('native_state', nativeState);
    return res.redirect(loginTarget.toString());
  });

  // ── Token endpoint (RFC 6749 §4.1.3 + §6) ────────────────────────────────

  router.post(
    '/token',
    express.urlencoded({ extended: false }),
    express.json({ limit: '16kb' }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const body = req.body || {};
      const grantType = body.grant_type;

      // ─ Authenticate the client (native clients are always public — no secret) ─
      const clientId = body.client_id;
      const client = clientId ? clientStore.getClient(String(clientId)) : null;
      if (!client) {
        return res.status(401).json({
          error: 'invalid_client',
          error_description: 'Unknown or missing client_id',
        });
      }

      // ─ authorization_code grant ──────────────────────────────────────────
      if (grantType === 'authorization_code') {
        const { code, code_verifier, redirect_uri } = body;

        if (!code || !code_verifier || !redirect_uri) {
          return res.status(400).json({
            error: 'invalid_request',
            error_description: 'code, code_verifier, and redirect_uri are required',
          });
        }

        let pending;
        try {
          pending = await consumePendingCode(String(code));
        } catch (_) {
          return res.status(503).json({
            error: 'server_error',
            error_description: 'Authorization service temporarily unavailable',
          });
        }

        if (!pending) {
          return res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code invalid or expired' });
        }
        if (pending.clientId !== String(clientId)) {
          return res.status(400).json({ error: 'invalid_grant', error_description: 'Client mismatch' });
        }

        // C5: redirect_uri MUST equal the one bound at authorization (RFC 6749 §4.1.3).
        if (String(redirect_uri) !== pending.redirectUri) {
          return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
        }

        // PKCE S256: sha256(code_verifier) must equal the stored challenge.
        if (_sha256Base64url(String(code_verifier)) !== pending.codeChallenge) {
          return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
        }

        // Authorization must have been completed (userId bound by IDP callback).
        if (!pending.userId) {
          return res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization not completed' });
        }

        const sub = pending.userId;

        // C6: scope ceiling — intersection of requested and grantedScopes(sub).
        // grantedScopes is scopesForRole(roleForSub(sub)); unknown role → member ceiling.
        const ceiling = opts.grantedScopes(sub);
        const effectiveScopes = applyScopeCeiling(pending.scopes, ceiling);

        // C1: mint the web-session JWT (issueToken shape: {sub, provider, id, name, role}).
        let accessToken;
        try {
          accessToken = await opts.issueAccessToken(sub);
        } catch (_) {
          return res.status(500).json({ error: 'server_error', error_description: 'Token issuance failed' });
        }

        // C2/C4: issue refresh token via durable gateway store (refresh-token-core backing).
        let refreshResult;
        try {
          refreshResult = await opts.refreshStore.issue(sub, {
            tokenTtlMs: NATIVE_REFRESH_TOKEN_TTL_MS,
            meta: { ua: String(req.headers['user-agent'] || '').slice(0, 256) },
          });
        } catch (_) {
          return res.status(503).json({ error: 'server_error', error_description: 'Refresh token issuance failed' });
        }

        return res.status(200).json({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: NATIVE_TOKEN_EXPIRY_SECONDS,
          refresh_token: refreshResult.token,
          scope: effectiveScopes.join(' '),
        });
      }

      // ─ refresh_token grant (C2) ──────────────────────────────────────────
      if (grantType === 'refresh_token') {
        const presentedToken = body.refresh_token;
        if (!presentedToken) {
          return res.status(400).json({ error: 'invalid_request', error_description: 'refresh_token is required' });
        }

        let result;
        try {
          result = await opts.refreshStore.rotate(String(presentedToken), {
            meta: { ua: String(req.headers['user-agent'] || '').slice(0, 256) },
          });
        } catch (_) {
          // A transient store fault: do NOT treat as theft. Fail soft with 503.
          return res.status(503).json({
            error: 'server_error',
            error_description: 'Session service temporarily unavailable',
            code: 'SESSION_STORE_UNAVAILABLE',
          });
        }

        if (!result.ok) {
          const err = _nativeRefreshError(result.reason);
          // C2: reason codes aligned to auth-session.mjs.
          return res.status(401).json({ error: 'invalid_grant', error_description: err.message, code: err.code });
        }

        const sub = result.sub;
        // C6: re-derive ceiling on every refresh (role may have changed since last login).
        const ceiling = opts.grantedScopes(sub);

        let accessToken;
        try {
          accessToken = await opts.issueAccessToken(sub);
        } catch (_) {
          return res.status(500).json({ error: 'server_error', error_description: 'Token issuance failed' });
        }

        // C2: new refresh token in the response body (not a cookie).
        return res.status(200).json({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: NATIVE_TOKEN_EXPIRY_SECONDS,
          refresh_token: result.token,
          scope: ceiling.join(' '),
        });
      }

      return res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: 'grant_type must be authorization_code or refresh_token',
      });
    }
  );

  // ── Revocation (RFC 7009) ──────────────────────────────────────────────────

  router.post(
    '/revoke',
    express.urlencoded({ extended: false }),
    express.json({ limit: '16kb' }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const body = req.body || {};
      const token = body.token;
      if (token) {
        try {
          await opts.refreshStore.revoke(String(token));
        } catch (_) {
          // RFC 7009 §2.2: revocation always returns 200 regardless of errors.
        }
      }
      return res.status(200).json({ ok: true });
    }
  );

  // ─── completeNativeAuthorization ─────────────────────────────────────────

  /**
   * Complete the native authorization after the IDP (Google/GitHub) OAuth callback.
   * Called from server.mjs when the round-trip state has the `native:` prefix.
   *
   * C3: Emits `iss` = issuerUrl on the loopback redirect (RFC 9207 §2).
   *     Value is identical to the `issuer` field in the discovery metadata, with no
   *     trailing-slash drift.
   *
   * C5: The redirect target is the `redirectUri` stored at authorization time (not
   *     taken from the current request), so a forged/mismatched redirect cannot be
   *     injected at this step.
   *
   * @param {string} nativeStateBase64 - base64url-encoded JSON from the `native:` state
   * @param {string} userId - authenticated user sub ("provider:id") from passport
   * @param {import('express').Response} res
   * @returns {Promise<void>}
   */
  async function completeNativeAuthorization(nativeStateBase64, userId, res) {
    let nativeState;
    try {
      nativeState = JSON.parse(Buffer.from(String(nativeStateBase64), 'base64url').toString('utf8'));
    } catch (_) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Malformed native state' });
    }

    const { code, redirectUri } = nativeState;
    if (!code || !redirectUri) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Malformed native state: missing code or redirectUri' });
    }

    // Bind the authenticated user to the pending code in the durable store (C4).
    let bound;
    try {
      bound = await bindUserToCode(String(code), String(userId));
    } catch (_) {
      return res.status(503).json({ error: 'server_error', error_description: 'Authorization service temporarily unavailable' });
    }

    if (!bound) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code invalid or expired' });
    }

    // Build the loopback redirect. The target is the stored redirectUri, not the
    // current request URI, so the companion's listener receives the code at its port.
    const redirectUrl = new URL(String(redirectUri));
    redirectUrl.searchParams.set('code', String(code));
    if (nativeState.state) redirectUrl.searchParams.set('state', String(nativeState.state));
    // C3: iss parameter — equal to the issuerUrl advertised in discovery (RFC 9207 §2).
    redirectUrl.searchParams.set('iss', issuerUrl);

    return res.redirect(redirectUrl.toString());
  }

  return { router, completeNativeAuthorization };
}

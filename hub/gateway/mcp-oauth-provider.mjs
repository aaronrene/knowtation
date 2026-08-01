/**
 * Issue #1 Phase D3 — OAuth 2.1 provider for hosted MCP.
 * Implements OAuthServerProvider from @modelcontextprotocol/sdk.
 * Reuses the Hub's existing Google/GitHub OAuth flow and wraps it with MCP-standard
 * PKCE + dynamic client registration.
 *
 * Phase A (durable agent auth): refresh tokens are persisted via the shared
 * `createGatewayRefreshStore({ consistency: 'strong' })` / `refresh-token-core`
 * (hash-at-rest, rotation, reuse→family revoke). Do not use an in-memory Map.
 *
 * C3 (docs/COMPANION-APP-OAUTH-SERVERSIDE-GATE.md §6): emits `iss` = canonical issuer
 *    identifier on the loopback redirect in completeMcpAuthorization (RFC 9207 §2).
 * C5: validates redirect_uri at token exchange when provided (RFC 6749 §4.1.3).
 */

import { randomUUID, createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { verifyJwtWithSecretRotation } from '../lib/session-secret-rotation.mjs';
import {
  DEFAULT_TOKEN_TTL_MS,
  DEFAULT_FAMILY_TTL_MS,
  REFRESH_FAILURE,
} from '../lib/refresh-token-core.mjs';

const MCP_TOKEN_EXPIRY_SECONDS = 3600;
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const MAX_CLIENTS = 500;
const MAX_PENDING_CODES = 1000;

function sha256(s) {
  return createHash('sha256').update(s).digest('base64url');
}

/**
 * In-memory client registration store for dynamic MCP client registration.
 * Production should move to a persistent store.
 */
class InMemoryClientsStore {
  constructor() {
    /** @type {Map<string, object>} */
    this._clients = new Map();
  }

  getClient(clientId) {
    return this._clients.get(clientId);
  }

  registerClient(clientInfo) {
    if (this._clients.size >= MAX_CLIENTS) {
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

    const clientId = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const full = {
      ...clientInfo,
      client_id: clientId,
      client_id_issued_at: now,
    };
    this._clients.set(clientId, full);
    return full;
  }
}

/**
 * Build agent label for refresh-record meta (multi-Hermes revoke list).
 * Prefer explicit option, then dynamic client_name, then client_id.
 * @param {object} client
 * @param {string} [explicit]
 * @returns {string}
 */
export function resolveMcpAgentLabel(client, explicit) {
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim().slice(0, 128);
  const name = client && typeof client.client_name === 'string' ? client.client_name.trim() : '';
  if (name) return name.slice(0, 128);
  return String(client?.client_id || 'mcp-client').slice(0, 128);
}

/**
 * Map refresh-token-core failure reasons to Error messages (no secrets).
 * @param {string} reason
 * @returns {Error}
 */
function refreshFailureError(reason) {
  switch (reason) {
    case REFRESH_FAILURE.REUSE:
      return new Error('Refresh token reuse detected');
    case REFRESH_FAILURE.REVOKED:
      return new Error('Refresh token revoked');
    case REFRESH_FAILURE.EXPIRED:
      return new Error('Refresh token expired');
    default:
      return new Error('Unknown refresh token');
  }
}

/**
 * Knowtation OAuth provider that bridges the Hub's existing auth
 * with the MCP SDK's OAuth 2.1 expectations.
 */
export class KnowtationOAuthProvider {
  /**
   * @param {{
   *   sessionSecret: string,
   *   sessionSecretPrevious?: string|null,
   *   baseUrl: string,
   *   loginUrl?: string,
   *   refreshStore: {
   *     issue: Function,
   *     rotate: Function,
   *     revoke: Function,
   *     peek?: Function,
   *   },
   *   agentLabel?: string,
   * }} opts
   */
  constructor(opts) {
    if (!opts?.refreshStore?.issue || !opts?.refreshStore?.rotate || !opts?.refreshStore?.revoke) {
      throw new Error('KnowtationOAuthProvider requires refreshStore { issue, rotate, revoke }');
    }
    this._sessionSecret = opts.sessionSecret;
    // SEC-KN-P6-ROTATE: verify-only during rotation; signing stays on _sessionSecret.
    this._sessionSecretPrevious = opts.sessionSecretPrevious || null;
    this._baseUrl = opts.baseUrl.replace(/\/$/, '');
    // C3: canonical issuer identifier — matches the `issuer.href` the mcpAuthRouter
    // advertises in discovery metadata (new URL(BASE_URL).href).  URL normalises
    // bare-host URLs by appending a trailing slash, so we preserve that here.
    this._issuerUrl = new URL(this._baseUrl).href;
    this._loginUrl = opts.loginUrl || `${this._baseUrl}/auth/login`;
    this._clientStore = new InMemoryClientsStore();
    this._refreshStore = opts.refreshStore;
    this._defaultAgentLabel = typeof opts.agentLabel === 'string' ? opts.agentLabel : undefined;
    /** @type {Map<string, { clientId: string, codeChallenge: string, redirectUri: string, state?: string, scopes: string[], userId?: string, expires: number }>} */
    this._pendingCodes = new Map();
  }

  get clientsStore() {
    return this._clientStore;
  }

  /**
   * Start the authorization flow by redirecting to the Hub's login page.
   * The Hub login callback will need to handle the MCP state and call back to completeMcpAuthorization.
   */
  async authorize(client, params, res) {
    const code = randomUUID();
    this._pendingCodes.set(code, {
      clientId: client.client_id,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      state: params.state,
      scopes: params.scopes || [],
      expires: Date.now() + AUTH_CODE_TTL_MS,
    });

    this._pruneExpiredCodes();

    const mcpState = Buffer.from(JSON.stringify({
      code,
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      state: params.state,
    })).toString('base64url');

    const loginUrl = new URL(this._loginUrl);
    loginUrl.searchParams.set('provider', 'google');
    loginUrl.searchParams.set('mcp_state', mcpState);
    res.redirect(loginUrl.toString());
  }

  /**
   * Called after Hub OAuth callback succeeds.
   * Binds the auth code to the authenticated user and redirects back to the MCP client.
   *
   * @param {string} mcpStateBase64 - The mcp_state parameter from the login callback
   * @param {string} userId - The authenticated user's ID
   * @param {import('express').Response} res
   */
  completeMcpAuthorization(mcpStateBase64, userId, res) {
    let mcpState;
    try {
      mcpState = JSON.parse(Buffer.from(mcpStateBase64, 'base64url').toString());
    } catch (_) {
      res.status(400).json({ error: 'invalid_mcp_state' });
      return;
    }

    const pending = this._pendingCodes.get(mcpState.code);
    if (!pending || pending.clientId !== mcpState.clientId || Date.now() > pending.expires) {
      res.status(400).json({ error: 'invalid_or_expired_code' });
      return;
    }

    pending.userId = userId;

    const redirectUrl = new URL(mcpState.redirectUri);
    redirectUrl.searchParams.set('code', mcpState.code);
    if (mcpState.state) redirectUrl.searchParams.set('state', mcpState.state);
    // C3 (RFC 9207 §2): emit iss = canonical issuer identifier so clients that pass
    // expectedIssuer get constant-time mix-up defense with no client-side change.
    // Value exactly equals the `issuer` field in the discovery metadata.
    redirectUrl.searchParams.set('iss', this._issuerUrl);
    res.redirect(redirectUrl.toString());
  }

  async challengeForAuthorizationCode(_client, authorizationCode) {
    const pending = this._pendingCodes.get(authorizationCode);
    if (!pending) throw new Error('Unknown authorization code');
    return pending.codeChallenge;
  }

  async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri, _resource) {
    const pending = this._pendingCodes.get(authorizationCode);
    if (!pending) throw new Error('Unknown authorization code');
    if (pending.clientId !== client.client_id) throw new Error('Client mismatch');
    if (Date.now() > pending.expires) {
      this._pendingCodes.delete(authorizationCode);
      throw new Error('Authorization code expired');
    }
    if (!pending.userId) throw new Error('Authorization not completed');
    // C5 (RFC 6749 §4.1.3): when redirect_uri is provided in the token request it MUST
    // exactly equal the one bound at authorization. Absent when the SDK omits it for
    // clients that did not include it in the auth request (tolerated for back-compat).
    if (redirectUri !== undefined && redirectUri !== pending.redirectUri) {
      throw new Error('redirect_uri mismatch');
    }

    this._pendingCodes.delete(authorizationCode);

    const scopes = pending.scopes.length > 0 ? pending.scopes : ['vault:read'];
    const accessToken = jwt.sign(
      {
        sub: pending.userId,
        client_id: client.client_id,
        scopes,
        type: 'mcp_access',
      },
      this._sessionSecret,
      { expiresIn: MCP_TOKEN_EXPIRY_SECONDS }
    );

    const agent = resolveMcpAgentLabel(client, this._defaultAgentLabel);
    let refreshResult;
    try {
      refreshResult = await this._refreshStore.issue(pending.userId, {
        tokenTtlMs: DEFAULT_TOKEN_TTL_MS,
        familyTtlMs: DEFAULT_FAMILY_TTL_MS,
        meta: {
          agent,
          client_id: client.client_id,
          scopes: scopes.join(' '),
        },
      });
    } catch (_) {
      throw new Error('Refresh token issuance failed');
    }

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: MCP_TOKEN_EXPIRY_SECONDS,
      refresh_token: refreshResult.token,
      scope: scopes.join(' '),
    };
  }

  async exchangeRefreshToken(client, refreshToken, scopes, _resource) {
    if (typeof this._refreshStore.peek === 'function') {
      const peeked = await this._refreshStore.peek(refreshToken);
      if (!peeked) throw new Error('Unknown refresh token');
      if (peeked.meta?.client_id && peeked.meta.client_id !== client.client_id) {
        throw new Error('Client mismatch');
      }
      if (peeked.revoked) throw refreshFailureError(REFRESH_FAILURE.REVOKED);
    }

    let result;
    try {
      result = await this._refreshStore.rotate(String(refreshToken), {});
    } catch (_) {
      throw new Error('Refresh token rotation failed');
    }

    if (!result.ok) {
      throw refreshFailureError(result.reason);
    }

    const meta = result.meta || {};
    if (meta.client_id && meta.client_id !== client.client_id) {
      // Should be unreachable after peek; fail closed without leaking.
      throw new Error('Client mismatch');
    }

    const storedScopes = typeof meta.scopes === 'string' && meta.scopes.trim()
      ? meta.scopes.trim().split(/\s+/).filter(Boolean)
      : ['vault:read'];

    const effectiveScopes = scopes && scopes.length > 0
      ? scopes.filter((s) => storedScopes.includes(s))
      : storedScopes;

    const accessToken = jwt.sign(
      {
        sub: result.sub,
        client_id: client.client_id,
        scopes: effectiveScopes,
        type: 'mcp_access',
      },
      this._sessionSecret,
      { expiresIn: MCP_TOKEN_EXPIRY_SECONDS }
    );

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: MCP_TOKEN_EXPIRY_SECONDS,
      refresh_token: result.token,
      scope: effectiveScopes.join(' '),
    };
  }

  async verifyAccessToken(token) {
    try {
      const payload = verifyJwtWithSecretRotation(token, this._sessionSecret, this._sessionSecretPrevious);
      if (!payload) throw new Error('signature verification failed');
      if (payload.type !== 'mcp_access') throw new Error('Not an MCP access token');
      return {
        token,
        clientId: payload.client_id,
        scopes: payload.scopes || [],
        expiresAt: payload.exp,
        extra: { sub: payload.sub },
      };
    } catch (e) {
      throw new Error(`Invalid access token: ${e.message}`);
    }
  }

  async revokeToken(client, request) {
    const token = request.token;
    if (!token) return;
    if (typeof this._refreshStore.peek === 'function') {
      const peeked = await this._refreshStore.peek(token);
      if (peeked?.meta?.client_id && peeked.meta.client_id !== client.client_id) {
        return;
      }
    }
    try {
      await this._refreshStore.revoke(String(token));
    } catch (_) {
      // RFC 7009: revocation is best-effort.
    }
  }

  _pruneExpiredCodes() {
    if (this._pendingCodes.size <= MAX_PENDING_CODES) return;
    const now = Date.now();
    for (const [code, pending] of this._pendingCodes) {
      if (now > pending.expires) this._pendingCodes.delete(code);
    }
  }

  destroy() {
    // No timers; durable store owns persistence.
  }
}

// Re-export for tests that assert TTL alignment.
export { MCP_TOKEN_EXPIRY_SECONDS, DEFAULT_TOKEN_TTL_MS, DEFAULT_FAMILY_TTL_MS, sha256 };

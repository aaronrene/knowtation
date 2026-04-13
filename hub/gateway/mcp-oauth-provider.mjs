/**
 * Issue #1 Phase D3 — OAuth 2.1 provider for hosted MCP.
 * Implements OAuthServerProvider from @modelcontextprotocol/sdk.
 * Reuses the Hub's existing Google/GitHub OAuth flow and wraps it with MCP-standard
 * PKCE + dynamic client registration.
 */

import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';

const MCP_TOKEN_EXPIRY_SECONDS = 3600;
const MCP_REFRESH_TOKEN_EXPIRY_SECONDS = 86400;
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const MAX_CLIENTS = 500;
const MAX_PENDING_CODES = 1000;
const REFRESH_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

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
 * Knowtation OAuth provider that bridges the Hub's existing auth
 * with the MCP SDK's OAuth 2.1 expectations.
 */
export class KnowtationOAuthProvider {
  /**
   * @param {{
   *   sessionSecret: string,
   *   baseUrl: string,
   *   loginUrl?: string,
   * }} opts
   */
  constructor(opts) {
    this._sessionSecret = opts.sessionSecret;
    this._baseUrl = opts.baseUrl.replace(/\/$/, '');
    this._loginUrl = opts.loginUrl || `${this._baseUrl}/auth/login`;
    this._clientStore = new InMemoryClientsStore();
    /** @type {Map<string, { clientId: string, codeChallenge: string, redirectUri: string, state?: string, scopes: string[], userId?: string, expires: number }>} */
    this._pendingCodes = new Map();
    /** @type {Map<string, { clientId: string, userId: string, scopes: string[], expires: number }>} */
    this._refreshTokens = new Map();

    this._sweepTimer = setInterval(() => this._sweepExpiredRefreshTokens(), REFRESH_SWEEP_INTERVAL_MS);
    if (this._sweepTimer.unref) this._sweepTimer.unref();
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
    res.redirect(redirectUrl.toString());
  }

  async challengeForAuthorizationCode(_client, authorizationCode) {
    const pending = this._pendingCodes.get(authorizationCode);
    if (!pending) throw new Error('Unknown authorization code');
    return pending.codeChallenge;
  }

  async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, _redirectUri, _resource) {
    const pending = this._pendingCodes.get(authorizationCode);
    if (!pending) throw new Error('Unknown authorization code');
    if (pending.clientId !== client.client_id) throw new Error('Client mismatch');
    if (Date.now() > pending.expires) {
      this._pendingCodes.delete(authorizationCode);
      throw new Error('Authorization code expired');
    }
    if (!pending.userId) throw new Error('Authorization not completed');

    this._pendingCodes.delete(authorizationCode);

    const scopes = pending.scopes.length > 0 ? pending.scopes : ['vault:read'];
    const now = Math.floor(Date.now() / 1000);
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

    const refreshToken = randomUUID();
    this._refreshTokens.set(refreshToken, {
      clientId: client.client_id,
      userId: pending.userId,
      scopes,
      expires: now + MCP_REFRESH_TOKEN_EXPIRY_SECONDS,
    });

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: MCP_TOKEN_EXPIRY_SECONDS,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    };
  }

  async exchangeRefreshToken(client, refreshToken, scopes, _resource) {
    const stored = this._refreshTokens.get(refreshToken);
    if (!stored) throw new Error('Unknown refresh token');
    if (stored.clientId !== client.client_id) throw new Error('Client mismatch');
    if (Math.floor(Date.now() / 1000) > stored.expires) {
      this._refreshTokens.delete(refreshToken);
      throw new Error('Refresh token expired');
    }

    this._refreshTokens.delete(refreshToken);

    const effectiveScopes = scopes && scopes.length > 0
      ? scopes.filter((s) => stored.scopes.includes(s))
      : stored.scopes;

    const accessToken = jwt.sign(
      {
        sub: stored.userId,
        client_id: client.client_id,
        scopes: effectiveScopes,
        type: 'mcp_access',
      },
      this._sessionSecret,
      { expiresIn: MCP_TOKEN_EXPIRY_SECONDS }
    );

    const newRefreshToken = randomUUID();
    this._refreshTokens.set(newRefreshToken, {
      clientId: client.client_id,
      userId: stored.userId,
      scopes: effectiveScopes,
      expires: Math.floor(Date.now() / 1000) + MCP_REFRESH_TOKEN_EXPIRY_SECONDS,
    });

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: MCP_TOKEN_EXPIRY_SECONDS,
      refresh_token: newRefreshToken,
      scope: effectiveScopes.join(' '),
    };
  }

  async verifyAccessToken(token) {
    try {
      const payload = jwt.verify(token, this._sessionSecret);
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
    if (this._refreshTokens.has(token)) {
      const stored = this._refreshTokens.get(token);
      if (stored.clientId === client.client_id) {
        this._refreshTokens.delete(token);
      }
    }
  }

  _pruneExpiredCodes() {
    if (this._pendingCodes.size <= MAX_PENDING_CODES) return;
    const now = Date.now();
    for (const [code, pending] of this._pendingCodes) {
      if (now > pending.expires) this._pendingCodes.delete(code);
    }
  }

  _sweepExpiredRefreshTokens() {
    const nowSec = Math.floor(Date.now() / 1000);
    for (const [token, stored] of this._refreshTokens) {
      if (nowSec > stored.expires) this._refreshTokens.delete(token);
    }
  }

  destroy() {
    if (this._sweepTimer) {
      clearInterval(this._sweepTimer);
      this._sweepTimer = null;
    }
  }
}

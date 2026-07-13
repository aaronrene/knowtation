/**
 * RFC 8628 device authorization for Hub “Connect cloud agent” (Phase B).
 *
 * Endpoints (mounted at /api/v1/auth/device):
 *   GET  /.well-known/oauth-authorization-server  discovery
 *   POST /authorize                               device authorization request
 *   POST /token                                   poll device_code → mcp_access + refresh
 *   POST /approve                                 Hub UI: bind authenticated user to user_code
 *   POST /deny                                    Hub UI: deny pending user_code
 *   GET  /pending                                 Hub UI: list pending (no secrets)
 *   POST /revoke                                  revoke a refresh token (agent credential)
 *   GET  /setup-pack                              non-secret cloud-agent setup instructions
 *
 * Security:
 *   - Device codes hashed at rest; refresh via createGatewayRefreshStore({ consistency: 'strong' })
 *   - Access tokens are mcp_access JWTs (same shape as MCP OAuth Phase A)
 *   - Approve/deny require authenticated Hub session (getUserId)
 *   - Poll rate limited via slow_down; user_code brute-force limited
 *   - Never log device_code, refresh_token, or access_token
 */

import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import {
  createDeviceAuthorization,
  approveUserCode,
  denyUserCode,
  pollDeviceCode,
  listPendingForDisplay,
  pruneExpiredDeviceCodes,
  normalizeUserCode,
  DEVICE_CODE_TTL_MS,
  DEVICE_POLL_INTERVAL_SEC,
} from './device-oauth-store.mjs';
import {
  DEFAULT_TOKEN_TTL_MS,
  DEFAULT_FAMILY_TTL_MS,
} from '../lib/refresh-token-core.mjs';

const MCP_TOKEN_EXPIRY_SECONDS = 3600;
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

/** In-memory rate limit for approve attempts by IP (user_code brute-force). */
const _approveAttempts = new Map();
const APPROVE_WINDOW_MS = 15 * 60 * 1000;
const APPROVE_MAX_ATTEMPTS = 20;

/**
 * @param {string} key
 * @returns {boolean} true if allowed
 */
function _allowApproveAttempt(key) {
  const now = Date.now();
  let bucket = _approveAttempts.get(key);
  if (!bucket || now - bucket.start > APPROVE_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    _approveAttempts.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= APPROVE_MAX_ATTEMPTS;
}

/**
 * Apply scope ceiling (never exceed role scopes).
 * @param {string[]} requested
 * @param {string[]} ceiling
 * @returns {string[]}
 */
export function applyDeviceScopeCeiling(requested, ceiling) {
  if (!Array.isArray(ceiling) || ceiling.length === 0) return ['vault:read'];
  if (!Array.isArray(requested) || requested.length === 0) return [...ceiling];
  return requested.filter((s) => ceiling.includes(s));
}

/**
 * Create the device OAuth Express router.
 *
 * @param {{
 *   baseUrl: string,
 *   sessionSecret: string,
 *   refreshStore: { issue: Function, rotate: Function, revoke: Function, peek?: Function },
 *   getUserId: (req: import('express').Request) => string | null,
 *   grantedScopes: (sub: string) => string[],
 *   hubVerificationPath?: string,
 * }} opts
 */
export function createDeviceOAuthRouter(opts) {
  const {
    baseUrl,
    sessionSecret,
    refreshStore,
    getUserId,
    grantedScopes,
    hubVerificationPath = '/hub/#settings/integrations',
  } = opts;

  if (!sessionSecret || typeof sessionSecret !== 'string') {
    throw new Error('createDeviceOAuthRouter requires sessionSecret');
  }
  if (!refreshStore || typeof refreshStore.issue !== 'function') {
    throw new Error('createDeviceOAuthRouter requires refreshStore');
  }
  if (typeof getUserId !== 'function') {
    throw new Error('createDeviceOAuthRouter requires getUserId');
  }
  if (typeof grantedScopes !== 'function') {
    throw new Error('createDeviceOAuthRouter requires grantedScopes');
  }

  const issuer = `${String(baseUrl).replace(/\/$/, '')}/api/v1/auth/device`;
  const verificationUri = `${String(baseUrl).replace(/\/$/, '')}${hubVerificationPath}`;
  const router = express.Router();
  router.use(express.json({ limit: '32kb' }));
  router.use(express.urlencoded({ extended: false, limit: '32kb' }));

  // RFC 8414 discovery (device grant advertised)
  router.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json({
      issuer,
      device_authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      revocation_endpoint: `${issuer}/revoke`,
      grant_types_supported: [DEVICE_GRANT_TYPE, 'refresh_token'],
      response_types_supported: ['none'],
      scopes_supported: ['vault:read', 'vault:write'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: [],
    });
  });

  /**
   * POST /authorize — agent starts device flow (no user auth required).
   * Body (JSON or form): client_id?, client_name?, scope?
   */
  router.post('/authorize', async (req, res) => {
    try {
      const clientId = String(req.body?.client_id || req.body?.clientId || 'cloud-agent').slice(0, 128);
      const clientName = String(req.body?.client_name || req.body?.clientName || 'Cloud agent').slice(0, 128);
      const scopeRaw = req.body?.scope || req.body?.scopes || 'vault:read vault:write';
      const scopes = String(scopeRaw).trim().split(/\s+/).filter(Boolean).slice(0, 16);
      const created = await createDeviceAuthorization({
        clientId,
        clientName,
        scopes,
      });
      const verificationUriComplete = `${verificationUri}${verificationUri.includes('?') || verificationUri.includes('#') ? '&' : '?'}user_code=${encodeURIComponent(created.userCode)}`;
      res.status(200).json({
        device_code: created.deviceCode,
        user_code: created.userCode,
        verification_uri: verificationUri,
        verification_uri_complete: verificationUriComplete,
        expires_in: created.expiresIn,
        interval: created.interval,
      });
    } catch (_) {
      res.status(500).json({ error: 'server_error', error_description: 'Could not start device authorization' });
    }
  });

  /**
   * POST /token — poll with device_code, or refresh_token grant.
   */
  router.post('/token', async (req, res) => {
    try {
      const grantType = String(req.body?.grant_type || '');
      if (grantType === 'refresh_token') {
        return await _handleRefresh(req, res);
      }
      if (grantType !== DEVICE_GRANT_TYPE) {
        return res.status(400).json({
          error: 'unsupported_grant_type',
          error_description: 'Supported: device_code and refresh_token',
        });
      }
      const deviceCode = String(req.body?.device_code || '');
      const poll = await pollDeviceCode(deviceCode);
      if (poll.status === 'authorization_pending') {
        return res.status(400).json({ error: 'authorization_pending' });
      }
      if (poll.status === 'slow_down') {
        return res.status(400).json({
          error: 'slow_down',
          interval: DEVICE_POLL_INTERVAL_SEC + 5,
        });
      }
      if (poll.status === 'access_denied') {
        return res.status(400).json({ error: 'access_denied' });
      }
      if (poll.status === 'expired_token') {
        return res.status(400).json({ error: 'expired_token' });
      }
      if (poll.status !== 'approved' || !poll.entry?.userId) {
        return res.status(400).json({ error: 'invalid_grant' });
      }

      const ceiling = grantedScopes(poll.entry.userId);
      const scopes = applyDeviceScopeCeiling(poll.entry.scopes || [], ceiling);
      const accessToken = jwt.sign(
        {
          sub: poll.entry.userId,
          client_id: poll.entry.clientId,
          scopes,
          type: 'mcp_access',
        },
        sessionSecret,
        { expiresIn: MCP_TOKEN_EXPIRY_SECONDS }
      );

      let refreshResult;
      try {
        refreshResult = await refreshStore.issue(poll.entry.userId, {
          tokenTtlMs: DEFAULT_TOKEN_TTL_MS,
          familyTtlMs: DEFAULT_FAMILY_TTL_MS,
          meta: {
            agent: String(poll.entry.clientName || 'cloud-agent').slice(0, 64),
            client_id: poll.entry.clientId,
            scopes: scopes.join(' '),
          },
        });
      } catch (_) {
        return res.status(500).json({ error: 'server_error' });
      }

      return res.status(200).json({
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: MCP_TOKEN_EXPIRY_SECONDS,
        refresh_token: refreshResult.token,
        scope: scopes.join(' '),
      });
    } catch (_) {
      return res.status(500).json({ error: 'server_error' });
    }
  });

  async function _handleRefresh(req, res) {
    const refreshToken = String(req.body?.refresh_token || '');
    if (!refreshToken) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    let result;
    try {
      result = await refreshStore.rotate(refreshToken, {});
    } catch (_) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
    if (!result.ok) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
    const meta = result.meta || {};
    const storedScopes = typeof meta.scopes === 'string' && meta.scopes.trim()
      ? meta.scopes.trim().split(/\s+/).filter(Boolean)
      : ['vault:read'];
    const ceiling = grantedScopes(result.sub);
    const scopes = applyDeviceScopeCeiling(storedScopes, ceiling);
    const accessToken = jwt.sign(
      {
        sub: result.sub,
        client_id: meta.client_id || 'cloud-agent',
        scopes,
        type: 'mcp_access',
      },
      sessionSecret,
      { expiresIn: MCP_TOKEN_EXPIRY_SECONDS }
    );
    return res.status(200).json({
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: MCP_TOKEN_EXPIRY_SECONDS,
      refresh_token: result.token,
      scope: scopes.join(' '),
    });
  }

  /**
   * POST /approve — Hub user enters user_code while signed in.
   */
  router.post('/approve', async (req, res) => {
    const sub = getUserId(req);
    if (!sub) return res.status(401).json({ error: 'unauthorized' });
    const ip = String(req.ip || req.headers['x-forwarded-for'] || 'unknown').slice(0, 64);
    if (!_allowApproveAttempt(`${sub}:${ip}`)) {
      return res.status(429).json({ error: 'rate_limited', error_description: 'Too many approval attempts' });
    }
    const userCode = normalizeUserCode(req.body?.user_code || req.body?.userCode || '');
    if (!userCode) return res.status(400).json({ error: 'invalid_request', error_description: 'user_code required' });
    const vaultId = req.body?.vault_id || req.body?.vaultId || null;
    const result = await approveUserCode(userCode, sub, { vaultId });
    if (!result.ok) {
      const status = result.reason === 'not_found' || result.reason === 'expired' ? 404 : 400;
      return res.status(status).json({ error: result.reason });
    }
    return res.status(200).json({
      ok: true,
      user_code: result.entry.userCode,
      client_name: result.entry.clientName,
      scopes: result.entry.scopes,
    });
  });

  /**
   * POST /deny
   */
  router.post('/deny', async (req, res) => {
    const sub = getUserId(req);
    if (!sub) return res.status(401).json({ error: 'unauthorized' });
    const userCode = normalizeUserCode(req.body?.user_code || req.body?.userCode || '');
    if (!userCode) return res.status(400).json({ error: 'invalid_request' });
    const result = await denyUserCode(userCode, sub);
    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : 400;
      return res.status(status).json({ error: result.reason });
    }
    return res.status(200).json({ ok: true });
  });

  /**
   * GET /pending — list pending codes for Hub (user_code only, no device_code).
   */
  router.get('/pending', async (req, res) => {
    const sub = getUserId(req);
    if (!sub) return res.status(401).json({ error: 'unauthorized' });
    const pending = await listPendingForDisplay();
    return res.status(200).json({ pending });
  });

  /**
   * POST /revoke — revoke a refresh token (agent presents it, or Hub with body).
   */
  router.post('/revoke', async (req, res) => {
    const token = String(req.body?.token || req.body?.refresh_token || '');
    if (!token) return res.status(200).json({ ok: true }); // RFC 7009: always succeed shape
    try {
      await refreshStore.revoke(token);
    } catch (_) {
      /* best effort */
    }
    return res.status(200).json({ ok: true });
  });

  /**
   * GET /setup-pack — non-secret instructions for cloud agents (Hermes / Hostinger interim).
   */
  router.get('/setup-pack', (_req, res) => {
    res.json({
      title: 'Knowtation cloud agent setup pack',
      secrets: false,
      mcp_url: 'https://mcp.knowtation.store/mcp',
      device_authorize_url: `${issuer}/authorize`,
      device_token_url: `${issuer}/token`,
      verification_uri: verificationUri,
      interim_mcp_remote: {
        summary: 'Desktop OAuth via mcp-remote, copy token folder to agent host, Hermes stdio mcp-remote',
        docs: 'docs/AGENT-INTEGRATION.md#always-on-cloud-agents',
        steps: [
          'On a laptop with a browser: npx -y mcp-remote https://mcp.knowtation.store/mcp',
          'Complete OAuth; tokens land under ~/.mcp-auth/mcp-remote-*/',
          'Pack: tar czf mcp-auth-knowtation.tgz -C ~ .mcp-auth/mcp-remote-<version>',
          'Upload tarball to the agent host HOME (e.g. /data), extract to .mcp-auth/',
          'Hermes config: command npx, args [-y, mcp-remote, https://mcp.knowtation.store/mcp] — no JWT headers',
          'Restart Hermes; verify tools list (expect ~23 hosted tools)',
        ],
      },
      do_not: [
        'Do not put Hub Copy session JWT into always-on server .env',
        'Do not use api.knowtation.store/mcp or Netlify /mcp for MCP',
        'Do not paste token JSON into Telegram or chat logs',
      ],
      phase_b: {
        status: 'available',
        grant_type: DEVICE_GRANT_TYPE,
        note: 'Prefer device authorization when the agent can poll /token; Hub Settings → Integrations → Connect cloud agent to approve user_code',
      },
    });
  });

  // Opportunistic prune on router creation (fire-and-forget).
  pruneExpiredDeviceCodes().catch(() => {});

  return { router, issuer, verificationUri };
}

export { DEVICE_GRANT_TYPE, MCP_TOKEN_EXPIRY_SECONDS, DEVICE_CODE_TTL_MS };

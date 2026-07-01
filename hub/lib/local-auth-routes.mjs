/**
 * Phase 8 P1b-b — local login + bootstrap HTTP routes (§6.1, §6.2).
 */

import express from 'express';
import {
  authenticateLocalUser,
  credentialStoreHasAdmin,
  hasAnyCredential,
} from './local-auth.mjs';
import { consumeSetupToken } from './local-auth-bootstrap.mjs';
import { appendLocalAuthAudit, requestAuditMeta } from './local-auth-audit.mjs';
import { validatePassphraseStrength } from './breached-passwords.mjs';

/**
 * Register offline-locked local auth routes on an Express app.
 * @param {import('express').Express} app
 * @param {{
 *   dataDir: string,
 *   sessionSecret: string,
 *   jwtExpiry: string,
 *   offlineLockedActive: boolean,
 *   adminUserIdsSet?: Set<string>,
 *   issueRefreshCookie?: (res: import('express').Response, req: import('express').Request, sub: string) => Promise<void>,
 *   basePath?: string,
 * }} opts
 */
export function registerLocalAuthRoutes(app, opts) {
  const {
    dataDir,
    sessionSecret,
    jwtExpiry,
    offlineLockedActive,
    adminUserIdsSet = new Set(),
    issueRefreshCookie,
    basePath = '/api/v1/auth/local',
  } = opts;

  if (!offlineLockedActive) return;

  app.post(`${basePath}/login`, express.json(), async (req, res) => {
    const { username, passphrase } = req.body || {};
    const { ip, ua } = requestAuditMeta(req);

    if (!username || !passphrase) {
      return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    }

    if (!credentialStoreHasAdmin(dataDir)) {
      return res.status(503).json({
        error: 'Offline-locked not bootstrapped',
        code: 'OFFLINE_LOCKED_NOT_BOOTSTRAPPED',
      });
    }

    const result = await authenticateLocalUser(dataDir, username, passphrase, {
      sessionSecret,
      jwtExpiry,
      offlineLockedActive,
      adminUserIdsSet,
    });

    if (!result.ok) {
      if (result.code === 'RATE_LIMITED') {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          code: 'RATE_LIMITED',
          retryAfterSeconds: result.retryAfterSeconds || 60,
        });
      }
      if (result.code === 'ACCOUNT_LOCKED') {
        appendLocalAuthAudit(dataDir, 'local_auth.account_locked', {
          username_attempted: username,
          ip,
          ts: new Date().toISOString(),
          lockedUntil: new Date(Date.now() + (result.retryAfterSeconds || 900) * 1000).toISOString(),
        });
        return res.status(401).json({
          error: 'Account locked',
          code: 'ACCOUNT_LOCKED',
          retryAfterSeconds: result.retryAfterSeconds || 900,
        });
      }
      if (result.code === 'OFFLINE_LOCKED_NOT_BOOTSTRAPPED') {
        return res.status(503).json({
          error: 'Offline-locked not bootstrapped',
          code: 'OFFLINE_LOCKED_NOT_BOOTSTRAPPED',
        });
      }
      appendLocalAuthAudit(dataDir, 'local_auth.login_failure', {
        username_attempted: username,
        ip,
        ua,
        ts: new Date().toISOString(),
        reason: 'invalid_credentials',
      });
      return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    }

    appendLocalAuthAudit(dataDir, 'local_auth.login_success', {
      sub: result.sub,
      username: result.credential.username,
      ip,
      ua,
      ts: new Date().toISOString(),
    });

    if (issueRefreshCookie) {
      try {
        await issueRefreshCookie(res, req, result.sub);
      } catch (_) {
        /* refresh cookie failure must not block login */
      }
    }

    return res.json({ token: result.token, expiresIn: jwtExpiry });
  });

  app.post(`${basePath}/bootstrap`, express.json(), async (req, res) => {
    const { setupToken, username, passphrase } = req.body || {};
    const { ip } = requestAuditMeta(req);

    if (credentialStoreHasAdmin(dataDir)) {
      return res.status(409).json({ error: 'Already bootstrapped', code: 'ALREADY_BOOTSTRAPPED' });
    }

    const strength = validatePassphraseStrength(passphrase || '');
    if (!strength.ok) {
      return res.status(400).json({ error: 'Passphrase too weak', code: 'WEAK_PASSPHRASE' });
    }

    const result = await consumeSetupToken(dataDir, setupToken, username, passphrase, { ip });
    if (!result.ok) {
      if (result.code === 'ALREADY_BOOTSTRAPPED') {
        return res.status(409).json({ error: 'Already bootstrapped', code: 'ALREADY_BOOTSTRAPPED' });
      }
      if (result.code === 'BOOTSTRAP_TOKEN_CONSUMED') {
        return res.status(410).json({ error: 'Bootstrap token consumed', code: 'BOOTSTRAP_TOKEN_CONSUMED' });
      }
      if (result.code === 'BOOTSTRAP_TOKEN_EXPIRED') {
        return res.status(410).json({ error: 'Bootstrap token expired', code: 'BOOTSTRAP_TOKEN_EXPIRED' });
      }
      if (result.code === 'RATE_LIMITED') {
        return res.status(429).json({ error: 'Rate limit exceeded', code: 'RATE_LIMITED', retryAfterSeconds: 60 });
      }
      return res.status(410).json({ error: 'Bootstrap token expired', code: 'BOOTSTRAP_TOKEN_EXPIRED' });
    }

    return res.json({ ok: true, userId: result.userId });
  });
}

/**
 * Providers endpoint shape when offline-locked (§6.3).
 * @param {boolean} offlineLockedActive
 * @returns {import('express').RequestHandler}
 */
export function localAuthProvidersHandler(offlineLockedActive) {
  return (_req, res, next) => {
    if (!offlineLockedActive) return next();
    return res.json({ google: false, github: false, local: true });
  };
}

export { credentialStoreHasAdmin, hasAnyCredential };

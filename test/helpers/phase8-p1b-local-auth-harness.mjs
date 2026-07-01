/**
 * Shared harness for Phase 8 P1b offline-locked auth tests.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import express from 'express';
import jwt from 'jsonwebtoken';
import { registerLocalAuthRoutes } from '../../hub/lib/local-auth-routes.mjs';
import { oauthDisabledGuard } from '../../hub/lib/local-auth-oauth-guard.mjs';
import { bootstrapAdminCli } from '../../hub/lib/local-auth-bootstrap.mjs';

export const TEST_PASSPHRASE = 'SecureHub123!Aa';
export const TEST_SECRET = 'test-jwt-secret-at-least-32-chars-long';
export const TEST_JWT_EXPIRY = '24h';

/**
 * @returns {Promise<{ dataDir: string, cleanup: () => void }>}
 */
export async function makeTempDataDir() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-local-auth-'));
  return {
    dataDir,
    cleanup: () => {
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
      } catch (_) {
        /* ignore */
      }
    },
  };
}

/**
 * Enable gate-on test paths without flipping shipped flag.
 */
export function enableOfflineLockedTestEnv(dataDir) {
  process.env.NODE_ENV = 'test';
  process.env.KNOWTATION_OFFLINE_LOCKED_AUTH = 'enabled';
  process.env.KNOWTATION_OFFLINE_LOCKED_AUTH_TEST_SHIPPED = '1';
  process.env.KNOWTATION_GATEWAY_DATA_DIR = dataDir;
  process.env.HUB_JWT_SECRET = TEST_SECRET;
  process.env.SESSION_SECRET = TEST_SECRET;
}

/**
 * @param {string} dataDir
 * @returns {Promise<{ app: import('express').Express, baseUrl: string, close: () => Promise<void> }>}
 */
export async function createLocalAuthTestApp(dataDir) {
  const app = express();
  app.use(express.json());
  const offlineLockedActive = true;
  app.get('/api/v1/auth/providers', (_req, res) => {
    res.json({ google: false, github: false, local: true });
  });
  app.get('/api/v1/auth/login', oauthDisabledGuard(true, dataDir), (_req, res) => {
    res.status(403).json({ code: 'OAUTH_DISABLED' });
  });
  app.get('/auth/login', oauthDisabledGuard(true, dataDir), (_req, res) => {
    res.status(403).json({ code: 'OAUTH_DISABLED' });
  });
  registerLocalAuthRoutes(app, {
    dataDir,
    sessionSecret: TEST_SECRET,
    jwtExpiry: TEST_JWT_EXPIRY,
    offlineLockedActive,
  });
  app.get('/api/v1/auth/session', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return res.status(401).json({ code: 'UNAUTHORIZED' });
    try {
      const payload = jwt.verify(auth.slice(7), TEST_SECRET);
      return res.json(payload);
    } catch (_) {
      return res.status(401).json({ code: 'UNAUTHORIZED' });
    }
  });
  app.get('/api/v1/roles', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return res.status(401).json({ code: 'UNAUTHORIZED' });
    try {
      jwt.verify(auth.slice(7), TEST_SECRET);
    } catch (_) {
      return res.status(401).json({ code: 'UNAUTHORIZED' });
    }
    const rolesFile = path.join(dataDir, 'hub_roles.json');
    const roles = fs.existsSync(rolesFile) ? JSON.parse(fs.readFileSync(rolesFile, 'utf8')).roles : {};
    res.json({ roles });
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    app,
    baseUrl,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/**
 * @param {string} dataDir
 * @param {string} [username]
 */
export async function bootstrapTestAdmin(dataDir, username = 'admin') {
  return bootstrapAdminCli(dataDir, username, TEST_PASSPHRASE);
}

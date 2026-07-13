/**
 * Shared helpers for Phase B device OAuth (RFC 8628) tests.
 *
 * Reuses the strong-consistency gateway refresh store from durable MCP OAuth
 * harness and mounts createDeviceOAuthRouter on a throwaway Express server for
 * HTTP integration / e2e / security tiers.
 */

import express from 'express';
import http from 'node:http';
import {
  createDeviceOAuthRouter,
  DEVICE_GRANT_TYPE,
} from '../../hub/gateway/device-oauth-provider.mjs';
import {
  createTempStrongStore,
  TEST_SECRET,
} from './durable-mcp-oauth-harness.mjs';

export { TEST_SECRET, createTempStrongStore, DEVICE_GRANT_TYPE };

/**
 * Mock Hub session: Bearer present → fixed test subject.
 * @param {import('express').Request} req
 * @returns {string | null}
 */
export function defaultGetUserId(req) {
  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Bearer ')) return 'google:device-test';
  return null;
}

/**
 * Default granted scope ceiling for device-test subject.
 * @param {string} _sub
 * @returns {string[]}
 */
export function defaultGrantedScopes(_sub) {
  return ['vault:read', 'vault:write'];
}

/**
 * Build a device OAuth router with test defaults.
 *
 * @param {{
 *   refreshStore: object,
 *   getUserId?: (req: import('express').Request) => string | null,
 *   grantedScopes?: (sub: string) => string[],
 *   sessionSecret?: string,
 *   baseUrl?: string,
 *   hubVerificationPath?: string,
 * }} opts
 */
export function createDeviceRouter(opts) {
  if (!opts?.refreshStore) {
    throw new Error('createDeviceRouter requires refreshStore');
  }
  return createDeviceOAuthRouter({
    baseUrl: opts.baseUrl || 'http://localhost:3340',
    sessionSecret: opts.sessionSecret || TEST_SECRET,
    refreshStore: opts.refreshStore,
    getUserId: opts.getUserId || defaultGetUserId,
    grantedScopes: opts.grantedScopes || defaultGrantedScopes,
    hubVerificationPath: opts.hubVerificationPath || '/hub/#settings/integrations',
  });
}

/**
 * Start an Express app with the device OAuth router on a random local port.
 *
 * @param {object} [opts]
 * @param {ReturnType<typeof createTempStrongStore> extends Promise<infer T> ? T : never} [opts.tmp]
 * @param {object} [opts.refreshStore]
 * @param {string} [opts.mountPath]
 * @param {(req: import('express').Request) => string | null} [opts.getUserId]
 * @param {(sub: string) => string[]} [opts.grantedScopes]
 * @param {string} [opts.sessionSecret]
 * @returns {Promise<{
 *   baseUrl: string,
 *   mountPath: string,
 *   tmp: { dir: string, store: object, cleanup: () => Promise<void> },
 *   stop: () => Promise<void>,
 *   fetch: (method: string, urlPath: string, body?: object, headers?: Record<string, string>) => Promise<{
 *     status: number,
 *     headers: Headers,
 *     json: object | null,
 *     text: string,
 *   }>,
 * }>}
 */
export async function startDeviceOAuthApp(opts = {}) {
  const tmp = opts.tmp || (await createTempStrongStore());
  const mountPath = opts.mountPath || '/api/v1/auth/device';
  const baseUrlForRouter = opts.baseUrl || 'http://localhost:3340';
  const { router } = createDeviceRouter({
    refreshStore: opts.refreshStore || tmp.store,
    getUserId: opts.getUserId,
    grantedScopes: opts.grantedScopes,
    sessionSecret: opts.sessionSecret,
    baseUrl: baseUrlForRouter,
    hubVerificationPath: opts.hubVerificationPath,
  });

  const app = express();
  app.set('trust proxy', true);
  app.use(mountPath, router);

  const server = http.createServer(app);
  const baseUrl = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });

  return {
    baseUrl,
    mountPath,
    tmp,
    async stop() {
      await new Promise((resolve, reject) => {
        server.close((e) => {
          if (e && e.code === 'ERR_SERVER_NOT_RUNNING') resolve();
          else if (e) reject(e);
          else resolve();
        });
      });
    },
    /**
     * @param {string} method
     * @param {string} urlPath
     * @param {object} [body]
     * @param {Record<string, string>} [headers]
     */
    async fetch(method, urlPath, body, headers = {}) {
      const url = new URL(urlPath, baseUrl);
      const contentType = headers['Content-Type'] || (body ? 'application/json' : undefined);
      const bodyStr = body
        ? contentType === 'application/json'
          ? JSON.stringify(body)
          : new URLSearchParams(
              Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)]))
            ).toString()
        : undefined;
      const res = await fetch(url.toString(), {
        method,
        headers: {
          ...(contentType ? { 'Content-Type': contentType } : {}),
          ...headers,
        },
        body: bodyStr,
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (_) {
        /* non-json */
      }
      return { status: res.status, headers: res.headers, json, text };
    },
  };
}

/**
 * Standard Authorization header for Hub-authenticated routes in tests.
 * @returns {Record<string, string>}
 */
export function authHeaders() {
  return { Authorization: 'Bearer test-session-jwt' };
}

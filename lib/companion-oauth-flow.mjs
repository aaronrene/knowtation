/**
 * Companion App — Phase 5 native OAuth flow driver.
 *
 * Binds a one-shot loopback redirect listener, opens the system browser, validates
 * `state` and `iss`, exchanges the code over TLS, and stores the resulting session
 * through injected keychain custody.
 */

import http from 'node:http';
import { spawn as nodeSpawn } from 'node:child_process';

import {
  buildAuthorizationUrl,
  buildTokenRequest,
  createNonce,
  createOAuthState,
  createPkcePair,
  validateAuthorizationResponse,
  validateTokenResponse,
} from './companion-oauth-pkce.mjs';
import { buildSessionMeta, createTokenCustody } from './companion-token-custody.mjs';

export const OAUTH_FLOW_REASONS = Object.freeze({
  BIND_FAILED: 'bind_failed',
  CALLBACK_INVALID: 'callback_invalid',
  CALLBACK_TIMEOUT: 'callback_timeout',
  TOKEN_EXCHANGE_FAILED: 'token_exchange_failed',
  REGISTRATION_FAILED: 'registration_failed',
});

/**
 * Open the default system browser without an embedded webview.
 * @param {string} url
 * @param {{ platform?: string, spawn?: typeof nodeSpawn }} [deps]
 */
export async function openSystemBrowser(url, deps = {}) {
  const platform = deps.platform ?? process.platform;
  const spawn = deps.spawn ?? nodeSpawn;
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { shell: false, detached: true, stdio: 'ignore' });
  child.unref?.();
}

/**
 * Bind a one-shot loopback OAuth redirect listener.
 * @param {{ expectedState: string, expectedIssuer: string, path?: string, host?: '127.0.0.1'|'::1', timeoutMs?: number, createServer?: typeof http.createServer }} params
 */
export async function createOAuthRedirectAttempt(params) {
  const {
    expectedState,
    expectedIssuer,
    path = '/callback',
    host = '127.0.0.1',
    timeoutMs = 120_000,
    createServer = http.createServer,
  } = params ?? {};
  if (host !== '127.0.0.1' && host !== '::1') throw new TypeError(OAUTH_FLOW_REASONS.BIND_FAILED);

  let settled = false;
  let timeout;
  let resolveCallback;
  const callback = new Promise((resolve, reject) => {
    resolveCallback = { resolve, reject };
    timeout = setTimeout(() => reject(new Error(OAUTH_FLOW_REASONS.CALLBACK_TIMEOUT)), timeoutMs);
  });

  const server = createServer((req, res) => {
    if (settled) {
      res.statusCode = 410;
      res.end('Authorization attempt is closed.');
      return;
    }
    settled = true;
    try {
      if (req.method !== 'GET') throw new Error(OAUTH_FLOW_REASONS.CALLBACK_INVALID);
      const requestUrl = new URL(req.url ?? '/', `http://${host}`);
      if (requestUrl.pathname !== path) throw new Error(OAUTH_FLOW_REASONS.CALLBACK_INVALID);
      const paramsObj = Object.fromEntries(requestUrl.searchParams.entries());
      const verdict = validateAuthorizationResponse({
        params: paramsObj,
        expectedState,
        expectedIssuer,
      });
      if (!verdict.ok) throw new Error(OAUTH_FLOW_REASONS.CALLBACK_INVALID);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end('Sign-in complete. You can return to Knowtation.');
      resolveCallback.resolve(verdict.code);
    } catch {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end('Sign-in failed. Return to Knowtation and try again.');
      resolveCallback.reject(new Error(OAUTH_FLOW_REASONS.CALLBACK_INVALID));
    } finally {
      clearTimeout(timeout);
      server.close();
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error(OAUTH_FLOW_REASONS.BIND_FAILED)));
    server.listen(0, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address !== 'object') {
    server.close();
    throw new Error(OAUTH_FLOW_REASONS.BIND_FAILED);
  }
  const redirectHost = address.address === '::1' ? '[::1]' : '127.0.0.1';
  return {
    redirectUri: `http://${redirectHost}:${address.port}${path}`,
    callback,
    close() {
      clearTimeout(timeout);
      if (server.listening) server.close();
    },
  };
}

/**
 * Register a public native client when a registration endpoint is supplied.
 * @param {{ registrationEndpoint?: string, redirectUri: string, fetch: typeof globalThis.fetch }} params
 */
export async function registerNativeClient({ registrationEndpoint, redirectUri, fetch }) {
  if (!registrationEndpoint) return null;
  const endpoint = new URL(registrationEndpoint);
  if (endpoint.protocol !== 'https:') throw new Error(OAUTH_FLOW_REASONS.REGISTRATION_FAILED);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  if (!res.ok) throw new Error(OAUTH_FLOW_REASONS.REGISTRATION_FAILED);
  const json = await res.json();
  if (!json || typeof json.client_id !== 'string' || json.client_id.length === 0) {
    throw new Error(OAUTH_FLOW_REASONS.REGISTRATION_FAILED);
  }
  return json.client_id;
}

/**
 * Run the full native OAuth flow.
 * @param {{
 *   authorizationEndpoint: string,
 *   tokenEndpoint: string,
 *   expectedIssuer: string,
 *   clientId?: string,
 *   registrationEndpoint?: string,
 *   scopes: string[],
 *   keychain: { get: Function, set: Function, delete: Function },
 *   fetch?: typeof globalThis.fetch,
 *   openBrowser?: (url: string) => Promise<void>|void,
 *   now?: () => number,
 *   refreshTtlMs?: number,
 * }} params
 */
export async function runCompanionOAuthFlow(params) {
  const fetch = params?.fetch ?? globalThis.fetch;
  const openBrowser = params?.openBrowser ?? ((url) => openSystemBrowser(url));
  if (typeof fetch !== 'function') throw new TypeError(OAUTH_FLOW_REASONS.TOKEN_EXCHANGE_FAILED);

  const pkce = createPkcePair();
  const state = createOAuthState();
  const nonce = createNonce();
  const attempt = await createOAuthRedirectAttempt({
    expectedState: state,
    expectedIssuer: params.expectedIssuer,
  });

  try {
    const clientId = params.clientId ?? await registerNativeClient({
      registrationEndpoint: params.registrationEndpoint,
      redirectUri: attempt.redirectUri,
      fetch,
    });
    if (typeof clientId !== 'string' || clientId.length === 0) {
      throw new Error(OAUTH_FLOW_REASONS.REGISTRATION_FAILED);
    }

    const authorizationUrl = buildAuthorizationUrl({
      authorizationEndpoint: params.authorizationEndpoint,
      clientId,
      redirectUri: attempt.redirectUri,
      scopes: params.scopes,
      state,
      codeChallenge: pkce.codeChallenge,
      nonce,
    });

    await openBrowser(authorizationUrl);
    const code = await attempt.callback;
    const tokenRequest = buildTokenRequest({
      tokenEndpoint: params.tokenEndpoint,
      clientId,
      code,
      codeVerifier: pkce.codeVerifier,
      redirectUri: attempt.redirectUri,
    });

    const tokenRes = await fetch(tokenRequest.url, {
      method: tokenRequest.method,
      headers: tokenRequest.headers,
      body: tokenRequest.body,
    });
    if (!tokenRes.ok) throw new Error(OAUTH_FLOW_REASONS.TOKEN_EXCHANGE_FAILED);
    const tokenJson = await tokenRes.json();
    const token = validateTokenResponse(tokenJson);
    if (!token.ok) throw new Error(OAUTH_FLOW_REASONS.TOKEN_EXCHANGE_FAILED);

    const meta = buildSessionMeta(token, {
      now: params.now?.() ?? Date.now(),
      refreshTtlMs: params.refreshTtlMs,
      issuer: params.expectedIssuer,
    });
    const custody = createTokenCustody(params.keychain);
    await custody.storeSession({
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      meta,
    });
    return { ok: true, meta };
  } catch (err) {
    attempt.close();
    throw err;
  }
}

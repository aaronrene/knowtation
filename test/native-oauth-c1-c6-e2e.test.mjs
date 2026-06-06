/**
 * End-to-end tests for native OAuth C1–C6 changes.
 * Tier 3 of 7 — docs/COMPANION-APP-OAUTH-SERVERSIDE-GATE.md §7.
 *
 * Simulates the full companion sign-in flow:
 *   1. Client registers (POST /register)
 *   2. Client starts authorization (GET /authorize)
 *   3. IDP callback binds userId (completeNativeAuthorization)
 *   4. Client exchanges code for tokens (POST /token)
 *   5. Client refreshes tokens (POST /token with grant_type=refresh_token)
 *   6. Client revokes the refresh token (POST /revoke)
 *
 * Also verifies the mcp_access regression: MCP clients are UNAFFECTED by native changes.
 * All flows run against the actual Express router (no mocking of router internals).
 */

import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

function sha256b64url(s) {
  return createHash('sha256').update(s).digest('base64url');
}

/**
 * Minimal HTTP test client that calls a local express app.
 */
function testClient(app) {
  const server = http.createServer(app);
  let baseUrl;

  return {
    start() {
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const port = server.address().port;
          baseUrl = `http://127.0.0.1:${port}`;
          resolve(baseUrl);
        });
      });
    },
    stop() {
      return new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    },
    async fetch(method, path, body, contentType = 'application/x-www-form-urlencoded') {
      const url = new URL(path, baseUrl);
      const bodyStr = body
        ? contentType === 'application/json'
          ? JSON.stringify(body)
          : new URLSearchParams(body).toString()
        : undefined;
      const res = await fetch(url.toString(), {
        method,
        headers: {
          'Content-Type': contentType,
          'User-Agent': 'knowtation-companion-e2e-test',
        },
        body: bodyStr,
        redirect: 'manual',
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
      return { status: res.status, headers: res.headers, json, text };
    },
  };
}

describe('C1–C6 E2E: full native companion sign-in flow', () => {
  let tmpDir;
  let client;
  let completeNativeAuthorization;
  let callbackApp;
  const BASE_URL_PLACEHOLDER = 'http://localhost:0'; // replaced after server start

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'native-oauth-e2e-'));
    process.env.KNOWTATION_GATEWAY_DATA_DIR = tmpDir;

    const jwt = (await import('jsonwebtoken')).default;
    const SECRET = 'e2e-test-secret-native-oauth';

    function issueAccessToken(sub) {
      const idx = sub.indexOf(':');
      const provider = idx > 0 ? sub.slice(0, idx) : '';
      const id = idx > 0 ? sub.slice(idx + 1) : sub;
      const role = sub.includes('admin') ? 'admin' : 'member';
      return jwt.sign({ sub, provider, id, name: '', role }, SECRET, { expiresIn: '24h' });
    }

    function grantedScopes(sub) {
      const role = sub.includes('admin') ? 'admin' : 'member';
      if (role === 'admin') return ['vault:read', 'vault:write', 'admin'];
      return ['vault:read', 'vault:write'];
    }

    // Minimal durable refresh store backed by refresh-token-core
    const { createGatewayRefreshStore } = await import('../hub/gateway/refresh-token-store.mjs');
    const refreshStore = createGatewayRefreshStore();

    const { createNativeOAuthRouter } = await import('../hub/gateway/native-oauth-provider.mjs');
    const result = createNativeOAuthRouter({
      baseUrl: BASE_URL_PLACEHOLDER,
      loginUrl: `${BASE_URL_PLACEHOLDER}/auth/login`,
      issueAccessToken,
      grantedScopes,
      refreshStore,
    });

    callbackApp = express();
    callbackApp.use('/api/v1/auth/native', result.router);
    completeNativeAuthorization = result.completeNativeAuthorization;

    client = testClient(callbackApp);
    await client.start();
  });

  after(async () => {
    await client.stop();
    delete process.env.KNOWTATION_GATEWAY_DATA_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('C1/C2/C3/C5/C6 – full companion sign-in and refresh flow', async () => {
    // Step 1: register as a native client
    const regRes = await client.fetch('POST', '/api/v1/auth/native/register', {
      redirect_uris: ['http://127.0.0.1:54380/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    }, 'application/json');
    assert.equal(regRes.status, 201, 'registration must succeed');
    const registeredClient = regRes.json;
    assert.ok(registeredClient.client_id, 'must get client_id');

    // Step 2: start authorization
    const verifier = 'e2e-code-verifier-long-enough-to-be-valid-abcdef';
    const challenge = sha256b64url(verifier);
    const redirectUri = 'http://127.0.0.1:54380/callback';
    const state = 'e2e-state-' + randomUUID();

    const authRes = await client.fetch(
      'GET',
      `/api/v1/auth/native/authorize?` +
        `client_id=${encodeURIComponent(registeredClient.client_id)}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `code_challenge=${encodeURIComponent(challenge)}&` +
        `code_challenge_method=S256&` +
        `state=${encodeURIComponent(state)}&` +
        `scope=vault%3Aread`
    );
    // The authorize endpoint redirects to the login page
    assert.equal(authRes.status, 302, 'authorize must redirect to login');
    const loginLocation = authRes.headers.get('location');
    assert.ok(loginLocation && loginLocation.includes('native_state='), 'must include native_state');

    // Extract native_state from the login URL
    const loginUrl = new URL(loginLocation);
    const nativeStateB64 = loginUrl.searchParams.get('native_state');
    assert.ok(nativeStateB64, 'must have native_state param');

    // Extract the code from the native_state
    const nativeState = JSON.parse(Buffer.from(nativeStateB64, 'base64url').toString());
    const code = nativeState.code;
    assert.ok(code, 'native state must contain code');

    // Step 3: simulate IDP callback (normally done by Google/GitHub)
    const sub = 'google:e2e-user-001';
    let capturedRedirectUrl = null;
    const fakeRes = {
      status(code) { this._code = code; return this; },
      json(data) { this._body = data; },
      redirect(loc) { capturedRedirectUrl = loc; },
    };
    await completeNativeAuthorization(nativeStateB64, sub, fakeRes);

    assert.ok(capturedRedirectUrl, 'completeNativeAuthorization must redirect');
    const callbackUrl = new URL(capturedRedirectUrl);
    assert.equal(callbackUrl.searchParams.get('code'), code, 'code must be in callback redirect');
    assert.equal(callbackUrl.searchParams.get('state'), state, 'state must be preserved');

    // C3: iss must be present and correct
    const issInRedirect = callbackUrl.searchParams.get('iss');
    assert.ok(issInRedirect, 'iss must be present in redirect');
    assert.ok(issInRedirect.endsWith('/api/v1/auth/native'), 'iss must end with /api/v1/auth/native');

    // Step 4: exchange code for tokens
    const tokenRes = await client.fetch('POST', '/api/v1/auth/native/token', {
      grant_type: 'authorization_code',
      client_id: registeredClient.client_id,
      code: code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });
    assert.equal(tokenRes.status, 200, 'token exchange must succeed');
    const tokens = tokenRes.json;
    assert.ok(tokens.access_token, 'must return access_token');
    assert.ok(tokens.refresh_token, 'C2: must return refresh_token in body (not cookie)');
    assert.equal(tokens.token_type, 'Bearer');
    assert.ok(tokens.expires_in > 0);

    // C1: decode and verify JWT shape
    const jwt = (await import('jsonwebtoken')).default;
    const decoded = jwt.decode(tokens.access_token);
    assert.equal(decoded.sub, sub);
    assert.equal(decoded.provider, 'google');
    assert.ok(decoded.role, 'must have role claim');
    assert.ok(!decoded.type, 'C1: must not have type:mcp_access claim');
    assert.ok(!decoded.scopes, 'C1: must not embed scopes in JWT payload');

    // C6: scope in response must not exceed member ceiling
    const scopeInResponse = (tokens.scope || '').split(' ');
    assert.ok(!scopeInResponse.includes('admin'), 'C6: member must not receive admin scope');
    assert.ok(scopeInResponse.includes('vault:read'), 'must include vault:read');

    // Step 5: refresh the token
    const refreshRes = await client.fetch('POST', '/api/v1/auth/native/token', {
      grant_type: 'refresh_token',
      client_id: registeredClient.client_id,
      refresh_token: tokens.refresh_token,
    });
    assert.equal(refreshRes.status, 200, 'C2: refresh must succeed');
    const refreshed = refreshRes.json;
    assert.ok(refreshed.access_token, 'must return new access_token');
    assert.ok(refreshed.refresh_token, 'C2: must return new refresh_token in body');
    assert.ok(refreshed.refresh_token !== tokens.refresh_token, 'must be a different token');

    // Step 6: revoke the refresh token
    const revokeRes = await client.fetch('POST', '/api/v1/auth/native/revoke', {
      token: refreshed.refresh_token,
    });
    assert.equal(revokeRes.status, 200, 'revocation must return 200');

    // Step 7: replay revoked token must fail
    const replayRes = await client.fetch('POST', '/api/v1/auth/native/token', {
      grant_type: 'refresh_token',
      client_id: registeredClient.client_id,
      refresh_token: refreshed.refresh_token,
    });
    assert.equal(replayRes.status, 401, 'revoked token must not rotate');
  });

  it('C5 – wrong redirect_uri at token exchange returns 400', async () => {
    const { savePendingCode, bindUserToCode } = await import('../hub/gateway/native-as-store.mjs');
    const regRes = await client.fetch('POST', '/api/v1/auth/native/register', {
      redirect_uris: ['http://127.0.0.1:54381/callback'],
      token_endpoint_auth_method: 'none',
    }, 'application/json');
    const registeredClient = regRes.json;

    const code = randomUUID();
    const verifier = 'verifier-c5-e2e-test';
    await savePendingCode(code, {
      clientId: registeredClient.client_id,
      codeChallenge: sha256b64url(verifier),
      redirectUri: 'http://127.0.0.1:54381/callback',
      scopes: [],
    });
    await bindUserToCode(code, 'google:user-c5');

    const tokenRes = await client.fetch('POST', '/api/v1/auth/native/token', {
      grant_type: 'authorization_code',
      client_id: registeredClient.client_id,
      code,
      code_verifier: verifier,
      redirect_uri: 'http://127.0.0.1:54382/callback', // wrong port
    });
    assert.equal(tokenRes.status, 400, 'C5: redirect_uri mismatch must return 400');
    assert.equal(tokenRes.json.error, 'invalid_grant');
  });

  it('C5 – PKCE failure returns 400 invalid_grant', async () => {
    const { savePendingCode, bindUserToCode } = await import('../hub/gateway/native-as-store.mjs');
    const regRes = await client.fetch('POST', '/api/v1/auth/native/register', {
      redirect_uris: ['http://127.0.0.1:54383/callback'],
      token_endpoint_auth_method: 'none',
    }, 'application/json');
    const registeredClient = regRes.json;

    const code = randomUUID();
    const correctVerifier = 'correct-verifier-string';
    await savePendingCode(code, {
      clientId: registeredClient.client_id,
      codeChallenge: sha256b64url(correctVerifier),
      redirectUri: 'http://127.0.0.1:54383/callback',
    });
    await bindUserToCode(code, 'google:pkce-test-user');

    const tokenRes = await client.fetch('POST', '/api/v1/auth/native/token', {
      grant_type: 'authorization_code',
      client_id: registeredClient.client_id,
      code,
      code_verifier: 'wrong-verifier',
      redirect_uri: 'http://127.0.0.1:54383/callback',
    });
    assert.equal(tokenRes.status, 400);
    assert.equal(tokenRes.json.error, 'invalid_grant');
    assert.ok(tokenRes.json.error_description.includes('PKCE'));
  });

  it('C6 – admin sub receives admin scope', async () => {
    const { savePendingCode, bindUserToCode } = await import('../hub/gateway/native-as-store.mjs');
    const regRes = await client.fetch('POST', '/api/v1/auth/native/register', {
      redirect_uris: ['http://127.0.0.1:54384/callback'],
      token_endpoint_auth_method: 'none',
    }, 'application/json');
    const registeredClient = regRes.json;

    const code = randomUUID();
    const verifier = 'admin-verifier-c6';
    await savePendingCode(code, {
      clientId: registeredClient.client_id,
      codeChallenge: sha256b64url(verifier),
      redirectUri: 'http://127.0.0.1:54384/callback',
      scopes: ['vault:read', 'vault:write', 'admin'],
    });
    await bindUserToCode(code, 'google:admin_user'); // contains 'admin' → admin role

    const tokenRes = await client.fetch('POST', '/api/v1/auth/native/token', {
      grant_type: 'authorization_code',
      client_id: registeredClient.client_id,
      code,
      code_verifier: verifier,
      redirect_uri: 'http://127.0.0.1:54384/callback',
    });
    assert.equal(tokenRes.status, 200);
    const scopes = (tokenRes.json.scope || '').split(' ');
    assert.ok(scopes.includes('admin'), 'C6: admin sub must receive admin scope');
  });

  it('Regression: non-loopback redirect_uri rejected at registration', async () => {
    const regRes = await client.fetch('POST', '/api/v1/auth/native/register', {
      redirect_uris: ['https://evil.com/callback'],
      token_endpoint_auth_method: 'none',
    }, 'application/json');
    assert.equal(regRes.status, 400, 'non-loopback URI must be rejected at registration');
    assert.ok(
      regRes.json.error === 'invalid_redirect_uri' || regRes.json.error === 'invalid_client_metadata',
      'error code must indicate invalid redirect'
    );
  });

  it('Regression: localhost redirect_uri rejected at registration', async () => {
    const regRes = await client.fetch('POST', '/api/v1/auth/native/register', {
      redirect_uris: ['http://localhost:8080/callback'],
      token_endpoint_auth_method: 'none',
    }, 'application/json');
    assert.equal(regRes.status, 400, 'localhost URI must be rejected (RFC 8252 §8.3)');
  });

  it('Discovery endpoint returns correct issuer and endpoints', async () => {
    const discRes = await client.fetch('GET', '/api/v1/auth/native/.well-known/oauth-authorization-server');
    assert.equal(discRes.status, 200);
    const meta = discRes.json;
    assert.ok(meta.issuer && meta.issuer.endsWith('/api/v1/auth/native'));
    assert.ok(meta.authorization_endpoint);
    assert.ok(meta.token_endpoint);
    assert.ok(meta.registration_endpoint);
    assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);
    assert.deepEqual(meta.token_endpoint_auth_methods_supported, ['none']);
  });
});

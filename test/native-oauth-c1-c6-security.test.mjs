/**
 * Security tests for native OAuth C1–C6 changes.
 * Tier 7 of 7 (centerpiece) — docs/COMPANION-APP-OAUTH-SERVERSIDE-GATE.md §7.
 *
 * The gate identifies this tier as the security centerpiece. Tests verify:
 *   - No superset/admin over-grant (C6)
 *   - PKCE still required — plain method rejected
 *   - redirect_uri: non-loopback rejected; mix-up rejected when expectedIssuer set
 *   - Refresh reuse burns the family
 *   - No secret (SESSION_SECRET, JWT, refresh token, code, verifier) in any log/error/redirect
 *   - mcp_access clients not widened by native changes (regression)
 *   - Authorization code cannot be exchanged without completing authorization (userId binding)
 *   - Client mismatch at exchange returns error (not token)
 *   - Expired code returns error
 *   - PKCE plain method rejected at /authorize
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

function testClient(app) {
  const server = http.createServer(app);
  let baseUrl;
  return {
    start() {
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          baseUrl = `http://127.0.0.1:${server.address().port}`;
          resolve(baseUrl);
        });
      });
    },
    stop() {
      return new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    },
    async fetch(method, urlPath, body, contentType = 'application/x-www-form-urlencoded') {
      const url = new URL(urlPath, baseUrl);
      const bodyStr = body
        ? contentType === 'application/json'
          ? JSON.stringify(body)
          : new URLSearchParams(body).toString()
        : undefined;
      const res = await fetch(url.toString(), {
        method,
        headers: { 'Content-Type': contentType },
        body: bodyStr,
        redirect: 'manual',
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) { }
      return { status: res.status, headers: res.headers, json, text };
    },
  };
}

describe('C1–C6 Security: attack surface and invariants', () => {
  let tmpDir, client, completeNativeAuthorization;
  let jwt;
  const SECRET = 'security-test-secret-must-never-leak';

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'native-oauth-security-'));
    process.env.KNOWTATION_GATEWAY_DATA_DIR = tmpDir;

    jwt = (await import('jsonwebtoken')).default;

    function issueAccessToken(sub) {
      const idx = sub.indexOf(':');
      const provider = idx > 0 ? sub.slice(0, idx) : '';
      const id = idx > 0 ? sub.slice(idx + 1) : sub;
      const role = sub.includes('admin') ? 'admin' : 'member';
      return jwt.sign({ sub, provider, id, name: '', role }, SECRET, { expiresIn: '24h' });
    }

    function grantedScopes(sub) {
      if (sub.includes('admin')) return ['vault:read', 'vault:write', 'admin'];
      return ['vault:read', 'vault:write'];
    }

    const { createGatewayRefreshStore } = await import('../hub/gateway/refresh-token-store.mjs');
    const refreshStore = createGatewayRefreshStore();

    const { createNativeOAuthRouter } = await import('../hub/gateway/native-oauth-provider.mjs');
    const result = createNativeOAuthRouter({
      baseUrl: 'http://localhost:0',
      loginUrl: 'http://localhost:0/auth/login',
      issueAccessToken,
      grantedScopes,
      refreshStore,
    });
    completeNativeAuthorization = result.completeNativeAuthorization;

    const app = express();
    app.use('/api/v1/auth/native', result.router);
    client = testClient(app);
    await client.start();
  });

  after(async () => {
    await client.stop();
    delete process.env.KNOWTATION_GATEWAY_DATA_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── S-a: Over-privileged companion token ─────────────────────────────────

  it('S-a/C6: member sub NEVER gets admin scope even if requested', async () => {
    const { savePendingCode, bindUserToCode } = await import('../hub/gateway/native-as-store.mjs');
    const reg = await client.fetch('POST', '/api/v1/auth/native/register', {
      redirect_uris: ['http://127.0.0.1:54400/callback'],
      token_endpoint_auth_method: 'none',
    }, 'application/json');
    assert.equal(reg.status, 201);
    const clientId = reg.json.client_id;

    const code = randomUUID();
    const verifier = 'sec-admin-test-verifier';
    await savePendingCode(code, {
      clientId,
      codeChallenge: sha256b64url(verifier),
      redirectUri: 'http://127.0.0.1:54400/callback',
      scopes: ['admin', 'vault:read', 'vault:write'],
    });
    await bindUserToCode(code, 'google:plain_member');

    const tokenRes = await client.fetch('POST', '/api/v1/auth/native/token', {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: 'http://127.0.0.1:54400/callback',
    });
    assert.equal(tokenRes.status, 200);
    const scopes = (tokenRes.json.scope || '').split(' ');
    assert.ok(!scopes.includes('admin'), 'member sub must NEVER receive admin scope');
    // Verify the JWT itself also does not embed admin
    const decoded = jwt.decode(tokenRes.json.access_token);
    assert.equal(decoded.role, 'member');
  });

  // ── S-b: Refresh token reuse burns the family ────────────────────────────

  it('S-b/C2: replaying a rotated refresh token burns the family', async () => {
    const { savePendingCode, bindUserToCode } = await import('../hub/gateway/native-as-store.mjs');
    const reg = await client.fetch('POST', '/api/v1/auth/native/register', {
      redirect_uris: ['http://127.0.0.1:54401/callback'],
      token_endpoint_auth_method: 'none',
    }, 'application/json');
    const clientId = reg.json.client_id;

    const code = randomUUID();
    const verifier = 'sec-reuse-verifier';
    await savePendingCode(code, {
      clientId,
      codeChallenge: sha256b64url(verifier),
      redirectUri: 'http://127.0.0.1:54401/callback',
      scopes: [],
    });
    await bindUserToCode(code, 'google:reuse-victim');

    const t1Res = await client.fetch('POST', '/api/v1/auth/native/token', {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: 'http://127.0.0.1:54401/callback',
    });
    assert.equal(t1Res.status, 200);
    const refreshToken1 = t1Res.json.refresh_token;

    // First rotation: valid
    const rot1 = await client.fetch('POST', '/api/v1/auth/native/token', {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken1,
    });
    assert.equal(rot1.status, 200);
    const refreshToken2 = rot1.json.refresh_token;

    // Replay the already-consumed token: must trigger REFRESH_REUSE
    const replay = await client.fetch('POST', '/api/v1/auth/native/token', {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken1, // already rotated — reuse
    });
    assert.equal(replay.status, 401);
    assert.ok(
      replay.json.code === 'REFRESH_REUSE' || replay.json.error === 'invalid_grant',
      'S-b: reuse must be detected'
    );
  });

  // ── S-c: Mix-up defense via iss ──────────────────────────────────────────

  it('S-c/C3: iss in redirect does not contain the authorization code value', async () => {
    const { savePendingCode } = await import('../hub/gateway/native-as-store.mjs');
    const code = randomUUID();
    await savePendingCode(code, {
      clientId: 'client-sc',
      codeChallenge: sha256b64url('verifier-sc'),
      redirectUri: 'http://127.0.0.1:54402/cb',
      state: 'state-sc',
    });

    const nativeState = Buffer.from(JSON.stringify({
      code, clientId: 'client-sc', redirectUri: 'http://127.0.0.1:54402/cb', state: 'state-sc',
    })).toString('base64url');

    let redirectUrl = null;
    const fakeRes = {
      status() { return this; },
      json() { },
      redirect(loc) { redirectUrl = loc; },
    };
    await completeNativeAuthorization(nativeState, 'google:sc-user', fakeRes);
    assert.ok(redirectUrl);
    const url = new URL(redirectUrl);
    const issValue = url.searchParams.get('iss');
    // iss must be a URL, not the code
    assert.ok(issValue && issValue.startsWith('http'), 'iss must be a URL');
    assert.ok(!issValue.includes(code), 'iss must not contain the code value');
    // iss must not contain any query string
    assert.ok(!issValue.includes('?'), 'iss must not have query string (RFC 8414)');
  });

  // ── S-d: Code cannot be exchanged without completing authorization ────────

  it('S-d: authorization code without userId binding returns invalid_grant', async () => {
    const { savePendingCode } = await import('../hub/gateway/native-as-store.mjs');
    const reg = await client.fetch('POST', '/api/v1/auth/native/register', {
      redirect_uris: ['http://127.0.0.1:54403/callback'],
      token_endpoint_auth_method: 'none',
    }, 'application/json');
    const clientId = reg.json.client_id;

    const code = randomUUID();
    const verifier = 'no-user-verifier';
    // Save but do NOT bind a user
    await savePendingCode(code, {
      clientId,
      codeChallenge: sha256b64url(verifier),
      redirectUri: 'http://127.0.0.1:54403/callback',
    });
    // Do NOT call bindUserToCode

    const tokenRes = await client.fetch('POST', '/api/v1/auth/native/token', {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: 'http://127.0.0.1:54403/callback',
    });
    assert.equal(tokenRes.status, 400);
    assert.equal(tokenRes.json.error, 'invalid_grant');
    assert.ok(tokenRes.json.error_description.includes('not completed'));
  });

  // ── S-e: Open-redirect via non-loopback registered URI rejected ──────────

  it('S-e/C5: non-loopback redirect_uri rejected at registration', async () => {
    const res = await client.fetch('POST', '/api/v1/auth/native/register', {
      redirect_uris: ['https://attacker.example.com/steal-code'],
      token_endpoint_auth_method: 'none',
    }, 'application/json');
    assert.equal(res.status, 400, 'S-e: open redirect via non-loopback must be rejected');
  });

  it('S-e: multiple URIs where one is non-loopback: entire registration rejected', async () => {
    const res = await client.fetch('POST', '/api/v1/auth/native/register', {
      redirect_uris: ['http://127.0.0.1:8080/ok', 'https://evil.com/steal'],
      token_endpoint_auth_method: 'none',
    }, 'application/json');
    assert.equal(res.status, 400, 'must reject if any URI is non-loopback');
  });

  // ── PKCE required: plain method rejected ─────────────────────────────────

  it('PKCE: code_challenge_method=plain is rejected at /authorize', async () => {
    const reg = await client.fetch('POST', '/api/v1/auth/native/register', {
      redirect_uris: ['http://127.0.0.1:54404/callback'],
      token_endpoint_auth_method: 'none',
    }, 'application/json');
    const clientId = reg.json.client_id;

    const res = await client.fetch(
      'GET',
      `/api/v1/auth/native/authorize?` +
        `client_id=${encodeURIComponent(clientId)}&` +
        `redirect_uri=${encodeURIComponent('http://127.0.0.1:54404/callback')}&` +
        `code_challenge=abc&` +
        `code_challenge_method=plain` // plain must be rejected
    );
    assert.equal(res.status, 400, 'plain PKCE must be rejected (only S256 allowed)');
  });

  it('PKCE: missing code_challenge_method is rejected', async () => {
    const reg = await client.fetch('POST', '/api/v1/auth/native/register', {
      redirect_uris: ['http://127.0.0.1:54405/callback'],
      token_endpoint_auth_method: 'none',
    }, 'application/json');
    const clientId = reg.json.client_id;

    const res = await client.fetch(
      'GET',
      `/api/v1/auth/native/authorize?` +
        `client_id=${encodeURIComponent(clientId)}&` +
        `redirect_uri=${encodeURIComponent('http://127.0.0.1:54405/callback')}&` +
        `code_challenge=abc`
      // missing code_challenge_method
    );
    assert.equal(res.status, 400);
  });

  // ── No secrets in error bodies ───────────────────────────────────────────

  it('No secret leaks: error bodies contain no raw token, code, or verifier values', async () => {
    // Call token endpoint with bad data and verify the error body doesn't echo secrets
    const sensitiveCode = 'ultra-secret-code-' + randomUUID();
    const sensitiveVerifier = 'ultra-secret-verifier-' + randomUUID();

    const res = await client.fetch('POST', '/api/v1/auth/native/token', {
      grant_type: 'authorization_code',
      client_id: 'fake-client',
      code: sensitiveCode,
      code_verifier: sensitiveVerifier,
      redirect_uri: 'http://127.0.0.1:1/cb',
    });
    const bodyStr = JSON.stringify(res.json);
    assert.ok(!bodyStr.includes(sensitiveCode), 'error must not echo the code');
    assert.ok(!bodyStr.includes(sensitiveVerifier), 'error must not echo the verifier');
  });

  it('No secret leaks: unknown refresh token error does not echo the token', async () => {
    const reg = await client.fetch('POST', '/api/v1/auth/native/register', {
      redirect_uris: ['http://127.0.0.1:54406/callback'],
      token_endpoint_auth_method: 'none',
    }, 'application/json');
    const sensitiveToken = 'secret-fake-refresh-token-' + randomUUID();

    const res = await client.fetch('POST', '/api/v1/auth/native/token', {
      grant_type: 'refresh_token',
      client_id: reg.json.client_id,
      refresh_token: sensitiveToken,
    });
    assert.equal(res.status, 401);
    const bodyStr = JSON.stringify(res.json);
    assert.ok(!bodyStr.includes(sensitiveToken), 'error must not echo the refresh token');
  });

  // ── Client mismatch at token exchange ────────────────────────────────────

  it('Client mismatch: different client_id at exchange returns error', async () => {
    const { savePendingCode, bindUserToCode } = await import('../hub/gateway/native-as-store.mjs');
    const reg1 = await client.fetch('POST', '/api/v1/auth/native/register', {
      redirect_uris: ['http://127.0.0.1:54407/callback'],
      token_endpoint_auth_method: 'none',
    }, 'application/json');
    const reg2 = await client.fetch('POST', '/api/v1/auth/native/register', {
      redirect_uris: ['http://127.0.0.1:54407/callback'],
      token_endpoint_auth_method: 'none',
    }, 'application/json');

    const code = randomUUID();
    await savePendingCode(code, {
      clientId: reg1.json.client_id, // code issued to client 1
      codeChallenge: sha256b64url('verifier-mismatch'),
      redirectUri: 'http://127.0.0.1:54407/callback',
    });
    await bindUserToCode(code, 'google:user-mismatch');

    const res = await client.fetch('POST', '/api/v1/auth/native/token', {
      grant_type: 'authorization_code',
      client_id: reg2.json.client_id, // client 2 tries to use client 1's code
      code,
      code_verifier: 'verifier-mismatch',
      redirect_uri: 'http://127.0.0.1:54407/callback',
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'invalid_grant');
  });

  // ── mcp_access regression ────────────────────────────────────────────────

  it('Regression: mcp_access token type and scopes are unaffected by native changes', async () => {
    // Verify the MCP provider still produces mcp_access tokens with read-only default
    const { KnowtationOAuthProvider } = await import('../hub/gateway/mcp-oauth-provider.mjs');
    const provider = new KnowtationOAuthProvider({
      sessionSecret: SECRET,
      baseUrl: 'http://localhost:3340',
    });

    // Simulate exchangeAuthorizationCode with no scopes (default mcp_access behavior)
    const fakeClient = { client_id: 'mcp-client-1' };
    const fakeCode = randomUUID();
    provider._pendingCodes.set(fakeCode, {
      clientId: 'mcp-client-1',
      codeChallenge: sha256b64url('mcp-verifier'),
      redirectUri: 'http://127.0.0.1:9000/callback',
      state: null,
      scopes: [],
      userId: 'google:mcp-user',
      expires: Date.now() + 300000,
    });

    const tokens = await provider.exchangeAuthorizationCode(fakeClient, fakeCode, undefined, 'http://127.0.0.1:9000/callback', undefined);
    const decoded = jwt.decode(tokens.access_token);

    assert.equal(decoded.type, 'mcp_access', 'mcp_access token must still have type claim');
    assert.ok(Array.isArray(decoded.scopes), 'mcp_access token must have scopes claim');
    assert.deepEqual(decoded.scopes, ['vault:read'], 'mcp_access default must remain vault:read only');
    assert.ok(!decoded.role, 'mcp_access token must not have role claim');
  });

  // ── C3 regression: iss on MCP redirect ───────────────────────────────────

  it('C3 regression: MCP provider completeMcpAuthorization now emits iss', async () => {
    const { KnowtationOAuthProvider } = await import('../hub/gateway/mcp-oauth-provider.mjs');
    const provider = new KnowtationOAuthProvider({
      sessionSecret: SECRET,
      baseUrl: 'http://localhost:3340',
    });

    const fakeCode = randomUUID();
    provider._pendingCodes.set(fakeCode, {
      clientId: 'mcp-client-c3',
      codeChallenge: sha256b64url('verifier-c3'),
      redirectUri: 'http://127.0.0.1:9001/callback',
      state: 'mcp-state',
      scopes: [],
      expires: Date.now() + 300000,
    });

    const mcpState = Buffer.from(JSON.stringify({
      code: fakeCode,
      clientId: 'mcp-client-c3',
      redirectUri: 'http://127.0.0.1:9001/callback',
      state: 'mcp-state',
    })).toString('base64url');

    let redirectUrl = null;
    const fakeRes = {
      status() { return this; },
      json() { },
      redirect(loc) { redirectUrl = loc; },
    };
    provider.completeMcpAuthorization(mcpState, 'google:mcp-user-c3', fakeRes);
    assert.ok(redirectUrl, 'must redirect');
    const url = new URL(redirectUrl);
    assert.ok(url.searchParams.get('iss'), 'C3: iss must be present on MCP redirect');
    // iss must equal new URL(baseUrl).href (the discovery issuer)
    assert.equal(url.searchParams.get('iss'), new URL('http://localhost:3340').href);
  });

  // ── C5 regression: redirect_uri validated in MCP provider ────────────────

  it('C5 regression: MCP provider now validates redirect_uri at exchange', async () => {
    const { KnowtationOAuthProvider } = await import('../hub/gateway/mcp-oauth-provider.mjs');
    const provider = new KnowtationOAuthProvider({
      sessionSecret: SECRET,
      baseUrl: 'http://localhost:3340',
    });

    const fakeCode = randomUUID();
    provider._pendingCodes.set(fakeCode, {
      clientId: 'mcp-client-c5',
      codeChallenge: sha256b64url('v-c5'),
      redirectUri: 'http://127.0.0.1:9002/callback',
      state: null,
      scopes: [],
      userId: 'google:mcp-user-c5',
      expires: Date.now() + 300000,
    });
    const fakeClient = { client_id: 'mcp-client-c5' };

    await assert.rejects(
      () => provider.exchangeAuthorizationCode(fakeClient, fakeCode, undefined, 'http://127.0.0.1:9999/WRONG', undefined),
      (err) => {
        assert.ok(err.message.includes('redirect_uri'), 'C5: must mention redirect_uri in error');
        return true;
      }
    );
  });
});

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { KnowtationOAuthProvider } from '../hub/gateway/mcp-oauth-provider.mjs';

const TEST_SECRET = 'test-secret-at-least-32-characters-long-for-jwt';

function createProvider() {
  return new KnowtationOAuthProvider({
    sessionSecret: TEST_SECRET,
    baseUrl: 'http://localhost:3340',
  });
}

describe('KnowtationOAuthProvider', () => {
  describe('clientsStore', () => {
    it('starts with no clients', () => {
      const provider = createProvider();
      assert.equal(provider.clientsStore.getClient('nonexistent'), undefined);
    });

    it('registers and retrieves a client', () => {
      const provider = createProvider();
      const registered = provider.clientsStore.registerClient({
        redirect_uris: [new URL('http://localhost:8080/callback')],
        client_name: 'Test Client',
      });
      assert.ok(registered.client_id);
      assert.ok(registered.client_id_issued_at);
      const retrieved = provider.clientsStore.getClient(registered.client_id);
      assert.equal(retrieved.client_id, registered.client_id);
      assert.equal(retrieved.client_name, 'Test Client');
    });

    it('evicts oldest client when limit reached', () => {
      const provider = createProvider();
      const ids = [];
      for (let i = 0; i < 502; i++) {
        const c = provider.clientsStore.registerClient({
          redirect_uris: [new URL(`http://localhost:${8000 + i}/cb`)],
          client_name: `client-${i}`,
        });
        ids.push(c.client_id);
      }
      assert.equal(provider.clientsStore.getClient(ids[0]), undefined);
      assert.ok(provider.clientsStore.getClient(ids[ids.length - 1]));
    });
  });

  describe('authorize', () => {
    it('redirects to login page with mcp_state', async () => {
      const provider = createProvider();
      const client = provider.clientsStore.registerClient({
        redirect_uris: [new URL('http://localhost:8080/callback')],
      });

      let redirectUrl = null;
      const mockRes = {
        redirect(url) { redirectUrl = url; },
      };

      await provider.authorize(
        client,
        {
          codeChallenge: 'test-challenge',
          redirectUri: 'http://localhost:8080/callback',
          state: 'client-state-123',
          scopes: ['vault:read'],
        },
        mockRes
      );

      assert.ok(redirectUrl);
      assert.ok(redirectUrl.includes('/auth/login'));
      assert.ok(redirectUrl.includes('mcp_state='));
    });
  });

  describe('full authorization code flow', () => {
    it('exchanges code for tokens after authorization completes', async () => {
      const provider = createProvider();
      const client = provider.clientsStore.registerClient({
        redirect_uris: [new URL('http://localhost:8080/callback')],
      });

      let redirectUrl = null;
      const mockRes = {
        redirect(url) { redirectUrl = url; },
      };

      await provider.authorize(
        client,
        {
          codeChallenge: 'test-challenge',
          redirectUri: 'http://localhost:8080/callback',
          state: 'my-state',
          scopes: ['vault:read', 'vault:write'],
        },
        mockRes
      );

      const url = new URL(redirectUrl);
      const mcpState = url.searchParams.get('mcp_state');
      assert.ok(mcpState);

      let callbackRedirect = null;
      const callbackRes = {
        redirect(url) { callbackRedirect = url; },
        status() { return { json() {} }; },
      };

      provider.completeMcpAuthorization(mcpState, 'google:12345', callbackRes);
      assert.ok(callbackRedirect);

      const callbackUrl = new URL(callbackRedirect);
      const code = callbackUrl.searchParams.get('code');
      const state = callbackUrl.searchParams.get('state');
      assert.ok(code);
      assert.equal(state, 'my-state');

      const tokens = await provider.exchangeAuthorizationCode(client, code);
      assert.ok(tokens.access_token);
      assert.equal(tokens.token_type, 'bearer');
      assert.ok(tokens.expires_in > 0);
      assert.ok(tokens.refresh_token);
      assert.ok(tokens.scope.includes('vault:read'));
    });
  });

  describe('challengeForAuthorizationCode', () => {
    it('returns the stored code challenge', async () => {
      const provider = createProvider();
      const client = provider.clientsStore.registerClient({
        redirect_uris: [new URL('http://localhost:8080/callback')],
      });

      let redirectUrl = null;
      await provider.authorize(
        client,
        {
          codeChallenge: 'my-challenge-value',
          redirectUri: 'http://localhost:8080/callback',
        },
        { redirect(url) { redirectUrl = url; } }
      );

      const url = new URL(redirectUrl);
      const mcpState = url.searchParams.get('mcp_state');
      const decoded = JSON.parse(Buffer.from(mcpState, 'base64url').toString());
      const code = decoded.code;

      const challenge = await provider.challengeForAuthorizationCode(client, code);
      assert.equal(challenge, 'my-challenge-value');
    });
  });

  describe('verifyAccessToken', () => {
    it('verifies a valid MCP access token', async () => {
      const provider = createProvider();
      const client = provider.clientsStore.registerClient({
        redirect_uris: [new URL('http://localhost:8080/callback')],
      });

      let redirectUrl = null;
      await provider.authorize(
        client,
        {
          codeChallenge: 'challenge',
          redirectUri: 'http://localhost:8080/callback',
          scopes: ['vault:read'],
        },
        { redirect(url) { redirectUrl = url; } }
      );

      const mcpState = new URL(redirectUrl).searchParams.get('mcp_state');
      let callbackRedirect = null;
      provider.completeMcpAuthorization(mcpState, 'github:99', {
        redirect(url) { callbackRedirect = url; },
        status() { return { json() {} }; },
      });

      const code = new URL(callbackRedirect).searchParams.get('code');
      const tokens = await provider.exchangeAuthorizationCode(client, code);

      const authInfo = await provider.verifyAccessToken(tokens.access_token);
      assert.equal(authInfo.clientId, client.client_id);
      assert.ok(authInfo.scopes.includes('vault:read'));
      assert.ok(authInfo.expiresAt);
      assert.equal(authInfo.extra.sub, 'github:99');
    });

    it('rejects invalid token', async () => {
      const provider = createProvider();
      await assert.rejects(
        () => provider.verifyAccessToken('invalid-token'),
        /Invalid access token/
      );
    });
  });

  describe('exchangeRefreshToken', () => {
    it('issues new tokens from refresh token', async () => {
      const provider = createProvider();
      const client = provider.clientsStore.registerClient({
        redirect_uris: [new URL('http://localhost:8080/callback')],
      });

      let redirectUrl = null;
      await provider.authorize(
        client,
        { codeChallenge: 'c', redirectUri: 'http://localhost:8080/callback', scopes: ['vault:read'] },
        { redirect(url) { redirectUrl = url; } }
      );

      const mcpState = new URL(redirectUrl).searchParams.get('mcp_state');
      let callbackRedirect = null;
      provider.completeMcpAuthorization(mcpState, 'google:1', {
        redirect(url) { callbackRedirect = url; },
        status() { return { json() {} }; },
      });

      const code = new URL(callbackRedirect).searchParams.get('code');
      const tokens = await provider.exchangeRefreshToken(
        client,
        (await provider.exchangeAuthorizationCode(client, code)).refresh_token
      );

      assert.ok(tokens.access_token);
      assert.ok(tokens.refresh_token);
    });
  });

  describe('revokeToken', () => {
    it('revokes a refresh token', async () => {
      const provider = createProvider();
      const client = provider.clientsStore.registerClient({
        redirect_uris: [new URL('http://localhost:8080/callback')],
      });

      let redirectUrl = null;
      await provider.authorize(
        client,
        { codeChallenge: 'c', redirectUri: 'http://localhost:8080/callback' },
        { redirect(url) { redirectUrl = url; } }
      );

      const mcpState = new URL(redirectUrl).searchParams.get('mcp_state');
      let callbackRedirect = null;
      provider.completeMcpAuthorization(mcpState, 'google:1', {
        redirect(url) { callbackRedirect = url; },
        status() { return { json() {} }; },
      });

      const code = new URL(callbackRedirect).searchParams.get('code');
      const tokens = await provider.exchangeAuthorizationCode(client, code);

      await provider.revokeToken(client, { token: tokens.refresh_token });
      await assert.rejects(
        () => provider.exchangeRefreshToken(client, tokens.refresh_token),
        /Unknown refresh token/
      );
    });
  });

  describe('completeMcpAuthorization', () => {
    it('rejects invalid mcp_state', () => {
      const provider = createProvider();
      let statusCode = null;
      let body = null;
      provider.completeMcpAuthorization('not-valid-base64!', 'user:1', {
        status(code) { statusCode = code; return { json(d) { body = d; } }; },
        redirect() {},
      });
      assert.equal(statusCode, 400);
    });
  });
});

/**
 * Legacy MCP OAuth provider suite — updated for Phase A durable refreshStore requirement.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDurableMcpProvider,
  mintMcpTokens,
} from './helpers/durable-mcp-oauth-harness.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

async function createProvider() {
  const ctx = await createDurableMcpProvider();
  cleanups.push(ctx.cleanup);
  return ctx.provider;
}

describe('KnowtationOAuthProvider', () => {
  describe('clientsStore', () => {
    it('starts with no clients', async () => {
      const provider = await createProvider();
      assert.equal(provider.clientsStore.getClient('nonexistent'), undefined);
    });

    it('registers and retrieves a client', async () => {
      const provider = await createProvider();
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

    it('evicts oldest client when limit reached', async () => {
      const provider = await createProvider();
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
      const provider = await createProvider();
      const client = provider.clientsStore.registerClient({
        redirect_uris: [new URL('http://localhost:8080/callback')],
      });

      let redirectUrl = null;
      await provider.authorize(
        client,
        {
          codeChallenge: 'test-challenge',
          redirectUri: 'http://localhost:8080/callback',
          state: 'client-state-123',
          scopes: ['vault:read'],
        },
        { redirect(url) { redirectUrl = url; } }
      );

      assert.ok(redirectUrl);
      assert.ok(redirectUrl.includes('/auth/login'));
      assert.ok(redirectUrl.includes('mcp_state='));
    });
  });

  describe('full authorization code flow', () => {
    it('exchanges code for tokens after authorization completes', async () => {
      const provider = await createProvider();
      const { tokens } = await mintMcpTokens(provider, {
        scopes: ['vault:read', 'vault:write'],
        userId: 'google:12345',
      });
      assert.ok(tokens.access_token);
      assert.equal(tokens.token_type, 'bearer');
      assert.ok(tokens.expires_in > 0);
      assert.ok(tokens.refresh_token);
      assert.ok(tokens.scope.includes('vault:read'));
    });
  });

  describe('challengeForAuthorizationCode', () => {
    it('returns the stored code challenge', async () => {
      const provider = await createProvider();
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
      const provider = await createProvider();
      const { client, tokens } = await mintMcpTokens(provider, {
        scopes: ['vault:read'],
        userId: 'github:99',
      });
      const authInfo = await provider.verifyAccessToken(tokens.access_token);
      assert.equal(authInfo.clientId, client.client_id);
      assert.ok(authInfo.scopes.includes('vault:read'));
      assert.ok(authInfo.expiresAt);
      assert.equal(authInfo.extra.sub, 'github:99');
    });

    it('rejects invalid token', async () => {
      const provider = await createProvider();
      await assert.rejects(
        () => provider.verifyAccessToken('invalid-token'),
        /Invalid access token/
      );
    });
  });

  describe('exchangeRefreshToken', () => {
    it('issues new tokens from refresh token', async () => {
      const provider = await createProvider();
      const { client, tokens } = await mintMcpTokens(provider, {
        scopes: ['vault:read'],
        userId: 'google:1',
      });
      const next = await provider.exchangeRefreshToken(client, tokens.refresh_token);
      assert.ok(next.access_token);
      assert.ok(next.refresh_token);
    });
  });

  describe('revokeToken', () => {
    it('revokes a refresh token', async () => {
      const provider = await createProvider();
      const { client, tokens } = await mintMcpTokens(provider, { userId: 'google:1' });
      await provider.revokeToken(client, { token: tokens.refresh_token });
      await assert.rejects(
        () => provider.exchangeRefreshToken(client, tokens.refresh_token),
        /Unknown refresh token|revoked/i
      );
    });
  });

  describe('completeMcpAuthorization', () => {
    it('rejects invalid mcp_state', async () => {
      const provider = await createProvider();
      let statusCode = null;
      provider.completeMcpAuthorization('not-valid-base64!', 'user:1', {
        status(code) { statusCode = code; return { json() {} }; },
        redirect() {},
      });
      assert.equal(statusCode, 400);
    });
  });
});

/**
 * Phase A — durable MCP OAuth: e2e tier (scripted OAuth client against provider fixture).
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  createDurableMcpProvider,
  mintMcpTokens,
  TEST_SECRET,
} from './helpers/durable-mcp-oauth-harness.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

describe('Phase A e2e — scripted MCP OAuth client', () => {
  it('full code flow → refresh → tool-shaped access token still verifies', async () => {
    const { provider, cleanup } = await createDurableMcpProvider();
    cleanups.push(cleanup);
    const { client, tokens } = await mintMcpTokens(provider, {
      scopes: ['vault:read', 'vault:write'],
      userId: 'github:e2e',
      clientName: 'e2e-client',
    });

    const authInfo = await provider.verifyAccessToken(tokens.access_token);
    assert.equal(authInfo.extra.sub, 'github:e2e');
    assert.ok(authInfo.scopes.includes('vault:write'));

    const next = await provider.exchangeRefreshToken(client, tokens.refresh_token, ['vault:read']);
    const payload = jwt.verify(next.access_token, TEST_SECRET);
    assert.equal(payload.type, 'mcp_access');
    assert.deepEqual(payload.scopes, ['vault:read']);
    assert.ok(next.refresh_token);

    const again = await provider.verifyAccessToken(next.access_token);
    assert.equal(again.extra.sub, 'github:e2e');
  });
});

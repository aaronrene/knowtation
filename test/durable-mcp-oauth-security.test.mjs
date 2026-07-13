/**
 * Phase A — durable MCP OAuth: security tier.
 * reuse → family revoke; revoked rejected; no secrets in logs; mcp_access scope on REST.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  createDurableMcpProvider,
  mintMcpTokens,
  TEST_SECRET,
} from './helpers/durable-mcp-oauth-harness.mjs';
import { subFromVerifiedPayload } from '../hub/gateway/access-token-authz.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

describe('Phase A security — refresh reuse / revoke / logging', () => {
  it('replaying a rotated refresh revokes the family and rejects further use', async () => {
    const { provider, cleanup } = await createDurableMcpProvider();
    cleanups.push(cleanup);
    const { client, tokens } = await mintMcpTokens(provider, { scopes: ['vault:read'] });
    const firstRefresh = tokens.refresh_token;
    const rotated = await provider.exchangeRefreshToken(client, firstRefresh);
    assert.ok(rotated.refresh_token);

    await assert.rejects(
      () => provider.exchangeRefreshToken(client, firstRefresh),
      /reuse|revoked|Unknown/i
    );
    await assert.rejects(
      () => provider.exchangeRefreshToken(client, rotated.refresh_token),
      /revoked|Unknown|reuse/i
    );
  });

  it('explicit revoke rejects subsequent refresh', async () => {
    const { provider, cleanup } = await createDurableMcpProvider();
    cleanups.push(cleanup);
    const { client, tokens } = await mintMcpTokens(provider);
    await provider.revokeToken(client, { token: tokens.refresh_token });
    await assert.rejects(
      () => provider.exchangeRefreshToken(client, tokens.refresh_token),
      /revoked|Unknown/
    );
  });

  it('error paths never include raw refresh secrets', async () => {
    const { provider, cleanup } = await createDurableMcpProvider();
    cleanups.push(cleanup);
    const { client, tokens } = await mintMcpTokens(provider);
    const secret = tokens.refresh_token;
    try {
      await provider.exchangeRefreshToken(client, 'not-a-token');
      assert.fail('expected throw');
    } catch (e) {
      assert.ok(!String(e.message).includes(secret));
      assert.ok(!String(e.stack || '').includes(secret.split('.')[1] || '___'));
    }
  });

  it('confused deputy: mcp_access vault:read MUST NOT authorize REST writes', () => {
    const access = jwt.sign(
      { sub: 'google:deputy', client_id: 'c', scopes: ['vault:read'], type: 'mcp_access' },
      TEST_SECRET,
      { expiresIn: 3600 }
    );
    const payload = jwt.verify(access, TEST_SECRET);
    assert.equal(subFromVerifiedPayload(payload, { method: 'GET' }), 'google:deputy');
    assert.equal(
      subFromVerifiedPayload(payload, { method: 'POST' }),
      null,
      'vault:read mcp_access must not write over REST'
    );
    assert.equal(subFromVerifiedPayload(payload, { method: 'PUT' }), null);
    assert.equal(subFromVerifiedPayload(payload, { method: 'DELETE' }), null);
    assert.equal(subFromVerifiedPayload(payload, { method: 'PATCH' }), null);
  });

  it('mcp_access with vault:write may mutate REST (identity only; role still separate)', () => {
    const payload = {
      sub: 'google:writer',
      type: 'mcp_access',
      scopes: ['vault:read', 'vault:write'],
    };
    assert.equal(subFromVerifiedPayload(payload, { method: 'POST' }), 'google:writer');
  });
});

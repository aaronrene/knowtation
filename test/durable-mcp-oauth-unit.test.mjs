/**
 * Phase A — durable MCP OAuth: unit tier.
 * TTL alignment, hash-at-rest via refresh-token-core store, agent meta, provider wiring.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import {
  createDurableMcpProvider,
  mintMcpTokens,
  TEST_SECRET,
} from './helpers/durable-mcp-oauth-harness.mjs';
import {
  DEFAULT_TOKEN_TTL_MS,
  DEFAULT_FAMILY_TTL_MS,
  sanitizeMeta,
  mergeMeta,
} from '../hub/lib/refresh-token-core.mjs';
import {
  MCP_TOKEN_EXPIRY_SECONDS,
  resolveMcpAgentLabel,
  KnowtationOAuthProvider,
} from '../hub/gateway/mcp-oauth-provider.mjs';
import {
  subFromVerifiedPayload,
  mcpScopesPermitMethod,
  shouldMountDurableAgentAuth,
} from '../hub/gateway/access-token-authz.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    await fn();
  }
});

describe('Phase A unit — MCP durable refresh', () => {
  it('access TTL is ≤ 1h and refresh TTLs match refresh-token-core defaults', () => {
    assert.equal(MCP_TOKEN_EXPIRY_SECONDS, 3600);
    assert.equal(DEFAULT_TOKEN_TTL_MS, 30 * 24 * 60 * 60 * 1000);
    assert.equal(DEFAULT_FAMILY_TTL_MS, 90 * 24 * 60 * 60 * 1000);
  });

  it('sanitizeMeta keeps agent / client_id / scopes and drops unknown fields', () => {
    const meta = sanitizeMeta({
      agent: 'Hermes-bf',
      client_id: 'abc',
      scopes: 'vault:read vault:write',
      evil: { nested: true },
      ua: 'x'.repeat(400),
    });
    assert.equal(meta.agent, 'Hermes-bf');
    assert.equal(meta.client_id, 'abc');
    assert.equal(meta.scopes, 'vault:read vault:write');
    assert.equal(meta.evil, undefined);
    assert.equal(meta.ua.length, 256);
  });

  it('mergeMeta preserves agent across rotate when incoming meta is empty', () => {
    const merged = mergeMeta({ agent: 'A', client_id: 'c1', scopes: 'vault:read' }, {});
    assert.equal(merged.agent, 'A');
    assert.equal(merged.client_id, 'c1');
  });

  it('resolveMcpAgentLabel prefers client_name then client_id', () => {
    assert.equal(resolveMcpAgentLabel({ client_name: 'Hermes', client_id: 'id1' }), 'Hermes');
    assert.equal(resolveMcpAgentLabel({ client_id: 'id1' }), 'id1');
    assert.equal(resolveMcpAgentLabel({ client_id: 'id1' }, 'override'), 'override');
  });

  it('KnowtationOAuthProvider requires refreshStore', () => {
    assert.throws(
      () => new KnowtationOAuthProvider({ sessionSecret: TEST_SECRET, baseUrl: 'http://localhost:3340' }),
      /refreshStore/
    );
  });

  it('issued refresh is hash-at-rest (raw secret absent from store file)', async () => {
    const { provider, cleanup, dir } = await createDurableMcpProvider();
    cleanups.push(cleanup);
    const { tokens } = await mintMcpTokens(provider, { clientName: 'Cursor IDE' });
    const secret = tokens.refresh_token.split('.')[1];
    const raw = await fs.readFile(path.join(dir, 'hosted_refresh_tokens.json'), 'utf8');
    assert.ok(!raw.includes(secret), 'raw refresh secret must not appear in store file');
    assert.ok(!raw.includes(tokens.access_token), 'access JWT must not be persisted in refresh store');
    const payload = jwt.verify(tokens.access_token, TEST_SECRET);
    assert.equal(payload.type, 'mcp_access');
    assert.equal(payload.scopes[0], 'vault:read');
  });

  it('refresh record meta includes agent label from client_name', async () => {
    const { provider, store, cleanup } = await createDurableMcpProvider();
    cleanups.push(cleanup);
    const { tokens } = await mintMcpTokens(provider, { clientName: 'Hermes-cofounder-1' });
    const peeked = await store.peek(tokens.refresh_token);
    assert.ok(peeked);
    assert.equal(peeked.meta.agent, 'Hermes-cofounder-1');
    assert.ok(peeked.meta.client_id);
    assert.equal(peeked.meta.scopes, 'vault:read');
  });
});

describe('Phase A unit — MCP scope REST guard helpers', () => {
  it('vault:read permits GET but not POST', () => {
    assert.equal(mcpScopesPermitMethod(['vault:read'], 'GET'), true);
    assert.equal(mcpScopesPermitMethod(['vault:read'], 'POST'), false);
    assert.equal(mcpScopesPermitMethod(['vault:write'], 'POST'), true);
  });

  it('subFromVerifiedPayload blocks mcp_access vault:read on mutating methods', () => {
    const payload = { sub: 'google:1', type: 'mcp_access', scopes: ['vault:read'] };
    assert.equal(subFromVerifiedPayload(payload, { method: 'GET' }), 'google:1');
    assert.equal(subFromVerifiedPayload(payload, { method: 'POST' }), null);
  });

  it('web session JWT (no mcp_access type) is not scope-blocked here', () => {
    const payload = { sub: 'google:1', role: 'member' };
    assert.equal(subFromVerifiedPayload(payload, { method: 'POST' }), 'google:1');
  });

  it('shouldMountDurableAgentAuth is false under offline-lock or Netlify', () => {
    assert.equal(shouldMountDurableAgentAuth({
      sessionSecret: 'x', netlify: false, offlineLockedActive: false,
    }), true);
    assert.equal(shouldMountDurableAgentAuth({
      sessionSecret: 'x', netlify: false, offlineLockedActive: true,
    }), false);
    assert.equal(shouldMountDurableAgentAuth({
      sessionSecret: 'x', netlify: true, offlineLockedActive: false,
    }), false);
  });
});

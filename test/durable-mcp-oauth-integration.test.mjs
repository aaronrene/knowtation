/**
 * Phase A — durable MCP OAuth: integration tier.
 * authorize → token → refresh → restart (new provider, same store) still works;
 * offline-lock mount guard asserted via shouldMountDurableAgentAuth + server source.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDurableMcpProvider,
  mintMcpTokens,
  TEST_SECRET,
  createTempStrongStore,
} from './helpers/durable-mcp-oauth-harness.mjs';
import { KnowtationOAuthProvider } from '../hub/gateway/mcp-oauth-provider.mjs';
import { shouldMountDurableAgentAuth } from '../hub/gateway/access-token-authz.mjs';
import { createGatewayRefreshStore } from '../hub/gateway/refresh-token-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

describe('Phase A integration — durable MCP refresh across restart', () => {
  it('refresh survives provider destroy + new provider on same store dir', async () => {
    const tmp = await createTempStrongStore();
    cleanups.push(tmp.cleanup);

    const provider1 = new KnowtationOAuthProvider({
      sessionSecret: TEST_SECRET,
      baseUrl: 'http://localhost:3340',
      refreshStore: tmp.store,
    });
    const { client, tokens } = await mintMcpTokens(provider1, {
      scopes: ['vault:read', 'vault:write'],
      clientName: 'Hermes',
    });
    provider1.destroy();

    // Simulate gateway restart: new provider instance, same strong store.
    const store2 = createGatewayRefreshStore({ consistency: 'strong' });
    const provider2 = new KnowtationOAuthProvider({
      sessionSecret: TEST_SECRET,
      baseUrl: 'http://localhost:3340',
      refreshStore: store2,
    });
    // Client registration is in-memory — re-register same id is not possible; use original
    // client object shape with same client_id for token exchange (SDK would re-discover).
    const refreshed = await provider2.exchangeRefreshToken(client, tokens.refresh_token);
    assert.ok(refreshed.access_token);
    assert.ok(refreshed.refresh_token);
    assert.notEqual(refreshed.refresh_token, tokens.refresh_token);
  });

  it('strong store ignores blob global (MCP refresh never uses eventual blob)', async () => {
    const { provider, store, cleanup } = await createDurableMcpProvider();
    cleanups.push(cleanup);
    assert.equal(store.consistency, 'strong');
    const blobWrites = { n: 0 };
    globalThis.__knowtation_gateway_auth_blob = {
      async get() { return null; },
      async setJSON() { blobWrites.n += 1; },
    };
    try {
      await mintMcpTokens(provider);
      assert.equal(blobWrites.n, 0, 'strong store must not write to blob');
    } finally {
      delete globalThis.__knowtation_gateway_auth_blob;
    }
  });

  it('offline-lock: durable agent auth must not mount', () => {
    assert.equal(shouldMountDurableAgentAuth({
      sessionSecret: 'secret',
      netlify: false,
      offlineLockedActive: true,
    }), false);
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'hub/gateway/server.mjs'),
      'utf8'
    );
    assert.ok(src.includes('shouldMountDurableAgentAuth'), 'server must gate on helper');
    assert.ok(src.includes('offline-locked mode'), 'server documents offline-lock skip');
    assert.ok(src.includes('refreshStore'), 'MCP provider must receive refreshStore');
  });
});

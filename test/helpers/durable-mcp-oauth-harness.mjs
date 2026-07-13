/**
 * Shared helpers for durable MCP OAuth Phase A tests.
 * Uses a strong-consistency gateway refresh store on a temp data dir.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { KnowtationOAuthProvider } from '../../hub/gateway/mcp-oauth-provider.mjs';
import { createGatewayRefreshStore } from '../../hub/gateway/refresh-token-store.mjs';

export const TEST_SECRET = 'test-secret-at-least-32-characters-long-for-jwt';

/**
 * @returns {Promise<{ dir: string, store: ReturnType<typeof createGatewayRefreshStore>, cleanup: () => Promise<void> }>}
 */
export async function createTempStrongStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ktn-mcp-oauth-'));
  const prev = process.env.KNOWTATION_GATEWAY_DATA_DIR;
  process.env.KNOWTATION_GATEWAY_DATA_DIR = dir;
  // Ensure blob global cannot win over strong consistency.
  delete globalThis.__knowtation_gateway_auth_blob;
  const store = createGatewayRefreshStore({ consistency: 'strong' });
  return {
    dir,
    store,
    async cleanup() {
      if (prev === undefined) delete process.env.KNOWTATION_GATEWAY_DATA_DIR;
      else process.env.KNOWTATION_GATEWAY_DATA_DIR = prev;
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * @param {object} [opts]
 * @returns {Promise<{ provider: KnowtationOAuthProvider, store: object, cleanup: () => Promise<void> }>}
 */
export async function createDurableMcpProvider(opts = {}) {
  const tmp = await createTempStrongStore();
  const provider = new KnowtationOAuthProvider({
    sessionSecret: opts.sessionSecret || TEST_SECRET,
    baseUrl: opts.baseUrl || 'http://localhost:3340',
    refreshStore: tmp.store,
    agentLabel: opts.agentLabel,
  });
  return { provider, store: tmp.store, cleanup: tmp.cleanup, dir: tmp.dir };
}

/**
 * Drive authorize → complete → exchangeAuthorizationCode.
 * @param {KnowtationOAuthProvider} provider
 * @param {{ scopes?: string[], clientName?: string, userId?: string }} [opts]
 */
export async function mintMcpTokens(provider, opts = {}) {
  const client = provider.clientsStore.registerClient({
    redirect_uris: [new URL('http://localhost:8080/callback')],
    client_name: opts.clientName || 'Hermes Agent',
  });
  let redirectUrl = null;
  await provider.authorize(
    client,
    {
      codeChallenge: 'test-challenge',
      redirectUri: 'http://localhost:8080/callback',
      state: 'st',
      scopes: opts.scopes || ['vault:read'],
    },
    { redirect(url) { redirectUrl = url; } }
  );
  const mcpState = new URL(redirectUrl).searchParams.get('mcp_state');
  let callbackRedirect = null;
  provider.completeMcpAuthorization(mcpState, opts.userId || 'google:phase-a', {
    redirect(url) { callbackRedirect = url; },
    status() { return { json() {} }; },
  });
  const code = new URL(callbackRedirect).searchParams.get('code');
  const tokens = await provider.exchangeAuthorizationCode(client, code);
  return { client, tokens };
}

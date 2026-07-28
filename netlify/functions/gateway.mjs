/**
 * Netlify serverless wrapper for the Knowtation Hub Gateway.
 * Redirects all traffic to this function; the Express app handles /auth/* and /api/*.
 * Persists hosted billing state in Netlify Blobs (store `gateway-billing`).
 */
import serverless from 'serverless-http';
import { connectLambda, getStore } from '@netlify/blobs';
import { app } from '../../hub/gateway/server.mjs';

export const handler = async (event, context) => {
  connectLambda(event);
  globalThis.__knowtation_gateway_blob = getStore({ name: 'gateway-billing', consistency: 'eventual' });
  globalThis.__knowtation_attest_blob = getStore({ name: 'gateway-attestation', consistency: 'eventual' });
  // Refresh-token store. Strong consistency is NOT available here: this gateway runs in Netlify's
  // Lambda compatibility mode (serverless-http + connectLambda), which wires up only edge
  // (eventual) access and omits the `uncachedEdgeURL` that strong-consistency reads require — a
  // strong read throws BlobsConsistencyError, which previously blocked every refresh-cookie write.
  // We therefore use eventual consistency (same as the billing store). Reuse detection still holds
  // after edge propagation (<60s, usually sub-second); see the trade-off note and hardening options
  // in hub/gateway/refresh-token-store.mjs.
  globalThis.__knowtation_gateway_auth_blob = getStore({ name: 'gateway-auth', consistency: 'eventual' });
  // Phase C — dedicated agent-credential store (never refresh-tokens-v1 / gateway-auth).
  globalThis.__knowtation_gateway_agent_cred_blob = getStore({
    name: 'gateway-agent-credentials',
    consistency: 'eventual',
  });
  try {
    return await serverless(app)(event, context);
  } finally {
    delete globalThis.__knowtation_gateway_blob;
    delete globalThis.__knowtation_attest_blob;
    delete globalThis.__knowtation_gateway_auth_blob;
    delete globalThis.__knowtation_gateway_agent_cred_blob;
  }
};

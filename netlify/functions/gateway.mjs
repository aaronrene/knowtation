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
  // Auth/refresh tokens need read-after-write (strong) consistency so a replayed token is seen
  // as already-consumed and reuse detection (family revocation) fires reliably. See
  // hub/gateway/refresh-token-store.mjs.
  globalThis.__knowtation_gateway_auth_blob = getStore({ name: 'gateway-auth', consistency: 'strong' });
  try {
    return await serverless(app)(event, context);
  } finally {
    delete globalThis.__knowtation_gateway_blob;
    delete globalThis.__knowtation_attest_blob;
    delete globalThis.__knowtation_gateway_auth_blob;
  }
};

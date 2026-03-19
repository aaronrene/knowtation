/**
 * Netlify serverless wrapper for the Knowtation Hub Bridge.
 * Use this when you deploy the bridge as a second Netlify site (same repo, redirect to this function).
 * Set the bridge env vars in that site's dashboard; set BRIDGE_URL on the gateway to that site's URL.
 * Attaches Netlify Blob store for persistent tokens + vector DBs.
 */
import serverless from 'serverless-http';
import { connectLambda, getStore } from '@netlify/blobs';
import { app } from '../../hub/bridge/server.mjs';

export const handler = async (event, context) => {
  connectLambda(event);
  // Use eventual consistency only. Strong consistency requires uncachedEdgeURL in the Netlify Functions
  // environment; without it, blob set/get throws BlobsConsistencyError and Connect GitHub crashes.
  // Hub retries /api/v1/settings after ?github_connected=1 to cover read-after-write lag.
  globalThis.__netlify_blob_store = getStore({ name: 'bridge-data', consistency: 'eventual' });
  try {
    return await serverless(app)(event, context);
  } finally {
    delete globalThis.__netlify_blob_store;
  }
};

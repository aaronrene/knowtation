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
  // Temporary: log raw path for 404 verification (remove after debugging).
  console.log('[bridge] event.path=', event.path, 'event.rawUrl=', event.rawUrl ?? '(none)');
  connectLambda(event);
  globalThis.__netlify_blob_store = getStore({ name: 'bridge-data', consistency: 'strong' });
  try {
    return await serverless(app)(event, context);
  } finally {
    delete globalThis.__netlify_blob_store;
  }
};

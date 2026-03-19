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
  // Strong consistency: OAuth callback writes tokens; the next request (gateway → github-status) must see them.
  // Eventual consistency caused Settings to show "Not connected" immediately after a successful Connect GitHub.
  globalThis.__netlify_blob_store = getStore({ name: 'bridge-data', consistency: 'strong' });
  try {
    return await serverless(app)(event, context);
  } finally {
    delete globalThis.__netlify_blob_store;
  }
};

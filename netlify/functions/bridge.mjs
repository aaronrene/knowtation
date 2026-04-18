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
  // Default `eventual` (fast). Set NETLIFY_BLOBS_CONSISTENCY=strong on the **bridge** site for
  // read-after-write on vector blobs (index → search); see Netlify Blobs docs. If strong mode errors
  // at runtime (e.g. missing edge URL), unset the env or revert to eventual.
  const consistency =
    String(process.env.NETLIFY_BLOBS_CONSISTENCY || '')
      .trim()
      .toLowerCase() === 'strong'
      ? 'strong'
      : 'eventual';
  globalThis.__netlify_blob_store = getStore({ name: 'bridge-data', consistency });
  try {
    return await serverless(app)(event, context);
  } finally {
    delete globalThis.__netlify_blob_store;
  }
};

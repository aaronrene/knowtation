/**
 * Netlify Background Function: long-running re-index path for the bridge.
 *
 * The `-background` filename suffix is what tells Netlify to give this function
 * the 15-minute timeout (vs 60 s for synchronous functions like `bridge.mjs`)
 * and to return 202 to the caller within ~50 ms regardless of how long the
 * actual work takes (docs.netlify.com/build/functions/background-functions).
 *
 * How a re-index reaches this function:
 *   1. Browser → `POST /api/v1/index` (proxied to `netlify/functions/bridge.mjs`).
 *   2. Sync handler runs preflight (`lib/bridge-index-preflight-estimate.mjs`)
 *      and decides this work won't fit in 60 s.
 *   3. Sync handler `acquireJobLock` + HTTP-POSTs to THIS endpoint with HMAC
 *      headers (signed by `lib/bridge-internal-hmac.mjs`).
 *   4. THIS function validates the HMAC, mounts the same Express app from
 *      `hub/bridge/server.mjs` (which contains the `POST /api/v1/index` route),
 *      sets `globalThis.__bridge_internal_request` so the route SKIPS the
 *      routing decision and runs inline, then invokes the route via
 *      `serverless-http`.
 *   5. After the route finishes (success OR error), the route's own code
 *      releases the job lock and writes `setLastIndexedAt`.
 *
 * Auth (defense in depth):
 *   - HMAC over `(canisterUid, vaultId, jobId, ts)` signed with `SESSION_SECRET`
 *     proves the request came from the bridge sync handler.
 *   - JWT in `Authorization: Bearer …` is forwarded verbatim from the original
 *     browser request, so `requireBridgeAuth` still requires a real user.
 *   - This function refuses any path other than `POST /api/v1/index` so the
 *     blast radius of a future HMAC bypass would be limited to the same route
 *     a forged sync request could already hit.
 */

import serverless from 'serverless-http';
import { connectLambda, getStore } from '@netlify/blobs';
import { app } from '../../hub/bridge/server.mjs';
import { verifyInternalRequest } from '../../lib/bridge-internal-hmac.mjs';

/**
 * Reject anything other than `POST` to the index route. Defense-in-depth: the
 * HMAC + JWT already gate the request, but this is one more belt so a future
 * routing mistake cannot accidentally expose another endpoint.
 */
function isAllowedRoute(httpMethod, path) {
  if (httpMethod !== 'POST') return false;
  if (typeof path !== 'string') return false;
  // Netlify forwards the original request path, possibly prefixed with the
  // function path. Accept any of: `/api/v1/index`, `/.netlify/functions/bridge-index-background`,
  // `/.netlify/functions/bridge-index-background/api/v1/index`.
  if (path === '/api/v1/index') return true;
  if (path === '/.netlify/functions/bridge-index-background') return true;
  if (path === '/.netlify/functions/bridge-index-background/') return true;
  if (path === '/.netlify/functions/bridge-index-background/api/v1/index') return true;
  return false;
}

export const handler = async (event, context) => {
  const headers = (event && event.headers) || {};
  const httpMethod = (event && event.httpMethod) || 'POST';
  const eventPath = (event && (event.path || event.rawPath)) || '';

  // 1. Route guard.
  if (!isAllowedRoute(httpMethod, eventPath)) {
    return {
      statusCode: 404,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Not found' }),
    };
  }

  // 2. HMAC validation. The shared secret must match what the sync function
  //    (running with the SAME `SESSION_SECRET` env var) used to sign the request.
  //    `HUB_JWT_SECRET` is checked as a legacy fallback to match `userIdFromJwt`
  //    in `hub/bridge/server.mjs`.
  const secret = process.env.SESSION_SECRET || process.env.HUB_JWT_SECRET || '';
  const verified = verifyInternalRequest(secret, {
    canisterUid: headers['x-bridge-internal-uid'],
    vaultId: headers['x-bridge-internal-vault-id'],
    jobId: headers['x-bridge-internal-job-id'],
    ts: headers['x-bridge-internal-ts'],
    sig: headers['x-bridge-internal-sig'],
  });
  if (!verified.ok) {
    console.warn('[bridge-index-background] HMAC verification failed:', verified.reason);
    return {
      statusCode: 401,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized internal request', reason: verified.reason }),
    };
  }

  // 3. Set up the Netlify Blob store the same way `bridge.mjs` does. Eventual
  //    consistency is fine for the background path since the lock + sidecar
  //    blobs are read by the next user-triggered request, not by the caller of
  //    this background function.
  connectLambda(event);
  const consistency =
    String(process.env.NETLIFY_BLOBS_CONSISTENCY || '')
      .trim()
      .toLowerCase() === 'strong'
      ? 'strong'
      : 'eventual';
  globalThis.__netlify_blob_store = getStore({ name: 'bridge-data', consistency });

  // 4. Set the internal-request marker that `hub/bridge/server.mjs` reads via
  //    `req.bridgeInternalRequest`. This is what tells the index handler to
  //    SKIP its routing decision and execute inline regardless of size.
  globalThis.__bridge_internal_request = {
    canisterUid: verified.payload.canisterUid,
    vaultId: verified.payload.vaultId,
    jobId: verified.payload.jobId,
  };

  try {
    // Force the path the express app sees to `/api/v1/index` so the route resolver
    // hits the right handler regardless of how Netlify rewrote the URL.
    const routedEvent = { ...event, path: '/api/v1/index', rawUrl: '/api/v1/index' };
    return await serverless(app)(routedEvent, context);
  } finally {
    delete globalThis.__netlify_blob_store;
    delete globalThis.__bridge_internal_request;
  }
};

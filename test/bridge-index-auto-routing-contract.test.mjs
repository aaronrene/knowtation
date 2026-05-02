/**
 * Contract tests for the auto-routing wiring in `hub/bridge/server.mjs POST
 * /api/v1/index` and `netlify/functions/bridge-index-background.mjs`.
 *
 * The full handler is too tightly coupled to canister + Netlify Blobs + live
 * embedding to boot in a Node test, so we lock in the static wiring with
 * source-string asserts. These tests exist because every wiring assertion
 * here corresponds to a regression that would silently re-introduce the bug
 * the auto-routing PR exists to prevent:
 *   - dropping the routing branch → big jobs go straight to sync and 504.
 *   - dropping the lock acquire → double-clicks double-bill DeepInfra.
 *   - dropping setLastIndexedAt → UI never shows "Last indexed" again.
 *   - dropping releaseJobLock → second background job blocked for 16 min.
 *   - background function not validating HMAC → public re-index trigger.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bridgeJs = readFileSync(join(root, 'hub/bridge/server.mjs'), 'utf8');
const bgFnJs = readFileSync(
  join(root, 'netlify/functions/bridge-index-background.mjs'),
  'utf8',
);
const bridgeNetlifyToml = readFileSync(join(root, 'deploy/bridge/netlify.toml'), 'utf8');

test('bridge imports auto-routing helpers', () => {
  assert.match(
    bridgeJs,
    /from\s+['"]\.\.\/\.\.\/lib\/bridge-index-preflight-estimate\.mjs['"]/,
    'must import from lib/bridge-index-preflight-estimate.mjs',
  );
  assert.match(
    bridgeJs,
    /from\s+['"]\.\.\/\.\.\/lib\/bridge-index-job-lock\.mjs['"]/,
    'must import from lib/bridge-index-job-lock.mjs',
  );
  assert.match(
    bridgeJs,
    /from\s+['"]\.\.\/\.\.\/lib\/bridge-index-last-indexed\.mjs['"]/,
    'must import from lib/bridge-index-last-indexed.mjs',
  );
  assert.match(
    bridgeJs,
    /from\s+['"]\.\.\/\.\.\/lib\/bridge-internal-hmac\.mjs['"]/,
    'must import from lib/bridge-internal-hmac.mjs',
  );
});

test('bridge exposes the routing decision step in the timer', () => {
  assert.match(
    bridgeJs,
    /timer\.step\(['"]routing_decision['"]/,
    'timer must emit a routing_decision step (post-mortem signal for sync vs background)',
  );
});

test('bridge calls estimateEmbedSeconds + shouldUseBackgroundIndex inside POST /api/v1/index', () => {
  // Both calls must appear inside a window starting at the index handler signature.
  const handlerStart = bridgeJs.indexOf("app.post('/api/v1/index'");
  assert.ok(handlerStart > 0, 'POST /api/v1/index handler must exist');
  const handlerWindow = bridgeJs.slice(handlerStart, handlerStart + 50000);
  assert.match(handlerWindow, /\bestimateEmbedSeconds\(/, 'must call estimateEmbedSeconds');
  assert.match(handlerWindow, /\bshouldUseBackgroundIndex\(/, 'must call shouldUseBackgroundIndex');
});

test('bridge acquires lock + kicks off background fn when routed to background', () => {
  const handlerStart = bridgeJs.indexOf("app.post('/api/v1/index'");
  const handlerWindow = bridgeJs.slice(handlerStart, handlerStart + 50000);
  assert.match(
    handlerWindow,
    /\bacquireJobLock\s*\(\s*req\.blobStore/,
    'must acquire job lock against the request blob store',
  );
  assert.match(
    handlerWindow,
    /\bkickOffBackgroundIndex\s*\(\s*req\s*,/,
    'must kick off the background function via the helper',
  );
});

test('bridge returns 202 status:background OR 409 status:already_running for the background path', () => {
  const handlerStart = bridgeJs.indexOf("app.post('/api/v1/index'");
  const handlerWindow = bridgeJs.slice(handlerStart, handlerStart + 50000);
  assert.match(
    handlerWindow,
    /res\.status\(202\)\.json\([\s\S]{0,500}status:\s*['"]background['"]/,
    '202 response must include status:"background" so the UI can branch',
  );
  assert.match(
    handlerWindow,
    /res\.status\(409\)\.json\([\s\S]{0,500}status:\s*['"]already_running['"]/,
    '409 response must include status:"already_running" so the UI can show "wait" toast',
  );
});

test('bridge skips routing when req.bridgeInternalRequest is set (background re-entry)', () => {
  // Without this short-circuit, the background function would re-route to itself
  // recursively — every background invocation would kick off another background invocation.
  const handlerStart = bridgeJs.indexOf("app.post('/api/v1/index'");
  const handlerWindow = bridgeJs.slice(handlerStart, handlerStart + 50000);
  assert.match(
    handlerWindow,
    /req\.bridgeInternalRequest\s*!=\s*null/,
    'must check req.bridgeInternalRequest before routing',
  );
  assert.match(
    handlerWindow,
    /isInternalBackgroundRequest/,
    'should name the local boolean so the intent is grep-able',
  );
});

test('bridge persists last-indexed sidecar on the sync success path', () => {
  const handlerStart = bridgeJs.indexOf("app.post('/api/v1/index'");
  const handlerWindow = bridgeJs.slice(handlerStart, handlerStart + 50000);
  assert.match(
    handlerWindow,
    /\bsetLastIndexedAt\s*\(\s*req\.blobStore\s*,/,
    'must call setLastIndexedAt after a successful index so the UI line stays correct',
  );
});

test('bridge releases the job lock on background-mode finish (success AND failure paths)', () => {
  const handlerStart = bridgeJs.indexOf("app.post('/api/v1/index'");
  const handlerWindow = bridgeJs.slice(handlerStart, handlerStart + 50000);
  // Should appear at LEAST in: success path, empty-vault path, catch path.
  const matches = handlerWindow.match(/\breleaseJobLock\s*\(/g) || [];
  assert.ok(
    matches.length >= 3,
    `releaseJobLock should be called from at least 3 paths (success, empty, catch); found ${matches.length}`,
  );
  assert.match(
    handlerWindow,
    /releaseJobLock\([\s\S]{0,200}expectedJobId:\s*req\.bridgeInternalRequest\.jobId/,
    'release MUST pass expectedJobId so a stale background fn cannot clobber a newer lock',
  );
});

test('bridge exposes GET /api/v1/index/status for the UI status line', () => {
  assert.match(
    bridgeJs,
    /app\.get\(['"]\/api\/v1\/index\/status['"]/,
    'must expose GET /api/v1/index/status',
  );
  assert.match(
    bridgeJs,
    /\bgetLastIndexedAt\s*\(\s*req\.blobStore/,
    'status endpoint must read the last-indexed sidecar',
  );
  assert.match(
    bridgeJs,
    /\bpeekJobLock\s*\(\s*req\.blobStore/,
    'status endpoint must peek the job lock so the UI knows when a background job is in flight',
  );
});

test('bridge kickoff helper signs request + targets the bridge-index-background function URL', () => {
  // The fetch URL must point at the background function (not the regular bridge),
  // otherwise the kicked-off work runs in the 60s sync function and gets killed.
  assert.match(
    bridgeJs,
    /\.netlify\/functions\/bridge-index-background/,
    'kickoff URL must hit /.netlify/functions/bridge-index-background',
  );
  assert.match(
    bridgeJs,
    /\bsignInternalRequest\s*\(\s*SESSION_SECRET/,
    'kickoff must sign the request with SESSION_SECRET',
  );
  assert.match(
    bridgeJs,
    /'x-bridge-internal-sig'\s*:\s*sig/,
    'kickoff must include the HMAC header so the receiver can verify',
  );
});

test('background function file: validates HMAC before doing any work', () => {
  assert.match(
    bgFnJs,
    /from\s+['"]\.\.\/\.\.\/lib\/bridge-internal-hmac\.mjs['"]/,
    'must import the HMAC verifier',
  );
  assert.match(
    bgFnJs,
    /\bverifyInternalRequest\(/,
    'must call verifyInternalRequest before invoking the Express app',
  );
  // Returning 401 on HMAC failure is the only safe behavior — anything else
  // would let an attacker probe whether the secret is correct.
  assert.match(
    bgFnJs,
    /statusCode:\s*401/,
    'must return 401 on HMAC failure (the public URL must reject all unsigned callers)',
  );
});

test('background function file: sets the internal-request marker globalThis.__bridge_internal_request', () => {
  // The marker is what tells the index handler to skip the routing decision.
  // Without it, the background fn would re-route to itself recursively.
  assert.match(
    bgFnJs,
    /globalThis\.__bridge_internal_request\s*=\s*\{/,
    'must set globalThis.__bridge_internal_request before invoking the app',
  );
  assert.match(
    bgFnJs,
    /delete\s+globalThis\.__bridge_internal_request/,
    'must clean up the marker in finally so the next invocation starts fresh',
  );
});

test('background function file: route guard rejects anything other than POST /api/v1/index', () => {
  assert.match(
    bgFnJs,
    /isAllowedRoute\(/,
    'must call a route guard before doing any auth/work',
  );
  assert.match(
    bgFnJs,
    /statusCode:\s*404/,
    'must return 404 for non-allowed routes',
  );
});

test('netlify.toml registers the bridge-index-background function', () => {
  // Netlify only applies the 15-min background timeout when the function is named
  // with the `-background` suffix AND the netlify.toml registers it (so its build
  // step + external_node_modules align with the bridge function).
  assert.match(
    bridgeNetlifyToml,
    /\[functions\."bridge-index-background"\]/,
    'deploy/bridge/netlify.toml must declare the bridge-index-background function',
  );
});

test('netlify.toml exempts /.netlify/functions/* from the catch-all redirect (May 2026 hotfix)', () => {
  // Regression context: the catch-all `[[redirects]] from = "/*" force = true`
  // captures EVERY URL — including `/.netlify/functions/bridge-index-background`
  // — because Netlify's normal exemption for `/.netlify/...` paths is bypassed
  // when `force = true` is set. Without an explicit passthrough rule placed
  // BEFORE the catch-all, the bridge sync function's kickoff fetch is rewritten
  // to the regular bridge function and returns 404. The kickoff caller then
  // falsely believes the background job started.
  //
  // This test asserts BOTH that the passthrough rule exists AND that it appears
  // before the catch-all (Netlify processes redirects top-down; first match wins).
  const passthroughIdx = bridgeNetlifyToml.indexOf('from = "/.netlify/functions/*"');
  const catchAllIdx = bridgeNetlifyToml.indexOf('from = "/*"');
  assert.ok(
    passthroughIdx > 0,
    'must declare an explicit passthrough for /.netlify/functions/* paths',
  );
  assert.ok(
    catchAllIdx > 0,
    'catch-all redirect must still exist (front-end SPA routing depends on it)',
  );
  assert.ok(
    passthroughIdx < catchAllIdx,
    'passthrough rule MUST appear before the catch-all (Netlify is first-match-wins)',
  );
});

test('bridge kickoff helper validates response.status (May 2026 hotfix)', () => {
  // Regression context: prior code did `await fetch(url, …)` and never inspected
  // `response.status`. fetch() resolves successfully on 4xx/5xx HTTP responses
  // (it only throws on network errors), so a 404 from the redirect-bug above was
  // silently treated as success. Defense in depth: assert the helper imports the
  // pure validator AND calls it after the fetch.
  assert.match(
    bridgeJs,
    /from\s+['"]\.\.\/\.\.\/lib\/bridge-index-kickoff-response\.mjs['"]/,
    'must import from lib/bridge-index-kickoff-response.mjs',
  );
  assert.match(
    bridgeJs,
    /\bassertBackgroundKickoffOk\s*\(/,
    'kickoff helper MUST call assertBackgroundKickoffOk so a 404/5xx fails loudly',
  );
});

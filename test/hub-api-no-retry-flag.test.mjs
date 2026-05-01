/**
 * Contract: web/hub/hub.js api() must support `noRetry: true` and the Re-index
 * button must use it for POST /api/v1/index. Without this, a 30s gateway timeout
 * (Netlify Function cap) causes the browser to fire a SECOND bridge index while
 * the first is still running, double-billing DeepInfra and worsening contention.
 *
 * String-grep test (matches the existing `test/hub-index-stale-banner.test.mjs`
 * convention) — hub.js is browser code without a Node-runnable harness.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hubJs = readFileSync(join(root, 'web/hub/hub.js'), 'utf8');

test('api() recognizes noRetry: true (zero retries when set, regardless of method)', () => {
  // Implementation detail we want to lock in: the noRetry branch must short-circuit
  // maxNetworkRetries to 0 for ANY method (including GET), so future callers of
  // expensive idempotent endpoints can opt out of the default 2x GET retry too.
  assert.match(
    hubJs,
    /opts\.noRetry\s*===\s*true[\s\S]{0,80}\?\s*0/,
    'api() should set maxNetworkRetries to 0 when opts.noRetry === true',
  );
  // Sanity: the default branch for non-GET still allows one retry (we didn't
  // accidentally remove the existing safety net for normal POSTs).
  assert.match(hubJs, /method === 'GET' \|\| method === 'HEAD'\)\s*\?\s*2\s*:\s*1/);
});

test('api() strips noRetry from opts before forwarding to fetch()', () => {
  // Otherwise fetch sees a non-standard init key. Some browsers warn / future ones may throw.
  assert.match(
    hubJs,
    /const\s*\{\s*noRetry\s*:\s*_noRetry\s*,\s*\.\.\.fetchOpts\s*\}\s*=\s*opts/,
    'api() should destructure noRetry out of opts before spreading into fetch()',
  );
  assert.match(hubJs, /\.\.\.fetchOpts/);
});

test('Re-index button POSTs /api/v1/index with noRetry: true', () => {
  // The whole point of the flag — the only known caller right now MUST set it,
  // otherwise the bridge double-fires under gateway timeout.
  const reindexBlock = hubJs.match(
    /btnReindex\.onclick\s*=\s*async[\s\S]{0,1200}?api\([^)]+\)/,
  );
  assert.ok(reindexBlock, 'btnReindex.onclick should call api(...)');
  assert.match(
    reindexBlock[0],
    /api\('\/api\/v1\/index',\s*\{\s*method:\s*'POST',\s*noRetry:\s*true\s*\}\)/,
    'Re-index call must include noRetry: true to prevent duplicate bridge invocations',
  );
});

test('Re-index toast surfaces cache-skip detail when present (no regression in plain message)', () => {
  // After PR feat/bridge-embed-hash-cache, the bridge returns chunksSkippedCached so the
  // user can see when an incremental re-index was fast because most chunks were cached.
  // We assert the toast composition logic; the wording itself can evolve.
  assert.match(hubJs, /chunksSkippedCached/);
  assert.match(hubJs, /chunksEmbedded/);
});

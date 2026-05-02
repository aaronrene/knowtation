/**
 * Unit tests for `lib/bridge-index-kickoff-response.mjs`.
 *
 * Why this file exists (regression context, May 2026):
 *   In the auto-routing PR (PR #205) the sync `bridge` function called
 *   `await fetch('/.netlify/functions/bridge-index-background', …)` and only
 *   awaited the promise — it did NOT inspect `response.status`. The bridge's
 *   `[[redirects]] from = "/*" force = true` rule turned out to capture
 *   `/.netlify/functions/*` paths too (Netlify's normal exemption is bypassed
 *   when `force = true`). The kickoff request was rewritten to the regular
 *   bridge function, returned 404, and `await fetch(…)` resolved successfully.
 *   The sync handler then returned `202 status:"background"` to the browser
 *   while the actual background function never ran. The user saw "Large
 *   re-index started" but the lock sat for 16 min and `setLastIndexedAt`
 *   never fired.
 *
 * The hotfix is two-pronged:
 *   1. Fix the redirect (deploy/bridge/netlify.toml: add an explicit
 *      `/.netlify/functions/*` passthrough BEFORE the catch-all).
 *   2. Defense in depth: assert that the kickoff actually got HTTP 202 from
 *      Netlify's background-function dispatcher. If anything else comes back
 *      (404 from a redirect, 5xx from a deploy gap), throw so the caller's
 *      catch handler can release the lock and surface the failure as 502.
 *
 * These tests lock in (2). They are pure — no network, no filesystem.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBackgroundKickoffOk } from '../lib/bridge-index-kickoff-response.mjs';

test('assertBackgroundKickoffOk: accepts HTTP 202 (the only valid response from a Netlify background fn)', () => {
  // Netlify always returns 202 within ~50–100 ms when a background function is
  // successfully dispatched, regardless of how long the function body runs.
  assert.doesNotThrow(() => assertBackgroundKickoffOk({ status: 202 }, ''));
});

test('assertBackgroundKickoffOk: throws on 404 (redirect captured the URL — the actual bug)', () => {
  // This is the real-world failure mode the hotfix exists to detect: the
  // catch-all redirect rewrote /.netlify/functions/bridge-index-background to
  // the regular bridge function, which has no Express route for it and returned
  // 404. Without this assert, the sync handler thought the kickoff succeeded.
  assert.throws(
    () => assertBackgroundKickoffOk({ status: 404 }, 'Cannot POST /bridge-index-background'),
    /HTTP 404/,
  );
});

test('assertBackgroundKickoffOk: throws on 5xx (Netlify deploy gap or runtime error)', () => {
  assert.throws(
    () => assertBackgroundKickoffOk({ status: 500 }, 'internal'),
    /HTTP 500/,
  );
  assert.throws(
    () => assertBackgroundKickoffOk({ status: 502 }, ''),
    /HTTP 502/,
  );
  assert.throws(
    () => assertBackgroundKickoffOk({ status: 503 }, ''),
    /HTTP 503/,
  );
});

test('assertBackgroundKickoffOk: throws on 200 (function returned synchronously — config wrong)', () => {
  // If we ever see 200 from this URL it means Netlify did NOT recognize the
  // function as a background function (e.g. someone removed the `-background`
  // suffix or moved the file out of `netlify/functions/`). 200 plus an "OK"
  // body would silently swallow the actual indexing work, so we reject it.
  assert.throws(
    () => assertBackgroundKickoffOk({ status: 200 }, 'OK'),
    /HTTP 200/,
  );
});

test('assertBackgroundKickoffOk: includes truncated body snippet in error for diagnostics', () => {
  let caught;
  try {
    assertBackgroundKickoffOk(
      { status: 404 },
      'Cannot POST /bridge-index-background — no route matches',
    );
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'must throw');
  assert.match(
    caught.message,
    /Cannot POST \/bridge-index-background/,
    'error must surface the response body so logs show WHY the kickoff failed',
  );
});

test('assertBackgroundKickoffOk: caps body snippet at 500 chars (avoid logging huge HTML pages)', () => {
  // Netlify error responses can be multi-KB HTML pages; we don't want to dump
  // them into Lambda logs (cost) or surface them in a JSON error body to the UI.
  const huge = 'x'.repeat(2000);
  let caught;
  try {
    assertBackgroundKickoffOk({ status: 500 }, huge);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'must throw');
  assert.ok(
    caught.message.length < 1000,
    `error message should be truncated; was ${caught.message.length} chars`,
  );
});

test('assertBackgroundKickoffOk: tolerates missing body (response.text() may have failed)', () => {
  assert.throws(
    () => assertBackgroundKickoffOk({ status: 404 }, undefined),
    /HTTP 404/,
  );
  assert.throws(
    () => assertBackgroundKickoffOk({ status: 404 }, null),
    /HTTP 404/,
  );
});

test('assertBackgroundKickoffOk: throws on null/undefined response (caller bug)', () => {
  // A null response would be a programmer error in the caller (forgot to await
  // fetch, or fetch threw and was swallowed). Better to surface than silently pass.
  assert.throws(() => assertBackgroundKickoffOk(null, ''), /invalid response/);
  assert.throws(() => assertBackgroundKickoffOk(undefined, ''), /invalid response/);
  assert.throws(() => assertBackgroundKickoffOk({}, ''), /invalid response/);
});

test('assertBackgroundKickoffOk: error message mentions the function URL so log readers can grep', () => {
  // Operators looking at Netlify logs need a fast way to know WHICH endpoint
  // failed. Including the function name in the error ensures `rg` can find it.
  let caught;
  try {
    assertBackgroundKickoffOk({ status: 404 }, '');
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'must throw');
  assert.match(
    caught.message,
    /bridge-index-background/,
    'error must reference the background function name',
  );
});

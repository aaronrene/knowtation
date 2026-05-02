/**
 * Contract tests for the Hub UI's auto-routing handling in `web/hub/hub.js`
 * + `web/hub/index.html` + `web/hub/hub.css`.
 *
 * These tests lock in the static wiring that makes the Re-index button work
 * with the bridge's three response shapes (200 sync, 202 background, 409
 * already-running) and that renders the passive "Last indexed: N minutes ago"
 * line next to the button.
 *
 * If any of these regress, the user-visible failure mode is one of:
 *   - 202 from the bridge silently looks like an error in the UI;
 *   - duplicate Re-index clicks while a background job runs do nothing useful;
 *   - "Last indexed" line never appears, defeating the auto-routing feedback loop.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hubJs = readFileSync(join(root, 'web/hub/hub.js'), 'utf8');
const hubHtml = readFileSync(join(root, 'web/hub/index.html'), 'utf8');
const hubCss = readFileSync(join(root, 'web/hub/hub.css'), 'utf8');

test('hub.js handles status:"background" response from POST /api/v1/index', () => {
  // The 202 + status:'background' shape is what the bridge returns when the
  // preflight estimator routes a re-index to the background function. Without
  // this branch the UI would treat the response as a normal sync result and
  // the toast would say "Indexed 0 notes, 0 chunks".
  assert.match(
    hubJs,
    /out\s*&&\s*out\.status\s*===\s*['"]background['"]/,
    'Re-index click handler must branch on status:"background"',
  );
});

test('hub.js handles status:"already_running" response from POST /api/v1/index', () => {
  // 409 + already_running is what the bridge returns when a second click arrives
  // while a background job is in flight. Without this branch the api() helper
  // would throw on the 409 and the user would see a generic error toast.
  assert.match(
    hubJs,
    /out\s*&&\s*out\.status\s*===\s*['"]already_running['"]/,
    'Re-index click handler must branch on status:"already_running"',
  );
});

test('hub.js calls hubLoadIndexStatus({ pollWhileRunning: true }) on background route', () => {
  // Polling while the background job runs is what flips the "Re-indexing in
  // background…" line back to "Last indexed: just now" without the user
  // reloading. Dropping this means the line stays stale until the next manual page reload.
  assert.match(
    hubJs,
    /hubLoadIndexStatus\(\{\s*pollWhileRunning:\s*true\s*\}\)/,
    'background-mode response must trigger polling so the status line auto-refreshes',
  );
});

test('hub.js polls GET /api/v1/index/status', () => {
  // The status endpoint is the authoritative source of "Last indexed" — it reads
  // the sidecar maintained by both sync and background paths.
  assert.match(
    hubJs,
    /api\(\s*['"]\/api\/v1\/index\/status['"]/,
    'must call GET /api/v1/index/status to populate the "Last indexed" line',
  );
});

test('hub.js relative time formatter handles common buckets', () => {
  // Source-string assertion that the formatter exists; the actual logic gets a
  // separate behavioral test below by re-evaluating the function in isolation.
  assert.match(
    hubJs,
    /function\s+hubFormatRelativeTime\s*\(\s*epochMs\s*\)/,
    'must expose hubFormatRelativeTime(epochMs) for the status line',
  );
});

test('hub.js stops polling when no in-flight job', () => {
  // The setInterval handle MUST be cleared once `inProgress: false` comes back,
  // otherwise we keep polling forever and burn user CPU + bridge function calls.
  assert.match(
    hubJs,
    /clearInterval\(\s*_hubIndexStatusPollTimer\s*\)/,
    'must clear the poll timer when the background job finishes',
  );
});

test('index.html has the hub-index-status placeholder near the Re-index button', () => {
  assert.match(
    hubHtml,
    /<span\s+id="hub-index-status"/,
    'must include <span id="hub-index-status"> placeholder for the "Last indexed" line',
  );
  // aria-live so screen readers announce when the status flips.
  assert.match(
    hubHtml,
    /id="hub-index-status"[^>]*aria-live="polite"/,
    'status placeholder must be aria-live="polite" so screen readers announce updates',
  );
});

test('hub.css styles the .hub-index-status class', () => {
  assert.match(
    hubCss,
    /\.hub-index-status\b/,
    'must define a .hub-index-status rule',
  );
  assert.match(
    hubCss,
    /\.hub-index-status-running\b/,
    'must define a .hub-index-status-running rule for the "background job in flight" state',
  );
});

test('relative time formatter behavior (re-evaluate inline)', () => {
  // Pull the function source out of hub.js, evaluate it in isolation, and assert
  // bucket boundaries. This is the one place we can run real JS logic against
  // the UI module without bringing up jsdom.
  const m = hubJs.match(
    /function\s+hubFormatRelativeTime\s*\(\s*epochMs\s*\)\s*\{[\s\S]*?\n\s{2}\}/,
  );
  assert.ok(m, 'must extract hubFormatRelativeTime source');
  // Wrap it in a closure so we can call it with controlled `Date.now`.
  const factory = new Function(
    'mockNow',
    `${m[0]}; return hubFormatRelativeTime;`,
  );
  // We can't easily inject Date.now, so we test against actual real-time math
  // with a generous margin (+- 1 sec) to avoid flake.
  const fn = factory();
  const now = Date.now();
  assert.strictEqual(fn(now), 'just now', 'now → "just now"');
  assert.strictEqual(fn(now - 30 * 1000), 'just now', '30 s ago → "just now"');
  assert.match(fn(now - 5 * 60 * 1000), /^5 minutes ago$/, '5 min ago');
  assert.match(fn(now - 1 * 60 * 1000), /^1 minute ago$/, 'singular minute');
  assert.match(fn(now - 90 * 60 * 1000), /^2 hours ago$/, '90 min ago → 2 hours');
  assert.match(fn(now - 3 * 24 * 60 * 60 * 1000), /^3 days ago$/, '3 days ago');
});

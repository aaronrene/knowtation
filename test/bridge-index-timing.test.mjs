/**
 * Unit tests for hub/bridge/index-timing.mjs (POST /api/v1/index per-step instrumentation).
 *
 * Why we test this in isolation rather than booting the bridge:
 * - The bridge's index handler depends on Netlify Blobs, the canister export, sqlite-vec,
 *   and a live embedding provider. Spinning all of that up to assert a console.log line
 *   is a bad cost/benefit trade.
 * - The timer is a pure module with an injected `logger` + `now` so we can deterministically
 *   verify the JSON shape, the step ordering, and the idempotent `finish` semantics that
 *   the index handler depends on. If any of these regress, the post-mortem signal we rely
 *   on for the timeout fix breaks silently — exactly the failure mode this PR exists to fix.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createIndexTimer } from '../hub/bridge/index-timing.mjs';

/**
 * Capture console.log lines into an array via the logger injection point.
 * @returns {{ logger: (line: string) => void, lines: string[] }}
 */
function captureLogger() {
  const lines = [];
  return { logger: (line) => lines.push(line), lines };
}

/**
 * Deterministic clock that advances by `delta` ms each call.
 * @param {number} startMs
 * @param {number[]} deltas
 */
function fakeClock(startMs, deltas) {
  let i = -1;
  let cursor = startMs;
  return () => {
    i++;
    if (i === 0) return cursor;
    cursor += deltas[i - 1] ?? 0;
    return cursor;
  };
}

describe('createIndexTimer', () => {
  it('emits a JSON line per step under the stable type knowtation_index_step', () => {
    const cap = captureLogger();
    const now = fakeClock(1_700_000_000_000, [10, 20, 30]);
    const timer = createIndexTimer({ vaultId: 'v1', canisterUid: 'uid:1', logger: cap.logger, now });
    timer.step('resolve_context');
    timer.step('canister_export', { note_count: 7 });
    assert.equal(cap.lines.length, 2);
    const a = JSON.parse(cap.lines[0]);
    const b = JSON.parse(cap.lines[1]);
    assert.equal(a.type, 'knowtation_index_step');
    assert.equal(a.step, 'resolve_context');
    assert.equal(a.vault_id, 'v1');
    assert.equal(a.canister_uid, 'uid:1');
    assert.ok(typeof a.ts === 'string' && a.ts.endsWith('Z'));
    assert.equal(typeof a.ms, 'number');
    assert.equal(typeof a.total_ms, 'number');
    assert.equal(b.note_count, 7, 'extra fields must merge into the line');
  });

  it('measures elapsed ms per step and cumulative total_ms', () => {
    const cap = captureLogger();
    // t0=0, step1 +250, step2 +750, finish +0
    const now = fakeClock(0, [250, 750, 0]);
    const timer = createIndexTimer({ logger: cap.logger, now });
    timer.step('a');
    timer.step('b');
    const a = JSON.parse(cap.lines[0]);
    const b = JSON.parse(cap.lines[1]);
    assert.equal(a.ms, 250);
    assert.equal(a.total_ms, 250);
    assert.equal(b.ms, 750);
    assert.equal(b.total_ms, 1000);
  });

  it('finish emits knowtation_index_done with step_count and merged extras', () => {
    const cap = captureLogger();
    const now = fakeClock(0, [10, 20, 5]);
    const timer = createIndexTimer({ vaultId: 'vault-x', logger: cap.logger, now });
    timer.step('a');
    timer.step('b');
    const total = timer.finish({ ok: true, chunks_indexed: 42 });
    const last = JSON.parse(cap.lines.at(-1));
    assert.equal(last.type, 'knowtation_index_done');
    assert.equal(last.step_count, 2);
    assert.equal(last.ok, true);
    assert.equal(last.chunks_indexed, 42);
    assert.equal(last.vault_id, 'vault-x');
    assert.equal(typeof last.total_ms, 'number');
    assert.equal(total, last.total_ms);
  });

  it('finish is idempotent: calling step() after finish() is a no-op (no extra log)', () => {
    const cap = captureLogger();
    const now = fakeClock(0, [10, 0, 0]);
    const timer = createIndexTimer({ logger: cap.logger, now });
    timer.step('a');
    timer.finish({ ok: true });
    timer.step('post_finish_should_be_noop');
    timer.finish({ ok: false });
    const types = cap.lines.map((l) => JSON.parse(l).type);
    assert.deepEqual(types, ['knowtation_index_step', 'knowtation_index_done']);
  });

  it('rejects empty step names early so we never silently emit untyped log lines', () => {
    const cap = captureLogger();
    const timer = createIndexTimer({ logger: cap.logger });
    assert.throws(() => timer.step(''), /non-empty/i);
    assert.throws(() => timer.step(undefined), /non-empty/i);
    assert.equal(cap.lines.length, 0);
  });

  it('default logger is console.log and default now is Date.now (smoke; do not over-assert)', () => {
    const orig = console.log;
    const lines = [];
    console.log = (line) => lines.push(line);
    try {
      const timer = createIndexTimer();
      timer.step('warmup', { warm: true });
      const total = timer.finish({ ok: true });
      assert.ok(total >= 0);
      assert.equal(lines.length, 2);
      const step = JSON.parse(lines[0]);
      assert.equal(step.step, 'warmup');
      assert.equal(step.warm, true);
    } finally {
      console.log = orig;
    }
  });

  it('null vaultId / canisterUid still serialize as null (logs must remain greppable on early errors)', () => {
    const cap = captureLogger();
    const now = fakeClock(0, [1]);
    const timer = createIndexTimer({ logger: cap.logger, now });
    timer.step('resolve_context', { ok: false });
    const a = JSON.parse(cap.lines[0]);
    assert.equal(a.vault_id, null);
    assert.equal(a.canister_uid, null);
    assert.equal(a.ok, false);
  });
});

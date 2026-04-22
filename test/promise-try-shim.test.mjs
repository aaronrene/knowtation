/**
 * Ensures lib/shims/promise-try.mjs can install Promise.try when absent (Node 20 / unpdf).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('lib/shims/promise-try', () => {
  it('defines Promise.try when the global is missing (mirrors Node 20 CI)', async () => {
    const d = Object.getOwnPropertyDescriptor(Promise, 'try');
    if (!d?.configurable) {
      // Very old runtimes: leave behavior to pdf golden tests
      return;
    }
    const orig = d.value;
    try {
      // eslint-disable-next-line no-delete-var -- test setup
      delete Promise.try;
      assert.equal(typeof Promise.try, 'undefined');
      const base = new URL('../lib/shims/promise-try.mjs', import.meta.url);
      base.searchParams.set('t', String(Date.now()));
      await import(base.href);
      assert.equal(typeof Promise.try, 'function');
      assert.equal(await Promise.try(() => 7), 7);
      assert.equal(
        await Promise.try((a, b) => a + b, 2, 3),
        5,
        'Promise.try(fn, ...args) must forward args (PDF.js workers rely on this)',
      );
      const err = new Error('sync-fail');
      await assert.rejects(
        () => Promise.try(() => { throw err; }),
        (e) => e === err
      );
    } finally {
      Object.defineProperty(Promise, 'try', { value: orig, configurable: true, writable: true });
    }
  });
});

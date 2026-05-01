/**
 * Tests for `lib/parallel-embed-pool.mjs`. The bridge `POST /api/v1/index` will call
 * `runWithConcurrency` with embed-batch thunks, so the contract that matters here is:
 *   1. Order: results[i] === <return value of tasks[i]()>.
 *   2. Concurrency cap: never more than N in flight at once (verified with a counter).
 *   3. Fail-fast: first error rejects; remaining unstarted tasks are skipped.
 *   4. onSettled callback fires per task with index, ok, ms.
 *   5. Edge cases: empty array, concurrency 0/NaN/string env values, pre-started promises.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runWithConcurrency,
  parseEmbedConcurrency,
  parseEmbedBatchSize,
} from '../lib/parallel-embed-pool.mjs';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('runWithConcurrency', () => {
  it('preserves input order in results', async () => {
    const tasks = [10, 5, 15, 1, 20].map((n, i) => async () => {
      await delay(n);
      return i;
    });
    const out = await runWithConcurrency(tasks, { concurrency: 3 });
    assert.deepEqual(out, [0, 1, 2, 3, 4]);
  });

  it('respects the concurrency cap (never more than N in flight)', async () => {
    let inFlight = 0;
    let maxObserved = 0;
    const tasks = Array.from({ length: 20 }, (_, i) => async () => {
      inFlight++;
      if (inFlight > maxObserved) maxObserved = inFlight;
      await delay(15);
      inFlight--;
      return i;
    });
    const concurrency = 4;
    const out = await runWithConcurrency(tasks, { concurrency });
    assert.equal(out.length, 20);
    assert.ok(
      maxObserved <= concurrency,
      `maxObserved=${maxObserved} exceeded cap=${concurrency}`,
    );
    assert.ok(maxObserved >= 2, 'expected actual parallelism, not just sequential');
  });

  it('returns immediately on empty tasks array', async () => {
    const out = await runWithConcurrency([], { concurrency: 5 });
    assert.deepEqual(out, []);
  });

  it('fails fast on first error and does not start tasks scheduled after the failure', async () => {
    let startedAfterFailure = 0;
    const failureIndex = 1;
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      if (i === failureIndex) {
        throw new Error('boom-' + i);
      }
      // Tasks 0 + 1 should start (concurrency=2). After 1 throws, 2..9 must not start.
      if (i > failureIndex + 1) {
        startedAfterFailure++;
      }
      await delay(20);
      return i;
    });
    await assert.rejects(
      () => runWithConcurrency(tasks, { concurrency: 2 }),
      /boom-1/,
    );
    assert.equal(
      startedAfterFailure,
      0,
      'tasks scheduled after the failure should be skipped',
    );
  });

  it('invokes onSettled per task with index, ok, ms', async () => {
    const events = [];
    const tasks = [
      async () => {
        await delay(5);
        return 'a';
      },
      async () => {
        await delay(5);
        throw new Error('nope');
      },
    ];
    await assert.rejects(
      () =>
        runWithConcurrency(tasks, {
          concurrency: 2,
          onSettled: (info) => events.push(info),
        }),
      /nope/,
    );
    assert.equal(events.length, 2);
    const byIndex = events.sort((a, b) => a.index - b.index);
    assert.equal(byIndex[0].ok, true);
    assert.equal(byIndex[0].index, 0);
    assert.ok(typeof byIndex[0].ms === 'number' && byIndex[0].ms >= 0);
    assert.equal(byIndex[1].ok, false);
    assert.match(String(byIndex[1].error?.message || ''), /nope/);
  });

  it('does not crash if onSettled throws (observability never fails the index)', async () => {
    const tasks = [async () => 1, async () => 2];
    const out = await runWithConcurrency(tasks, {
      concurrency: 2,
      onSettled: () => {
        throw new Error('logger crash');
      },
    });
    assert.deepEqual(out, [1, 2]);
  });

  it('clamps invalid concurrency: NaN, 0, negative → 1; > tasks.length → tasks.length', async () => {
    const tasks = [async () => 1, async () => 2, async () => 3];
    assert.deepEqual(await runWithConcurrency(tasks, { concurrency: 0 }), [1, 2, 3]);
    assert.deepEqual(await runWithConcurrency(tasks, { concurrency: -5 }), [1, 2, 3]);
    assert.deepEqual(await runWithConcurrency(tasks, { concurrency: NaN }), [1, 2, 3]);
    assert.deepEqual(await runWithConcurrency(tasks, { concurrency: 9999 }), [1, 2, 3]);
  });

  it('rejects non-thunk inputs with a descriptive error pointing at the bad index', async () => {
    await assert.rejects(
      () => runWithConcurrency([async () => 1, Promise.resolve(2)], { concurrency: 2 }),
      /tasks\[1\] must be a thunk/,
    );
  });
});

describe('parseEmbedConcurrency', () => {
  it('defaults to 5 when missing or empty', () => {
    assert.equal(parseEmbedConcurrency(null), 5);
    assert.equal(parseEmbedConcurrency(undefined), 5);
    assert.equal(parseEmbedConcurrency(''), 5);
  });

  it('parses string env values', () => {
    assert.equal(parseEmbedConcurrency('3'), 3);
    assert.equal(parseEmbedConcurrency('  8  '), 8);
  });

  it('rejects garbage and falls back to default 5', () => {
    assert.equal(parseEmbedConcurrency('abc'), 5);
    assert.equal(parseEmbedConcurrency('-3'), 5);
    assert.equal(parseEmbedConcurrency('0'), 5);
  });

  it('clamps absurdly large values to ceiling 16', () => {
    assert.equal(parseEmbedConcurrency('1000'), 16);
    assert.equal(parseEmbedConcurrency(17), 16);
  });
});

describe('parseEmbedBatchSize', () => {
  it('defaults to 50 when missing/empty', () => {
    assert.equal(parseEmbedBatchSize(null), 50);
    assert.equal(parseEmbedBatchSize(''), 50);
  });

  it('parses valid values', () => {
    assert.equal(parseEmbedBatchSize('20'), 20);
    assert.equal(parseEmbedBatchSize(75), 75);
  });

  it('rejects garbage and falls back to default 50', () => {
    assert.equal(parseEmbedBatchSize('xyz'), 50);
    assert.equal(parseEmbedBatchSize('-1'), 50);
    assert.equal(parseEmbedBatchSize('0'), 50);
  });

  it('clamps to 256 to keep within provider per-request limits', () => {
    assert.equal(parseEmbedBatchSize('500'), 256);
    assert.equal(parseEmbedBatchSize(1024), 256);
  });
});

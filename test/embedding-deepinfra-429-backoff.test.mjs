/**
 * Tests for DeepInfra embedding 429 retry. The bridge `POST /api/v1/index` will run
 * `embedDeepInfraWithUsage` concurrently via `lib/parallel-embed-pool.mjs`; if a burst
 * trips DeepInfra's per-second cap, we want a single bounded retry honoring the
 * `Retry-After` header rather than failing the entire vault re-index.
 *
 * Hermetic: we inject a fake `fetchImpl` and `sleepFn` so no real network or real
 * `setTimeout` is involved (test runs in a few ms).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  embedDeepInfraWithUsage,
  retryAfterHeaderMs,
  DEEPINFRA_429_BACKOFF_DEFAULT_MS,
  DEEPINFRA_429_BACKOFF_MAX_MS,
} from '../lib/embedding.mjs';

function makeFakeResponse({ status = 200, headers = {}, body = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const k = String(name).toLowerCase();
        for (const h of Object.keys(headers)) {
          if (h.toLowerCase() === k) return headers[h];
        }
        return null;
      },
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
    async json() {
      return typeof body === 'string' ? JSON.parse(body) : body;
    },
  };
}

function fakeEmbeddingsBody(vectors) {
  return {
    data: vectors.map((vec, i) => ({ index: i, embedding: vec })),
    usage: { prompt_tokens: 7 },
  };
}

describe('embedDeepInfraWithUsage — 429 retry', () => {
  it('retries once on 429 then succeeds, honoring Retry-After (seconds)', async () => {
    let calls = 0;
    const sleeps = [];
    const fakeFetch = async () => {
      calls++;
      if (calls === 1) {
        return makeFakeResponse({
          status: 429,
          headers: { 'Retry-After': '2' },
          body: { error: 'rate_limited' },
        });
      }
      return makeFakeResponse({
        status: 200,
        body: fakeEmbeddingsBody([[0.1, 0.2]]),
      });
    };
    const out = await embedDeepInfraWithUsage(['hi'], {
      model: 'BAAI/bge-large-en-v1.5',
      apiKey: 'fake',
      fetchImpl: fakeFetch,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
    });
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [2000]);
    assert.deepEqual(out.vectors, [[0.1, 0.2]]);
    assert.equal(out.embedding_input_tokens, 7);
  });

  it('uses default backoff when Retry-After header is missing', async () => {
    let calls = 0;
    const sleeps = [];
    const fakeFetch = async () => {
      calls++;
      if (calls === 1) {
        return makeFakeResponse({ status: 429, body: 'too many' });
      }
      return makeFakeResponse({
        status: 200,
        body: fakeEmbeddingsBody([[0.5]]),
      });
    };
    await embedDeepInfraWithUsage(['hi'], {
      model: 'BAAI/bge-large-en-v1.5',
      apiKey: 'fake',
      fetchImpl: fakeFetch,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
    });
    assert.equal(sleeps.length, 1);
    assert.equal(sleeps[0], DEEPINFRA_429_BACKOFF_DEFAULT_MS);
  });

  it('does NOT retry beyond budget — second 429 surfaces as DeepInfra embed failed (429)', async () => {
    let calls = 0;
    const sleeps = [];
    const fakeFetch = async () => {
      calls++;
      return makeFakeResponse({
        status: 429,
        headers: { 'Retry-After': '1' },
        body: 'rate limit',
      });
    };
    await assert.rejects(
      () =>
        embedDeepInfraWithUsage(['hi'], {
          model: 'BAAI/bge-large-en-v1.5',
          apiKey: 'fake',
          fetchImpl: fakeFetch,
          sleepFn: async (ms) => {
            sleeps.push(ms);
          },
        }),
      /DeepInfra embed failed \(429\)/,
    );
    assert.equal(calls, 2, 'should attempt original + 1 retry, then surface');
    assert.equal(sleeps.length, 1);
  });

  it('does not retry on non-429 errors (e.g. 500) — fail fast so the user sees the real error', async () => {
    let calls = 0;
    const fakeFetch = async () =>
      makeFakeResponse({ status: 500, body: 'upstream broke' });
    await assert.rejects(
      () =>
        embedDeepInfraWithUsage(['hi'], {
          model: 'BAAI/bge-large-en-v1.5',
          apiKey: 'fake',
          fetchImpl: fakeFetch,
          sleepFn: async () => {
            throw new Error('sleep should not be called for non-429');
          },
        }),
      /DeepInfra embed failed \(500\)/,
    );
    void calls;
  });

  it('maxRetries: 0 disables retry (one attempt only) — useful for hot paths that prefer fail-fast', async () => {
    let calls = 0;
    const fakeFetch = async () => {
      calls++;
      return makeFakeResponse({ status: 429, body: 'rl' });
    };
    await assert.rejects(
      () =>
        embedDeepInfraWithUsage(['hi'], {
          model: 'BAAI/bge-large-en-v1.5',
          apiKey: 'fake',
          fetchImpl: fakeFetch,
          sleepFn: async () => {},
          maxRetries: 0,
        }),
      /DeepInfra embed failed \(429\)/,
    );
    assert.equal(calls, 1);
  });

  it('throws on missing/empty apiKey before any fetch', async () => {
    let called = false;
    const fakeFetch = async () => {
      called = true;
      return makeFakeResponse({ status: 200, body: fakeEmbeddingsBody([[0]]) });
    };
    await assert.rejects(
      () =>
        embedDeepInfraWithUsage(['hi'], {
          model: 'BAAI/bge-large-en-v1.5',
          apiKey: '',
          fetchImpl: fakeFetch,
        }),
      /DeepInfra embeddings require DEEPINFRA_API_KEY/,
    );
    assert.equal(called, false);
  });
});

describe('retryAfterHeaderMs', () => {
  it('returns default when header is missing', () => {
    assert.equal(retryAfterHeaderMs(null), DEEPINFRA_429_BACKOFF_DEFAULT_MS);
    assert.equal(retryAfterHeaderMs(undefined), DEEPINFRA_429_BACKOFF_DEFAULT_MS);
    assert.equal(retryAfterHeaderMs(''), DEEPINFRA_429_BACKOFF_DEFAULT_MS);
  });

  it('parses integer seconds', () => {
    assert.equal(retryAfterHeaderMs('3'), 3000);
  });

  it('clamps to MAX so a huge value cannot strand a Netlify Function past its 60s cap', () => {
    assert.equal(retryAfterHeaderMs('3600'), DEEPINFRA_429_BACKOFF_MAX_MS);
  });

  it('rejects garbage and returns default', () => {
    assert.equal(retryAfterHeaderMs('abc'), DEEPINFRA_429_BACKOFF_DEFAULT_MS);
    assert.equal(retryAfterHeaderMs('-1'), DEEPINFRA_429_BACKOFF_DEFAULT_MS);
  });

  it('parses HTTP-date when in the future, capped to MAX', () => {
    const future = new Date(Date.now() + 30 * 1000).toUTCString();
    const got = retryAfterHeaderMs(future);
    assert.ok(got > 0 && got <= DEEPINFRA_429_BACKOFF_MAX_MS);
  });

  it('past HTTP-date falls back to default (no negative wait)', () => {
    const past = new Date(Date.now() - 60 * 1000).toUTCString();
    assert.equal(retryAfterHeaderMs(past), DEEPINFRA_429_BACKOFF_DEFAULT_MS);
  });
});

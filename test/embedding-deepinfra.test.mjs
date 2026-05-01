/**
 * DeepInfra OpenAI-compatible embeddings (lib/embedding.mjs).
 *
 * Verifies wire shape (POST to https://api.deepinfra.com/v1/openai/embeddings),
 * vector ordering by index (matches OpenAI behaviour), token-usage extraction,
 * and dimension defaults for common DeepInfra embedding models.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  embedWithUsage,
  embeddingDimension,
  formatEmbeddingFetchFailure,
} from '../lib/embedding.mjs';

const origFetch = globalThis.fetch;
const origDeepinfra = process.env.DEEPINFRA_API_KEY;

function restoreEnv() {
  if (origDeepinfra === undefined) delete process.env.DEEPINFRA_API_KEY;
  else process.env.DEEPINFRA_API_KEY = origDeepinfra;
}

describe('embedWithUsage provider=deepinfra', () => {
  beforeEach(() => {
    delete process.env.DEEPINFRA_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    restoreEnv();
  });

  it('throws when DEEPINFRA_API_KEY is not set', async () => {
    await assert.rejects(
      () =>
        embedWithUsage(['hello'], { provider: 'deepinfra', model: 'BAAI/bge-large-en-v1.5' }),
      /DEEPINFRA_API_KEY/,
    );
  });

  it('posts to the DeepInfra OpenAI-compat endpoint with bearer token and model', async () => {
    process.env.DEEPINFRA_API_KEY = 'di-test';
    let observedUrl = '';
    let observedHeaders;
    let observedBody;
    globalThis.fetch = async (url, init) => {
      observedUrl = String(url);
      observedHeaders = init.headers;
      observedBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          data: [
            { index: 0, embedding: [0.1, 0.2] },
            { index: 1, embedding: [0.3, 0.4] },
          ],
          usage: { prompt_tokens: 7 },
        }),
      };
    };
    const r = await embedWithUsage(
      ['alpha', 'beta'],
      { provider: 'deepinfra', model: 'BAAI/bge-large-en-v1.5' },
    );
    assert.strictEqual(observedUrl, 'https://api.deepinfra.com/v1/openai/embeddings');
    assert.strictEqual(observedHeaders.Authorization, 'Bearer di-test');
    assert.strictEqual(observedBody.model, 'BAAI/bge-large-en-v1.5');
    assert.deepStrictEqual(observedBody.input, ['alpha', 'beta']);
    assert.deepStrictEqual(r.vectors, [
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    assert.strictEqual(r.embedding_input_tokens, 7);
  });

  it('sorts vectors by index even when API returns out of order', async () => {
    process.env.DEEPINFRA_API_KEY = 'di-test';
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        data: [
          { index: 1, embedding: [0.3, 0.4] },
          { index: 0, embedding: [0.1, 0.2] },
        ],
        usage: { prompt_tokens: 5 },
      }),
    });
    const r = await embedWithUsage(
      ['first', 'second'],
      { provider: 'deepinfra', model: 'BAAI/bge-large-en-v1.5' },
    );
    assert.deepStrictEqual(r.vectors, [
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });

  it('falls back to total_tokens when prompt_tokens is missing, then to estimate', async () => {
    process.env.DEEPINFRA_API_KEY = 'di-test';
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        data: [{ index: 0, embedding: [0.1] }],
        usage: { total_tokens: 9 },
      }),
    });
    const r = await embedWithUsage(['x'], {
      provider: 'deepinfra',
      model: 'BAAI/bge-large-en-v1.5',
    });
    assert.strictEqual(r.embedding_input_tokens, 9);

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        data: [{ index: 0, embedding: [0.1] }],
      }),
    });
    const r2 = await embedWithUsage(['hello world'], {
      provider: 'deepinfra',
      model: 'BAAI/bge-large-en-v1.5',
    });
    // 'hello world'.length = 11 chars → ceil(11/4) = 3 tokens
    assert.strictEqual(r2.embedding_input_tokens, 3);
  });

  it('uses default model BAAI/bge-large-en-v1.5 when model is unset', async () => {
    process.env.DEEPINFRA_API_KEY = 'di-test';
    let observedModel;
    globalThis.fetch = async (url, init) => {
      observedModel = JSON.parse(init.body).model;
      return {
        ok: true,
        json: async () => ({ data: [{ index: 0, embedding: [0.1] }] }),
      };
    };
    await embedWithUsage(['x'], { provider: 'deepinfra' });
    assert.strictEqual(observedModel, 'BAAI/bge-large-en-v1.5');
  });

  it('surfaces non-2xx response with status and body in error', async () => {
    process.env.DEEPINFRA_API_KEY = 'di-test';
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      text: async () => 'invalid api key',
    });
    await assert.rejects(
      () =>
        embedWithUsage(['x'], { provider: 'deepinfra', model: 'BAAI/bge-large-en-v1.5' }),
      /DeepInfra embed failed \(401\): invalid api key/,
    );
  });
});

describe('embeddingDimension provider=deepinfra', () => {
  it('default BAAI/bge-large-en-v1.5 is 1024', () => {
    assert.strictEqual(
      embeddingDimension({ provider: 'deepinfra', model: 'BAAI/bge-large-en-v1.5' }),
      1024,
    );
  });

  it('Qwen3-Embedding-8B is 4096', () => {
    assert.strictEqual(
      embeddingDimension({ provider: 'deepinfra', model: 'Qwen/Qwen3-Embedding-8B' }),
      4096,
    );
  });

  it('Qwen3-Embedding-4B is 2560', () => {
    assert.strictEqual(
      embeddingDimension({ provider: 'deepinfra', model: 'Qwen/Qwen3-Embedding-4B' }),
      2560,
    );
  });

  it('multilingual-e5-large-instruct is 1024', () => {
    assert.strictEqual(
      embeddingDimension({
        provider: 'deepinfra',
        model: 'intfloat/multilingual-e5-large-instruct',
      }),
      1024,
    );
  });

  it('bge-base is 768', () => {
    assert.strictEqual(
      embeddingDimension({ provider: 'deepinfra', model: 'BAAI/bge-base-en-v1.5' }),
      768,
    );
  });

  it('bge-small is 384', () => {
    assert.strictEqual(
      embeddingDimension({ provider: 'deepinfra', model: 'BAAI/bge-small-en-v1.5' }),
      384,
    );
  });

  it('falls back to 1024 (safe default) for unknown DeepInfra model', () => {
    assert.strictEqual(
      embeddingDimension({ provider: 'deepinfra', model: 'some/unknown-model' }),
      1024,
    );
  });
});

describe('formatEmbeddingFetchFailure provider=deepinfra', () => {
  it('mentions DEEPINFRA_API_KEY, provider env, and re-index requirement', () => {
    const err = new TypeError('fetch failed');
    err.cause = new Error('getaddrinfo ENOTFOUND api.deepinfra.com');
    const s = formatEmbeddingFetchFailure(
      'deepinfra',
      'https://api.deepinfra.com/v1/openai/embeddings',
      'BAAI/bge-large-en-v1.5',
      err,
    );
    assert.match(s, /DeepInfra embeddings unreachable/);
    assert.match(s, /DEEPINFRA_API_KEY/);
    assert.match(s, /EMBEDDING_PROVIDER=deepinfra/);
    assert.match(s, /re-index/);
    assert.match(s, /BAAI\/bge-large-en-v1\.5/);
  });
});

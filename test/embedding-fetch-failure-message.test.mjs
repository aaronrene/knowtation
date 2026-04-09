/**
 * Semantic search surfaces embedding fetch errors in the Hub; messages must be actionable.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { formatEmbeddingFetchFailure } from '../lib/embedding.mjs';

describe('formatEmbeddingFetchFailure', () => {
  it('expands Ollama "fetch failed" with host and troubleshooting', () => {
    const err = new TypeError('fetch failed');
    err.cause = new Error('connect ECONNREFUSED 127.0.0.1:11434');
    const s = formatEmbeddingFetchFailure('ollama', 'http://127.0.0.1:11434', 'nomic-embed-text', err);
    assert.match(s, /Ollama embeddings unreachable/);
    assert.match(s, /http:\/\/127\.0\.0\.1:11434/);
    assert.match(s, /ollama serve/);
    assert.match(s, /ollama pull nomic-embed-text/);
    assert.match(s, /EMBEDDING_PROVIDER=openai/);
    assert.match(s, /VOYAGE_API_KEY/);
    assert.match(s, /ECONNREFUSED|fetch failed/);
  });

  it('uses default model label when model empty', () => {
    const err = new TypeError('fetch failed');
    const s = formatEmbeddingFetchFailure('ollama', 'http://localhost:11434', '', err);
    assert.match(s, /ollama pull nomic-embed-text/);
  });

  it('OpenAI path mentions API key and host', () => {
    const err = new TypeError('fetch failed');
    err.cause = new Error('getaddrinfo ENOTFOUND api.openai.com');
    const s = formatEmbeddingFetchFailure('openai', 'https://api.openai.com/v1/embeddings', 'text-embedding-3-small', err);
    assert.match(s, /OpenAI embeddings request failed/);
    assert.match(s, /OPENAI_API_KEY/);
  });

  it('Voyage path mentions API key, provider, and re-index', () => {
    const err = new TypeError('fetch failed');
    const s = formatEmbeddingFetchFailure('voyage', 'https://api.voyageai.com/v1/embeddings', 'voyage-4-lite', err);
    assert.match(s, /Voyage embeddings unreachable/);
    assert.match(s, /VOYAGE_API_KEY/);
    assert.match(s, /EMBEDDING_PROVIDER=voyage/);
    assert.match(s, /re-index/);
  });
});

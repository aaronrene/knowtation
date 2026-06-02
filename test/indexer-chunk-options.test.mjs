/**
 * Hosted indexer chunk option tests.
 *
 * DeepInfra BGE embedding models enforce a 512-token context window. These
 * tests keep the bridge defaults below that provider limit before any network
 * embed request can fail with an over-context error.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEEPINFRA_SAFE_CHUNK_OVERLAP,
  DEEPINFRA_SAFE_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  defaultBridgeEmbeddingModelForProvider,
  resolveIndexerChunkOptions,
} from '../lib/indexer-chunk-options.mjs';
import { splitByHeadingOrSize } from '../lib/chunk.mjs';

describe('indexer chunk options', () => {
  it('unit: defaults DeepInfra bridge embeddings to a real DeepInfra model', () => {
    assert.equal(defaultBridgeEmbeddingModelForProvider('deepinfra'), 'BAAI/bge-large-en-v1.5');
    assert.equal(defaultBridgeEmbeddingModelForProvider('openai'), 'text-embedding-3-small');
    assert.equal(defaultBridgeEmbeddingModelForProvider('voyage'), 'voyage-4-lite');
    assert.equal(defaultBridgeEmbeddingModelForProvider('ollama'), 'nomic-embed-text');
  });

  it('integration: clamps hosted DeepInfra chunks below the 512-token model limit margin', () => {
    const opts = resolveIndexerChunkOptions(
      { INDEXER_CHUNK_SIZE: '2048', INDEXER_CHUNK_OVERLAP: '256' },
      { provider: 'deepinfra', model: 'BAAI/bge-large-en-v1.5' },
    );

    assert.equal(opts.chunkSize, DEEPINFRA_SAFE_CHUNK_SIZE);
    assert.equal(opts.chunkOverlap, DEEPINFRA_SAFE_CHUNK_OVERLAP);
  });

  it('end-to-end: DeepInfra-sized chunking splits a note that old defaults sent as one 2048-char chunk', () => {
    const text = 'a '.repeat(1024).trim();
    const oldChunks = splitByHeadingOrSize(text, {
      chunkSize: DEFAULT_CHUNK_SIZE,
      chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    });
    const safeChunks = splitByHeadingOrSize(text, resolveIndexerChunkOptions({}, {
      provider: 'deepinfra',
      model: 'BAAI/bge-large-en-v1.5',
    }));

    assert.equal(oldChunks.length, 1);
    assert.equal(safeChunks.length > 1, true);
    assert.equal(safeChunks.every((chunk) => chunk.length <= DEEPINFRA_SAFE_CHUNK_SIZE), true);
  });

  it('stress: invalid env values fall back to bounded provider defaults', () => {
    const opts = resolveIndexerChunkOptions(
      { INDEXER_CHUNK_SIZE: 'not-a-number', INDEXER_CHUNK_OVERLAP: '-5' },
      { provider: 'deepinfra', model: 'BAAI/bge-large-en-v1.5' },
    );

    assert.deepEqual(opts, {
      chunkSize: DEEPINFRA_SAFE_CHUNK_SIZE,
      chunkOverlap: DEEPINFRA_SAFE_CHUNK_OVERLAP,
    });
  });

  it('data-integrity: non-DeepInfra providers keep the existing default chunk contract', () => {
    assert.deepEqual(resolveIndexerChunkOptions({}, { provider: 'openai' }), {
      chunkSize: DEFAULT_CHUNK_SIZE,
      chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    });
  });

  it('performance: explicit smaller DeepInfra chunk sizes are honored', () => {
    const opts = resolveIndexerChunkOptions(
      { INDEXER_CHUNK_SIZE: '768', INDEXER_CHUNK_OVERLAP: '80' },
      { provider: 'deepinfra', model: 'BAAI/bge-large-en-v1.5' },
    );

    assert.deepEqual(opts, { chunkSize: 768, chunkOverlap: 80 });
  });

  it('security: overlap is capped below chunk size so chunking always advances', () => {
    const opts = resolveIndexerChunkOptions(
      { INDEXER_CHUNK_SIZE: '32', INDEXER_CHUNK_OVERLAP: '9999' },
      { provider: 'openai', model: 'text-embedding-3-small' },
    );

    assert.deepEqual(opts, { chunkSize: 32, chunkOverlap: 31 });
  });
});

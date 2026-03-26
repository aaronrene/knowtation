import { describe, it } from 'node:test';
import assert from 'node:assert';
import { estimateEmbeddingInputTokens, embedWithUsage } from '../lib/embedding.mjs';

describe('embedding usage helpers', () => {
  it('estimateEmbeddingInputTokens is ~4 chars per token', () => {
    assert.strictEqual(estimateEmbeddingInputTokens(['']), 0);
    assert.strictEqual(estimateEmbeddingInputTokens(['abcd']), 1);
    assert.strictEqual(estimateEmbeddingInputTokens(['abc']), 1);
    assert.strictEqual(estimateEmbeddingInputTokens(['x'.repeat(8)]), 2);
  });

  it('embedWithUsage returns zero tokens for empty input', async () => {
    const r = await embedWithUsage([], { provider: 'ollama', model: 'nomic-embed-text' });
    assert.deepStrictEqual(r.vectors, []);
    assert.strictEqual(r.embedding_input_tokens, 0);
  });
});

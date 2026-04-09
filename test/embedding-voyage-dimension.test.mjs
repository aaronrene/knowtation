import { describe, it } from 'node:test';
import assert from 'node:assert';
import { embeddingDimension } from '../lib/embedding.mjs';

describe('embeddingDimension voyage', () => {
  it('defaults voyage-4-lite to 1024', () => {
    assert.strictEqual(embeddingDimension({ provider: 'voyage', model: 'voyage-4-lite' }), 1024);
  });

  it('voyage-3-lite is 512', () => {
    assert.strictEqual(embeddingDimension({ provider: 'voyage', model: 'voyage-3-lite' }), 512);
  });

  it('voyage-3.5-lite is 1024 (not 3-lite slug)', () => {
    assert.strictEqual(embeddingDimension({ provider: 'voyage', model: 'voyage-3.5-lite' }), 1024);
  });

  it('voyage-code-2 is 1536', () => {
    assert.strictEqual(embeddingDimension({ provider: 'voyage', model: 'voyage-code-2' }), 1536);
  });
});

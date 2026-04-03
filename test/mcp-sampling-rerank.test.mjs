import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRerankResponse, rerankWithSampling } from '../mcp/tools/sampling-rerank.mjs';

function makeMockServer({ sampling = true, response = null } = {}) {
  return {
    server: {
      getClientCapabilities: () => (sampling ? { sampling: {} } : {}),
      createMessage: async () => ({
        content: { type: 'text', text: response },
        model: 'mock',
        role: 'assistant',
      }),
    },
  };
}

describe('parseRerankResponse', () => {
  it('parses JSON array of 1-based indices', () => {
    const result = parseRerankResponse('[3, 1, 2]', 5);
    assert.deepEqual(result, [2, 0, 1]);
  });

  it('strips markdown fences', () => {
    const result = parseRerankResponse('```json\n[2, 4, 1]\n```', 5);
    assert.deepEqual(result, [1, 3, 0]);
  });

  it('falls back to regex number extraction', () => {
    const result = parseRerankResponse('The best order is 3, then 1, then 2.', 5);
    assert.deepEqual(result, [2, 0, 1]);
  });

  it('filters out-of-range indices', () => {
    const result = parseRerankResponse('[1, 99, 2, 0, -1]', 3);
    assert.deepEqual(result, [0, 1]);
  });

  it('returns null for null input', () => {
    assert.equal(parseRerankResponse(null, 5), null);
  });

  it('returns null for empty string', () => {
    assert.equal(parseRerankResponse('', 5), null);
  });
});

describe('rerankWithSampling', () => {
  const results = [
    { path: 'a.md', snippet: 'alpha' },
    { path: 'b.md', snippet: 'beta' },
    { path: 'c.md', snippet: 'gamma' },
  ];

  it('returns original when sampling unavailable', async () => {
    const out = await rerankWithSampling(
      makeMockServer({ sampling: false }),
      'test query', results, 3
    );
    assert.deepEqual(out, results);
  });

  it('reorders results based on sampling response', async () => {
    const server = makeMockServer({ sampling: true, response: '[3, 1, 2]' });
    const out = await rerankWithSampling(server, 'test query', results, 3);
    assert.equal(out[0].path, 'c.md');
    assert.equal(out[1].path, 'a.md');
    assert.equal(out[2].path, 'b.md');
  });

  it('preserves unreferenced results at the end', async () => {
    const server = makeMockServer({ sampling: true, response: '[2]' });
    const out = await rerankWithSampling(server, 'query', results, 10);
    assert.equal(out[0].path, 'b.md');
    assert.equal(out.length, 3);
  });

  it('returns original for single result', async () => {
    const single = [{ path: 'x.md', snippet: 'only' }];
    const out = await rerankWithSampling(makeMockServer(), 'q', single, 1);
    assert.deepEqual(out, single);
  });

  it('returns original for empty results', async () => {
    const out = await rerankWithSampling(makeMockServer(), 'q', [], 5);
    assert.deepEqual(out, []);
  });

  it('respects limit parameter', async () => {
    const server = makeMockServer({ sampling: true, response: '[3, 1, 2]' });
    const out = await rerankWithSampling(server, 'q', results, 2);
    assert.equal(out.length, 2);
    assert.equal(out[0].path, 'c.md');
    assert.equal(out[1].path, 'a.md');
  });
});

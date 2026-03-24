import { describe, it } from 'node:test';
import assert from 'node:assert';
import { filterUpstreamResponseHeadersForDecodedBody } from '../hub/gateway/upstream-response-headers.mjs';

describe('filterUpstreamResponseHeadersForDecodedBody', () => {
  it('removes content-encoding and length so decoded text() bodies are not double-decoded', () => {
    const out = filterUpstreamResponseHeadersForDecodedBody([
      ['Content-Encoding', 'br'],
      ['Content-Length', '999'],
      ['Content-Type', 'application/json; charset=utf-8'],
      ['X-Powered-By', 'Express'],
    ]);
    assert.deepStrictEqual(out, [
      ['Content-Type', 'application/json; charset=utf-8'],
      ['X-Powered-By', 'Express'],
    ]);
  });

  it('removes transfer-encoding and connection case-insensitively', () => {
    const out = filterUpstreamResponseHeadersForDecodedBody([
      ['transfer-encoding', 'chunked'],
      ['Connection', 'keep-alive'],
      ['ETag', '"abc"'],
    ]);
    assert.deepStrictEqual(out, [['ETag', '"abc"']]);
  });
});

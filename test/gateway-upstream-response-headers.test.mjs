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

  it('strips upstream CORS headers so gateway CORS middleware is authoritative', () => {
    const out = filterUpstreamResponseHeadersForDecodedBody([
      ['Access-Control-Allow-Origin', 'https://canister-origin.example'],
      ['access-control-allow-methods', 'GET, POST'],
      ['Access-Control-Allow-Headers', 'Authorization'],
      ['access-control-allow-credentials', 'true'],
      ['Access-Control-Expose-Headers', 'X-Custom'],
      ['Access-Control-Max-Age', '3600'],
      ['Content-Type', 'application/json'],
      ['X-Custom', 'kept'],
    ]);
    assert.deepStrictEqual(out, [
      ['Content-Type', 'application/json'],
      ['X-Custom', 'kept'],
    ]);
  });
});

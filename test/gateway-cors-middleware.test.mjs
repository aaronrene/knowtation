import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyGatewayCors } from '../hub/gateway/cors-middleware.mjs';

function mockRes() {
  const headers = {};
  return {
    set(name, value) {
      headers[name.toLowerCase()] = value;
    },
    headers,
  };
}

describe('applyGatewayCors', () => {
  it('with empty HUB list uses * and does not set Allow-Credentials', () => {
    const res = mockRes();
    applyGatewayCors(res, 'https://knowtation.store', []);
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.equal(res.headers['access-control-allow-credentials'], undefined);
  });

  it('with configured origins reflects matching Origin and sets credentials', () => {
    const res = mockRes();
    const list = ['https://knowtation.store', 'https://www.knowtation.store'];
    applyGatewayCors(res, 'https://www.knowtation.store', list);
    assert.equal(res.headers['access-control-allow-origin'], 'https://www.knowtation.store');
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
    assert.equal(res.headers.vary, 'Origin');
  });

  it('with configured origins and foreign Origin falls back to first allowlisted (browser may still block)', () => {
    const res = mockRes();
    const list = ['https://knowtation.store', 'https://www.knowtation.store'];
    applyGatewayCors(res, 'https://evil.example', list);
    assert.equal(res.headers['access-control-allow-origin'], 'https://knowtation.store');
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
  });
});

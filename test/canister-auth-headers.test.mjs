import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { canisterAuthHeaders } from '../hub/gateway/canister-auth-headers.mjs';

describe('canisterAuthHeaders (gateway → ICP X-Gateway-Auth)', () => {
  let saved;

  before(() => {
    saved = process.env.CANISTER_AUTH_SECRET;
  });

  after(() => {
    if (saved === undefined) delete process.env.CANISTER_AUTH_SECRET;
    else process.env.CANISTER_AUTH_SECRET = saved;
  });

  test('returns x-gateway-auth when CANISTER_AUTH_SECRET is set', () => {
    process.env.CANISTER_AUTH_SECRET = 'test-secret-value';
    assert.deepEqual(canisterAuthHeaders(), { 'x-gateway-auth': 'test-secret-value' });
  });

  test('returns empty object when CANISTER_AUTH_SECRET is unset or empty', () => {
    delete process.env.CANISTER_AUTH_SECRET;
    assert.deepEqual(canisterAuthHeaders(), {});
    process.env.CANISTER_AUTH_SECRET = '';
    assert.deepEqual(canisterAuthHeaders(), {});
  });
});

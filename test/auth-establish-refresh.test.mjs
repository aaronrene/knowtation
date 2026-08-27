/**
 * Behavioral tests for POST /auth/establish-refresh — session JWT → durable refresh token.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createEstablishRefreshHandler, REFRESH_COOKIE_NAME } from '../hub/auth-session.mjs';

function mockRes() {
  /** @type {Record<string, string>} */
  const headers = {};
  /** @type {Record<string, string>} */
  const cookies = {};
  return {
    statusCode: 200,
    body: null,
    set(name, value) {
      headers[String(name).toLowerCase()] = String(value);
    },
    cookie(name, value) {
      cookies[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    headers,
    cookies,
  };
}

describe('createEstablishRefreshHandler', () => {
  const handler = createEstablishRefreshHandler({
    store: {
      issue: async (sub) => ({ token: `${sub}.refreshsecret` }),
    },
    verifyAccessToken: (token) => {
      if (token === 'good') return { sub: 'google:1', type: 'session' };
      if (token === 'agent') return { sub: 'google:1', type: 'agent_access' };
      return null;
    },
    cookieOptions: () => ({ httpOnly: true, secure: true, sameSite: 'none', path: '/api/v1/auth' }),
  });

  test('issues refresh token + cookie for valid session JWT', async () => {
    const req = { headers: { authorization: 'Bearer good' } };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.refresh_token, 'google:1.refreshsecret');
    assert.equal(res.cookies[REFRESH_COOKIE_NAME], 'google:1.refreshsecret');
  });

  test('rejects missing bearer', async () => {
    const res = mockRes();
    await handler({ headers: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'UNAUTHORIZED');
  });

  test('rejects non-session token types', async () => {
    const res = mockRes();
    await handler({ headers: { authorization: 'Bearer agent' } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'SESSION_ESTABLISH_DENIED');
  });

  test('store throw → 503 SESSION_STORE_UNAVAILABLE', async () => {
    const failing = createEstablishRefreshHandler({
      store: {
        issue: async () => {
          throw new Error('blob write refused');
        },
      },
      verifyAccessToken: () => ({ sub: 'google:1', type: 'session' }),
      cookieOptions: () => ({ httpOnly: true, path: '/api/v1/auth' }),
    });
    const res = mockRes();
    await failing({ headers: { authorization: 'Bearer good' } }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'SESSION_STORE_UNAVAILABLE');
  });
});

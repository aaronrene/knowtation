/**
 * Behavioral tests for POST /auth/establish-refresh — browser vs CLI delivery modes.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEstablishRefreshHandler,
  REFRESH_COOKIE_NAME,
} from '../hub/auth-session.mjs';
import { acceptIncludesRefreshTokenCli, REFRESH_TOKEN_CLI_ACCEPT } from '../hub/lib/human-session-admission.mjs';

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

function sessionOk() {
  const now = Math.floor(Date.now() / 1000);
  return {
    ok: true,
    payload: {
      sub: 'google:1',
      type: 'session',
      iat: now - 60,
      exp: now - 60 + 10800,
    },
  };
}

describe('createEstablishRefreshHandler', () => {
  const handler = createEstablishRefreshHandler({
    store: {
      issue: async (sub) => ({ token: `${sub}.refreshsecret` }),
    },
    verifyHumanSession: (token) => {
      if (token === 'good') return sessionOk();
      if (token === 'expired') return { ok: false, code: 'SESSION_EXPIRED' };
      if (token === 'agent') return { ok: false, code: 'SESSION_INVALID' };
      return { ok: false, code: 'SESSION_INVALID' };
    },
    cookieOptions: () => ({ httpOnly: true, secure: true, sameSite: 'none', path: '/api/v1/auth' }),
    isBrowserOriginAllowed: (o) => o === 'https://knowtation.store',
    acceptIncludesCliMediaType: acceptIncludesRefreshTokenCli,
  });

  test('browser Origin: cookie + established body, never refresh_token', async () => {
    const req = {
      headers: {
        authorization: 'Bearer good',
        origin: 'https://knowtation.store',
        accept: REFRESH_TOKEN_CLI_ACCEPT,
      },
    };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.established, true);
    assert.equal(res.body.refresh_token, undefined);
    assert.equal(res.cookies[REFRESH_COOKIE_NAME], 'google:1.refreshsecret');
  });

  test('CLI no-Origin + vendor Accept: refresh_token, no cookie', async () => {
    const req = {
      headers: {
        authorization: 'Bearer good',
        accept: REFRESH_TOKEN_CLI_ACCEPT,
      },
    };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.refresh_token, 'google:1.refreshsecret');
    assert.equal(res.cookies[REFRESH_COOKIE_NAME], undefined);
  });

  test('rejects missing bearer', async () => {
    const res = mockRes();
    await handler({ headers: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'UNAUTHORIZED');
  });

  test('rejects non-session / invalid with SESSION_INVALID', async () => {
    const res = mockRes();
    await handler(
      { headers: { authorization: 'Bearer agent', origin: 'https://knowtation.store' } },
      res,
    );
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'SESSION_INVALID');
  });

  test('expired session → SESSION_EXPIRED without issuing', async () => {
    const res = mockRes();
    await handler(
      { headers: { authorization: 'Bearer expired', origin: 'https://knowtation.store' } },
      res,
    );
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'SESSION_EXPIRED');
  });

  test('store throw → 503 SESSION_STORE_UNAVAILABLE', async () => {
    const failing = createEstablishRefreshHandler({
      store: {
        issue: async () => {
          throw new Error('blob write refused');
        },
      },
      verifyHumanSession: () => sessionOk(),
      cookieOptions: () => ({ httpOnly: true, path: '/api/v1/auth' }),
      isBrowserOriginAllowed: () => true,
      acceptIncludesCliMediaType: acceptIncludesRefreshTokenCli,
    });
    const res = mockRes();
    await failing(
      { headers: { authorization: 'Bearer good', origin: 'https://knowtation.store' } },
      res,
    );
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'SESSION_STORE_UNAVAILABLE');
  });
});

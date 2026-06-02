/**
 * Auth-session handler tests — refresh/logout HTTP orchestration + cookie policy.
 *
 * Tiers: unit (cookie option policy), integration (handlers against the REAL file store
 * through a temp dir), security (reuse clears cookie + REFRESH_REUSE, missing token 401,
 * HttpOnly always set, SameSite=None forces Secure).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  refreshCookieOptions,
  clearCookieOptions,
  issueRefreshCookie,
  createRefreshHandler,
  createLogoutHandler,
} from '../hub/auth-session.mjs';
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} from '../hub/refresh-tokens.mjs';

/** Minimal express-like response double that records what handlers do. */
function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    cookies: [],
    clearedCookies: [],
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    cookie(name, value, options) { this.cookies.push({ name, value, options }); return this; },
    clearCookie(name, options) { this.clearedCookies.push({ name, options }); return this; },
  };
}

/** Build a store bound to a temp data dir, matching the shape auth-session expects. */
function fileStore(dataDir) {
  return {
    issue: (sub, opts) => issueRefreshToken(dataDir, sub, opts),
    rotate: (token, opts) => rotateRefreshToken(dataDir, token, opts),
    revoke: (token) => revokeRefreshToken(dataDir, token),
  };
}

const cookieOptions = () => refreshCookieOptions({ secure: true, sameSite: 'lax', maxAgeMs: 1000 });
const issueAccessToken = (sub) => `access-for-${sub}`;

let dataDir;
beforeEach(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-sess-')); });
afterEach(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* noop */ } });

// ---------------------------------------------------------------------------
// unit — cookie policy
// ---------------------------------------------------------------------------
describe('cookie policy', () => {
  it('always sets HttpOnly and defaults to the auth path', () => {
    const o = refreshCookieOptions();
    assert.equal(o.httpOnly, true);
    assert.equal(o.path, REFRESH_COOKIE_PATH);
  });

  it('SameSite=None forces Secure (browsers drop None without Secure)', () => {
    const o = refreshCookieOptions({ sameSite: 'none', secure: false });
    assert.equal(o.sameSite, 'none');
    assert.equal(o.secure, true);
  });

  it('clearCookieOptions mirrors set options but omits maxAge', () => {
    const set = refreshCookieOptions({ secure: true, sameSite: 'lax', maxAgeMs: 5000 });
    const clear = clearCookieOptions(set);
    assert.equal(clear.maxAge, undefined);
    assert.equal(clear.httpOnly, true);
    assert.equal(clear.path, REFRESH_COOKIE_PATH);
    assert.equal(clear.sameSite, 'lax');
  });
});

// ---------------------------------------------------------------------------
// integration — issue + refresh + logout through the real file store
// ---------------------------------------------------------------------------
describe('issueRefreshCookie', () => {
  it('sets an HttpOnly cookie and returns the token', async () => {
    const res = mockRes();
    const token = await issueRefreshCookie(res, {
      store: fileStore(dataDir),
      sub: 'google:1',
      cookieOptions,
      now: 1000,
    });
    assert.ok(token.includes('.'));
    assert.equal(res.cookies.length, 1);
    assert.equal(res.cookies[0].name, REFRESH_COOKIE_NAME);
    assert.equal(res.cookies[0].value, token);
    assert.equal(res.cookies[0].options.httpOnly, true);
  });
});

describe('refresh handler', () => {
  it('rotates a valid cookie token: returns access token + sets a new cookie', async () => {
    const store = fileStore(dataDir);
    const setRes = mockRes();
    const token = await issueRefreshCookie(setRes, { store, sub: 'google:1', cookieOptions, now: 1000 });

    const handler = createRefreshHandler({ store, issueAccessToken, cookieOptions, now: () => 2000 });
    const req = { cookies: { [REFRESH_COOKIE_NAME]: token } };
    const res = mockRes();
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.access_token, 'access-for-google:1');
    assert.equal(res.body.token_type, 'Bearer');
    assert.equal(res.cookies.length, 1, 'a rotated cookie must be set');
    assert.notEqual(res.cookies[0].value, token, 'rotated token must differ');
    assert.equal(res.headers['Cache-Control'], 'private, no-store, must-revalidate');
  });

  it('accepts the token from a JSON body when no cookie is present', async () => {
    const store = fileStore(dataDir);
    const token = issueRefreshToken(dataDir, 'github:9', { now: 1000 }).token;
    const handler = createRefreshHandler({ store, issueAccessToken, cookieOptions, now: () => 2000 });
    const res = mockRes();
    await handler({ cookies: {}, body: { refresh_token: token } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.access_token, 'access-for-github:9');
  });

  it('returns 401 when no token is presented', async () => {
    const store = fileStore(dataDir);
    const handler = createRefreshHandler({ store, issueAccessToken, cookieOptions });
    const res = mockRes();
    await handler({ cookies: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'UNAUTHORIZED');
  });

  it('on REUSE: clears the cookie and returns REFRESH_REUSE', async () => {
    const store = fileStore(dataDir);
    const token = issueRefreshToken(dataDir, 'google:1', { now: 1000 }).token;
    // First rotation consumes the token.
    rotateRefreshToken(dataDir, token, { now: 2000 });
    // Replay the original (now-rotated) token via the handler.
    const handler = createRefreshHandler({ store, issueAccessToken, cookieOptions, now: () => 3000 });
    const res = mockRes();
    await handler({ cookies: { [REFRESH_COOKIE_NAME]: token } }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'REFRESH_REUSE');
    assert.equal(res.clearedCookies.length, 1, 'reuse must clear the cookie');
    assert.equal(res.clearedCookies[0].options.maxAge, undefined);
  });

  it('on EXPIRED: clears the cookie and returns REFRESH_EXPIRED', async () => {
    const store = fileStore(dataDir);
    const token = issueRefreshToken(dataDir, 'google:1', { now: 1000, tokenTtlMs: 500 }).token;
    const handler = createRefreshHandler({ store, issueAccessToken, cookieOptions, now: () => 5000 });
    const res = mockRes();
    await handler({ cookies: { [REFRESH_COOKIE_NAME]: token } }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'REFRESH_EXPIRED');
    assert.equal(res.clearedCookies.length, 1);
  });

  it('on a store fault: fails soft with 503 and does NOT clear the cookie', async () => {
    // An async store whose rotate() rejects simulates a transient blob backend outage.
    const faultyStore = {
      issue: async () => { throw new Error('unused'); },
      rotate: async () => { throw new Error('blob unavailable'); },
      revoke: async () => ({ revoked: false }),
    };
    const handler = createRefreshHandler({ store: faultyStore, issueAccessToken, cookieOptions });
    const res = mockRes();
    await handler({ cookies: { [REFRESH_COOKIE_NAME]: 'id.secret' } }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'SESSION_STORE_UNAVAILABLE');
    assert.equal(res.clearedCookies.length, 0, 'a transient fault must not log the user out');
  });

  it('awaits an async issueAccessToken (Promise-returning signer)', async () => {
    const store = fileStore(dataDir);
    const token = issueRefreshToken(dataDir, 'google:7', { now: 1000 }).token;
    const asyncSigner = async (sub) => `async-access-for-${sub}`;
    const handler = createRefreshHandler({ store, issueAccessToken: asyncSigner, cookieOptions, now: () => 2000 });
    const res = mockRes();
    await handler({ cookies: { [REFRESH_COOKIE_NAME]: token } }, res);
    assert.equal(res.body.access_token, 'async-access-for-google:7');
  });
});

describe('logout handler', () => {
  it('revokes the presented token and clears the cookie', async () => {
    const store = fileStore(dataDir);
    const token = issueRefreshToken(dataDir, 'google:1', { now: 1000 }).token;
    const handler = createLogoutHandler({ store, cookieOptions });
    const res = mockRes();
    await handler({ cookies: { [REFRESH_COOKIE_NAME]: token } }, res);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.revoked, true);
    assert.equal(res.clearedCookies.length, 1);
    // Token no longer works.
    const after = rotateRefreshToken(dataDir, token, { now: 2000 });
    assert.equal(after.ok, false);
  });

  it('is idempotent when no token is present (still clears + ok)', async () => {
    const store = fileStore(dataDir);
    const handler = createLogoutHandler({ store, cookieOptions });
    const res = mockRes();
    await handler({ cookies: {} }, res);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.revoked, false);
    assert.equal(res.clearedCookies.length, 1);
  });

  it('tolerates an async store whose revoke() rejects (still clears + ok)', async () => {
    const faultyStore = { revoke: async () => { throw new Error('blob down'); } };
    const handler = createLogoutHandler({ store: faultyStore, cookieOptions });
    const res = mockRes();
    await handler({ cookies: { [REFRESH_COOKIE_NAME]: 'id.secret' } }, res);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.revoked, false);
    assert.equal(res.clearedCookies.length, 1);
  });
});

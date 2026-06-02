/**
 * Structural wiring tests — proves the self-hosted Hub actually mounts the persistent-session
 * machinery (refresh-token rotation + HttpOnly cookie + real logout). These guard the
 * integration points; the behavioral guarantees are covered by refresh-token-core,
 * refresh-tokens-store, and auth-session test suites.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

describe('self-hosted Hub wires persistent sessions', () => {
  let src;
  const load = () => {
    if (!src) src = fs.readFileSync(path.join(ROOT, 'hub/server.mjs'), 'utf8');
    return src;
  };

  test('imports cookie-parser and registers it as middleware', () => {
    const s = load();
    assert.ok(s.includes("import cookieParser from 'cookie-parser'"), 'must import cookie-parser');
    assert.ok(s.includes('app.use(cookieParser())'), 'must register cookieParser middleware');
  });

  test('imports the refresh-token store and auth-session helpers', () => {
    const s = load();
    assert.ok(s.includes("from './refresh-tokens.mjs'"), 'must import the refresh-token store');
    assert.ok(s.includes("from './auth-session.mjs'"), 'must import auth-session helpers');
  });

  test('mounts POST /api/v1/auth/refresh and /api/v1/auth/logout', () => {
    const s = load();
    assert.ok(/app\.post\(\s*'\/api\/v1\/auth\/refresh'/.test(s), 'must mount POST /auth/refresh');
    assert.ok(/app\.post\(\s*'\/api\/v1\/auth\/logout'/.test(s), 'must mount POST /auth/logout');
  });

  test('refresh route uses createRefreshHandler with the refresh store', () => {
    const s = load();
    const block = s.slice(s.indexOf("'/api/v1/auth/refresh'"), s.indexOf("'/api/v1/auth/refresh'") + 400);
    assert.ok(block.includes('createRefreshHandler'), 'refresh route must use createRefreshHandler');
    assert.ok(block.includes('issueAccessToken'), 'refresh route must supply an access-token signer');
  });

  test('OAuth callback issues a refresh cookie', () => {
    const s = load();
    const block = s.slice(s.indexOf('function handleAuthCallback'));
    const end = block.indexOf('\n}\n');
    const body = block.slice(0, end > 0 ? end : 1200);
    assert.ok(body.includes('issueRefreshCookie'), 'login callback must issue a refresh cookie');
  });

  test('refresh cookie policy is HttpOnly and path-scoped to the auth endpoints', () => {
    const s = load();
    assert.ok(s.includes('refreshCookieOptions'), 'must use refreshCookieOptions for the policy');
    // The policy helper centralizes HttpOnly; assert the auth-session module enforces it.
    const sess = fs.readFileSync(path.join(ROOT, 'hub/auth-session.mjs'), 'utf8');
    assert.ok(sess.includes('httpOnly: true'), 'refresh cookie must be HttpOnly');
    assert.ok(sess.includes("REFRESH_COOKIE_PATH = '/api/v1/auth'"), 'cookie must be scoped to /api/v1/auth');
  });

  test('logout uses createLogoutHandler (server-side revocation)', () => {
    const s = load();
    const block = s.slice(s.indexOf("'/api/v1/auth/logout'"), s.indexOf("'/api/v1/auth/logout'") + 300);
    assert.ok(block.includes('createLogoutHandler'), 'logout must use createLogoutHandler');
  });
});

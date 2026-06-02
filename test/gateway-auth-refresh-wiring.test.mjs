/**
 * Structural wiring tests — proves the hosted gateway actually mounts the persistent-session
 * machinery (refresh-token rotation + HttpOnly cookie + real logout) and provisions a
 * strong-consistency blob for the auth store. These guard the integration points; the
 * behavioral guarantees live in the refresh-token-core, gateway-refresh-token-store, and
 * auth-session suites.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

describe('hosted gateway wires persistent sessions', () => {
  let src;
  const load = () => {
    if (!src) src = fs.readFileSync(path.join(ROOT, 'hub/gateway/server.mjs'), 'utf8');
    return src;
  };

  test('imports auth-session helpers and the gateway refresh store', () => {
    const s = load();
    assert.ok(s.includes("from '../auth-session.mjs'"), 'must import auth-session helpers');
    assert.ok(s.includes("from './refresh-token-store.mjs'"), 'must import the gateway refresh store');
  });

  test('mounts POST /api/v1/auth/refresh and /api/v1/auth/logout before the proxies', () => {
    const s = load();
    assert.ok(/app\.post\(\s*'\/api\/v1\/auth\/refresh'/.test(s), 'must mount POST /auth/refresh');
    assert.ok(/app\.post\(\s*'\/api\/v1\/auth\/logout'/.test(s), 'must mount POST /auth/logout');
    // Auth routes must be registered before any bridge/canister proxy so they are handled locally.
    const refreshIdx = s.indexOf("'/api/v1/auth/refresh'");
    const proxyIdx = s.indexOf('proxyTo(');
    assert.ok(refreshIdx > 0 && (proxyIdx === -1 || refreshIdx < proxyIdx), 'auth routes precede proxies');
  });

  test('answers OPTIONS preflight for the credentialed auth routes', () => {
    const s = load();
    assert.ok(/app\.options\(\[\s*'\/api\/v1\/auth\/refresh'/.test(s), 'must handle OPTIONS preflight');
  });

  test('refresh route uses createRefreshHandler with a sub-only access-token signer', () => {
    const s = load();
    const block = s.slice(s.indexOf("'/api/v1/auth/refresh'"), s.indexOf("'/api/v1/auth/refresh'") + 400);
    assert.ok(block.includes('createRefreshHandler'), 'refresh route must use createRefreshHandler');
    assert.ok(block.includes('issueAccessTokenForSub'), 'refresh route must re-mint from sub alone');
  });

  test('both OAuth callbacks issue a refresh cookie before redirect', () => {
    const s = load();
    const g = s.indexOf("'/auth/callback/google'");
    const gh = s.indexOf("'/auth/callback/github'");
    assert.ok(g > 0 && gh > 0);
    assert.ok(s.slice(g, g + 600).includes('issueRefreshCookieSafe'), 'google callback issues cookie');
    assert.ok(s.slice(gh, gh + 600).includes('issueRefreshCookieSafe'), 'github callback issues cookie');
  });

  test('cookie policy adapts SameSite to cross-origin deployments', () => {
    const s = load();
    const block = s.slice(s.indexOf('function refreshCookiePolicy'), s.indexOf('function refreshCookiePolicy') + 400);
    assert.ok(block.includes("'none'") && block.includes("'lax'"), 'policy chooses None (cross-origin) vs Lax (same-origin)');
  });

  test('logout uses createLogoutHandler (server-side revocation)', () => {
    const s = load();
    // The first occurrence is the OPTIONS preflight array; the POST route is the later one.
    const postIdx = s.lastIndexOf("'/api/v1/auth/logout'");
    const block = s.slice(postIdx, postIdx + 300);
    assert.ok(block.includes('createLogoutHandler'), 'logout must use createLogoutHandler');
  });

  test('refresh-cookie issuance logs success and surfaces failures (no silent swallow)', () => {
    const s = load();
    const start = s.indexOf('async function issueRefreshCookieSafe');
    assert.ok(start > 0, 'issueRefreshCookieSafe must exist');
    const block = s.slice(start, start + 1200);
    // Must log a real error in the catch, not swallow it with a bare noop.
    assert.ok(/catch\s*\(\s*err\s*\)/.test(block), 'catch must bind the error');
    assert.ok(block.includes('console.error'), 'a refresh-store write failure must be logged');
    assert.ok(block.includes('authBlobPresent'), 'failure log must record whether the auth blob was provisioned');
    assert.doesNotMatch(block, /catch\s*\(\s*_\s*\)\s*\{\s*\/\/[^\n]*\n\s*\}/, 'must not silently swallow the error');
  });

  test('Netlify function provisions a strong-consistency auth blob and cleans it up', () => {
    const fn = fs.readFileSync(path.join(ROOT, 'netlify/functions/gateway.mjs'), 'utf8');
    assert.ok(fn.includes("name: 'gateway-auth'"), 'must provision the gateway-auth store');
    assert.ok(/consistency:\s*'strong'/.test(fn), 'auth store must be strong-consistency');
    assert.ok(fn.includes('delete globalThis.__knowtation_gateway_auth_blob'), 'must clean up the global');
  });
});

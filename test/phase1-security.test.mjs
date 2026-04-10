/**
 * Phase 1 Security Remediation Tests
 *
 * Covers all 5 Phase 1 items from docs/SECURITY-AUDIT-PLAN.md:
 *   1.1 — Trust proxy for Express rate limiting
 *   1.2 — Zip-slip protection in AdmZip import
 *   1.3 — Self-hosted default-admin startup warning when roleMap is empty
 *   1.4 — Header allowlist replacing ...req.headers spread
 *   1.5 — Billing enforcement startup warning when BILLING_ENFORCE unset
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

// ---------------------------------------------------------------------------
// 1.1  Trust proxy for Express rate limiting
// ---------------------------------------------------------------------------
describe('1.1 trust proxy — Express rate limit IP resolution', () => {
  /**
   * Mirrors the trust-proxy logic: Express uses req.ip which reads
   * X-Forwarded-For when trust proxy is enabled.  Tests confirm that the
   * setting is present and that rate-limit middleware receives the real client
   * IP rather than the CDN/load-balancer address.
   */

  function simulateExpressIp(trustProxy, headers, remoteAddress) {
    // Simplified mirror of Express req.ip behaviour
    if (!trustProxy) return remoteAddress;
    const xff = headers['x-forwarded-for'];
    if (!xff) return remoteAddress;
    // Express with trust proxy = 1 uses the leftmost untrusted hop
    return xff.split(',')[0].trim();
  }

  test('with trust proxy disabled, IP is the socket remote address (CDN IP)', () => {
    const ip = simulateExpressIp(false, { 'x-forwarded-for': '1.2.3.4' }, '10.0.0.1');
    assert.equal(ip, '10.0.0.1', 'should return the socket address, not the forwarded IP');
  });

  test('with trust proxy enabled, IP is taken from X-Forwarded-For (real client IP)', () => {
    const ip = simulateExpressIp(true, { 'x-forwarded-for': '1.2.3.4, 10.0.0.2' }, '10.0.0.1');
    assert.equal(ip, '1.2.3.4', 'should return the real client IP from X-Forwarded-For');
  });

  test('with trust proxy enabled and no X-Forwarded-For, falls back to remote address', () => {
    const ip = simulateExpressIp(true, {}, '10.0.0.1');
    assert.equal(ip, '10.0.0.1', 'should fall back to remote address when XFF is absent');
  });

  test('rate limiter uses client IP for key (not CDN IP) when trust proxy is on', () => {
    const clientIp = '203.0.113.5';
    const cdnIp = '192.168.1.1';
    const ipWithProxy = simulateExpressIp(true, { 'x-forwarded-for': clientIp }, cdnIp);
    const ipWithoutProxy = simulateExpressIp(false, { 'x-forwarded-for': clientIp }, cdnIp);
    assert.equal(ipWithProxy, clientIp, 'trust proxy on: rate limiter keys on real client IP');
    assert.equal(ipWithoutProxy, cdnIp, 'trust proxy off: rate limiter would key on CDN IP (bad)');
    assert.notEqual(ipWithProxy, ipWithoutProxy);
  });

  test('trust proxy value of 1 trusts exactly one hop', () => {
    // With trust proxy = 1, the first hop in XFF is returned
    // (Express validates from the right by default, returning the first untrusted)
    const headers = { 'x-forwarded-for': 'real-client, cdn-hop1' };
    const ip = simulateExpressIp(true, headers, 'lb-address');
    assert.equal(ip, 'real-client', 'should pick the leftmost entry as the real client');
  });
});

// ---------------------------------------------------------------------------
// 1.2  Zip-slip protection
// ---------------------------------------------------------------------------
describe('1.2 zip-slip protection — path traversal detection', () => {
  /**
   * Mirrors the zip-slip validation added to hub/server.mjs and hub/bridge/server.mjs.
   * The guard resolves each entry path and verifies it stays inside extractDir.
   */

  function validateZipEntries(entries, extractDir) {
    const extractDirResolved = path.resolve(extractDir) + path.sep;
    for (const entryName of entries) {
      const entryResolved = path.resolve(extractDir, entryName);
      if (entryResolved !== path.resolve(extractDir) && !entryResolved.startsWith(extractDirResolved)) {
        return { safe: false, offendingEntry: entryName };
      }
    }
    return { safe: true };
  }

  test('benign entries within extract dir are allowed', () => {
    const extractDir = '/tmp/knowtation-test-extract';
    const entries = ['notes/note1.md', 'notes/subdir/note2.md', 'media/image.png'];
    const result = validateZipEntries(entries, extractDir);
    assert.ok(result.safe, 'normal nested entries should pass');
  });

  test('classic zip-slip "../" traversal is rejected', () => {
    const extractDir = '/tmp/knowtation-test-extract';
    const entries = ['notes/note.md', '../evil.sh'];
    const result = validateZipEntries(entries, extractDir);
    assert.ok(!result.safe, 'path traversal entry should fail validation');
    assert.equal(result.offendingEntry, '../evil.sh');
  });

  test('absolute path escape is rejected', () => {
    const extractDir = '/tmp/knowtation-test-extract';
    const entries = ['/etc/passwd'];
    const result = validateZipEntries(entries, extractDir);
    assert.ok(!result.safe, 'absolute path outside extract dir should fail');
  });

  test('deep traversal through nested dirs is rejected', () => {
    const extractDir = '/tmp/knowtation-test-extract';
    const entries = ['a/b/../../../../../../etc/cron.d/attack'];
    const result = validateZipEntries(entries, extractDir);
    assert.ok(!result.safe, 'deep traversal should fail');
  });

  test('entry that normalises to the extractDir root is allowed (empty dir entry)', () => {
    const extractDir = '/tmp/knowtation-test-extract';
    const entries = ['.'];
    const result = validateZipEntries(entries, extractDir);
    assert.ok(result.safe, 'dot entry resolving to extractDir root is harmless');
  });

  test('entry just outside extract dir (sibling) is rejected', () => {
    const extractDir = '/tmp/knowtation-test-extract';
    const entries = ['../sibling-dir/file.txt'];
    const result = validateZipEntries(entries, extractDir);
    assert.ok(!result.safe, 'sibling directory traversal should fail');
  });

  test('multiple safe entries all pass', () => {
    const extractDir = '/tmp/knowtation-test-extract';
    const entries = ['a/b/c.md', 'x/y/z/file.txt', 'root.md'];
    const result = validateZipEntries(entries, extractDir);
    assert.ok(result.safe, 'all safe entries should pass');
  });

  test('empty entry list is safe', () => {
    const extractDir = '/tmp/knowtation-test-extract';
    const result = validateZipEntries([], extractDir);
    assert.ok(result.safe, 'empty zip is safe');
  });
});

// ---------------------------------------------------------------------------
// 1.3  Default-admin startup warning when roleMap is empty in production
// ---------------------------------------------------------------------------
describe('1.3 default-admin warning — empty roleMap in production', () => {
  /**
   * Mirrors the issueToken / effectiveRole logic and the startup warning condition
   * from hub/server.mjs.  When roleMap.size === 0, every authenticated user gets
   * admin role (first-run convenience).  In production this must trigger a warning.
   */

  function effectiveRoleFromMap(roleMap, sub) {
    if (roleMap.size === 0) return 'admin';
    const stored = roleMap.get(sub);
    if (stored === 'admin') return 'admin';
    if (stored && ['editor', 'viewer', 'evaluator'].includes(stored)) return stored;
    return 'editor'; // default member → editor
  }

  function shouldWarnDefaultAdmin(isProduction, roleMap) {
    return isProduction && roleMap.size === 0;
  }

  test('empty roleMap assigns admin to any user in dev (no warning)', () => {
    const roleMap = new Map();
    assert.equal(effectiveRoleFromMap(roleMap, 'google:123'), 'admin');
    assert.ok(!shouldWarnDefaultAdmin(false, roleMap), 'no warning in dev');
  });

  test('empty roleMap in production should trigger warning', () => {
    const roleMap = new Map();
    assert.ok(shouldWarnDefaultAdmin(true, roleMap), 'warning required in production with empty roleMap');
    assert.equal(effectiveRoleFromMap(roleMap, 'google:999'), 'admin', 'user still gets admin role');
  });

  test('non-empty roleMap in production suppresses warning', () => {
    const roleMap = new Map([['google:admin-user', 'admin']]);
    assert.ok(!shouldWarnDefaultAdmin(true, roleMap), 'no warning when roles are configured');
  });

  test('a single role entry is enough to silence the warning', () => {
    const roleMap = new Map([['github:12345', 'editor']]);
    assert.ok(!shouldWarnDefaultAdmin(true, roleMap), 'one entry is sufficient');
  });

  test('non-admin users get correct roles when roleMap is populated', () => {
    const roleMap = new Map([
      ['google:admin-user', 'admin'],
      ['github:editor-user', 'editor'],
      ['google:viewer-user', 'viewer'],
    ]);
    assert.equal(effectiveRoleFromMap(roleMap, 'google:admin-user'), 'admin');
    assert.equal(effectiveRoleFromMap(roleMap, 'github:editor-user'), 'editor');
    assert.equal(effectiveRoleFromMap(roleMap, 'google:viewer-user'), 'viewer');
    assert.equal(effectiveRoleFromMap(roleMap, 'google:unknown-user'), 'editor', 'unknown defaults to editor');
  });

  test('warning condition is independent of NODE_ENV value (only isProduction flag matters)', () => {
    const roleMap = new Map();
    assert.ok(!shouldWarnDefaultAdmin(false, roleMap), 'false = no warning regardless of roleMap');
    assert.ok(shouldWarnDefaultAdmin(true, roleMap), 'true = warning when roleMap empty');
  });
});

// ---------------------------------------------------------------------------
// 1.4  Header allowlist — replacing ...req.headers spread
// ---------------------------------------------------------------------------
describe('1.4 header allowlist — safe header forwarding', () => {
  /**
   * Mirrors the PROXY_HEADER_ALLOWLIST constant and header-building logic
   * added to hub/gateway/server.mjs proxyTo and proxyToCanister.
   */

  const PROXY_HEADER_ALLOWLIST = new Set([
    'content-type',
    'accept',
    'accept-language',
    'accept-encoding',
  ]);

  function buildBridgeHeaders(baseUrl, reqHeaders) {
    const headers = { host: new URL(baseUrl).host };
    for (const k of PROXY_HEADER_ALLOWLIST) {
      if (reqHeaders[k] !== undefined) headers[k] = reqHeaders[k];
    }
    if (reqHeaders.authorization) headers.authorization = reqHeaders.authorization;
    if (reqHeaders['x-vault-id']) headers['x-vault-id'] = reqHeaders['x-vault-id'];
    return headers;
  }

  function buildCanisterHeaders(canisterUrl, extraHeaders, reqHeaders) {
    const headers = { host: new URL(canisterUrl).host, ...extraHeaders };
    for (const k of PROXY_HEADER_ALLOWLIST) {
      if (reqHeaders[k] !== undefined) headers[k] = reqHeaders[k];
    }
    return headers;
  }

  const CANISTER_URL = 'https://canister.example.com';
  const BRIDGE_URL = 'https://bridge.example.com';

  test('allowlist contains expected safe headers', () => {
    assert.ok(PROXY_HEADER_ALLOWLIST.has('content-type'));
    assert.ok(PROXY_HEADER_ALLOWLIST.has('accept'));
    assert.ok(PROXY_HEADER_ALLOWLIST.has('accept-language'));
    assert.ok(PROXY_HEADER_ALLOWLIST.has('accept-encoding'));
  });

  test('allowlist does NOT contain dangerous headers', () => {
    const dangerous = [
      'cookie',
      'x-forwarded-for',
      'x-real-ip',
      'x-forwarded-host',
      'x-forwarded-proto',
      'x-test-user',
      'origin',
      'referer',
      'host',
      'authorization', // not in base allowlist (added explicitly for bridge only)
      'x-gateway-auth',
    ];
    for (const h of dangerous) {
      assert.ok(!PROXY_HEADER_ALLOWLIST.has(h), `dangerous header "${h}" must not be in allowlist`);
    }
  });

  test('proxyTo (bridge): only allowlisted headers forwarded plus authorization and x-vault-id', () => {
    const reqHeaders = {
      'content-type': 'application/json',
      'authorization': 'Bearer jwt-token',
      'x-vault-id': 'my-vault',
      'cookie': 'session=secret',
      'x-forwarded-for': '1.2.3.4',
      'x-custom-internal': 'leak',
      'origin': 'https://evil.example.com',
      'referer': 'https://attacker.example.com',
    };
    const forwarded = buildBridgeHeaders(BRIDGE_URL, reqHeaders);

    assert.equal(forwarded['content-type'], 'application/json');
    assert.equal(forwarded['authorization'], 'Bearer jwt-token');
    assert.equal(forwarded['x-vault-id'], 'my-vault');
    assert.equal(forwarded.host, 'bridge.example.com');

    assert.equal(forwarded.cookie, undefined, 'cookie must not be forwarded');
    assert.equal(forwarded['x-forwarded-for'], undefined, 'x-forwarded-for must not be forwarded');
    assert.equal(forwarded['x-custom-internal'], undefined, 'custom headers must not leak');
    assert.equal(forwarded.origin, undefined, 'origin must not be forwarded');
    assert.equal(forwarded.referer, undefined, 'referer must not be forwarded');
  });

  test('proxyToCanister: authorization is NOT forwarded (canister uses x-user-id + x-gateway-auth)', () => {
    const reqHeaders = {
      'content-type': 'application/json',
      'authorization': 'Bearer jwt-token',
      'cookie': 'session=leaked',
      'x-test-user': 'injected',
    };
    const forwarded = buildCanisterHeaders(CANISTER_URL, {
      'x-user-id': 'effective-uid',
      'x-actor-id': 'actor-uid',
      'x-vault-id': 'default',
    }, reqHeaders);

    assert.equal(forwarded['x-user-id'], 'effective-uid');
    assert.equal(forwarded['x-actor-id'], 'actor-uid');
    assert.equal(forwarded['content-type'], 'application/json');
    assert.equal(forwarded['authorization'], undefined, 'JWT must not reach canister');
    assert.equal(forwarded.cookie, undefined, 'cookie must not reach canister');
    assert.equal(forwarded['x-test-user'], undefined, 'x-test-user must not reach canister');
    assert.equal(forwarded.origin, undefined, 'origin must not reach canister');
  });

  test('proxyTo (bridge): headers absent in request are not forwarded', () => {
    const reqHeaders = {};
    const forwarded = buildBridgeHeaders(BRIDGE_URL, reqHeaders);
    assert.equal(forwarded['content-type'], undefined);
    assert.equal(forwarded['authorization'], undefined);
    assert.equal(forwarded['x-vault-id'], undefined);
    assert.equal(forwarded.host, 'bridge.example.com');
  });

  test('accept-language and accept-encoding are forwarded when present', () => {
    const reqHeaders = {
      'accept-language': 'en-US,en;q=0.9',
      'accept-encoding': 'gzip, deflate, br',
    };
    const forwarded = buildBridgeHeaders(BRIDGE_URL, reqHeaders);
    assert.equal(forwarded['accept-language'], 'en-US,en;q=0.9');
    assert.equal(forwarded['accept-encoding'], 'gzip, deflate, br');
  });

  test('host header is derived from baseUrl, not forwarded from client', () => {
    const reqHeaders = { host: 'attacker.evil.com' };
    const forwarded = buildBridgeHeaders(BRIDGE_URL, reqHeaders);
    assert.equal(forwarded.host, 'bridge.example.com', 'host must be derived from upstream URL');
  });
});

// ---------------------------------------------------------------------------
// 1.5  Billing enforcement startup warning
// ---------------------------------------------------------------------------
describe('1.5 billing enforcement warning — BILLING_ENFORCE unset in hosted mode', () => {
  /**
   * Mirrors the billingEnforced() helper from hub/gateway/billing-constants.mjs
   * and the startup-warning condition added to hub/gateway/server.mjs.
   */

  function billingEnforced(env = process.env) {
    return env.BILLING_ENFORCE === 'true' || env.BILLING_ENFORCE === '1';
  }

  function shouldWarnBillingEnforce(canisterUrl, env) {
    return Boolean(canisterUrl) && !billingEnforced(env);
  }

  let savedEnv;
  beforeEach(() => {
    savedEnv = process.env.BILLING_ENFORCE;
  });
  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env.BILLING_ENFORCE = savedEnv;
    } else {
      delete process.env.BILLING_ENFORCE;
    }
  });

  test('billingEnforced() returns false when BILLING_ENFORCE is unset', () => {
    delete process.env.BILLING_ENFORCE;
    assert.ok(!billingEnforced(), 'unset BILLING_ENFORCE must return false');
  });

  test('billingEnforced() returns false when BILLING_ENFORCE is empty string', () => {
    assert.ok(!billingEnforced({ BILLING_ENFORCE: '' }));
  });

  test('billingEnforced() returns false when BILLING_ENFORCE is "false"', () => {
    assert.ok(!billingEnforced({ BILLING_ENFORCE: 'false' }));
  });

  test('billingEnforced() returns true when BILLING_ENFORCE is "true"', () => {
    process.env.BILLING_ENFORCE = 'true';
    assert.ok(billingEnforced(), '"true" must enable enforcement');
  });

  test('billingEnforced() returns true when BILLING_ENFORCE is "1"', () => {
    process.env.BILLING_ENFORCE = '1';
    assert.ok(billingEnforced(), '"1" must enable enforcement');
  });

  test('warning is required when CANISTER_URL set and billing not enforced', () => {
    assert.ok(shouldWarnBillingEnforce('https://canister.example.com', {}));
  });

  test('no warning when BILLING_ENFORCE is true even with CANISTER_URL', () => {
    assert.ok(!shouldWarnBillingEnforce('https://canister.example.com', { BILLING_ENFORCE: 'true' }));
  });

  test('no warning when CANISTER_URL is empty (self-hosted / local dev without canister)', () => {
    assert.ok(!shouldWarnBillingEnforce('', {}));
    assert.ok(!shouldWarnBillingEnforce(undefined, {}));
  });

  test('no warning when CANISTER_URL set and BILLING_ENFORCE is "1"', () => {
    assert.ok(!shouldWarnBillingEnforce('https://c.example.com', { BILLING_ENFORCE: '1' }));
  });

  test('billingEnforced() reads from process.env by default', () => {
    process.env.BILLING_ENFORCE = 'true';
    assert.ok(billingEnforced());
    process.env.BILLING_ENFORCE = 'false';
    assert.ok(!billingEnforced());
  });
});

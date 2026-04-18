/**
 * Phase 3 Security Remediation Tests
 *
 * Covers all 6 Phase 3 items from docs/SECURITY-AUDIT-PLAN.md:
 *   3.1 — JWT token-in-URL: OAuth redirect uses URL fragment (#token=); gateway JWT expiry shortened from 7d
 *   3.2 — Image proxy: short-lived HMAC-signed token replaces full JWT in ?token= query param
 *   3.3 — Bridge write routes: requireBridgeEditorOrAdmin guards all mutation endpoints
 *   3.4 — MCP in-memory refresh token store: periodic sweep for expired entries
 *   3.5 — CORS on canister: corsHeaders() locks origin when gateway_auth_secret is set (Motoko structural)
 *   3.6 — path-to-regexp ReDoS CVE resolved (npm audit passes)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// 3.1  JWT token-in-URL: fragment-based redirect + shortened expiry
// ---------------------------------------------------------------------------
describe('3.1 JWT token-in-URL: OAuth redirects use fragment, gateway expiry shortened', () => {
  let gatewaySource;
  let selfHostedSource;

  const loadGateway = () => {
    if (!gatewaySource) gatewaySource = fs.readFileSync(path.join(ROOT, 'hub/gateway/server.mjs'), 'utf8');
    return gatewaySource;
  };
  const loadSelfHosted = () => {
    if (!selfHostedSource) selfHostedSource = fs.readFileSync(path.join(ROOT, 'hub/server.mjs'), 'utf8');
    return selfHostedSource;
  };

  test('gateway postLoginRedirect uses # fragment, not ?token= query param', () => {
    const src = loadGateway();
    assert.ok(src.includes('/hub/#'), 'postLoginRedirect must redirect to #fragment');
    const fnBlock = src.slice(src.indexOf('function postLoginRedirect'));
    const fnEnd = fnBlock.indexOf('\n}');
    const fnBody = fnBlock.slice(0, fnEnd);
    assert.ok(!fnBody.includes('?token='), 'postLoginRedirect must NOT use ?token= query');
  });

  test('gateway JWT_EXPIRY default is no longer 7d', () => {
    const src = loadGateway();
    const match = src.match(/JWT_EXPIRY\s*=\s*process\.env\.HUB_JWT_EXPIRY\s*\|\|\s*'([^']+)'/);
    assert.ok(match, 'JWT_EXPIRY constant must exist with default');
    assert.notEqual(match[1], '7d', 'default JWT_EXPIRY must not be 7d');
    assert.equal(match[1], '24h', 'default JWT_EXPIRY should be 24h');
  });

  test('self-hosted handleAuthCallback uses # fragment, not ?token= query param', () => {
    const src = loadSelfHosted();
    assert.ok(
      src.includes('/#token=') || src.includes("'/#token='"),
      'self-hosted redirect must use # fragment for token'
    );
    const postRedirectBlock = src.slice(src.indexOf('function handleAuthCallback'));
    assert.ok(
      !postRedirectBlock.includes('/?token='),
      'handleAuthCallback must NOT use ?token= query param'
    );
  });
});

// ---------------------------------------------------------------------------
// 3.2  Image proxy: short-lived HMAC-signed token
// ---------------------------------------------------------------------------
describe('3.2 Image proxy: HMAC-signed token replaces full JWT in query param', () => {
  const SECRET = 'test-secret-key-for-phase3-tests';
  const UID = 'google:123456';

  function signImageProxyToken(secret, uid) {
    const TTL = 300;
    const exp = Math.floor(Date.now() / 1000) + TTL;
    const payload = `img\0${uid}\0${exp}`;
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    return `${exp}.${Buffer.from(uid).toString('base64url')}.${sig}`;
  }

  function verifyImageProxyToken(secret, token) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [expStr, uidB64, sig] = parts;
    const exp = parseInt(expStr, 10);
    if (!exp || Math.floor(Date.now() / 1000) > exp) return null;
    let uid;
    try { uid = Buffer.from(uidB64, 'base64url').toString(); } catch (_) { return null; }
    if (!uid) return null;
    const payload = `img\0${uid}\0${exp}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expected);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
    return uid;
  }

  test('signImageProxyToken produces a 3-part dot-separated token', () => {
    const token = signImageProxyToken(SECRET, UID);
    const parts = token.split('.');
    assert.equal(parts.length, 3, 'token must have 3 parts: exp.uid_b64.sig');
  });

  test('verifyImageProxyToken returns uid for a valid token', () => {
    const token = signImageProxyToken(SECRET, UID);
    const result = verifyImageProxyToken(SECRET, token);
    assert.equal(result, UID);
  });

  test('verifyImageProxyToken rejects tampered signature', () => {
    const token = signImageProxyToken(SECRET, UID);
    const tampered = token.slice(0, -4) + 'XXXX';
    assert.equal(verifyImageProxyToken(SECRET, tampered), null);
  });

  test('verifyImageProxyToken rejects wrong secret', () => {
    const token = signImageProxyToken(SECRET, UID);
    assert.equal(verifyImageProxyToken('wrong-secret', token), null);
  });

  test('verifyImageProxyToken rejects expired token', () => {
    const exp = Math.floor(Date.now() / 1000) - 10;
    const payload = `img\0${UID}\0${exp}`;
    const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
    const token = `${exp}.${Buffer.from(UID).toString('base64url')}.${sig}`;
    assert.equal(verifyImageProxyToken(SECRET, token), null);
  });

  test('verifyImageProxyToken rejects invalid format', () => {
    assert.equal(verifyImageProxyToken(SECRET, ''), null);
    assert.equal(verifyImageProxyToken(SECRET, 'not.a.valid.token'), null);
    assert.equal(verifyImageProxyToken(SECRET, null), null);
    assert.equal(verifyImageProxyToken(SECRET, undefined), null);
  });

  test('gateway server has image-proxy-token signing endpoint', () => {
    const src = fs.readFileSync(path.join(ROOT, 'hub/gateway/server.mjs'), 'utf8');
    assert.ok(src.includes("'/api/v1/vault/image-proxy-token'"), 'gateway must expose image-proxy-token endpoint');
    assert.ok(src.includes('signImageProxyToken'), 'gateway must use signImageProxyToken');
  });

  test('self-hosted server has image-proxy-token signing endpoint', () => {
    const src = fs.readFileSync(path.join(ROOT, 'hub/server.mjs'), 'utf8');
    assert.ok(src.includes("'/api/v1/vault/image-proxy-token'"), 'self-hosted must expose image-proxy-token endpoint');
    assert.ok(src.includes('signImageProxyToken'), 'self-hosted must use signImageProxyToken');
  });

  test('gateway image proxy uses verifyImageProxyToken for query token auth', () => {
    const src = fs.readFileSync(path.join(ROOT, 'hub/gateway/server.mjs'), 'utf8');
    assert.ok(src.includes('verifyImageProxyToken'), 'gateway image proxy must use verifyImageProxyToken');
  });

  test('gateway image proxy has backward-compat JWT fallback for ?token=', () => {
    const src = fs.readFileSync(path.join(ROOT, 'hub/gateway/server.mjs'), 'utf8');
    assert.ok(src.includes('Backward compat'), 'gateway must include JWT fallback for pre-signed-token hub.js');
  });

  test('self-hosted image proxy has backward-compat JWT fallback for ?token=', () => {
    const src = fs.readFileSync(path.join(ROOT, 'hub/server.mjs'), 'utf8');
    assert.ok(src.includes('Backward compat'), 'self-hosted must include JWT fallback for pre-signed-token hub.js');
  });
});

// ---------------------------------------------------------------------------
// 3.3  Bridge write routes: requireBridgeEditorOrAdmin on mutations
// ---------------------------------------------------------------------------
describe('3.3 Bridge write routes guarded by requireBridgeEditorOrAdmin', () => {
  let bridgeSrc;
  const load = () => {
    if (!bridgeSrc) bridgeSrc = fs.readFileSync(path.join(ROOT, 'hub/bridge/server.mjs'), 'utf8');
    return bridgeSrc;
  };

  test('POST /api/v1/vault/sync has requireBridgeEditorOrAdmin', () => {
    const src = load();
    const syncLine = src.split('\n').find((l) => l.includes("'/api/v1/vault/sync'") && l.includes('app.post'));
    assert.ok(syncLine, 'sync route must exist');
    assert.ok(syncLine.includes('requireBridgeEditorOrAdmin'), '/vault/sync must require editor or admin');
  });

  test('POST /api/v1/index has requireBridgeEditorOrAdmin', () => {
    const src = load();
    const indexLine = src.split('\n').find((l) => l.includes("'/api/v1/index'") && l.includes('app.post'));
    assert.ok(indexLine, 'index route must exist');
    assert.ok(indexLine.includes('requireBridgeEditorOrAdmin'), '/index must require editor or admin');
  });

  test('POST /api/v1/index clears prior vault vectors before upsert (no orphan search paths)', () => {
    const src = load();
    assert.ok(
      src.includes('deleteByVaultId(vaultId)') &&
        src.includes('Remove stale chunk rows for this vault before upsert') &&
        src.includes('Drop prior vectors for this vault so search cannot return paths no longer in the export'),
      'bridge index must deleteByVaultId for this vault before upsert and when chunk list is empty',
    );
  });

  test('POST /api/v1/index JSON includes vectors_deleted for operators', () => {
    const src = load();
    assert.ok(
      src.includes('vectors_deleted') && src.includes('chunksIndexed') && src.includes('notesProcessed'),
      'bridge index response must expose vectors_deleted alongside notesProcessed/chunksIndexed',
    );
  });

  test('GET /api/v1/bridge-version exists for deploy verification', () => {
    const src = load();
    assert.ok(
      src.includes("app.get('/api/v1/bridge-version'") && src.includes('COMMIT_REF'),
      'bridge must expose unauthenticated GET /api/v1/bridge-version with commit metadata',
    );
  });

  test('POST /api/v1/memory/store has requireBridgeEditorOrAdmin', () => {
    const src = load();
    const storeLine = src.split('\n').find((l) => l.includes("'/api/v1/memory/store'") && l.includes('app.post'));
    assert.ok(storeLine, 'memory/store route must exist');
    assert.ok(storeLine.includes('requireBridgeEditorOrAdmin'), '/memory/store must require editor or admin');
  });

  test('DELETE /api/v1/memory/clear has requireBridgeEditorOrAdmin', () => {
    const src = load();
    const clearLine = src.split('\n').find((l) => l.includes("'/api/v1/memory/clear'") && l.includes('app.delete'));
    assert.ok(clearLine, 'memory/clear route must exist');
    assert.ok(clearLine.includes('requireBridgeEditorOrAdmin'), '/memory/clear must require editor or admin');
  });

  test('POST /api/v1/memory/consolidate has requireBridgeEditorOrAdmin', () => {
    const src = load();
    const consolLine = src.split('\n').find((l) => l.includes("'/api/v1/memory/consolidate'") && l.includes('app.post'));
    assert.ok(consolLine, 'memory/consolidate route must exist');
    assert.ok(consolLine.includes('requireBridgeEditorOrAdmin'), '/memory/consolidate must require editor or admin');
  });

  test('requireBridgeEditorOrAdmin blocks viewer role', () => {
    const src = load();
    const fnBlock = src.slice(src.indexOf('async function requireBridgeEditorOrAdmin'));
    assert.ok(fnBlock.includes("role === 'viewer'"), 'middleware must check for viewer role');
    assert.ok(fnBlock.includes('403'), 'middleware must return 403 for viewers');
  });
});

// ---------------------------------------------------------------------------
// 3.4  MCP in-memory refresh token store: periodic sweep
// ---------------------------------------------------------------------------
describe('3.4 MCP refresh token store — periodic expired-token sweep', () => {
  let mcpSrc;
  const load = () => {
    if (!mcpSrc) mcpSrc = fs.readFileSync(path.join(ROOT, 'hub/gateway/mcp-oauth-provider.mjs'), 'utf8');
    return mcpSrc;
  };

  test('KnowtationOAuthProvider has _sweepExpiredRefreshTokens method', () => {
    const src = load();
    assert.ok(src.includes('_sweepExpiredRefreshTokens'), 'must have sweep method');
  });

  test('constructor sets up periodic sweep timer', () => {
    const src = load();
    assert.ok(src.includes('setInterval'), 'constructor must create setInterval for sweep');
    assert.ok(src.includes('REFRESH_SWEEP_INTERVAL_MS'), 'must use configured interval constant');
  });

  test('sweep timer is unref()d to not block Node process exit', () => {
    const src = load();
    assert.ok(src.includes('.unref'), 'sweep timer must call unref() to not block exit');
  });

  test('sweep method deletes expired refresh tokens', () => {
    const src = load();
    const sweepBlock = src.slice(src.indexOf('_sweepExpiredRefreshTokens'));
    assert.ok(sweepBlock.includes('_refreshTokens.delete'), 'sweep must delete expired tokens');
    assert.ok(sweepBlock.includes('expires'), 'sweep must check expiry');
  });

  test('destroy() method clears the sweep timer', () => {
    const src = load();
    assert.ok(src.includes('destroy()'), 'must have destroy method');
    assert.ok(src.includes('clearInterval'), 'destroy must clear the interval');
  });

  test('sweep interval is reasonable (5–30 minutes)', () => {
    const src = load();
    const match = src.match(/REFRESH_SWEEP_INTERVAL_MS\s*=\s*([^;]+)/);
    assert.ok(match, 'REFRESH_SWEEP_INTERVAL_MS must be defined');
    const ms = Function(`return ${match[1].trim()}`)();
    assert.ok(ms >= 5 * 60 * 1000 && ms <= 30 * 60 * 1000,
      `sweep interval must be 5–30 min, got ${ms / 60000} min`);
  });
});

// ---------------------------------------------------------------------------
// 3.4b  MCP OAuth: SDK express-rate-limit behind Nginx (proxy validate relaxations)
// ---------------------------------------------------------------------------
describe('3.4b MCP OAuth: SDK rate limit behind Nginx', () => {
  test('gateway disables express-rate-limit validations for mcpAuthRouter (keep limiters)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'hub/gateway/server.mjs'), 'utf8');
    assert.ok(src.includes('app.set(\'trust proxy\', 1)'), 'gateway must set trust proxy for X-Forwarded-For');
    const block = src.slice(src.indexOf('app._mcpOAuthProvider = oauthProvider'), src.indexOf('[gateway] MCP OAuth 2.1 endpoints mounted'));
    assert.ok(
      block.includes('rateLimit: { validate: false }'),
      'must set rateLimit.validate false so ERR_ERL_* does not break /token behind Nginx',
    );
    assert.match(block, /authorizationOptions:\s*mcpOAuthSdkRateLimitOpts/);
    assert.match(block, /tokenOptions:\s*mcpOAuthSdkRateLimitOpts/);
  });
});

// ---------------------------------------------------------------------------
// 3.5  CORS on canister: locked origin when gateway_auth_secret is set
// ---------------------------------------------------------------------------
describe('3.5 Canister CORS locked to gateway origin when auth secret set', () => {
  let mainMo;
  let migrationMo;
  const loadMain = () => {
    if (!mainMo) mainMo = fs.readFileSync(path.join(ROOT, 'hub/icp/src/hub/main.mo'), 'utf8');
    return mainMo;
  };
  const loadMigration = () => {
    if (!migrationMo) migrationMo = fs.readFileSync(path.join(ROOT, 'hub/icp/src/hub/Migration.mo'), 'utf8');
    return migrationMo;
  };

  test('corsHeaders() checks gateway_auth_secret and cors_allowed_origin', () => {
    const src = loadMain();
    const corsBlock = src.slice(src.indexOf('func corsHeaders'));
    assert.ok(corsBlock.includes('gateway_auth_secret'), 'corsHeaders must check gateway_auth_secret');
    assert.ok(corsBlock.includes('cors_allowed_origin'), 'corsHeaders must check cors_allowed_origin');
  });

  test('corsHeaders() returns specific origin when both secrets are set', () => {
    const src = loadMain();
    const corsBlock = src.slice(src.indexOf('func corsHeaders'), src.indexOf('func corsHeaders') + 500);
    assert.ok(corsBlock.includes('"*"'), 'must have wildcard fallback');
    assert.ok(corsBlock.includes('storage.cors_allowed_origin'), 'must use stored origin when locked');
  });

  test('admin_set_cors_origin function exists and requires controller', () => {
    const src = loadMain();
    assert.ok(src.includes('admin_set_cors_origin'), 'must have admin_set_cors_origin function');
    const fnBlock = src.slice(src.indexOf('admin_set_cors_origin'));
    assert.ok(fnBlock.includes('isController'), 'must verify caller is controller');
    assert.ok(fnBlock.includes('FORBIDDEN'), 'must trap non-controllers');
  });

  test('StableStorage type includes cors_allowed_origin field', () => {
    const src = loadMigration();
    const stableBlock = src.slice(src.lastIndexOf('public type StableStorage'));
    assert.ok(stableBlock.includes('cors_allowed_origin'), 'StableStorage must have cors_allowed_origin');
  });

  test('migration preserves gateway_auth_secret and cors_allowed_origin', () => {
    const src = loadMigration();
    const migBlock = src.slice(src.indexOf('public func migration'));
    assert.ok(migBlock.includes('gateway_auth_secret = old.storage.gateway_auth_secret'),
      'migration must preserve existing gateway auth secret');
    // V7 stable already includes cors_allowed_origin; actor hook maps V7→current by preserving it.
    assert.ok(migBlock.includes('cors_allowed_origin = old.storage.cors_allowed_origin'),
      'migration must preserve cors_allowed_origin from V7 storage');
  });

  test('saveStable preserves cors_allowed_origin', () => {
    const src = loadMain();
    const saveBlock = src.slice(src.indexOf('func saveStable'));
    assert.ok(saveBlock.includes('keepCorsOrigin'), 'saveStable must preserve cors origin');
    assert.ok(saveBlock.includes('cors_allowed_origin = keepCorsOrigin'), 'saveStable must write cors origin');
  });
});

// ---------------------------------------------------------------------------
// 3.6  path-to-regexp ReDoS CVE resolved
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Bridge → canister X-Gateway-Auth header (Phase 0 compatibility fix)
// ---------------------------------------------------------------------------
describe('Bridge canister calls include X-Gateway-Auth header', () => {
  let bridgeSrc;
  const load = () => {
    if (!bridgeSrc) bridgeSrc = fs.readFileSync(path.join(ROOT, 'hub/bridge/server.mjs'), 'utf8');
    return bridgeSrc;
  };

  test('bridge reads CANISTER_AUTH_SECRET from env (same var name as gateway)', () => {
    const src = load();
    assert.ok(src.includes('CANISTER_AUTH_SECRET'), 'bridge must read CANISTER_AUTH_SECRET env var');
  });

  test('bridge has canisterHeaders() helper that injects x-gateway-auth', () => {
    const src = load();
    assert.ok(src.includes('function canisterHeaders'), 'bridge must define canisterHeaders helper');
    assert.ok(src.includes("'x-gateway-auth'"), 'canisterHeaders must set x-gateway-auth header');
  });

  test('canisterHeaders() is used at every canister fetch call site', () => {
    const src = load();
    // Count how many times we call fetch on the canister URL (CANISTER_URL or ${base}/api)
    const fetchCanisterCount = (src.match(/fetch\(CANISTER_URL|fetch\(`\$\{CANISTER_URL\}|fetch\(`\$\{base\}/g) || []).length;
    // Count how many times canisterHeaders appears near those calls
    const canisterHeadersCount = (src.match(/canisterHeaders\(/g) || []).length;
    assert.ok(
      canisterHeadersCount >= fetchCanisterCount,
      `canisterHeaders() must appear at least as many times as canister fetch calls (fetches: ${fetchCanisterCount}, canisterHeaders: ${canisterHeadersCount})`,
    );
  });
});

describe('3.6 path-to-regexp ReDoS CVE resolved', () => {
  test('hub/package-lock.json has path-to-regexp >= 0.1.13', () => {
    const lockPath = path.join(ROOT, 'hub/package-lock.json');
    if (!fs.existsSync(lockPath)) return;
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const packages = lock.packages || {};
    for (const [pkg, info] of Object.entries(packages)) {
      if (pkg.endsWith('/path-to-regexp') || pkg === 'path-to-regexp') {
        const ver = info.version;
        if (ver && ver.startsWith('0.1.')) {
          const patch = parseInt(ver.split('.')[2], 10);
          assert.ok(patch >= 13, `path-to-regexp must be >= 0.1.13 (found ${ver})`);
        }
      }
    }
  });

  test('hub/gateway/package-lock.json has path-to-regexp >= 0.1.13', () => {
    const lockPath = path.join(ROOT, 'hub/gateway/package-lock.json');
    if (!fs.existsSync(lockPath)) return;
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const packages = lock.packages || {};
    for (const [pkg, info] of Object.entries(packages)) {
      if (pkg.endsWith('/path-to-regexp') || pkg === 'path-to-regexp') {
        const ver = info.version;
        if (ver && ver.startsWith('0.1.')) {
          const patch = parseInt(ver.split('.')[2], 10);
          assert.ok(patch >= 13, `path-to-regexp must be >= 0.1.13 (found ${ver})`);
        }
      }
    }
  });

  test('root package-lock.json has path-to-regexp >= 0.1.13', () => {
    const lockPath = path.join(ROOT, 'package-lock.json');
    if (!fs.existsSync(lockPath)) return;
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const packages = lock.packages || {};
    for (const [pkg, info] of Object.entries(packages)) {
      if (pkg.endsWith('/path-to-regexp') || pkg === 'path-to-regexp') {
        const ver = info.version;
        if (ver && ver.startsWith('0.1.')) {
          const patch = parseInt(ver.split('.')[2], 10);
          assert.ok(patch >= 13, `path-to-regexp must be >= 0.1.13 (found ${ver})`);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3.7  Muse thin bridge (Option C): operator proxy route markers
// ---------------------------------------------------------------------------
describe('3.7 Muse thin bridge: operator proxy present on gateway and Node Hub', () => {
  test('gateway registers GET /api/v1/operator/muse/proxy with requireAdmin', () => {
    const src = fs.readFileSync(path.join(ROOT, 'hub/gateway/server.mjs'), 'utf8');
    assert.ok(
      src.includes('/api/v1/operator/muse/proxy'),
      'gateway must expose operator Muse proxy path',
    );
    assert.ok(
      src.includes('fetchMuseProxiedGet') && src.includes('parseMuseConfigFromEnv'),
      'gateway must use muse-thin-bridge helpers for proxy',
    );
  });

  test('self-hosted Hub registers GET /api/v1/operator/muse/proxy with jwtAuth and admin role', () => {
    const src = fs.readFileSync(path.join(ROOT, 'hub/server.mjs'), 'utf8');
    assert.ok(
      src.includes('/api/v1/operator/muse/proxy'),
      'Node Hub must expose operator Muse proxy path',
    );
    assert.ok(
      src.includes('fetchMuseProxiedGet') && src.includes("requireRole('admin')"),
      'Node Hub must gate Muse proxy with admin role',
    );
  });

  test('Node Hub exposes POST /api/v1/settings/muse for self-hosted YAML Muse URL', () => {
    const src = fs.readFileSync(path.join(ROOT, 'hub/server.mjs'), 'utf8');
    assert.ok(
      src.includes("'/api/v1/settings/muse'"),
      'Node Hub must allow admins to persist muse.url in config/local.yaml',
    );
  });

  test('gateway rejects POST /api/v1/settings/muse (hosted operator-only)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'hub/gateway/server.mjs'), 'utf8');
    assert.ok(
      src.includes("'/api/v1/settings/muse'") && src.includes('501'),
      'gateway must not allow browser clients to set Muse URL',
    );
  });
});

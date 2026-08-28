/**
 * SESSION-DURABILITY-b-KN — seven-tier matrix for hosted human-session continuity.
 * Freeze: ~/scooling/docs/reviews/2026-08-28-session-durability.md §§4,6,7 (KN boundary).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  parseHostedHubJwtExpirySeconds,
  verifyHumanSessionAccessToken,
  humanSessionClaimsShapeOk,
  admitHumanSessionPayload,
  isEstablishRefreshBrowserOriginAllowed,
  acceptIncludesRefreshTokenCli,
  REFRESH_TOKEN_CLI_ACCEPT,
  HUMAN_SESSION_LIFETIME_MIN_SECONDS,
  HUMAN_SESSION_LIFETIME_MAX_SECONDS,
} from '../hub/lib/human-session-admission.mjs';
import { isWwwApexPair } from '../hub/gateway/cors-middleware.mjs';
import {
  createEstablishRefreshHandler,
  REFRESH_COOKIE_NAME,
} from '../hub/auth-session.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SECRET = 'session-durability-kn-test-secret-32b';
const HUB_JS = fs.readFileSync(path.join(ROOT, 'web', 'hub', 'hub.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'web', 'hub', 'index.html'), 'utf8');
const SERVER_SRC = fs.readFileSync(path.join(ROOT, 'hub', 'gateway', 'server.mjs'), 'utf8');
const AUTH_SESSION_SRC = fs.readFileSync(path.join(ROOT, 'hub', 'auth-session.mjs'), 'utf8');
const CLI_AUTH_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'hub-session-auth.mjs'), 'utf8');

function makeJwt(payload, secret = SECRET) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

function sessionPayload(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: 'google:durability-user',
    provider: 'google',
    id: 'durability-user',
    name: 'Durability',
    role: 'member',
    type: 'session',
    iat: now - 60,
    exp: now - 60 + HUMAN_SESSION_LIFETIME_MIN_SECONDS,
    ...overrides,
  };
}

function mockRes() {
  const headers = {};
  const cookies = {};
  /** @type {string[]} */
  const cleared = [];
  return {
    statusCode: 200,
    body: null,
    set(name, value) {
      headers[String(name).toLowerCase()] = String(value);
    },
    cookie(name, value) {
      cookies[name] = value;
    },
    clearCookie(name) {
      cleared.push(name);
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
    cleared,
  };
}

function startServer(app) {
  const srv = http.createServer(app);
  return new Promise((resolve, reject) => {
    srv.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      resolve({
        url: `http://127.0.0.1:${srv.address().port}`,
        close: () => new Promise((r) => srv.close(() => r())),
      });
    });
  });
}

async function createGateway(envExtra = {}) {
  process.env.NETLIFY = '1';
  process.env.SESSION_SECRET = SECRET;
  process.env.BILLING_ENFORCE = 'false';
  process.env.CANISTER_URL = '';
  process.env.BRIDGE_URL = '';
  delete process.env.HUB_JWT_EXPIRY;
  for (const [k, v] of Object.entries(envExtra)) {
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  const entry = pathToFileURL(path.join(ROOT, 'hub', 'gateway', 'server.mjs')).href;
  const { app } = await import(`${entry}?sdkn=${Date.now()}-${Math.random()}`);
  return startServer(app);
}

// ─── 1. UNIT ─────────────────────────────────────────────────────────────────

describe('SESSION-DURABILITY-b-KN unit', () => {
  it('hosted expiry parser accepts integer seconds and N[smhd] in 3h–24h only', () => {
    assert.equal(parseHostedHubJwtExpirySeconds('24h').ok, true);
    assert.equal(parseHostedHubJwtExpirySeconds('24h').seconds, 86400);
    assert.equal(parseHostedHubJwtExpirySeconds('3h').seconds, 10800);
    assert.equal(parseHostedHubJwtExpirySeconds(43200).seconds, 43200);
    assert.equal(parseHostedHubJwtExpirySeconds('10800').seconds, 10800);
    assert.equal(parseHostedHubJwtExpirySeconds('2h').ok, false);
    assert.equal(parseHostedHubJwtExpirySeconds('25h').ok, false);
    assert.equal(parseHostedHubJwtExpirySeconds('24 h').ok, false);
    assert.equal(parseHostedHubJwtExpirySeconds('1.5h').ok, false);
    assert.equal(parseHostedHubJwtExpirySeconds('abc').ok, false);
    assert.equal(parseHostedHubJwtExpirySeconds(10800.5).ok, false);
  });

  it('type:session + mandatory integer iat/exp admission', () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal(humanSessionClaimsShapeOk(sessionPayload()), true);
    assert.equal(admitHumanSessionPayload(sessionPayload(), now).ok, true);
    assert.equal(admitHumanSessionPayload(sessionPayload({ type: 'agent_access' }), now).ok, false);
    assert.equal(admitHumanSessionPayload(sessionPayload({ type: undefined }), now).code, 'SESSION_INVALID');
    assert.equal(
      admitHumanSessionPayload(sessionPayload({ iat: now - 10, exp: now + 900 }), now).code,
      'SESSION_INVALID',
    );
  });

  it('SESSION_EXPIRED versus SESSION_INVALID for verified tokens', () => {
    const now = Math.floor(Date.now() / 1000);
    const live = makeJwt(sessionPayload({ iat: now - 60, exp: now - 60 + 10800 }));
    assert.equal(verifyHumanSessionAccessToken(live, SECRET, null, now).ok, true);

    const expiredOkShape = makeJwt(
      sessionPayload({ iat: now - 10801, exp: now - 1, type: 'session' }),
    );
    assert.equal(
      verifyHumanSessionAccessToken(expiredOkShape, SECRET, null, now).code,
      'SESSION_EXPIRED',
    );

    const shortLived = makeJwt(sessionPayload({ iat: now - 10, exp: now + 900, type: 'session' }));
    assert.equal(verifyHumanSessionAccessToken(shortLived, SECRET, null, now).code, 'SESSION_INVALID');

    const missingType = makeJwt({
      sub: 'google:1',
      iat: now - 60,
      exp: now - 60 + 10800,
    });
    assert.equal(verifyHumanSessionAccessToken(missingType, SECRET, null, now).code, 'SESSION_INVALID');

    const agent = makeJwt(sessionPayload({ type: 'agent_access' }));
    assert.equal(verifyHumanSessionAccessToken(agent, SECRET, null, now).code, 'SESSION_INVALID');

    assert.equal(verifyHumanSessionAccessToken('not-a-jwt', SECRET, null, now).code, 'SESSION_INVALID');
  });

  it('CLI Accept helper and Origin allowlist including www/apex pairing', () => {
    assert.equal(acceptIncludesRefreshTokenCli(REFRESH_TOKEN_CLI_ACCEPT), true);
    assert.equal(acceptIncludesRefreshTokenCli('application/json'), false);
    assert.equal(
      isEstablishRefreshBrowserOriginAllowed(
        'https://knowtation.store',
        ['https://knowtation.store', 'https://www.knowtation.store'],
        'https://api.knowtation.store',
        isWwwApexPair,
      ),
      true,
    );
    // www request against apex-only allowlist (pairing branch).
    assert.equal(
      isEstablishRefreshBrowserOriginAllowed(
        'https://www.knowtation.store',
        ['https://knowtation.store'],
        'https://api.knowtation.store',
        isWwwApexPair,
      ),
      true,
    );
    assert.equal(
      isEstablishRefreshBrowserOriginAllowed(
        'https://knowtation.store',
        ['https://www.knowtation.store'],
        'https://api.knowtation.store',
        isWwwApexPair,
      ),
      true,
    );
    assert.equal(
      isEstablishRefreshBrowserOriginAllowed(
        'https://evil.example',
        ['https://knowtation.store'],
        'https://api.knowtation.store',
        isWwwApexPair,
      ),
      false,
    );
    assert.equal(
      isEstablishRefreshBrowserOriginAllowed(
        'null',
        ['https://knowtation.store'],
        'https://api.knowtation.store',
        isWwwApexPair,
      ),
      false,
    );
  });

  it('gateway signs with integer JWT_EXPIRY_SECONDS', () => {
    assert.match(SERVER_SRC, /expiresIn:\s*JWT_EXPIRY_SECONDS/);
    assert.match(SERVER_SRC, /expires_in:\s*JWT_EXPIRY_SECONDS/);
    assert.match(SERVER_SRC, /parseHostedHubJwtExpirySeconds/);
  });
});

// ─── 2. INTEGRATION (handler + HTTP) ─────────────────────────────────────────

describe('SESSION-DURABILITY-b-KN integration', () => {
  it('browser Origin: cookie only, no raw refresh_token even with CLI Accept', async () => {
    let issued = false;
    const handler = createEstablishRefreshHandler({
      store: {
        issue: async (sub) => {
          issued = true;
          return { token: `${sub}.rawsecret` };
        },
      },
      verifyHumanSession: (t) =>
        t === 'good'
          ? { ok: true, payload: sessionPayload({ sub: 'google:1' }) }
          : { ok: false, code: 'SESSION_INVALID' },
      cookieOptions: () => ({ httpOnly: true, secure: true, sameSite: 'none', path: '/api/v1/auth' }),
      isBrowserOriginAllowed: () => true,
      acceptIncludesCliMediaType: acceptIncludesRefreshTokenCli,
    });
    const res = mockRes();
    await handler(
      {
        headers: {
          authorization: 'Bearer good',
          origin: 'https://knowtation.store',
          accept: REFRESH_TOKEN_CLI_ACCEPT,
        },
      },
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.established, true);
    assert.equal(res.body.refresh_token, undefined);
    assert.equal(res.cookies[REFRESH_COOKIE_NAME], 'google:1.rawsecret');
    assert.equal(issued, true);
  });

  it('CLI no-Origin + Accept: refresh_token body, no Set-Cookie', async () => {
    const handler = createEstablishRefreshHandler({
      store: { issue: async (sub) => ({ token: `${sub}.cli` }) },
      verifyHumanSession: () => ({ ok: true, payload: sessionPayload({ sub: 'google:2' }) }),
      cookieOptions: () => ({ httpOnly: true, path: '/api/v1/auth' }),
      isBrowserOriginAllowed: () => false,
      acceptIncludesCliMediaType: acceptIncludesRefreshTokenCli,
    });
    const res = mockRes();
    await handler(
      {
        headers: {
          authorization: 'Bearer good',
          accept: REFRESH_TOKEN_CLI_ACCEPT,
        },
      },
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.refresh_token, 'google:2.cli');
    assert.equal(res.cookies[REFRESH_COOKIE_NAME], undefined);
  });

  it('no-Origin wrong Accept → 406 and no store issue', async () => {
    let issued = false;
    const handler = createEstablishRefreshHandler({
      store: {
        issue: async () => {
          issued = true;
          return { token: 'x' };
        },
      },
      verifyHumanSession: () => ({ ok: true, payload: sessionPayload() }),
      cookieOptions: () => ({ httpOnly: true, path: '/api/v1/auth' }),
      isBrowserOriginAllowed: () => true,
      acceptIncludesCliMediaType: acceptIncludesRefreshTokenCli,
    });
    const res = mockRes();
    await handler({ headers: { authorization: 'Bearer good', accept: 'application/json' } }, res);
    assert.equal(res.statusCode, 406);
    assert.equal(issued, false);
  });

  it('malicious / null Origin → 403 and no issue', async () => {
    let issued = false;
    const handler = createEstablishRefreshHandler({
      store: {
        issue: async () => {
          issued = true;
          return { token: 'x' };
        },
      },
      verifyHumanSession: () => ({ ok: true, payload: sessionPayload() }),
      cookieOptions: () => ({ httpOnly: true, path: '/api/v1/auth' }),
      isBrowserOriginAllowed: () => false,
      acceptIncludesCliMediaType: acceptIncludesRefreshTokenCli,
    });
    for (const origin of ['null', 'https://evil.example']) {
      issued = false;
      const res = mockRes();
      await handler({ headers: { authorization: 'Bearer good', origin } }, res);
      assert.equal(res.statusCode, 403);
      assert.equal(issued, false);
    }
  });

  it('admission failures create neither refresh record nor cookie', async () => {
    let issued = false;
    const handler = createEstablishRefreshHandler({
      store: {
        issue: async () => {
          issued = true;
          return { token: 'x' };
        },
      },
      verifyHumanSession: (t) => {
        if (t === 'expired') return { ok: false, code: 'SESSION_EXPIRED' };
        return { ok: false, code: 'SESSION_INVALID' };
      },
      cookieOptions: () => ({ httpOnly: true, path: '/api/v1/auth' }),
      isBrowserOriginAllowed: () => true,
      acceptIncludesCliMediaType: acceptIncludesRefreshTokenCli,
    });
    const expiredRes = mockRes();
    await handler(
      { headers: { authorization: 'Bearer expired', origin: 'https://knowtation.store' } },
      expiredRes,
    );
    assert.equal(expiredRes.statusCode, 401);
    assert.equal(expiredRes.body.code, 'SESSION_EXPIRED');
    assert.equal(issued, false);

    const badRes = mockRes();
    await handler(
      { headers: { authorization: 'Bearer bad', origin: 'https://knowtation.store' } },
      badRes,
    );
    assert.equal(badRes.statusCode, 401);
    assert.equal(badRes.body.code, 'SESSION_INVALID');
    assert.equal(issued, false);
  });

  let gw;
  before(async () => {
    gw = await createGateway({
      HUB_CORS_ORIGIN: 'https://knowtation.store,https://www.knowtation.store',
      HUB_BASE_URL: 'https://api.knowtation.store',
    });
  });
  after(async () => {
    await gw.close();
  });

  it('HTTP session: MCP / missing-type fail introspection', async () => {
    const now = Math.floor(Date.now() / 1000);
    const mcp = makeJwt(sessionPayload({ type: 'mcp_access' }));
    const missing = makeJwt({
      sub: 'google:1',
      iat: now - 60,
      exp: now - 60 + 10800,
    });
    for (const token of [mcp, missing]) {
      const res = await fetch(`${gw.url}/api/v1/auth/session`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      assert.equal(res.status, 401);
      assert.equal(body.code, 'SESSION_INVALID');
    }
  });

  it('HTTP session: live session returns type:session + iat/exp', async () => {
    const token = makeJwt(sessionPayload());
    const res = await fetch(`${gw.url}/api/v1/auth/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.type, 'session');
    assert.equal(typeof body.iat, 'number');
    assert.equal(typeof body.exp, 'number');
  });

  it('HTTP establish-refresh browser: no refresh_token in body', async () => {
    const token = makeJwt(sessionPayload());
    const res = await fetch(`${gw.url}/api/v1/auth/establish-refresh`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://knowtation.store',
        Accept: REFRESH_TOKEN_CLI_ACCEPT,
        'Content-Type': 'application/json',
      },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.established, true);
    assert.equal(body.refresh_token, undefined);
    const setCookie = res.headers.get('set-cookie') || '';
    assert.match(setCookie, /ktn_refresh=/);
  });

  it('HTTP establish-refresh allows www Origin via apex allowlist pairing', async () => {
    const token = makeJwt(sessionPayload());
    const res = await fetch(`${gw.url}/api/v1/auth/establish-refresh`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://www.knowtation.store',
        'Content-Type': 'application/json',
      },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.established, true);
    assert.equal(body.refresh_token, undefined);
  });
});

// ─── 3–7. e2e / stress / data-integrity / performance / security (source + contract) ──

describe('SESSION-DURABILITY-b-KN e2e/source contracts', () => {
  it('e2e: durability banner + typed establishPersistentSession in hub UI', () => {
    assert.match(INDEX_HTML, /id="hub-session-durability-banner"/);
    assert.match(INDEX_HTML, /role="status"/);
    assert.match(HUB_JS, /async function establishPersistentSession/);
    assert.match(HUB_JS, /SESSION_DURABILITY_WARN_KEY/);
    assert.match(HUB_JS, /This session could not be made durable/);
    assert.match(HUB_JS, /schema_version !== 1/);
    assert.match(HUB_JS, /established !== true/);
  });

  it('e2e: ensureFreshHumanSession + hubApiResponse wired for copy and credentials', () => {
    assert.match(HUB_JS, /async function ensureFreshHumanSession/);
    assert.match(HUB_JS, /async function hubApiResponse/);
    assert.match(HUB_JS, /btnCopyHubApiEnv\.onclick\s*=\s*async/);
    assert.match(HUB_JS, /ensureFreshHumanSession\(120\)/);
    assert.match(HUB_JS, /hubApiResponse\('\/api\/v1\/auth\/agent\/credentials'/);
    assert.doesNotMatch(
      HUB_JS,
      /fetch\(String\(apiBase[\s\S]{0,80}\/api\/v1\/auth\/agent\/credentials/,
    );
  });

  it('stress: single-flight refresh + mutation zero network retries', () => {
    assert.match(HUB_JS, /let refreshInFlight = null/);
    assert.match(
      HUB_JS,
      /method === 'GET' \|\| method === 'HEAD'\s*\?\s*2\s*:\s*0/,
    );
  });

  it('data-integrity: five named consumers; new establish-refresh callers cannot bypass CLI Accept', () => {
    assert.match(CLI_AUTH_SRC, /application\/vnd\.knowtation\.refresh-token\+json/);
    assert.match(CLI_AUTH_SRC, /mode:\s*0o600/);
    const namedConsumers = [
      'scripts/lib/hub-session-auth.mjs',
      'scripts/hub-session-refresh.mjs',
      'scripts/verify-rhf-d-catalog-consent.mjs',
      'scripts/verify-rhf-kn0-deploy-proof.mjs',
      'web/hub/hub.js',
    ];
    for (const rel of namedConsumers) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), rel);
    }
    assert.match(
      fs.readFileSync(path.join(ROOT, 'scripts/hub-session-refresh.mjs'), 'utf8'),
      /establishHostedRefreshFromAccess|--save-access-token/,
    );
    // Enumerate every runtime caller of establish-refresh. Browser hub.js is Origin mode.
    // Every other .mjs/.js caller must go through hub-session-auth (vendor Accept) or be
    // the shared helper itself. A new direct fetch with Accept: application/json fails this test.
    const skipDir = new Set(['node_modules', '.git', '.muse', 'data', 'backups', 'dist', 'coverage']);
    /** @type {string[]} */
    const callSites = [];
    function walk(dir) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skipDir.has(ent.name)) continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(mjs|js)$/.test(ent.name)) continue;
        const rel = path.relative(ROOT, full);
        if (rel.startsWith('test' + path.sep)) continue;
        const src = fs.readFileSync(full, 'utf8');
        if (!src.includes('/api/v1/auth/establish-refresh')) continue;
        callSites.push(rel);
      }
    }
    walk(ROOT);
    const allowedDirect = new Set([
      'scripts/lib/hub-session-auth.mjs',
      'web/hub/hub.js',
      'hub/gateway/server.mjs',
      'hub/auth-session.mjs',
    ]);
    for (const rel of callSites) {
      if (allowedDirect.has(rel)) continue;
      // Named verification scripts must import the shared helper — not fetch establish-refresh.
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      assert.ok(
        src.includes('establishHostedRefreshFromAccess') ||
          src.includes("from './lib/hub-session-auth.mjs'") ||
          src.includes("from '../lib/hub-session-auth.mjs'") ||
          src.includes('hub-session-auth.mjs'),
        `${rel} calls establish-refresh outside the named delivery-mode contract`,
      );
      assert.ok(
        !/fetch\([^)]*establish-refresh/.test(src.replace(/\s+/g, ' ')),
        `${rel} must not fetch establish-refresh directly (use hub-session-auth)`,
      );
    }
    assert.ok(
      callSites.includes('scripts/lib/hub-session-auth.mjs'),
      'CLI helper must remain an establish-refresh caller',
    );
    assert.ok(callSites.includes('web/hub/hub.js'), 'Hub UI must remain an establish-refresh caller');
  });

  it('performance: one 401 → one refresh + one retry; auth endpoints excluded', () => {
    assert.match(HUB_JS, /_retriedAfterRefresh/);
    assert.match(HUB_JS, /\/api\/v1\/auth\/establish-refresh/);
    assert.match(HUB_JS, /path !== '\/api\/v1\/auth\/refresh'/);
  });

  it('security: browser never returns raw refresh; establish handler mode-split present', () => {
    assert.match(AUTH_SESSION_SRC, /hasOrigin/);
    assert.match(AUTH_SESSION_SRC, /established:\s*true/);
    assert.match(AUTH_SESSION_SRC, /NOT_ACCEPTABLE|406/);
    assert.match(HUB_JS, /Object\.prototype\.hasOwnProperty\.call\(data,\s*'refresh_token'\)/);
  });
});

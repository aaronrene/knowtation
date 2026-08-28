/**
 * Operator human-lane session auth for hosted Hub REST smokes.
 *
 * Durable secret: refresh token in ~/.config/knowtation/hub_refresh (or env file path).
 * Short JWT: refreshed via POST /api/v1/auth/refresh, cached in ~/.config/knowtation/hub_session.
 *
 * Not for production cron/Netlify — use kt_agent_ machine lane there (AGENT-INTEGRATION.md).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

export const DEFAULT_REFRESH_FILE = path.join(os.homedir(), '.config', 'knowtation', 'hub_refresh');
export const DEFAULT_SESSION_FILE = path.join(os.homedir(), '.config', 'knowtation', 'hub_session');

const REFRESH_SKEW_MS = 60_000;
const ACCESS_SKEW_S = 120;

/**
 * @param {string} p
 * @returns {string}
 */
export function expandHome(p) {
  const s = String(p || '').trim();
  if (!s) return s;
  return s.startsWith('~') ? path.join(os.homedir(), s.slice(1)) : s;
}

/**
 * @param {string} fp
 * @returns {string}
 */
export function readTrimmedFile(fp) {
  return fs.readFileSync(expandHome(fp), 'utf8').trim();
}

/**
 * @param {string} fp
 * @param {string} contents
 */
export function writeSecretFile(fp, contents) {
  const expanded = expandHome(fp);
  fs.mkdirSync(path.dirname(expanded), { recursive: true, mode: 0o700 });
  fs.writeFileSync(expanded, contents, { mode: 0o600 });
}

/**
 * @param {string} token
 * @returns {{ sub?: string, type?: string, exp?: number, expired: boolean, expiresInSec: number | null }}
 */
export function decodeAccessClaims(token) {
  try {
    const payload = jwt.decode(token);
    if (!payload || typeof payload !== 'object') {
      return { expired: true, expiresInSec: null };
    }
    const exp = typeof payload.exp === 'number' ? payload.exp : null;
    const now = Math.floor(Date.now() / 1000);
    const expiresInSec = exp == null ? null : exp - now;
    return {
      sub: typeof payload.sub === 'string' ? payload.sub : undefined,
      type: typeof payload.type === 'string' ? payload.type : undefined,
      exp: exp ?? undefined,
      expired: exp != null ? exp <= now + ACCESS_SKEW_S : true,
      expiresInSec,
    };
  } catch {
    return { expired: true, expiresInSec: null };
  }
}

/**
 * @param {Headers} headers
 * @param {string} name
 * @returns {string | null}
 */
export function readSetCookieValue(headers, name) {
  const lines =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [headers.get('set-cookie')].filter(Boolean);
  for (const line of lines) {
    if (typeof line !== 'string') continue;
    const m = line.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`));
    if (m) {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return m[1];
      }
    }
  }
  return null;
}

/**
 * Exchange a valid session access JWT for a durable refresh token (CLI bootstrap).
 *
 * @param {string} accessToken
 * @param {{ apiBase?: string, refreshFile?: string, sessionFile?: string, timeoutMs?: number }} [opts]
 */
export async function establishHostedRefreshFromAccess(accessToken, opts = {}) {
  const apiBase = (opts.apiBase || process.env.KNOWTATION_HUB_API || process.env.KNOWTATION_HUB_URL || 'https://api.knowtation.store').replace(/\/$/, '');
  const refreshFile = expandHome(opts.refreshFile || process.env.KNOWTATION_HUB_REFRESH_TOKEN_FILE || DEFAULT_REFRESH_FILE);
  const sessionFile = expandHome(opts.sessionFile || process.env.KNOWTATION_HUB_TOKEN_FILE || DEFAULT_SESSION_FILE);
  const token = String(accessToken || '').trim();
  if (!token) {
    return { ok: false, code: 'ACCESS_MISSING', detail: 'No access token to establish refresh from' };
  }

  const res = await fetch(`${apiBase}/api/v1/auth/establish-refresh`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.knowtation.refresh-token+json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });

  const text = await res.text();
  /** @type {{ refresh_token?: string, code?: string, error?: string }} */
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  if (!res.ok) {
    return {
      ok: false,
      code: typeof body.code === 'string' ? body.code : 'ESTABLISH_FAILED',
      detail: typeof body.error === 'string' ? body.error : `HTTP ${res.status}`,
      httpStatus: res.status,
    };
  }

  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : '';
  if (!refreshToken) {
    return { ok: false, code: 'ESTABLISH_NO_REFRESH', detail: 'establish-refresh succeeded but refresh_token missing' };
  }

  writeSecretFile(refreshFile, refreshToken);
  writeSecretFile(sessionFile, token);

  return {
    ok: true,
    refreshToken,
    claims: decodeAccessClaims(token),
  };
}

/**
 * @param {{
 *   apiBase?: string,
 *   refreshToken?: string,
 *   refreshFile?: string,
 *   sessionFile?: string,
 *   timeoutMs?: number,
 * }} [opts]
 * @returns {Promise<{ ok: true, accessToken: string, refreshToken: string, claims: ReturnType<typeof decodeAccessClaims> } | { ok: false, code: string, detail: string, httpStatus?: number }>}
 */
export async function refreshHostedSessionAccessToken(opts = {}) {
  const apiBase = (opts.apiBase || process.env.KNOWTATION_HUB_API || process.env.KNOWTATION_HUB_URL || 'https://api.knowtation.store').replace(/\/$/, '');
  const refreshFile = expandHome(opts.refreshFile || process.env.KNOWTATION_HUB_REFRESH_TOKEN_FILE || DEFAULT_REFRESH_FILE);
  const sessionFile = expandHome(opts.sessionFile || process.env.KNOWTATION_HUB_TOKEN_FILE || DEFAULT_SESSION_FILE);

  let refreshToken = (opts.refreshToken || process.env.KNOWTATION_HUB_REFRESH_TOKEN || '').trim();
  if (!refreshToken && fs.existsSync(refreshFile)) {
    refreshToken = readTrimmedFile(refreshFile);
  }
  if (!refreshToken) {
    return {
      ok: false,
      code: 'REFRESH_MISSING',
      detail: `No refresh token. Bootstrap once with a fresh hub_token from DevTools → Local Storage:
  node scripts/hub-session-refresh.mjs --save-access-token '<hub_token>'
(requires POST /api/v1/auth/establish-refresh on hosted gateway — land + deploy if 404)`,
    };
  }

  const res = await fetch(`${apiBase}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });

  const text = await res.text();
  /** @type {{ access_token?: string, code?: string, error?: string }} */
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  if (!res.ok) {
    return {
      ok: false,
      code: typeof body.code === 'string' ? body.code : 'REFRESH_FAILED',
      detail: typeof body.error === 'string' ? body.error : `HTTP ${res.status}`,
      httpStatus: res.status,
    };
  }

  const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
  if (!accessToken) {
    return { ok: false, code: 'REFRESH_NO_ACCESS', detail: 'Refresh succeeded but access_token missing' };
  }

  const rotated = readSetCookieValue(res.headers, 'ktn_refresh') || refreshToken;
  writeSecretFile(refreshFile, rotated);
  writeSecretFile(sessionFile, accessToken);

  return {
    ok: true,
    accessToken,
    refreshToken: rotated,
    claims: decodeAccessClaims(accessToken),
  };
}

/**
 * Return a valid hosted session access JWT, refreshing when expired.
 *
 * Precedence: non-expired KNOWTATION_HUB_TOKEN env → session file → refresh.
 *
 * @param {{ apiBase?: string, forceRefresh?: boolean }} [opts]
 * @returns {Promise<{ ok: true, accessToken: string, source: string, refreshed: boolean } | { ok: false, code: string, detail: string }>}
 */
export async function ensureHostedSessionAccessToken(opts = {}) {
  const sessionFile = expandHome(process.env.KNOWTATION_HUB_TOKEN_FILE || DEFAULT_SESSION_FILE);
  const envToken = (process.env.KNOWTATION_HUB_TOKEN || process.env.HUB_JWT || '').trim();

  if (!opts.forceRefresh && envToken) {
    const claims = decodeAccessClaims(envToken);
    if (!claims.expired) {
      return { ok: true, accessToken: envToken, source: 'env', refreshed: false };
    }
  }

  if (!opts.forceRefresh && fs.existsSync(sessionFile)) {
    const fileToken = readTrimmedFile(sessionFile);
    const claims = decodeAccessClaims(fileToken);
    if (!claims.expired) {
      return { ok: true, accessToken: fileToken, source: 'session_file', refreshed: false };
    }
  }

  const refreshed = await refreshHostedSessionAccessToken({ apiBase: opts.apiBase });
  if (!refreshed.ok) return refreshed;
  return {
    ok: true,
    accessToken: refreshed.accessToken,
    source: 'refresh',
    refreshed: true,
  };
}

/**
 * Mint a legacy_session-shaped JWT for hosted probes when operator SESSION_SECRET is in env.
 * Never persist; never log the token.
 *
 * @param {{ sub?: string }} [opts]
 * @returns {{ ok: true, accessToken: string } | { ok: false, code: string, detail: string }}
 */
export function mintLegacySessionAccessToken(opts = {}) {
  const secret = (process.env.KNOWTATION_SESSION_SECRET || process.env.SESSION_SECRET || '').trim();
  if (!secret) {
    return {
      ok: false,
      code: 'SESSION_SECRET_MISSING',
      detail: 'Set KNOWTATION_SESSION_SECRET (production SESSION_SECRET) locally to probe legacy_session class',
    };
  }
  const sub = opts.sub || 'operator-deploy-proof-legacy';
  const accessToken = jwt.sign({ sub, role: 'admin' }, secret, { expiresIn: '15m' });
  return { ok: true, accessToken };
}

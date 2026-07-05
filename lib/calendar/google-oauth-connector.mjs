/**
 * Google Calendar OAuth connector — Phase 1D (read-only, server-side PKCE + confidential client).
 *
 * Gated by CALENDAR_OAUTH_GOOGLE_AUTHORIZED (compile-time false). Tests inject
 * authorizedOverride via handler options — production routes never pass it.
 *
 * @see docs/CALENDAR-OAUTH-CONNECTOR-1D-SPEC.md
 */

import crypto from 'crypto';
import {
  createPkcePair,
  createOAuthState,
  constantTimeEqual,
  validateAuthorizationResponse,
  validateTokenResponse,
  PKCE_METHOD_S256,
} from '../companion-oauth-pkce.mjs';
import {
  buildEventId,
  connectorForClient,
  countSourceCalendarsForConnector,
  getConnector,
  listConnectors,
  loadCalendarStore,
  purgeConnectorData,
  saveConnector,
  upsertGoogleSourceCalendar,
  upsertNormalizedEvents,
} from './event-store.mjs';
import {
  deleteOAuthTokenVault,
  readOAuthTokenVault,
  writeOAuthTokenVault,
} from './oauth-token-vault.mjs';
import { normalizeGoogleEvents } from './google-event-normalizer.mjs';

/** Tier 3 compile-time gate — do not flip in build sessions; operator changes separately. */
export const CALENDAR_OAUTH_GOOGLE_AUTHORIZED = false;

export const GOOGLE_OAUTH_SCOPES = Object.freeze([
  'openid',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
]);

export const CONNECTOR_SYNC_RATE_LIMIT_MS = 60_000;
export const OAUTH_STATE_TTL_MS = 10 * 60_000;
export const REVOKE_SLA_HOURS = 24;
export const SYNC_PAST_DAYS = 90;
export const SYNC_FUTURE_DAYS = 365;

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

/** @type {Map<string, number>} */
const lastSyncByConnector = new Map();

/**
 * @typedef {Object} GoogleOAuthConnectorEnv
 * @property {string} [CALENDAR_OAUTH_GOOGLE_AUTHORIZED]
 * @property {string} [GOOGLE_CALENDAR_OAUTH_CLIENT_ID]
 * @property {string} [GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET]
 * @property {string} [KNOWTATION_CALENDAR_OAUTH_SECRET]
 * @property {string} [CALENDAR_OAUTH_REDIRECT_URI]
 * @property {string} [SCOOLING_RETURN_URL_ALLOWLIST]
 */

/**
 * @typedef {Object} GoogleOAuthClient
 * @property {(input: { url: string, method?: string, headers?: Record<string,string>, body?: string }) => Promise<{ ok: boolean, status: number, json: () => Promise<unknown>, headers?: { get?: (k: string) => string|null } }>} fetch
 * @property {(accessToken: string) => Promise<{ items: unknown[], nextPageToken?: string }>} calendarList
 * @property {(accessToken: string, calendarId: string, opts: { timeMin: string, timeMax: string, syncToken?: string }) => Promise<{ items: unknown[], nextSyncToken?: string, status?: number }>} eventsList
 */

/**
 * @param {{ authorizedOverride?: boolean }} [opts]
 * @returns {boolean}
 */
export function isGoogleOAuthConnectorEnabled(opts = {}) {
  if (opts.authorizedOverride === true) {
    return true;
  }
  return CALENDAR_OAUTH_GOOGLE_AUTHORIZED === true;
}

/**
 * @param {GoogleOAuthConnectorEnv} env
 * @returns {{ clientId: string, clientSecret: string, vaultSecret: string, redirectUri: string, returnAllowlist: string[] }}
 */
export function readGoogleOAuthEnv(env = process.env) {
  const clientId = typeof env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID === 'string'
    ? env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID.trim()
    : '';
  const clientSecret = typeof env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET === 'string'
    ? env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET.trim()
    : '';
  const vaultSecret = typeof env.KNOWTATION_CALENDAR_OAUTH_SECRET === 'string'
    ? env.KNOWTATION_CALENDAR_OAUTH_SECRET.trim()
    : '';
  const redirectUri = typeof env.CALENDAR_OAUTH_REDIRECT_URI === 'string'
    ? env.CALENDAR_OAUTH_REDIRECT_URI.trim()
    : '';
  const allowRaw = typeof env.SCOOLING_RETURN_URL_ALLOWLIST === 'string'
    ? env.SCOOLING_RETURN_URL_ALLOWLIST
    : '';
  const returnAllowlist = allowRaw.split(',').map((s) => s.trim()).filter(Boolean);
  return { clientId, clientSecret, vaultSecret, redirectUri, returnAllowlist };
}

/**
 * @param {string} returnUrl
 * @param {string[]} allowlist
 * @returns {boolean}
 */
export function isReturnUrlAllowed(returnUrl, allowlist) {
  if (typeof returnUrl !== 'string' || !returnUrl.trim()) {
    return false;
  }
  return allowlist.some((allowed) => constantTimeEqual(returnUrl, allowed));
}

/**
 * @param {string} redirectUri
 * @param {string} expected
 * @returns {boolean}
 */
export function isRedirectUriAllowed(redirectUri, expected) {
  return typeof redirectUri === 'string'
    && typeof expected === 'string'
    && redirectUri.length > 0
    && constantTimeEqual(redirectUri, expected);
}

/**
 * Build Google authorization URL (confidential client + PKCE S256).
 *
 * @param {{ clientId: string, redirectUri: string, state: string, codeChallenge: string }} params
 * @returns {string}
 */
export function buildGoogleAuthorizationUrl(params) {
  const { clientId, redirectUri, state, codeChallenge } = params;
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  const q = url.searchParams;
  q.set('response_type', 'code');
  q.set('client_id', clientId);
  q.set('redirect_uri', redirectUri);
  q.set('scope', GOOGLE_OAUTH_SCOPES.join(' '));
  q.set('state', state);
  q.set('code_challenge', codeChallenge);
  q.set('code_challenge_method', PKCE_METHOD_S256);
  q.set('access_type', 'offline');
  q.set('prompt', 'consent');
  return url.toString();
}

/**
 * @param {string} vaultId
 * @param {string} connectorId
 * @param {string} returnUrl
 * @returns {string}
 */
export function buildOAuthStateBinding(vaultId, connectorId, returnUrl) {
  return crypto.createHash('sha256')
    .update(`${vaultId}:${connectorId}:${returnUrl}`, 'utf8')
    .digest('base64url');
}

/**
 * @param {number} [nowMs]
 * @returns {{ timeMin: string, timeMax: string }}
 */
export function buildSyncHorizon(nowMs = Date.now()) {
  const past = new Date(nowMs - SYNC_PAST_DAYS * 86_400_000);
  const future = new Date(nowMs + SYNC_FUTURE_DAYS * 86_400_000);
  return { timeMin: past.toISOString(), timeMax: future.toISOString() };
}

/**
 * @returns {string}
 */
function newConnectorId() {
  return `conn_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/**
 * @param {{ ok: false, status: number, code: string, error?: string }} result
 */
export function notAuthorizedResult() {
  return { ok: false, status: 501, code: 'NOT_AUTHORIZED' };
}

/**
 * POST /calendar/connectors — begin Google OAuth connect.
 *
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   body: unknown,
 *   env?: GoogleOAuthConnectorEnv,
 *   now?: number,
 *   authorizedOverride?: boolean,
 * }} ctx
 */
export function handleBeginGoogleConnector(ctx) {
  if (!isGoogleOAuthConnectorEnabled({ authorizedOverride: ctx.authorizedOverride })) {
    return notAuthorizedResult();
  }
  const env = readGoogleOAuthEnv(ctx.env);
  if (!env.clientId || !env.clientSecret || !env.vaultSecret || !env.redirectUri) {
    return { ok: false, status: 500, code: 'RUNTIME_ERROR', error: 'OAuth not configured' };
  }
  const body = ctx.body && typeof ctx.body === 'object' ? ctx.body : {};
  if (body.provider !== 'google') {
    return { ok: false, status: 400, code: 'BAD_REQUEST', error: 'provider must be google' };
  }
  const returnUrl = typeof body.return_url === 'string' ? body.return_url.trim() : '';
  if (!isReturnUrlAllowed(returnUrl, env.returnAllowlist)) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', error: 'return_url not allowlisted' };
  }
  const displayName = typeof body.display_name === 'string' && body.display_name.trim()
    ? body.display_name.trim().slice(0, 120)
    : 'Google Calendar';
  const now = ctx.now ?? Date.now();
  const pkce = createPkcePair();
  const state = createOAuthState();
  const connectorId = newConnectorId();
  const expiresAt = new Date(now + OAUTH_STATE_TTL_MS).toISOString();
  const connector = {
    connector_id: connectorId,
    provider: 'google',
    display_name: displayName,
    status: /** @type {'pending'} */ ('pending'),
    oauth_ref: null,
    account_sub: null,
    sync_cursors: {},
    last_sync_at: null,
    last_sync_error: null,
    revoked_at: null,
    oauth_pending: {
      state,
      code_verifier: pkce.codeVerifier,
      return_url: returnUrl,
      state_binding: buildOAuthStateBinding(ctx.vaultId, connectorId, returnUrl),
      expires_at: expiresAt,
    },
  };
  saveConnector(ctx.dataDir, ctx.vaultId, connector);
  const authorizationUrl = buildGoogleAuthorizationUrl({
    clientId: env.clientId,
    redirectUri: env.redirectUri,
    state,
    codeChallenge: pkce.codeChallenge,
  });
  return {
    ok: true,
    status: 200,
    payload: {
      connector_id: connectorId,
      authorization_url: authorizationUrl,
      expires_at: expiresAt,
    },
  };
}

/**
 * @param {Record<string, unknown>} pending
 * @param {number} now
 * @returns {boolean}
 */
function isPendingStateValid(pending, now) {
  if (!pending || typeof pending !== 'object') {
    return false;
  }
  const expiresAt = pending.expires_at;
  if (typeof expiresAt !== 'string') {
    return false;
  }
  return Date.parse(expiresAt) > now;
}

/**
 * Exchange authorization code for tokens (server-side confidential client).
 *
 * @param {GoogleOAuthClient} client
 * @param {{ clientId: string, clientSecret: string, redirectUri: string, code: string, codeVerifier: string }} params
 */
async function exchangeAuthorizationCode(client, params) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code_verifier: params.codeVerifier,
  }).toString();
  const res = await client.fetch({
    url: GOOGLE_TOKEN_ENDPOINT,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  if (!res.ok) {
    return { ok: false, errorCode: 'token_exchange_failed' };
  }
  const validated = validateTokenResponse(await res.json());
  if (!validated.ok) {
    return { ok: false, errorCode: validated.errorCode ?? 'invalid_token_response' };
  }
  return { ok: true, tokens: validated };
}

/**
 * @param {GoogleOAuthClient} client
 * @param {string} accessToken
 */
async function fetchOpenIdSub(client, accessToken) {
  const res = await client.fetch({
    url: GOOGLE_USERINFO_ENDPOINT,
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    return null;
  }
  const json = await res.json();
  if (!json || typeof json !== 'object' || typeof json.sub !== 'string') {
    return null;
  }
  return json.sub;
}

/**
 * @param {string} dataDir
 * @param {string} state
 * @returns {{ vaultId: string, connector: import('./event-store.mjs').StoredCalendarConnector } | null}
 */
export function findPendingConnectorByState(dataDir, state) {
  if (typeof state !== 'string' || !state.trim()) {
    return null;
  }
  const store = loadCalendarStore(dataDir);
  for (const [vaultId, vault] of Object.entries(store.vaults)) {
    for (const connector of vault.connectors ?? []) {
      if (connector.status !== 'pending' || !connector.oauth_pending) {
        continue;
      }
      if (constantTimeEqual(connector.oauth_pending.state, state)) {
        return { vaultId, connector };
      }
    }
  }
  return null;
}

/**
 * GET /calendar/connectors/callback
 *
 * @param {{
 *   dataDir: string,
 *   query: Record<string, unknown>,
 *   googleClient: GoogleOAuthClient,
 *   env?: GoogleOAuthConnectorEnv,
 *   now?: number,
 *   authorizedOverride?: boolean,
 * }} ctx
 */
export async function handleGoogleConnectorCallback(ctx) {
  if (!isGoogleOAuthConnectorEnabled({ authorizedOverride: ctx.authorizedOverride })) {
    return { ok: false, status: 501, redirect: null, code: 'NOT_AUTHORIZED' };
  }
  const env = readGoogleOAuthEnv(ctx.env);
  const now = ctx.now ?? Date.now();
  const gotState = typeof ctx.query.state === 'string' ? ctx.query.state : '';
  const located = findPendingConnectorByState(ctx.dataDir, gotState);
  const fallbackReturn = env.returnAllowlist[0] ?? '/';

  if (!located) {
    const url = new URL(fallbackReturn);
    url.searchParams.set('connect', 'error');
    url.searchParams.set('reason', 'state_invalid');
    return { ok: false, status: 302, redirect: url.toString(), code: 'STATE_INVALID' };
  }

  const { vaultId, connector: matched } = located;
  const pending = matched.oauth_pending;

  if (!pending || !isPendingStateValid(pending, now)) {
    const url = new URL(pending?.return_url ?? fallbackReturn);
    url.searchParams.set('connect', 'error');
    url.searchParams.set('reason', 'state_expired');
    return { ok: false, status: 302, redirect: url.toString(), code: 'STATE_EXPIRED' };
  }

  const auth = validateAuthorizationResponse({
    params: ctx.query,
    expectedState: pending.state,
  });
  if (!auth.ok) {
    const url = new URL(pending.return_url);
    url.searchParams.set('connect', 'error');
    url.searchParams.set('reason', 'state_invalid');
    return { ok: false, status: 302, redirect: url.toString(), code: 'STATE_INVALID' };
  }

  const returnUrl = pending.return_url;
  const failRedirect = (reason) => {
    const url = new URL(returnUrl);
    url.searchParams.set('connect', 'error');
    url.searchParams.set('reason', reason);
    return { ok: false, status: 302, redirect: url.toString(), code: reason.toUpperCase() };
  };

  const exchange = await exchangeAuthorizationCode(ctx.googleClient, {
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    redirectUri: env.redirectUri,
    code: auth.code,
    codeVerifier: pending.code_verifier,
  });

  if (!exchange.ok || !exchange.tokens.refreshToken) {
    return failRedirect('token_exchange_failed');
  }

  const accountSub = await fetchOpenIdSub(ctx.googleClient, exchange.tokens.accessToken) ?? 'unknown';
  writeOAuthTokenVault(ctx.dataDir, matched.connector_id, env.vaultSecret, {
    refresh_token: exchange.tokens.refreshToken,
    scope: exchange.tokens.scope ?? GOOGLE_OAUTH_SCOPES.join(' '),
    token_type: exchange.tokens.tokenType,
    obtained_at: new Date(now).toISOString(),
    account_sub: accountSub,
  });

  matched.status = 'connected';
  matched.oauth_ref = matched.connector_id;
  matched.account_sub = accountSub;
  matched.oauth_pending = null;
  matched.last_sync_error = 'none';
  saveConnector(ctx.dataDir, vaultId, matched);

  await runInitialGoogleSync(ctx.dataDir, vaultId, matched.connector_id, ctx.googleClient, env, now);

  const okUrl = new URL(returnUrl);
  okUrl.searchParams.set('connect', 'ok');
  return { ok: true, status: 302, redirect: okUrl.toString(), code: 'OK' };
}

/**
 * Refresh access token using stored refresh token.
 *
 * @param {GoogleOAuthClient} client
 * @param {{ clientId: string, clientSecret: string, refreshToken: string }} params
 */
async function refreshAccessToken(client, params) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  }).toString();
  const res = await client.fetch({
    url: GOOGLE_TOKEN_ENDPOINT,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  if (!res.ok) {
    return { ok: false, errorCode: 'refresh_failed' };
  }
  const validated = validateTokenResponse(await res.json());
  if (!validated.ok) {
    return { ok: false, errorCode: validated.errorCode ?? 'invalid_grant' };
  }
  return { ok: true, accessToken: validated.accessToken };
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} connectorId
 * @param {GoogleOAuthClient} googleClient
 * @param {ReturnType<typeof readGoogleOAuthEnv>} env
 * @param {number} [nowMs]
 */
export async function runInitialGoogleSync(dataDir, vaultId, connectorId, googleClient, env, nowMs = Date.now()) {
  return runGoogleConnectorSync(dataDir, vaultId, connectorId, googleClient, env, nowMs, { skipRateLimit: true });
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} connectorId
 * @param {GoogleOAuthClient} googleClient
 * @param {ReturnType<typeof readGoogleOAuthEnv>} env
 * @param {number} nowMs
 * @param {{ skipRateLimit?: boolean }} [opts]
 */
export async function runGoogleConnectorSync(
  dataDir,
  vaultId,
  connectorId,
  googleClient,
  env,
  nowMs,
  opts = {},
) {
  const connector = getConnector(dataDir, vaultId, connectorId);
  if (!connector || connector.status !== 'connected') {
    throw new Error('Connector not connected');
  }
  if (!opts.skipRateLimit) {
    const last = lastSyncByConnector.get(connectorId) ?? 0;
    if (nowMs - last < CONNECTOR_SYNC_RATE_LIMIT_MS) {
      return { ok: false, code: 'rate_limited' };
    }
  }
  let tokenPayload;
  try {
    tokenPayload = readOAuthTokenVault(dataDir, connectorId, env.vaultSecret);
  } catch {
    connector.status = 'needs_reauth';
    connector.last_sync_error = 'auth_expired';
    saveConnector(dataDir, vaultId, connector);
    return { ok: false, code: 'auth_expired' };
  }
  const refreshed = await refreshAccessToken(googleClient, {
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    refreshToken: tokenPayload.refresh_token,
  });
  if (!refreshed.ok) {
    connector.status = refreshed.errorCode === 'invalid_grant' ? 'needs_reauth' : connector.status;
    connector.last_sync_error = refreshed.errorCode === 'invalid_grant' ? 'auth_expired' : 'provider_error';
    saveConnector(dataDir, vaultId, connector);
    return { ok: false, code: connector.last_sync_error };
  }
  const accessToken = refreshed.accessToken;
  const list = await googleClient.calendarList(accessToken);
  const horizon = buildSyncHorizon(nowMs);
  let synced = 0;
  let updated = 0;
  let tombstoned = 0;
  if (!connector.sync_cursors) {
    connector.sync_cursors = {};
  }

  for (const item of list.items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const row = /** @type {Record<string, unknown>} */ (item);
    const googleId = typeof row.id === 'string' ? row.id : '';
    if (!googleId) {
      continue;
    }
    const calSummary = typeof row.summary === 'string' ? row.summary : 'Google calendar';
    const sourceCalendar = upsertGoogleSourceCalendar(
      dataDir,
      vaultId,
      connectorId,
      googleId,
      calSummary,
    );
    const syncToken = connector.sync_cursors[sourceCalendar.source_calendar_id];
    const eventsResult = await googleClient.eventsList(accessToken, googleId, {
      timeMin: horizon.timeMin,
      timeMax: horizon.timeMax,
      ...(syncToken ? { syncToken } : {}),
    });
    if (eventsResult.status === 410) {
      delete connector.sync_cursors[sourceCalendar.source_calendar_id];
      const full = await googleClient.eventsList(accessToken, googleId, {
        timeMin: horizon.timeMin,
        timeMax: horizon.timeMax,
      });
      const normalized = normalizeGoogleEvents(full.items);
      const counts = upsertNormalizedEvents(dataDir, vaultId, sourceCalendar.source_calendar_id, normalized);
      synced += counts.imported;
      updated += counts.updated;
      tombstoned += counts.tombstoned;
      if (full.nextSyncToken) {
        connector.sync_cursors[sourceCalendar.source_calendar_id] = full.nextSyncToken;
      }
      continue;
    }
    const normalized = normalizeGoogleEvents(eventsResult.items);
    const counts = upsertNormalizedEvents(dataDir, vaultId, sourceCalendar.source_calendar_id, normalized);
    synced += counts.imported;
    updated += counts.updated;
    tombstoned += counts.tombstoned;
    if (eventsResult.nextSyncToken) {
      connector.sync_cursors[sourceCalendar.source_calendar_id] = eventsResult.nextSyncToken;
    }
  }

  connector.last_sync_at = new Date(nowMs).toISOString();
  connector.last_sync_error = 'none';
  saveConnector(dataDir, vaultId, connector);
  lastSyncByConnector.set(connectorId, nowMs);
  return { ok: true, synced, updated, tombstoned, last_sync_at: connector.last_sync_at };
}

/**
 * GET /calendar/connectors
 *
 * @param {{ dataDir: string, vaultId: string, authorizedOverride?: boolean }} ctx
 */
export function handleListGoogleConnectors(ctx) {
  if (!isGoogleOAuthConnectorEnabled({ authorizedOverride: ctx.authorizedOverride })) {
    return notAuthorizedResult();
  }
  const connectors = listConnectors(ctx.dataDir, ctx.vaultId)
    .filter((c) => c.provider === 'google')
    .map((c) => connectorForClient(c, countSourceCalendarsForConnector(ctx.dataDir, ctx.vaultId, c.connector_id)));
  return {
    ok: true,
    status: 200,
    payload: {
      schema: 'knowtation.calendar_connectors/v0',
      vault_id: ctx.vaultId,
      connectors,
    },
  };
}

/**
 * POST /calendar/connectors/:id/sync
 */
export async function handleSyncGoogleConnector(ctx) {
  if (!isGoogleOAuthConnectorEnabled({ authorizedOverride: ctx.authorizedOverride })) {
    return notAuthorizedResult();
  }
  const env = readGoogleOAuthEnv(ctx.env);
  const now = ctx.now ?? Date.now();
  const connectorId = ctx.connectorId;
  const result = await runGoogleConnectorSync(
    ctx.dataDir,
    ctx.vaultId,
    connectorId,
    ctx.googleClient,
    env,
    now,
  );
  if (!result.ok) {
    if (result.code === 'rate_limited') {
      return { ok: false, status: 429, code: 'RATE_LIMITED' };
    }
    if (result.code === 'auth_expired') {
      return { ok: false, status: 409, code: 'AUTH_EXPIRED' };
    }
    return { ok: false, status: 502, code: 'PROVIDER_ERROR' };
  }
  return {
    ok: true,
    status: 200,
    payload: {
      synced: result.synced,
      updated: result.updated,
      tombstoned: result.tombstoned,
      last_sync_at: result.last_sync_at,
    },
  };
}

/**
 * DELETE /calendar/connectors/:id
 */
export async function handleRevokeGoogleConnector(ctx) {
  if (!isGoogleOAuthConnectorEnabled({ authorizedOverride: ctx.authorizedOverride })) {
    return notAuthorizedResult();
  }
  const env = readGoogleOAuthEnv(ctx.env);
  const connector = getConnector(ctx.dataDir, ctx.vaultId, ctx.connectorId);
  if (!connector) {
    return { ok: false, status: 404, code: 'NOT_FOUND' };
  }
  try {
    const payload = readOAuthTokenVault(ctx.dataDir, ctx.connectorId, env.vaultSecret);
    await ctx.googleClient.fetch({
      url: GOOGLE_REVOKE_ENDPOINT,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: payload.refresh_token }).toString(),
    });
  } catch {
    // best-effort revoke
  }
  deleteOAuthTokenVault(ctx.dataDir, ctx.connectorId);
  const eventsDeleted = purgeConnectorData(ctx.dataDir, ctx.vaultId, ctx.connectorId);
  connector.status = 'revoked';
  connector.revoked_at = new Date(ctx.now ?? Date.now()).toISOString();
  connector.oauth_ref = null;
  connector.oauth_pending = null;
  saveConnector(ctx.dataDir, ctx.vaultId, connector);
  return {
    ok: true,
    status: 200,
    payload: {
      revoked: true,
      events_deleted: eventsDeleted,
      sla_hours: REVOKE_SLA_HOURS,
    },
  };
}

export function createFakeGoogleClient(fixtures = {}) {
  /** @type {unknown[]} */
  const tokenCalls = [];
  return {
    fetch: async (input) => {
      tokenCalls.push(input);
      if (input.url.includes('/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => fixtures.tokenResponse ?? {
            access_token: 'access_test_token',
            refresh_token: 'refresh_test_token',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: GOOGLE_OAUTH_SCOPES.join(' '),
          },
        };
      }
      if (input.url.includes('userinfo')) {
        return {
          ok: true,
          status: 200,
          json: async () => fixtures.userinfo ?? { sub: 'google-sub-123' },
        };
      }
      if (input.url.includes('revoke')) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    },
    calendarList: async () => ({
      items: fixtures.calendars ?? [{ id: 'primary', summary: 'Primary' }],
    }),
    eventsList: async (_accessToken, calendarId, opts) => {
      const bucket = fixtures.eventsByCalendar?.[calendarId];
      if (bucket?.status === 410) {
        return { items: [], status: 410 };
      }
      if (opts.syncToken && fixtures.eventsByCalendar?.[`${calendarId}:incremental`]) {
        return fixtures.eventsByCalendar[`${calendarId}:incremental`];
      }
      return bucket ?? {
        items: [{
          id: 'evt-1',
          summary: 'Team standup',
          start: { dateTime: '2026-06-18T17:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2026-06-18T17:30:00Z', timeZone: 'UTC' },
          status: 'confirmed',
        }],
        nextSyncToken: 'sync-token-1',
      };
    },
  };
}

/**
 * Production Google API client (real fetch). Only invoked when gate is enabled.
 *
 * @returns {GoogleOAuthClient}
 */
export function createProductionGoogleClient() {
  const fetchImpl = globalThis.fetch.bind(globalThis);
  return {
    fetch: async (input) => {
      const res = await fetchImpl(input.url, {
        method: input.method ?? 'GET',
        headers: input.headers,
        ...(input.body !== undefined ? { body: input.body } : {}),
      });
      return {
        ok: res.ok,
        status: res.status,
        json: () => res.json(),
        headers: { get: (k) => res.headers.get(k) },
      };
    },
    calendarList: async (accessToken) => {
      const res = await fetchImpl('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      const json = await res.json();
      return { items: Array.isArray(json.items) ? json.items : [] };
    },
    eventsList: async (accessToken, calendarId, opts) => {
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      if (opts.timeMin) url.searchParams.set('timeMin', opts.timeMin);
      if (opts.timeMax) url.searchParams.set('timeMax', opts.timeMax);
      if (opts.syncToken) url.searchParams.set('syncToken', opts.syncToken);
      const res = await fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (res.status === 410) {
        return { items: [], status: 410 };
      }
      const json = await res.json();
      return {
        items: Array.isArray(json.items) ? json.items : [],
        nextSyncToken: typeof json.nextSyncToken === 'string' ? json.nextSyncToken : undefined,
        status: res.status,
      };
    },
  };
}

export { buildEventId };

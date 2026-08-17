/**
 * Google Drive readonly OAuth connector.
 *
 * Gated by DOCS_OAUTH_GOOGLE_AUTHORIZED (compile-time; Tier 3 flip 2026-08-17).
 * Tests may inject `authorizedOverride`; production routes must never pass it.
 */

import crypto from 'crypto';
import {
  createOAuthState,
  createPkcePair,
  constantTimeEqual,
  PKCE_METHOD_S256,
  validateAuthorizationResponse,
  validateTokenResponse,
} from '../companion-oauth-pkce.mjs';
import { docxBytesToMarkdown } from '../importers/docx.mjs';
import { pdfBytesToMarkdown } from '../importers/pdf.mjs';
import {
  connectorForClient,
  findPendingByState,
  getConnector,
  listConnectors,
  newConnectorId,
  saveConnector,
} from './docs-connector-store.mjs';
import { proposeDocsImports } from './docs-import-propose.mjs';
import {
  buildDriveNameContainsQuery,
  DRIVE_FILE_ID_RE,
  isImportableMime,
  LIST_Q_RE,
} from './google-drive-normalizer.mjs';
import {
  deleteOAuthTokenVault,
  readOAuthTokenVault,
  writeOAuthTokenVault,
} from './oauth-token-vault.mjs';

/** Tier 3 compile-time gate — flipped 2026-08-17 (operator-authorized Drive OAuth). */
export const DOCS_OAUTH_GOOGLE_AUTHORIZED = true;
export const GOOGLE_DRIVE_OAUTH_SCOPES = Object.freeze([
  'openid',
  'https://www.googleapis.com/auth/drive.readonly',
]);
export const DOCS_CONNECTOR_SYNC_RATE_LIMIT_MS = 60_000;
export const DOCS_OAUTH_STATE_TTL_MS = 10 * 60_000;
export const DOCS_LIST_PAGE_SIZE = 50;

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const activeSyncs = new Set();

export function isDocsGoogleOAuthEnabled({ authorizedOverride } = {}) {
  if (authorizedOverride === true) return true;
  if (authorizedOverride === false) return false;
  return DOCS_OAUTH_GOOGLE_AUTHORIZED === true;
}

export function readDocsGoogleOAuthEnv(env = process.env) {
  const value = (name) => typeof env?.[name] === 'string' ? env[name].trim() : '';
  return {
    clientId: value('GOOGLE_DRIVE_OAUTH_CLIENT_ID'),
    clientSecret: value('GOOGLE_DRIVE_OAUTH_CLIENT_SECRET'),
    vaultSecret: value('KNOWTATION_DOCS_OAUTH_SECRET'),
    redirectUri: value('DOCS_OAUTH_REDIRECT_URI'),
    returnAllowlist: value('SCOOLING_RETURN_URL_ALLOWLIST')
      .split(',')
      .map((row) => row.trim())
      .filter(Boolean),
  };
}

function envComplete(env) {
  return Boolean(env.clientId && env.clientSecret && env.vaultSecret && env.redirectUri);
}

function result(status, code) {
  return { ok: false, status, code };
}

function notAuthorized() {
  return result(501, 'NOT_AUTHORIZED');
}

async function sleep(ms) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

async function providerCall(ctx, operation) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await operation();
    if (response?.status !== 429) return response;
    if (attempt < 2) {
      const wait = Number.isFinite(response.retryAfterMs)
        ? Math.max(0, Math.min(response.retryAfterMs, 60_000))
        : 0;
      await (ctx.sleepFn ?? sleep)(wait);
    }
  }
  return { status: 429 };
}

function isReturnUrlAllowed(returnUrl, allowlist) {
  return typeof returnUrl === 'string'
    && returnUrl.length > 0
    && allowlist.some((allowed) => constantTimeEqual(returnUrl, allowed));
}

export function buildDocsOAuthStateBinding(vaultId, connectorId, returnUrl) {
  return crypto.createHash('sha256')
    .update(`${vaultId}:${connectorId}:${returnUrl}`, 'utf8')
    .digest('base64url');
}

export function buildDocsGoogleAuthorizationUrl({ clientId, redirectUri, state, codeChallenge }) {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', GOOGLE_DRIVE_OAUTH_SCOPES.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', PKCE_METHOD_S256);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

/**
 * Begin a confidential-web-client + PKCE S256 consent.
 */
export function handleBeginDocsConnector(ctx) {
  if (!isDocsGoogleOAuthEnabled({ authorizedOverride: ctx.authorizedOverride })) return notAuthorized();
  const env = readDocsGoogleOAuthEnv(ctx.env);
  if (!envComplete(env)) return result(503, 'NOT_CONFIGURED');
  const body = ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body : null;
  if (!body) return result(400, 'BAD_REQUEST');
  const allowedKeys = new Set(['provider', 'display_name', 'return_url']);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) return result(400, 'BAD_REQUEST');
  if (body.provider !== 'google-drive') return result(400, 'PROVIDER_DENIED');
  const returnUrl = typeof body.return_url === 'string' ? body.return_url.trim() : '';
  if (!isReturnUrlAllowed(returnUrl, env.returnAllowlist)) return result(400, 'RETURN_URL_DENIED');

  const now = ctx.now ?? Date.now();
  const connectorId = newConnectorId();
  const pkce = createPkcePair();
  const state = createOAuthState();
  const expiresAt = new Date(now + DOCS_OAUTH_STATE_TTL_MS).toISOString();
  saveConnector(ctx.dataDir, ctx.vaultId, {
    connector_id: connectorId,
    provider: 'google-drive',
    display_name: typeof body.display_name === 'string' && body.display_name.trim()
      ? body.display_name.trim().slice(0, 128)
      : 'Google Drive',
    status: 'pending',
    account_sub: null,
    oauth_ref: null,
    sync_cursor: null,
    last_sync_at: null,
    last_sync_error: 'none',
    file_count: 0,
    revoked_at: null,
    oauth_pending: {
      state,
      code_verifier: pkce.codeVerifier,
      return_url: returnUrl,
      state_binding: buildDocsOAuthStateBinding(ctx.vaultId, connectorId, returnUrl),
      expires_at: expiresAt,
    },
  });
  return {
    ok: true,
    status: 200,
    payload: {
      connector_id: connectorId,
      authorization_url: buildDocsGoogleAuthorizationUrl({
        clientId: env.clientId,
        redirectUri: env.redirectUri,
        state,
        codeChallenge: pkce.codeChallenge,
      }),
      expires_at: expiresAt,
    },
  };
}

function redirectResult(returnUrl, reason, code) {
  if (typeof returnUrl !== 'string' || !returnUrl) {
    return { ok: false, status: 400, redirect: null, code };
  }
  const url = new URL(returnUrl);
  url.searchParams.set('connect', 'error');
  url.searchParams.set('reason', reason);
  return { ok: false, status: 302, redirect: url.toString(), code };
}

async function exchangeCode(client, env, code, verifier) {
  const response = await client.fetch({
    url: TOKEN_ENDPOINT,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.redirectUri,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      code_verifier: verifier,
    }).toString(),
  });
  if (!response.ok) return null;
  const validated = validateTokenResponse(await response.json());
  return validated.ok ? validated : null;
}

async function fetchAccountSub(client, accessToken) {
  const response = await client.fetch({
    url: USERINFO_ENDPOINT,
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const body = await response.json();
  return body && typeof body.sub === 'string' && body.sub ? body.sub : null;
}

/**
 * Complete consent. Every located state is consumed exactly once.
 */
export async function handleDocsConnectorCallback(ctx) {
  if (!isDocsGoogleOAuthEnabled({ authorizedOverride: ctx.authorizedOverride })) {
    return { ...notAuthorized(), redirect: null };
  }
  const env = readDocsGoogleOAuthEnv(ctx.env);
  const fallback = env.returnAllowlist[0];
  if (!envComplete(env)) {
    return fallback
      ? redirectResult(fallback, 'not_configured', 'NOT_CONFIGURED')
      : { ...result(503, 'NOT_CONFIGURED'), redirect: null };
  }
  const state = typeof ctx.query?.state === 'string' ? ctx.query.state : '';
  const located = findPendingByState(ctx.dataDir, state);
  if (!located) return redirectResult(fallback, 'state_invalid', 'STATE_INVALID');
  const { vaultId, connector } = located;
  const pending = connector.oauth_pending;
  connector.oauth_pending = null;
  saveConnector(ctx.dataDir, vaultId, connector);

  const now = ctx.now ?? Date.now();
  const validExpiry = typeof pending?.expires_at === 'string' && Date.parse(pending.expires_at) > now;
  const validBinding = constantTimeEqual(
    pending?.state_binding,
    buildDocsOAuthStateBinding(vaultId, connector.connector_id, pending?.return_url ?? ''),
  );
  if (!validExpiry || !validBinding || !isReturnUrlAllowed(pending?.return_url, env.returnAllowlist)) {
    return redirectResult(
      isReturnUrlAllowed(pending?.return_url, env.returnAllowlist) ? pending.return_url : fallback,
      'state_invalid',
      'STATE_INVALID',
    );
  }
  const auth = validateAuthorizationResponse({ params: ctx.query, expectedState: pending.state });
  if (!auth.ok) {
    const denied = auth.errorCode === 'access_denied';
    return redirectResult(pending.return_url, denied ? 'denied' : 'provider_error', denied ? 'PROVIDER_DENIED' : 'PROVIDER_ERROR');
  }
  const tokens = await exchangeCode(ctx.googleClient, env, auth.code, pending.code_verifier);
  if (!tokens || !tokens.refreshToken) {
    connector.status = 'needs_reauth';
    connector.last_sync_error = 'provider_error';
    saveConnector(ctx.dataDir, vaultId, connector);
    return redirectResult(pending.return_url, 'provider_error', 'PROVIDER_ERROR');
  }
  const accountSub = await fetchAccountSub(ctx.googleClient, tokens.accessToken);
  if (!accountSub) {
    connector.status = 'needs_reauth';
    connector.last_sync_error = 'provider_error';
    saveConnector(ctx.dataDir, vaultId, connector);
    return redirectResult(pending.return_url, 'provider_error', 'PROVIDER_ERROR');
  }
  writeOAuthTokenVault(ctx.dataDir, connector.connector_id, env.vaultSecret, {
    refresh_token: tokens.refreshToken,
    scope: tokens.scope ?? GOOGLE_DRIVE_OAUTH_SCOPES.join(' '),
    token_type: tokens.tokenType,
    obtained_at: new Date(now).toISOString(),
    account_sub: accountSub,
  });
  connector.status = 'connected';
  connector.oauth_ref = connector.connector_id;
  connector.account_sub = accountSub;
  connector.last_sync_error = 'none';
  saveConnector(ctx.dataDir, vaultId, connector);
  const url = new URL(pending.return_url);
  url.searchParams.set('connect', 'ok');
  return { ok: true, status: 302, redirect: url.toString(), code: 'OK' };
}

async function refreshAccess(ctx, connector, env) {
  let token;
  try {
    token = readOAuthTokenVault(ctx.dataDir, connector.connector_id, env.vaultSecret);
  } catch {
    connector.status = 'needs_reauth';
    connector.last_sync_error = 'auth_expired';
    saveConnector(ctx.dataDir, ctx.vaultId, connector);
    return { ok: false, response: result(409, 'NEEDS_REAUTH') };
  }
  const response = await ctx.googleClient.fetch({
    url: TOKEN_ENDPOINT,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
      client_id: env.clientId,
      client_secret: env.clientSecret,
    }).toString(),
  });
  const json = await response.json();
  const validated = response.ok ? validateTokenResponse(json) : { ok: false, errorCode: json?.error };
  if (!validated.ok) {
    if (validated.errorCode === 'invalid_grant' || json?.error === 'invalid_grant') {
      connector.status = 'needs_reauth';
      connector.last_sync_error = 'auth_expired';
      saveConnector(ctx.dataDir, ctx.vaultId, connector);
      return { ok: false, response: result(409, 'NEEDS_REAUTH') };
    }
    connector.last_sync_error = response.status === 429 ? 'rate_limited' : 'provider_error';
    saveConnector(ctx.dataDir, ctx.vaultId, connector);
    return {
      ok: false,
      response: response.status === 429 ? result(429, 'RATE_LIMITED') : result(502, 'PROVIDER_ERROR'),
    };
  }
  return { ok: true, accessToken: validated.accessToken };
}

function connectedConnector(ctx) {
  const connector = getConnector(ctx.dataDir, ctx.vaultId, ctx.connectorId);
  if (!connector || connector.status === 'revoked') return { response: result(404, 'CONNECTOR_NOT_FOUND') };
  if (connector.status === 'needs_reauth') return { response: result(409, 'NEEDS_REAUTH') };
  if (connector.status !== 'connected') return { response: result(400, 'BAD_REQUEST') };
  if (connector.provider !== 'google-drive') return { response: result(400, 'PROVIDER_DENIED') };
  return { connector };
}

function normalizeFile(row) {
  const size = Number.parseInt(row?.size ?? '0', 10);
  return {
    file_id: typeof row?.id === 'string' ? row.id : '',
    name: typeof row?.name === 'string' ? row.name.slice(0, 512) : 'Untitled',
    mime: typeof row?.mimeType === 'string' ? row.mimeType : '',
    modified: typeof row?.modifiedTime === 'string' ? row.modifiedTime : null,
    size: Number.isFinite(size) && size >= 0 ? size : 0,
    importable: isImportableMime(row?.mimeType),
  };
}

export function handleListDocsConnectors(ctx) {
  if (!isDocsGoogleOAuthEnabled({ authorizedOverride: ctx.authorizedOverride })) return notAuthorized();
  return {
    ok: true,
    status: 200,
    payload: {
      schema: 'knowtation.docs_connectors/v0',
      connectors: listConnectors(ctx.dataDir, ctx.vaultId)
        .filter((connector) => connector.provider === 'google-drive')
        .map(connectorForClient),
    },
  };
}

export async function handleListDocsConnectorFiles(ctx) {
  if (!isDocsGoogleOAuthEnabled({ authorizedOverride: ctx.authorizedOverride })) return notAuthorized();
  const found = connectedConnector(ctx);
  if (found.response) return found.response;
  const q = ctx.query?.q;
  if (q !== undefined && (typeof q !== 'string' || !LIST_Q_RE.test(q))) return result(400, 'BAD_REQUEST');
  const pageToken = ctx.query?.page_token;
  if (pageToken !== undefined && (typeof pageToken !== 'string' || pageToken.length > 2048)) {
    return result(400, 'BAD_REQUEST');
  }
  const env = readDocsGoogleOAuthEnv(ctx.env);
  if (!envComplete(env)) return result(503, 'NOT_CONFIGURED');
  const token = await refreshAccess(ctx, found.connector, env);
  if (!token.ok) return token.response;
  const listed = await providerCall(ctx, () => ctx.googleClient.filesList({
    accessToken: token.accessToken,
    ...(pageToken ? { pageToken } : {}),
    ...(q ? { q: buildDriveNameContainsQuery(q) } : {}),
  }));
  if (listed.status === 429) return result(429, 'RATE_LIMITED');
  if (listed.status && listed.status >= 400) return result(502, 'PROVIDER_ERROR');
  const files = (listed.files ?? listed.items ?? []).slice(0, DOCS_LIST_PAGE_SIZE).map(normalizeFile);
  found.connector.file_count = files.length;
  found.connector.last_sync_error = 'none';
  saveConnector(ctx.dataDir, ctx.vaultId, found.connector);
  return {
    ok: true,
    status: 200,
    payload: {
      files,
      ...(listed.nextPageToken ? { next_page_token: listed.nextPageToken } : {}),
    },
  };
}

function bytesOf(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value && Buffer.isBuffer(value.bytes)) return value.bytes;
  if (value?.bytes instanceof Uint8Array) return Buffer.from(value.bytes);
  return Buffer.from(typeof value === 'string' ? value : value?.body ?? '', 'utf8');
}

async function driveFileMarkdown(client, accessToken, meta) {
  const mime = meta.mimeType;
  if (!isImportableMime(mime)) return { ok: false, reason: 'unsupported_mime' };
  let bytes;
  if (mime === 'application/vnd.google-apps.document') {
    try {
      bytes = bytesOf(await client.filesExport({ accessToken, fileId: meta.id, mimeType: 'text/markdown' }));
      if (!bytes.toString('utf8').trim()) {
        bytes = bytesOf(await client.filesExport({ accessToken, fileId: meta.id, mimeType: 'text/plain' }));
      }
    } catch {
      return { ok: false, reason: 'provider_error' };
    }
    const markdown = bytes.toString('utf8').trim();
    return markdown ? { ok: true, markdown, size: bytes.length } : { ok: false, reason: 'empty_extract' };
  }
  try {
    bytes = bytesOf(await client.filesDownload({ accessToken, fileId: meta.id }));
  } catch {
    return { ok: false, reason: 'provider_error' };
  }
  if (bytes.length > 25_000_000) return { ok: false, reason: 'too_large' };
  if (mime === 'application/pdf') {
    const converted = await pdfBytesToMarkdown(bytes);
    return converted.ok ? { ok: true, markdown: converted.markdown, size: bytes.length } : converted;
  }
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const converted = await docxBytesToMarkdown(bytes);
    return converted.ok ? { ok: true, markdown: converted.markdown, size: bytes.length } : converted;
  }
  const markdown = bytes.toString('utf8').trim();
  return markdown ? { ok: true, markdown, size: bytes.length } : { ok: false, reason: 'empty_extract' };
}

async function fetchImportItems(ctx, accessToken, fileIds) {
  const items = [];
  const skips = [];
  let batchBytes = 0;
  for (const fileId of fileIds) {
    let meta;
    try {
      meta = await providerCall(ctx, () => ctx.googleClient.filesGet({ accessToken, fileId }));
    } catch {
      skips.push({ source_id: fileId, reason: 'not_found' });
      continue;
    }
    if (meta?.status === 429) {
      throw Object.assign(new Error('provider rate limited'), { code: 'RATE_LIMITED' });
    }
    if (!meta || meta.status === 404 || typeof meta.id !== 'string') {
      skips.push({ source_id: fileId, reason: 'not_found' });
      continue;
    }
    if (!isImportableMime(meta.mimeType)) {
      skips.push({ source_id: fileId, reason: 'unsupported_mime' });
      continue;
    }
    const declaredSize = Number.parseInt(meta.size ?? '0', 10);
    if (Number.isFinite(declaredSize) && declaredSize > 25_000_000) {
      skips.push({ source_id: fileId, reason: 'too_large' });
      continue;
    }
    const content = await driveFileMarkdown(ctx.googleClient, accessToken, meta);
    if (!content.ok) {
      skips.push({ source_id: fileId, reason: content.reason });
      continue;
    }
    batchBytes += content.size;
    if (batchBytes > 80_000_000) throw Object.assign(new TypeError('import batch exceeds byte cap'), { code: 'BAD_REQUEST' });
    items.push({
      source_id: fileId,
      name: typeof meta.name === 'string' ? meta.name : fileId,
      markdown: content.markdown,
      size: content.size,
    });
  }
  return { items, skips };
}

export async function handleImportDocsConnectorFiles(ctx) {
  if (!isDocsGoogleOAuthEnabled({ authorizedOverride: ctx.authorizedOverride })) return notAuthorized();
  const found = connectedConnector(ctx);
  if (found.response) return found.response;
  const body = ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body : null;
  if (!body || Object.keys(body).some((key) => key !== 'file_ids')) return result(400, 'BAD_REQUEST');
  const fileIds = body.file_ids;
  if (!Array.isArray(fileIds) || fileIds.length < 1 || fileIds.length > 20 || !fileIds.every((id) => DRIVE_FILE_ID_RE.test(id))) {
    return result(400, 'BAD_REQUEST');
  }
  const env = readDocsGoogleOAuthEnv(ctx.env);
  if (!envComplete(env)) return result(503, 'NOT_CONFIGURED');
  const token = await refreshAccess(ctx, found.connector, env);
  if (!token.ok) return token.response;
  let fetched;
  try {
    fetched = await fetchImportItems(ctx, token.accessToken, fileIds);
  } catch (error) {
    if (error?.code === 'BAD_REQUEST') return result(400, 'BAD_REQUEST');
    if (error?.code === 'RATE_LIMITED') return result(429, 'RATE_LIMITED');
    return result(502, 'PROVIDER_ERROR');
  }
  let proposed = { proposed: 0, skipped: 0, proposal_ids: [], skip_details: [] };
  if (fetched.items.length) {
    proposed = proposeDocsImports({
      dataDir: ctx.dataDir,
      vaultPath: ctx.vaultPath,
      vaultId: ctx.vaultId,
      connectorId: ctx.connectorId,
      provider: 'google-drive',
      items: fetched.items,
      now: ctx.now,
      createProposalFn: ctx.createProposalFn,
      loadProposalsFn: ctx.loadProposalsFn,
      listMarkdownFilesFn: ctx.listMarkdownFilesFn,
      readNoteFn: ctx.readNoteFn,
    });
  }
  const skipDetails = [...fetched.skips, ...proposed.skip_details];
  return {
    ok: true,
    status: 200,
    payload: {
      proposed: proposed.proposed,
      skipped: skipDetails.length,
      proposal_ids: proposed.proposal_ids,
      skip_details: skipDetails,
    },
  };
}

async function syncRows(ctx, connector, accessToken) {
  let rows;
  let nextCursor;
  if (!connector.sync_cursor) {
    const listed = await providerCall(ctx, () => ctx.googleClient.filesList({ accessToken }));
    if (listed.status === 429) return { response: result(429, 'RATE_LIMITED') };
    rows = listed.files ?? listed.items ?? [];
    const start = await providerCall(ctx, () => ctx.googleClient.changesGetStartPageToken({ accessToken }));
    if (start.status === 429) return { response: result(429, 'RATE_LIMITED') };
    nextCursor = start.startPageToken ?? start.token ?? null;
  } else {
    let changes = await providerCall(
      ctx,
      () => ctx.googleClient.changesList({ accessToken, pageToken: connector.sync_cursor }),
    );
    if (changes.status === 410) {
      const listed = await providerCall(ctx, () => ctx.googleClient.filesList({ accessToken }));
      rows = listed.files ?? listed.items ?? [];
      const start = await providerCall(ctx, () => ctx.googleClient.changesGetStartPageToken({ accessToken }));
      if (start.status === 429) return { response: result(429, 'RATE_LIMITED') };
      nextCursor = start.startPageToken ?? start.token ?? null;
    } else {
      if (changes.status === 429) return { response: result(429, 'RATE_LIMITED') };
      rows = (changes.changes ?? []).map((change) => change.file).filter(Boolean);
      nextCursor = changes.newStartPageToken ?? changes.nextPageToken ?? connector.sync_cursor;
    }
  }
  return { rows: rows.slice(0, 20), nextCursor };
}

export async function handleSyncDocsConnector(ctx) {
  if (!isDocsGoogleOAuthEnabled({ authorizedOverride: ctx.authorizedOverride })) return notAuthorized();
  const found = connectedConnector(ctx);
  if (found.response) return found.response;
  const now = ctx.now ?? Date.now();
  const last = found.connector.last_sync_at ? Date.parse(found.connector.last_sync_at) : 0;
  if (activeSyncs.has(ctx.connectorId) || (Number.isFinite(last) && now - last < DOCS_CONNECTOR_SYNC_RATE_LIMIT_MS)) {
    return result(429, 'RATE_LIMITED');
  }
  const env = readDocsGoogleOAuthEnv(ctx.env);
  if (!envComplete(env)) return result(503, 'NOT_CONFIGURED');
  activeSyncs.add(ctx.connectorId);
  try {
    const token = await refreshAccess(ctx, found.connector, env);
    if (!token.ok) return token.response;
    const sync = await syncRows(ctx, found.connector, token.accessToken);
    if (sync.response) {
      found.connector.last_sync_error = 'rate_limited';
      saveConnector(ctx.dataDir, ctx.vaultId, found.connector);
      return sync.response;
    }
    const ids = sync.rows
      .map((row) => row?.id)
      .filter((id) => typeof id === 'string' && DRIVE_FILE_ID_RE.test(id));
    const fetched = await fetchImportItems(ctx, token.accessToken, ids);
    const proposed = fetched.items.length
      ? proposeDocsImports({
          dataDir: ctx.dataDir,
          vaultPath: ctx.vaultPath,
          vaultId: ctx.vaultId,
          connectorId: ctx.connectorId,
          provider: 'google-drive',
          items: fetched.items,
          now,
          createProposalFn: ctx.createProposalFn,
          loadProposalsFn: ctx.loadProposalsFn,
          listMarkdownFilesFn: ctx.listMarkdownFilesFn,
          readNoteFn: ctx.readNoteFn,
        })
      : { proposed: 0, skipped: 0, proposal_ids: [], skip_details: [] };
    found.connector.sync_cursor = typeof sync.nextCursor === 'string' ? sync.nextCursor : found.connector.sync_cursor;
    found.connector.last_sync_at = new Date(now).toISOString();
    found.connector.last_sync_error = 'none';
    found.connector.file_count = sync.rows.length;
    saveConnector(ctx.dataDir, ctx.vaultId, found.connector);
    return {
      ok: true,
      status: 200,
      payload: {
        proposed: proposed.proposed,
        skipped: fetched.skips.length + proposed.skipped,
        last_sync_at: found.connector.last_sync_at,
      },
    };
  } catch (error) {
    const rateLimited = error?.code === 'RATE_LIMITED';
    found.connector.last_sync_error = rateLimited ? 'rate_limited' : 'provider_error';
    saveConnector(ctx.dataDir, ctx.vaultId, found.connector);
    return rateLimited ? result(429, 'RATE_LIMITED') : result(502, 'PROVIDER_ERROR');
  } finally {
    activeSyncs.delete(ctx.connectorId);
  }
}

export async function handleRevokeDocsConnector(ctx) {
  if (!isDocsGoogleOAuthEnabled({ authorizedOverride: ctx.authorizedOverride })) return notAuthorized();
  const connector = getConnector(ctx.dataDir, ctx.vaultId, ctx.connectorId);
  if (!connector || connector.status === 'revoked') return result(404, 'CONNECTOR_NOT_FOUND');
  if (connector.provider !== 'google-drive') return result(400, 'PROVIDER_DENIED');
  const env = readDocsGoogleOAuthEnv(ctx.env);
  if (env.vaultSecret) {
    try {
      const token = readOAuthTokenVault(ctx.dataDir, ctx.connectorId, env.vaultSecret);
      await ctx.googleClient.fetch({
        url: REVOKE_ENDPOINT,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: token.refresh_token }).toString(),
      });
    } catch {
      // Remote revoke is best-effort; local custody deletion is mandatory.
    }
  }
  deleteOAuthTokenVault(ctx.dataDir, ctx.connectorId);
  connector.status = 'revoked';
  connector.revoked_at = new Date(ctx.now ?? Date.now()).toISOString();
  connector.oauth_ref = null;
  connector.oauth_pending = null;
  connector.sync_cursor = null;
  saveConnector(ctx.dataDir, ctx.vaultId, connector);
  return { ok: true, status: 200, payload: { revoked: true } };
}

/**
 * Deterministic fake client. Fixtures may provide functions or static values.
 */
export function createFakeGoogleDriveClient(fixtures = {}) {
  const call = async (name, args, fallback) => typeof fixtures[name] === 'function'
    ? fixtures[name](args)
    : fixtures[name] ?? fallback;
  return {
    fetch: async (input) => {
      if (typeof fixtures.fetch === 'function') return fixtures.fetch(input);
      if (input.url.includes('/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => fixtures.tokenResponse ?? {
            access_token: 'drive_access_test',
            refresh_token: 'drive_refresh_test',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: GOOGLE_DRIVE_OAUTH_SCOPES.join(' '),
          },
        };
      }
      if (input.url.includes('userinfo')) {
        return { ok: true, status: 200, json: async () => fixtures.userinfo ?? { sub: 'drive-sub-test' } };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
    filesList: (args) => call('filesList', args, { files: fixtures.files ?? [], nextPageToken: fixtures.nextPageToken }),
    filesGet: (args) => call(
      'filesGet',
      args,
      (fixtures.files ?? []).find((row) => row.id === args.fileId) ?? { status: 404 },
    ),
    filesExport: (args) => call('filesExport', args, fixtures.contents?.[args.fileId] ?? ''),
    filesDownload: (args) => call('filesDownload', args, fixtures.contents?.[args.fileId] ?? ''),
    changesGetStartPageToken: (args) => call('changesGetStartPageToken', args, { startPageToken: 'start-page-token' }),
    changesList: (args) => call('changesList', args, { changes: [], newStartPageToken: 'next-page-token' }),
  };
}

export function createProductionGoogleDriveClient() {
  const fetchImpl = globalThis.fetch.bind(globalThis);
  const authHeaders = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/json' });
  async function jsonRequest(url, accessToken) {
    const response = await fetchImpl(url, { headers: authHeaders(accessToken) });
    const body = await response.json();
    const retryAfter = Number.parseFloat(response.headers.get('retry-after') ?? '');
    return {
      ...body,
      status: response.status,
      ...(Number.isFinite(retryAfter) ? { retryAfterMs: retryAfter * 1000 } : {}),
    };
  }
  async function bytesRequest(url, accessToken) {
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error('Drive content request failed');
    return Buffer.from(await response.arrayBuffer());
  }
  return {
    fetch: async (input) => {
      const response = await fetchImpl(input.url, {
        method: input.method ?? 'GET',
        headers: input.headers,
        ...(input.body !== undefined ? { body: input.body } : {}),
      });
      return {
        ok: response.ok,
        status: response.status,
        json: () => response.json(),
        headers: { get: (name) => response.headers.get(name) },
      };
    },
    filesList: async ({ accessToken, pageToken, q }) => {
      const url = new URL(`${DRIVE_API}/files`);
      url.searchParams.set('pageSize', String(DOCS_LIST_PAGE_SIZE));
      url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,modifiedTime,size)');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      if (q) url.searchParams.set('q', q);
      return jsonRequest(url, accessToken);
    },
    filesGet: async ({ accessToken, fileId }) => {
      const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`);
      url.searchParams.set('fields', 'id,name,mimeType,modifiedTime,size');
      return jsonRequest(url, accessToken);
    },
    filesExport: async ({ accessToken, fileId, mimeType }) => {
      const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(fileId)}/export`);
      url.searchParams.set('mimeType', mimeType);
      return bytesRequest(url, accessToken);
    },
    filesDownload: async ({ accessToken, fileId }) => {
      const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`);
      url.searchParams.set('alt', 'media');
      return bytesRequest(url, accessToken);
    },
    changesGetStartPageToken: ({ accessToken }) => jsonRequest(
      new URL(`${DRIVE_API}/changes/startPageToken`),
      accessToken,
    ),
    changesList: async ({ accessToken, pageToken }) => {
      const url = new URL(`${DRIVE_API}/changes`);
      url.searchParams.set('pageToken', pageToken);
      url.searchParams.set('pageSize', String(DOCS_LIST_PAGE_SIZE));
      url.searchParams.set('fields', 'nextPageToken,newStartPageToken,changes(file(id,name,mimeType,modifiedTime,size),removed)');
      return jsonRequest(url, accessToken);
    },
  };
}

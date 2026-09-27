import {
  buildRefreshRequest,
  validateTokenResponse,
} from '../../lib/companion-oauth-pkce.mjs';
import { runCompanionOAuthFlow } from '../../lib/companion-oauth-flow.mjs';
import { buildSessionMeta, createTokenCustody } from '../../lib/companion-token-custody.mjs';

export const COMPANION_HUB_ORIGIN = 'https://mcp.knowtation.store';
export const COMPANION_NATIVE_ISSUER = `${COMPANION_HUB_ORIGIN}/api/v1/auth/native`;
export const COMPANION_DISCOVERY_URL = `${COMPANION_NATIVE_ISSUER}/.well-known/oauth-authorization-server`;
export const COMPANION_SESSION_URL = `${COMPANION_HUB_ORIGIN}/api/v1/auth/session`;
export const COMPANION_SCOPES = Object.freeze(['vault:read', 'vault:write']);

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_JSON_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

function fixedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function readJson(response, failureCode) {
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) throw fixedError(failureCode);
  try {
    const json = JSON.parse(text);
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('invalid');
    return json;
  } catch {
    throw fixedError(failureCode);
  }
}

function requestSignal(timeoutMs = REQUEST_TIMEOUT_MS) {
  return AbortSignal.timeout(timeoutMs);
}

function boundedFetch(fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS) {
  return (input, options = {}) => fetchImpl(input, {
    ...options,
    redirect: 'error',
    signal: options.signal ?? requestSignal(timeoutMs),
  });
}

function requireExactEndpoint(value, expected) {
  if (value !== expected) throw fixedError('companion_discovery_invalid');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw fixedError('companion_discovery_invalid');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw fixedError('companion_discovery_invalid');
  }
  return value;
}

export async function discoverCompanionOAuth({
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw fixedError('companion_network_unavailable');
  let response;
  try {
    response = await fetchImpl(COMPANION_DISCOVERY_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: requestSignal(timeoutMs),
    });
  } catch {
    throw fixedError('companion_discovery_unavailable');
  }
  if (!response.ok) throw fixedError('companion_discovery_unavailable');
  const metadata = await readJson(response, 'companion_discovery_invalid');
  requireExactEndpoint(metadata.issuer, COMPANION_NATIVE_ISSUER);
  return Object.freeze({
    issuer: metadata.issuer,
    authorizationEndpoint: requireExactEndpoint(
      metadata.authorization_endpoint,
      `${COMPANION_NATIVE_ISSUER}/authorize`
    ),
    tokenEndpoint: requireExactEndpoint(metadata.token_endpoint, `${COMPANION_NATIVE_ISSUER}/token`),
    registrationEndpoint: requireExactEndpoint(
      metadata.registration_endpoint,
      `${COMPANION_NATIVE_ISSUER}/register`
    ),
    revocationEndpoint: requireExactEndpoint(
      metadata.revocation_endpoint,
      `${COMPANION_NATIVE_ISSUER}/revoke`
    ),
  });
}

export async function signInCompanion({
  keychain,
  fetchImpl = globalThis.fetch,
  openBrowser,
  now = () => Date.now(),
} = {}) {
  const previous = await createTokenCustody(keychain).loadSession();
  if (previous) {
    const signOut = await signOutCompanion({ keychain, fetchImpl });
    if (signOut.remoteRevoked === false) throw fixedError('companion_sign_out_required');
  }
  const oauth = await discoverCompanionOAuth({ fetchImpl });
  const fetchWithPolicy = boundedFetch(fetchImpl);
  return runCompanionOAuthFlow({
    authorizationEndpoint: oauth.authorizationEndpoint,
    tokenEndpoint: oauth.tokenEndpoint,
    registrationEndpoint: oauth.registrationEndpoint,
    expectedIssuer: oauth.issuer,
    scopes: [...COMPANION_SCOPES],
    keychain,
    fetch: fetchWithPolicy,
    openBrowser,
    now,
    refreshTtlMs: REFRESH_TTL_MS,
  });
}

export async function ensureHostedSession({
  keychain,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  const custody = createTokenCustody(keychain);
  const instant = now();
  const session = await custody.loadSession();
  if (!session || session.issuer !== COMPANION_NATIVE_ISSUER) {
    if (session) await custody.clearSession();
    throw fixedError('companion_sign_in_required');
  }

  const decision = await custody.decide({ now: instant });
  if (decision === 'valid') return session;
  if (
    decision !== 'refresh' ||
    !session.refreshToken ||
    !session.clientId
  ) {
    await custody.clearSession();
    throw fixedError('companion_sign_in_required');
  }

  const oauth = await discoverCompanionOAuth({ fetchImpl });
  const descriptor = buildRefreshRequest({
    tokenEndpoint: oauth.tokenEndpoint,
    clientId: session.clientId,
    refreshToken: session.refreshToken,
  });
  let response;
  try {
    response = await fetchImpl(descriptor.url, {
      method: descriptor.method,
      headers: descriptor.headers,
      body: descriptor.body,
      redirect: 'error',
      signal: requestSignal(),
    });
  } catch {
    throw fixedError('companion_refresh_unavailable');
  }
  const json = await readJson(response, 'companion_refresh_failed');
  const token = validateTokenResponse(json);
  if (!response.ok || !token.ok) {
    if (json.error === 'invalid_grant' || json.error === 'invalid_client') {
      await custody.clearSession();
      throw fixedError('companion_sign_in_required');
    }
    throw fixedError('companion_refresh_failed');
  }

  const normalized = {
    ...token,
    refreshToken: token.refreshToken ?? session.refreshToken,
    scope: token.scope ?? session.scope,
  };
  const meta = {
    ...buildSessionMeta(normalized, {
      now: instant,
      issuer: COMPANION_NATIVE_ISSUER,
      clientId: session.clientId,
    }),
    refreshExpiresAt: session.refreshExpiresAt,
  };
  await custody.updateAccessToken({
    accessToken: token.accessToken,
    refreshToken: token.refreshToken ?? undefined,
    meta,
  });
  return custody.loadSession();
}

export async function inspectCompanionSession({ keychain, now = () => Date.now() } = {}) {
  const custody = createTokenCustody(keychain);
  const session = await custody.loadSession();
  if (!session || session.issuer !== COMPANION_NATIVE_ISSUER) {
    return { session: 'absent' };
  }
  const state = await custody.decide({ now: now() });
  return {
    session: state,
    scopes: typeof session.scope === 'string' ? session.scope.split(/\s+/).filter(Boolean) : [],
  };
}

export async function verifyHostedSession({ keychain, fetchImpl = globalThis.fetch, now } = {}) {
  const session = await ensureHostedSession({ keychain, fetchImpl, now });
  let response;
  try {
    response = await fetchImpl(COMPANION_SESSION_URL, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${session.accessToken}` },
      redirect: 'error',
      signal: requestSignal(),
    });
  } catch {
    throw fixedError('companion_session_verification_unavailable');
  }
  if (!response.ok) throw fixedError('companion_session_verification_failed');
  const json = await readJson(response, 'companion_session_verification_failed');
  if (json.type !== 'session' || !Array.isArray(json.scopes)) {
    throw fixedError('companion_session_verification_failed');
  }
  return {
    authenticated: true,
    scopes: json.scopes.filter((scope) => typeof scope === 'string'),
  };
}

export async function signOutCompanion({ keychain, fetchImpl = globalThis.fetch } = {}) {
  const custody = createTokenCustody(keychain);
  const session = await custody.loadSession();
  let remoteRevoked = session?.refreshToken ? false : null;
  try {
    if (session?.refreshToken) {
      const oauth = await discoverCompanionOAuth({ fetchImpl });
      const body = new URLSearchParams({ token: session.refreshToken });
      if (session.clientId) body.set('client_id', session.clientId);
      const response = await fetchImpl(oauth.revocationEndpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        redirect: 'error',
        signal: requestSignal(),
      });
      remoteRevoked = response.ok;
    }
  } catch {
    remoteRevoked = false;
  } finally {
    await custody.clearSession();
  }
  return { signedOut: true, remoteRevoked };
}

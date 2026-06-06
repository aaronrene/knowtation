/**
 * Companion OAuth — native/public-client PKCE protocol CORE (pure, no I/O).
 *
 * Phase 3 of the Companion App build plan (feat/companion-app).
 * See docs/COMPANION-APP-PHASE-3-OAUTH-PKCE.md for the accepted design, the adversarial
 * threat model, the RFC citations, and the contract Phase 5 must honour to bind the loopback
 * redirect listener and perform the real network / OS-keychain I/O.
 *
 * WHAT THIS MODULE IS
 *   The companion app (a future tray helper) authenticates as a NATIVE / PUBLIC OAuth client
 *   using Authorization Code + PKCE (RFC 7636) with a loopback redirect (RFC 8252) and NO
 *   client secret on the device. This module is the PROTOCOL CORE for that flow: it generates
 *   the PKCE pair, the CSRF `state`, and the `nonce`; builds the authorization URL and the
 *   token-endpoint request *descriptor*; and validates the redirect URI, the authorization
 *   response, and the token response. It decides, from a clock, whether an access token is
 *   still valid, should be refreshed, or requires full re-authentication.
 *
 * WHAT THIS MODULE IS NOT (deferred to Phase 5 — the shared bind gate)
 *   - It binds NO socket (no loopback redirect listener).            → Phase 5
 *   - It performs NO network I/O (no TLS POST to the token endpoint). → Phase 5 sends the
 *     descriptor returned by buildTokenRequest().
 *   - It opens NO system browser.                                    → Phase 5
 *   - It performs NO real OS-keychain I/O.                           → lib/companion-token-custody.mjs
 *     defines the custody logic against an INJECTED adapter; Phase 5 supplies the real adapter.
 *
 * DESIGN CONSTRAINTS (read before modifying — these are security invariants, not style):
 *   - PURE. No I/O, no process.env reads, no network, no logging, no clock reads. Every input
 *     (including `now`) is passed explicitly so the core is deterministic and exhaustively
 *     testable, and composable at any layer without environment coupling.
 *   - CSPRNG ONLY. All entropy comes from node:crypto randomBytes; never Math.random.
 *   - S256 ONLY (RFC 7636 §4.2). The 'plain' challenge method is REJECTED everywhere — a
 *     downgrade to 'plain' defeats PKCE against an attacker who can read the authorization
 *     request, so it is never built and never accepted.
 *   - CONSTANT-TIME compares for `state` and `iss` (timing-oracle resistance).
 *   - FAIL-CLOSED. Anything missing, malformed, ambiguous, or unrecognised → DENY. Validators
 *     return a discriminated { ok:false, reason } whose `reason` is a fixed constant.
 *   - NEVER LEAK A SECRET. A token / JWT / refresh token / authorization code / code_verifier /
 *     `state` value is NEVER copied into a `reason`, a value intended for logging, or a thrown
 *     error. The authorization code and code_verifier appear ONLY in the legitimate return
 *     channels (validateAuthorizationResponse().code, buildTokenRequest()).
 *
 * PROVIDER-AGNOSTIC (Phase 3 scope decision, owner-approved 2026-06-05)
 *   This module hardcodes NO authorization server, NO client_id, and NO scope set. The
 *   authorization/token endpoints, the client_id, and the scope list are all INJECTED inputs.
 *   Phase 3 therefore registers no OAuth client and alters no scopes (honouring the gate's
 *   "DOES NOT approve: Any change to OAuth client registration or scopes"). Whether the
 *   native/loopback client is issued web-session-equivalent scopes, and whether the PKCE
 *   provider runs on the hosted deployment, is a SEPARATE server-side OAuth gate (a Phase 5
 *   prerequisite) — see the Phase 3 design doc.
 *
 * Hard constraint from docs/COMPANION-APP-MODEL-ROUTING-AND-ENRICHMENT-ARCHITECTURE.md §3/§5:
 *   OAuth itself is unchanged; the companion is a public client with PKCE + loopback redirect,
 *   no device secret, JWT stored in the OS keychain (custody module). The cloud never proxies
 *   local inference; this module only governs the companion's identity acquisition.
 */

import crypto from 'node:crypto';

/**
 * Fixed reason codes. These are the ONLY strings the validators ever return as a `reason`.
 * None is derived from request/response input, so no secret or attacker-controlled value can
 * leak through the reason channel.
 * @readonly
 */
export const OAUTH_PKCE_REASONS = Object.freeze({
  OK: 'ok',
  MALFORMED_INPUT: 'malformed_input',
  AUTHORIZATION_SERVER_ERROR: 'authorization_server_error',
  STATE_MISSING: 'state_missing',
  STATE_MISMATCH: 'state_mismatch',
  ISSUER_MISMATCH: 'issuer_mismatch',
  MISSING_CODE: 'missing_code',
  INVALID_REDIRECT_URI: 'invalid_redirect_uri',
  UNSUPPORTED_PKCE_METHOD: 'unsupported_pkce_method',
  INVALID_TOKEN_RESPONSE: 'invalid_token_response',
});

/** The one and only PKCE challenge method this client supports (RFC 7636 §4.2). */
export const PKCE_METHOD_S256 = 'S256';

/** RFC 7636 §4.1 code_verifier length bounds (characters). */
export const CODE_VERIFIER_MIN_LEN = 43;
export const CODE_VERIFIER_MAX_LEN = 128;

/** Bytes of CSPRNG entropy for the code_verifier: 32 bytes → 43 base64url chars (≥ 256-bit). */
const VERIFIER_ENTROPY_BYTES = 32;
/** Bytes of CSPRNG entropy for `state` and `nonce` (128-bit min; we use 256-bit). */
const STATE_ENTROPY_BYTES = 32;
const NONCE_ENTROPY_BYTES = 32;

/**
 * RFC 7636 §4.1 unreserved code_verifier alphabet: ALPHA / DIGIT / "-" / "." / "_" / "~".
 * base64url output (A–Z a–z 0–9 - _) is a strict subset, so a base64url(randomBytes) verifier
 * is always valid; this regex is the validation gate for verifiers received from elsewhere.
 */
const CODE_VERIFIER_CHARSET = /^[A-Za-z0-9\-._~]+$/;

/**
 * RFC 6749 §4.1.2.1 authorization error codes. Only these fixed codes may be surfaced to the
 * caller as `errorCode`; an authorization server's free-text `error_description` is NEVER
 * surfaced (it is attacker-influenceable and could carry injected content).
 * @type {ReadonlySet<string>}
 */
const OAUTH_ERROR_CODES = new Set([
  'invalid_request',
  'unauthorized_client',
  'access_denied',
  'unsupported_response_type',
  'invalid_scope',
  'server_error',
  'temporarily_unavailable',
]);

/** Hard ceiling on any single token-response field length (defense against oversized payloads). */
const MAX_TOKEN_FIELD_LEN = 8192;
/** Hard ceiling on a JWT/token we will accept (generous; real Knowtation JWTs are < 2 KB). */
const MAX_ACCESS_TOKEN_LEN = 8192;

/**
 * Constant-time equality for two short ASCII strings (e.g. `state`, `iss`).
 *
 * Both inputs are hashed to a fixed 32-byte SHA-256 digest before comparison, so:
 *   - timingSafeEqual always receives equal-length buffers (a raw length mismatch would itself
 *     be an early-exit oracle),
 *   - the comparison time is independent of the position of the first differing byte, and
 *   - different-length inputs simply yield different digests (no length leak via timing).
 *
 * Non-string or empty inputs return false WITHOUT comparing — absence is not a content oracle.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length === 0 || b.length === 0) return false;
  const da = crypto.createHash('sha256').update(a, 'utf8').digest();
  const db = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(da, db);
}

/**
 * Compute the S256 PKCE code_challenge for a given code_verifier (RFC 7636 §4.2):
 *   code_challenge = BASE64URL-ENCODE(SHA-256(ASCII(code_verifier)))
 *
 * S256 ONLY: there is no `method` parameter and no 'plain' path. The verifier is validated
 * against RFC 7636 §4.1 (length + unreserved charset) before hashing; an invalid verifier
 * throws a fixed-message error that never contains the verifier.
 *
 * @param {string} codeVerifier
 * @returns {string} base64url(SHA-256(codeVerifier))
 * @throws {TypeError} on a structurally invalid verifier (message carries NO secret)
 */
export function computeCodeChallenge(codeVerifier) {
  if (
    typeof codeVerifier !== 'string' ||
    codeVerifier.length < CODE_VERIFIER_MIN_LEN ||
    codeVerifier.length > CODE_VERIFIER_MAX_LEN ||
    !CODE_VERIFIER_CHARSET.test(codeVerifier)
  ) {
    throw new TypeError('computeCodeChallenge: code_verifier is not a valid RFC 7636 §4.1 verifier');
  }
  return crypto.createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
}

/**
 * Create a fresh PKCE pair (RFC 7636). The verifier is 32 CSPRNG bytes base64url-encoded
 * (43 chars, ≥ 256-bit), the challenge is its S256 transform.
 *
 * The returned codeVerifier is a SECRET (it must be sent only to the token endpoint over TLS,
 * and never logged); the codeChallenge is public (it travels in the authorization URL).
 *
 * @returns {{ codeVerifier: string, codeChallenge: string, method: 'S256' }}
 */
export function createPkcePair() {
  const codeVerifier = crypto.randomBytes(VERIFIER_ENTROPY_BYTES).toString('base64url');
  const codeChallenge = computeCodeChallenge(codeVerifier);
  return { codeVerifier, codeChallenge, method: PKCE_METHOD_S256 };
}

/**
 * Create a high-entropy CSRF `state` value (RFC 6749 §10.12). 32 CSPRNG bytes, base64url.
 * `state` is single-use: bind it to the pending request and discard it after one callback.
 * @returns {string}
 */
export function createOAuthState() {
  return crypto.randomBytes(STATE_ENTROPY_BYTES).toString('base64url');
}

/**
 * Create a high-entropy OpenID Connect `nonce` (replay binding for an id_token, if used).
 * 32 CSPRNG bytes, base64url.
 * @returns {string}
 */
export function createNonce() {
  return crypto.randomBytes(NONCE_ENTROPY_BYTES).toString('base64url');
}

/**
 * Validate a redirect URI against RFC 8252 (OAuth 2.0 for Native Apps) loopback rules.
 *
 * Accepts ONLY:
 *   - scheme `http` (loopback redirects use plain http per RFC 8252 §7.3; the connection never
 *     leaves the device),
 *   - host that is a literal loopback IP — `127.0.0.1` or `[::1]` — (RFC 8252 §8.3 recommends
 *     literal IPs over the hostname `localhost`, whose resolution depends on local config);
 *     a caller may widen the allow-set via `allowedHosts` but it is matched as an exact literal
 *     list, never a wildcard or suffix,
 *   - an explicit, numeric, in-range port (the ephemeral loopback port; RFC 8252 §7.3 requires
 *     the AUTH SERVER to permit a variable port for loopback — this validator simply requires a
 *     concrete port and never a wildcard),
 *   - no userinfo, no query, no fragment (an exact-match redirect target, no smuggling).
 *
 * FAIL-CLOSED: anything else returns { ok:false, reason }. The reason never contains the URI.
 *
 * @param {string} uri
 * @param {{ allowedHosts?: string[] }} [opts]
 *   allowedHosts: exact loopback hostnames permitted. Default ['127.0.0.1','::1'].
 * @returns {{ ok: true, host: string, port: number, pathname: string } | { ok: false, reason: string }}
 */
export function validateRedirectUri(uri, opts = {}) {
  const allowed = Array.isArray(opts.allowedHosts) && opts.allowedHosts.length > 0
    ? opts.allowedHosts.map((h) => String(h).toLowerCase())
    : ['127.0.0.1', '::1'];
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > MAX_TOKEN_FIELD_LEN) {
    return { ok: false, reason: OAUTH_PKCE_REASONS.INVALID_REDIRECT_URI };
  }
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    return { ok: false, reason: OAUTH_PKCE_REASONS.INVALID_REDIRECT_URI };
  }
  // Plain http only, and only to a loopback literal — never https-to-loopback ambiguity, never
  // a custom scheme. (RFC 8252 also defines a private-use-scheme flow; the companion uses the
  // loopback flow exclusively, so any non-http scheme is rejected here.)
  if (parsed.protocol !== 'http:') {
    return { ok: false, reason: OAUTH_PKCE_REASONS.INVALID_REDIRECT_URI };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: OAUTH_PKCE_REASONS.INVALID_REDIRECT_URI };
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    return { ok: false, reason: OAUTH_PKCE_REASONS.INVALID_REDIRECT_URI };
  }
  // URL normalises an IPv6 host to bracketed form; strip brackets for the allowlist compare.
  const rawHost = parsed.hostname.toLowerCase();
  const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
  if (!allowed.includes(host)) {
    return { ok: false, reason: OAUTH_PKCE_REASONS.INVALID_REDIRECT_URI };
  }
  // A concrete numeric in-range port is mandatory (no default-port ambiguity for an ephemeral
  // loopback listener; the absence of an explicit port would make the redirect non-exact).
  if (parsed.port === '' || !/^[0-9]+$/.test(parsed.port)) {
    return { ok: false, reason: OAUTH_PKCE_REASONS.INVALID_REDIRECT_URI };
  }
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, reason: OAUTH_PKCE_REASONS.INVALID_REDIRECT_URI };
  }
  return { ok: true, host, port, pathname: parsed.pathname };
}

/**
 * Validate a scope list: a non-empty array of non-empty, space-free strings.
 * @param {unknown} scopes
 * @returns {string[] | null} the cleaned list, or null if invalid
 */
function validateScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) return null;
  const out = [];
  for (const s of scopes) {
    if (typeof s !== 'string' || s.length === 0 || /\s/.test(s)) return null;
    out.push(s);
  }
  return out;
}

/**
 * Build the authorization-request URL (RFC 6749 §4.1.1 + RFC 7636 §4.3) for the system browser.
 *
 * The URL is pure data — Phase 5 hands it to the OS browser; nothing here opens it. The result
 * ALWAYS carries `response_type=code`, `code_challenge_method=S256`, the exact (validated)
 * loopback `redirect_uri`, the injected `client_id`, the space-joined injected `scope`, and the
 * CSRF `state`. It NEVER carries a client secret. If `nonce` is provided it is included.
 *
 * S256 ONLY: `codeChallengeMethod` defaults to 'S256' and anything else is rejected (no downgrade
 * to 'plain').
 *
 * @param {{
 *   authorizationEndpoint: string,
 *   clientId: string,
 *   redirectUri: string,
 *   scopes: string[],
 *   state: string,
 *   codeChallenge: string,
 *   codeChallengeMethod?: 'S256',
 *   nonce?: string,
 *   allowedRedirectHosts?: string[],
 *   extraParams?: Record<string, string>,
 * }} params
 * @returns {string} the absolute authorization URL
 * @throws {TypeError} on invalid configuration (message carries NO secret)
 */
export function buildAuthorizationUrl(params) {
  const {
    authorizationEndpoint,
    clientId,
    redirectUri,
    scopes,
    state,
    codeChallenge,
    codeChallengeMethod = PKCE_METHOD_S256,
    nonce,
    allowedRedirectHosts,
    extraParams,
  } = params ?? {};

  if (codeChallengeMethod !== PKCE_METHOD_S256) {
    // Refuse to ever construct a 'plain' (or unknown) PKCE request.
    throw new TypeError('buildAuthorizationUrl: only S256 PKCE is supported');
  }
  if (typeof authorizationEndpoint !== 'string' || authorizationEndpoint.length === 0) {
    throw new TypeError('buildAuthorizationUrl: authorizationEndpoint is required');
  }
  let endpoint;
  try {
    endpoint = new URL(authorizationEndpoint);
  } catch {
    throw new TypeError('buildAuthorizationUrl: authorizationEndpoint is not a valid URL');
  }
  if (endpoint.protocol !== 'https:') {
    // The authorization endpoint must be HTTPS (the request leaves the device). Loopback http
    // is only for the *redirect*, never the authorization server.
    throw new TypeError('buildAuthorizationUrl: authorizationEndpoint must be https');
  }
  if (typeof clientId !== 'string' || clientId.length === 0) {
    throw new TypeError('buildAuthorizationUrl: clientId is required');
  }
  const cleanScopes = validateScopes(scopes);
  if (!cleanScopes) {
    throw new TypeError('buildAuthorizationUrl: scopes must be a non-empty array of tokens');
  }
  if (typeof state !== 'string' || state.length === 0) {
    throw new TypeError('buildAuthorizationUrl: state is required');
  }
  if (typeof codeChallenge !== 'string' || codeChallenge.length === 0) {
    throw new TypeError('buildAuthorizationUrl: codeChallenge is required');
  }
  const redirect = validateRedirectUri(redirectUri, { allowedHosts: allowedRedirectHosts });
  if (!redirect.ok) {
    throw new TypeError('buildAuthorizationUrl: redirectUri is not a valid RFC 8252 loopback URI');
  }

  // Build query deterministically. URLSearchParams handles percent-encoding.
  const q = new URLSearchParams();
  q.set('response_type', 'code');
  q.set('client_id', clientId);
  q.set('redirect_uri', redirectUri);
  q.set('scope', cleanScopes.join(' '));
  q.set('state', state);
  q.set('code_challenge', codeChallenge);
  q.set('code_challenge_method', PKCE_METHOD_S256);
  if (typeof nonce === 'string' && nonce.length > 0) q.set('nonce', nonce);
  if (extraParams && typeof extraParams === 'object') {
    for (const [k, v] of Object.entries(extraParams)) {
      // Never let an injected extra param override a security-critical parameter.
      const key = String(k);
      if (
        key === 'response_type' || key === 'client_id' || key === 'redirect_uri' ||
        key === 'scope' || key === 'state' || key === 'code_challenge' ||
        key === 'code_challenge_method' || key === 'client_secret'
      ) {
        continue;
      }
      if (typeof v === 'string') q.set(key, v);
    }
  }
  endpoint.search = q.toString();
  return endpoint.toString();
}

/**
 * Validate the authorization RESPONSE delivered to the loopback redirect (RFC 6749 §4.1.2,
 * RFC 9207 issuer identification). FAIL-CLOSED.
 *
 * Order of checks (each must pass):
 *   1. structural: params is an object;
 *   2. error: if the server returned `error`, surface a fixed reason plus the RFC 6749 error
 *      CODE only when it is a known code (never the free-text error_description);
 *   3. state: expectedState present, params.state present, constant-time match (CSRF / fixation);
 *   4. issuer (RFC 9207): if `expectedIssuer` is given AND params.iss is present, require a
 *      constant-time match (mix-up defense). If expectedIssuer is given but iss is absent, this
 *      is TOLERATED for back-compat (documented server-side follow-up to emit `iss`); a PRESENT
 *      but mismatched iss is always rejected;
 *   5. code: a non-empty `code` must be present; it is returned only in the success channel.
 *
 * The authorization code and the state value are NEVER placed in a `reason` or thrown error.
 *
 * @param {{
 *   params: Record<string, unknown>,
 *   expectedState: string,
 *   expectedIssuer?: string,
 * }} args
 * @returns {{ ok: true, code: string } | { ok: false, reason: string, errorCode?: string }}
 */
export function validateAuthorizationResponse(args) {
  try {
    const { params, expectedState, expectedIssuer } = args ?? {};
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return { ok: false, reason: OAUTH_PKCE_REASONS.MALFORMED_INPUT };
    }

    // 2. Authorization-server error response.
    const errRaw = params.error;
    if (typeof errRaw === 'string' && errRaw.length > 0) {
      const errorCode = OAUTH_ERROR_CODES.has(errRaw) ? errRaw : undefined;
      return errorCode
        ? { ok: false, reason: OAUTH_PKCE_REASONS.AUTHORIZATION_SERVER_ERROR, errorCode }
        : { ok: false, reason: OAUTH_PKCE_REASONS.AUTHORIZATION_SERVER_ERROR };
    }

    // 3. CSRF state — constant-time compare, fail-closed on absence.
    if (typeof expectedState !== 'string' || expectedState.length === 0) {
      return { ok: false, reason: OAUTH_PKCE_REASONS.STATE_MISSING };
    }
    const gotState = params.state;
    if (typeof gotState !== 'string' || gotState.length === 0) {
      return { ok: false, reason: OAUTH_PKCE_REASONS.STATE_MISSING };
    }
    if (!constantTimeEqual(gotState, expectedState)) {
      return { ok: false, reason: OAUTH_PKCE_REASONS.STATE_MISMATCH };
    }

    // 4. RFC 9207 issuer — optional-but-validated.
    if (typeof expectedIssuer === 'string' && expectedIssuer.length > 0) {
      const gotIss = params.iss;
      if (typeof gotIss === 'string' && gotIss.length > 0) {
        if (!constantTimeEqual(gotIss, expectedIssuer)) {
          return { ok: false, reason: OAUTH_PKCE_REASONS.ISSUER_MISMATCH };
        }
      }
      // iss absent → tolerated (back-compat); documented server-side follow-up.
    }

    // 5. Authorization code.
    const code = params.code;
    if (typeof code !== 'string' || code.length === 0 || code.length > MAX_TOKEN_FIELD_LEN) {
      return { ok: false, reason: OAUTH_PKCE_REASONS.MISSING_CODE };
    }

    return { ok: true, code };
  } catch {
    // Defense in depth: never let an unexpected error escape with input data attached.
    return { ok: false, reason: OAUTH_PKCE_REASONS.MALFORMED_INPUT };
  }
}

/**
 * Build the token-endpoint REQUEST descriptor (RFC 6749 §4.1.3 + RFC 7636 §4.5). PURE — it
 * performs NO fetch; Phase 5 sends this descriptor over TLS.
 *
 * The body carries grant_type=authorization_code, the `code`, the `code_verifier` (this is what
 * proves PKCE possession and binds the code to this client), the exact `redirect_uri`, and the
 * public-client `client_id`. It NEVER carries a client_secret.
 *
 * @param {{
 *   tokenEndpoint: string,
 *   clientId: string,
 *   code: string,
 *   codeVerifier: string,
 *   redirectUri: string,
 *   allowedRedirectHosts?: string[],
 * }} params
 * @returns {{ url: string, method: 'POST', headers: Record<string,string>, body: string, bodyParams: Record<string,string> }}
 * @throws {TypeError} on invalid configuration (message carries NO secret)
 */
export function buildTokenRequest(params) {
  const { tokenEndpoint, clientId, code, codeVerifier, redirectUri, allowedRedirectHosts } = params ?? {};

  if (typeof tokenEndpoint !== 'string' || tokenEndpoint.length === 0) {
    throw new TypeError('buildTokenRequest: tokenEndpoint is required');
  }
  let endpoint;
  try {
    endpoint = new URL(tokenEndpoint);
  } catch {
    throw new TypeError('buildTokenRequest: tokenEndpoint is not a valid URL');
  }
  if (endpoint.protocol !== 'https:') {
    throw new TypeError('buildTokenRequest: tokenEndpoint must be https');
  }
  if (typeof clientId !== 'string' || clientId.length === 0) {
    throw new TypeError('buildTokenRequest: clientId is required');
  }
  if (typeof code !== 'string' || code.length === 0 || code.length > MAX_TOKEN_FIELD_LEN) {
    throw new TypeError('buildTokenRequest: code is required');
  }
  if (
    typeof codeVerifier !== 'string' ||
    codeVerifier.length < CODE_VERIFIER_MIN_LEN ||
    codeVerifier.length > CODE_VERIFIER_MAX_LEN ||
    !CODE_VERIFIER_CHARSET.test(codeVerifier)
  ) {
    throw new TypeError('buildTokenRequest: code_verifier is not a valid RFC 7636 verifier');
  }
  const redirect = validateRedirectUri(redirectUri, { allowedHosts: allowedRedirectHosts });
  if (!redirect.ok) {
    throw new TypeError('buildTokenRequest: redirectUri is not a valid RFC 8252 loopback URI');
  }

  const bodyParams = {
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
    client_id: clientId,
  };
  const body = new URLSearchParams(bodyParams).toString();

  return {
    url: endpoint.toString(),
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
    bodyParams,
  };
}

/**
 * Build the token-endpoint REQUEST descriptor for a refresh-token grant (RFC 6749 §6). PURE.
 * Public client → no client_secret. `scope`, if provided, must be a subset of the original grant.
 *
 * @param {{
 *   tokenEndpoint: string,
 *   clientId: string,
 *   refreshToken: string,
 *   scopes?: string[],
 * }} params
 * @returns {{ url: string, method: 'POST', headers: Record<string,string>, body: string, bodyParams: Record<string,string> }}
 * @throws {TypeError} on invalid configuration (message carries NO secret)
 */
export function buildRefreshRequest(params) {
  const { tokenEndpoint, clientId, refreshToken, scopes } = params ?? {};
  if (typeof tokenEndpoint !== 'string' || tokenEndpoint.length === 0) {
    throw new TypeError('buildRefreshRequest: tokenEndpoint is required');
  }
  let endpoint;
  try {
    endpoint = new URL(tokenEndpoint);
  } catch {
    throw new TypeError('buildRefreshRequest: tokenEndpoint is not a valid URL');
  }
  if (endpoint.protocol !== 'https:') {
    throw new TypeError('buildRefreshRequest: tokenEndpoint must be https');
  }
  if (typeof clientId !== 'string' || clientId.length === 0) {
    throw new TypeError('buildRefreshRequest: clientId is required');
  }
  if (typeof refreshToken !== 'string' || refreshToken.length === 0 || refreshToken.length > MAX_TOKEN_FIELD_LEN) {
    throw new TypeError('buildRefreshRequest: refreshToken is required');
  }
  const bodyParams = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  };
  if (scopes !== undefined) {
    const cleanScopes = validateScopes(scopes);
    if (!cleanScopes) throw new TypeError('buildRefreshRequest: scopes must be a non-empty array of tokens');
    bodyParams.scope = cleanScopes.join(' ');
  }
  const body = new URLSearchParams(bodyParams).toString();
  return {
    url: endpoint.toString(),
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
    bodyParams,
  };
}

/**
 * Validate a parsed token-endpoint RESPONSE (RFC 6749 §5.1 / §5.2). FAIL-CLOSED.
 *
 * Requires: token_type === 'bearer' (case-insensitive), a non-empty access_token within length
 * bounds, and a positive-integer expires_in (the companion needs an expiry to drive refresh;
 * the Knowtation provider always emits it). refresh_token is optional but, when present, must be
 * a non-empty bounded string. An `error` response, a missing/blank field, a wrong token_type, or
 * an oversized field all fail closed. The reason never carries any token value.
 *
 * @param {unknown} json - the already-parsed JSON object from the token endpoint
 * @returns {
 *   { ok: true, accessToken: string, refreshToken: string | null, expiresIn: number, tokenType: 'Bearer', scope: string | null }
 *   | { ok: false, reason: string, errorCode?: string }
 * }
 */
export function validateTokenResponse(json) {
  try {
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return { ok: false, reason: OAUTH_PKCE_REASONS.INVALID_TOKEN_RESPONSE };
    }
    const obj = /** @type {Record<string, unknown>} */ (json);

    // Error response (RFC 6749 §5.2).
    if (typeof obj.error === 'string' && obj.error.length > 0) {
      const errorCode = OAUTH_ERROR_CODES.has(obj.error) || obj.error === 'invalid_grant' || obj.error === 'invalid_client'
        ? obj.error
        : undefined;
      return errorCode
        ? { ok: false, reason: OAUTH_PKCE_REASONS.INVALID_TOKEN_RESPONSE, errorCode }
        : { ok: false, reason: OAUTH_PKCE_REASONS.INVALID_TOKEN_RESPONSE };
    }

    const tokenType = obj.token_type;
    if (typeof tokenType !== 'string' || tokenType.toLowerCase() !== 'bearer') {
      return { ok: false, reason: OAUTH_PKCE_REASONS.INVALID_TOKEN_RESPONSE };
    }

    const accessToken = obj.access_token;
    if (
      typeof accessToken !== 'string' ||
      accessToken.length === 0 ||
      accessToken.length > MAX_ACCESS_TOKEN_LEN
    ) {
      return { ok: false, reason: OAUTH_PKCE_REASONS.INVALID_TOKEN_RESPONSE };
    }

    const expiresIn = obj.expires_in;
    if (typeof expiresIn !== 'number' || !Number.isInteger(expiresIn) || expiresIn <= 0) {
      return { ok: false, reason: OAUTH_PKCE_REASONS.INVALID_TOKEN_RESPONSE };
    }

    let refreshToken = null;
    if (obj.refresh_token !== undefined) {
      if (
        typeof obj.refresh_token !== 'string' ||
        obj.refresh_token.length === 0 ||
        obj.refresh_token.length > MAX_TOKEN_FIELD_LEN
      ) {
        return { ok: false, reason: OAUTH_PKCE_REASONS.INVALID_TOKEN_RESPONSE };
      }
      refreshToken = obj.refresh_token;
    }

    let scope = null;
    if (obj.scope !== undefined) {
      if (typeof obj.scope !== 'string' || obj.scope.length > MAX_TOKEN_FIELD_LEN) {
        return { ok: false, reason: OAUTH_PKCE_REASONS.INVALID_TOKEN_RESPONSE };
      }
      scope = obj.scope;
    }

    return { ok: true, accessToken, refreshToken, expiresIn, tokenType: 'Bearer', scope };
  } catch {
    return { ok: false, reason: OAUTH_PKCE_REASONS.INVALID_TOKEN_RESPONSE };
  }
}

/**
 * Decide what to do with a stored access token given the current clock. PURE.
 *
 *   - 'valid'   — the access token is still good (now + skew < expiresAt).
 *   - 'refresh' — the access token is at/past its skew-adjusted expiry but a refresh is still
 *                 viable (no refreshExpiresAt given, or now < refreshExpiresAt).
 *   - 'reauth'  — full re-authentication is required (refresh window elapsed, or inputs are
 *                 missing/malformed → fail-closed to the safest outcome: force a fresh login).
 *
 * Times are epoch-ms numbers; `now` is injected (never read from the clock here).
 *
 * @param {{ expiresAt: number, now: number, skewMs?: number, refreshExpiresAt?: number }} params
 * @returns {'valid' | 'refresh' | 'reauth'}
 */
export function decideTokenRefresh(params) {
  const { expiresAt, now, skewMs = 30_000, refreshExpiresAt } = params ?? {};
  // Fail-closed: anything we cannot reason about forces re-auth (never falsely "valid").
  if (typeof now !== 'number' || !Number.isFinite(now)) return 'reauth';
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return 'reauth';
  const skew = typeof skewMs === 'number' && Number.isFinite(skewMs) && skewMs >= 0 ? skewMs : 30_000;

  if (now + skew < expiresAt) return 'valid';

  // Access token expired (within skew). Is a refresh still in its window?
  if (typeof refreshExpiresAt === 'number' && Number.isFinite(refreshExpiresAt)) {
    return now < refreshExpiresAt ? 'refresh' : 'reauth';
  }
  // No explicit refresh ceiling supplied → attempt refresh (the endpoint is the source of truth).
  return 'refresh';
}

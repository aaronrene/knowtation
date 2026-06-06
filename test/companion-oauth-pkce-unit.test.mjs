/**
 * Tier 1 — UNIT: each pure function of the Phase 3 OAuth/PKCE core in isolation.
 *
 * Reference: docs/COMPANION-APP-PHASE-3-OAUTH-PKCE.md; RFC 7636 (PKCE, S256), RFC 8252 (native
 * apps / loopback redirect), RFC 9207 (iss). The RFC 7636 Appendix B vector is asserted directly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OAUTH_PKCE_REASONS,
  PKCE_METHOD_S256,
  CODE_VERIFIER_MIN_LEN,
  CODE_VERIFIER_MAX_LEN,
  constantTimeEqual,
  computeCodeChallenge,
  createPkcePair,
  createOAuthState,
  createNonce,
  validateRedirectUri,
  buildAuthorizationUrl,
  validateAuthorizationResponse,
  buildTokenRequest,
  buildRefreshRequest,
  validateTokenResponse,
  decideTokenRefresh,
} from '../lib/companion-oauth-pkce.mjs';

const AUTH_EP = 'https://knowtation.store/authorize';
const TOKEN_EP = 'https://knowtation.store/token';
const CLIENT_ID = 'companion-public-client';
const REDIRECT = 'http://127.0.0.1:49321/callback';
const SCOPES = ['vault:read', 'vault:write'];

// RFC 7636 Appendix B canonical test vector.
const RFC7636_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC7636_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('computeCodeChallenge — RFC 7636 §4.2 S256', () => {
  it('matches the RFC 7636 Appendix B test vector', () => {
    assert.equal(computeCodeChallenge(RFC7636_VERIFIER), RFC7636_CHALLENGE);
  });
  it('is deterministic', () => {
    assert.equal(computeCodeChallenge(RFC7636_VERIFIER), computeCodeChallenge(RFC7636_VERIFIER));
  });
  it('throws (no secret in message) on a too-short verifier', () => {
    assert.throws(() => computeCodeChallenge('short'), /valid RFC 7636/);
  });
  it('throws on a verifier with a disallowed character', () => {
    const bad = 'a'.repeat(42) + ' '; // space is not in the unreserved set
    assert.throws(() => computeCodeChallenge(bad));
  });
});

describe('createPkcePair', () => {
  it('returns a verifier within RFC 7636 length bounds and method S256', () => {
    const { codeVerifier, codeChallenge, method } = createPkcePair();
    assert.equal(method, PKCE_METHOD_S256);
    assert.ok(codeVerifier.length >= CODE_VERIFIER_MIN_LEN && codeVerifier.length <= CODE_VERIFIER_MAX_LEN);
    assert.match(codeVerifier, /^[A-Za-z0-9\-._~]+$/);
    assert.equal(codeChallenge, computeCodeChallenge(codeVerifier));
  });
  it('produces a unique pair each call', () => {
    const a = createPkcePair();
    const b = createPkcePair();
    assert.notEqual(a.codeVerifier, b.codeVerifier);
    assert.notEqual(a.codeChallenge, b.codeChallenge);
  });
});

describe('createOAuthState / createNonce', () => {
  it('return base64url high-entropy values', () => {
    for (const fn of [createOAuthState, createNonce]) {
      const v = fn();
      assert.match(v, /^[A-Za-z0-9\-_]+$/);
      assert.ok(v.length >= 43, 'at least 256-bit base64url');
    }
  });
  it('are unique per call', () => {
    assert.notEqual(createOAuthState(), createOAuthState());
    assert.notEqual(createNonce(), createNonce());
  });
});

describe('validateRedirectUri — RFC 8252 loopback rules', () => {
  it('accepts an http loopback URI with an explicit port', () => {
    const r = validateRedirectUri(REDIRECT);
    assert.equal(r.ok, true);
    assert.equal(r.host, '127.0.0.1');
    assert.equal(r.port, 49321);
    assert.equal(r.pathname, '/callback');
  });
  it('accepts IPv6 loopback [::1]', () => {
    const r = validateRedirectUri('http://[::1]:51000/callback');
    assert.equal(r.ok, true);
    assert.equal(r.host, '::1');
  });
  it('rejects https-to-loopback (loopback redirect is plain http)', () => {
    assert.equal(validateRedirectUri('https://127.0.0.1:49321/callback').ok, false);
  });
  it('rejects a non-loopback host', () => {
    assert.equal(validateRedirectUri('http://192.168.0.5:49321/callback').ok, false);
    assert.equal(validateRedirectUri('http://evil.example:49321/callback').ok, false);
  });
  it('rejects localhost by default (resolution depends on local config)', () => {
    assert.equal(validateRedirectUri('http://localhost:49321/callback').ok, false);
  });
  it('rejects a missing port (non-exact redirect)', () => {
    assert.equal(validateRedirectUri('http://127.0.0.1/callback').ok, false);
  });
  it('rejects userinfo, query, and fragment', () => {
    assert.equal(validateRedirectUri('http://user:pw@127.0.0.1:49321/callback').ok, false);
    assert.equal(validateRedirectUri('http://127.0.0.1:49321/callback?x=1').ok, false);
    assert.equal(validateRedirectUri('http://127.0.0.1:49321/callback#frag').ok, false);
  });
  it('honors a caller-supplied allowedHosts list', () => {
    assert.equal(validateRedirectUri('http://localhost:49321/callback', { allowedHosts: ['localhost'] }).ok, true);
  });
  it('returns a fixed reason that never contains the URI', () => {
    const r = validateRedirectUri('http://evil.example:1/x');
    assert.equal(r.reason, OAUTH_PKCE_REASONS.INVALID_REDIRECT_URI);
  });
});

describe('buildAuthorizationUrl', () => {
  const base = {
    authorizationEndpoint: AUTH_EP,
    clientId: CLIENT_ID,
    redirectUri: REDIRECT,
    scopes: SCOPES,
    state: 'state-abc',
    codeChallenge: RFC7636_CHALLENGE,
  };
  it('builds an RFC 6749 §4.1.1 + RFC 7636 §4.3 authorization request', () => {
    const url = new URL(buildAuthorizationUrl(base));
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
    assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
    assert.equal(url.searchParams.get('scope'), 'vault:read vault:write');
    assert.equal(url.searchParams.get('state'), 'state-abc');
    assert.equal(url.searchParams.get('code_challenge'), RFC7636_CHALLENGE);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  });
  it('includes a nonce when provided', () => {
    const url = new URL(buildAuthorizationUrl({ ...base, nonce: 'n-1' }));
    assert.equal(url.searchParams.get('nonce'), 'n-1');
  });
  it('throws on a non-S256 method (no plain downgrade)', () => {
    assert.throws(() => buildAuthorizationUrl({ ...base, codeChallengeMethod: 'plain' }), /S256/);
  });
  it('throws when the authorization endpoint is not https', () => {
    assert.throws(() => buildAuthorizationUrl({ ...base, authorizationEndpoint: 'http://knowtation.store/authorize' }), /https/);
  });
  it('throws on an invalid loopback redirect', () => {
    assert.throws(() => buildAuthorizationUrl({ ...base, redirectUri: 'https://evil.example/cb' }), /RFC 8252/);
  });
  it('cannot be made to inject a client_secret via extraParams', () => {
    const url = new URL(buildAuthorizationUrl({ ...base, extraParams: { client_secret: 'leak', prompt: 'consent' } }));
    assert.equal(url.searchParams.get('client_secret'), null);
    assert.equal(url.searchParams.get('prompt'), 'consent');
  });
});

describe('validateAuthorizationResponse', () => {
  it('accepts a matching state and extracts the code', () => {
    const r = validateAuthorizationResponse({ params: { code: 'authcode', state: 's' }, expectedState: 's' });
    assert.equal(r.ok, true);
    assert.equal(r.code, 'authcode');
  });
  it('rejects a state mismatch with a fixed reason', () => {
    const r = validateAuthorizationResponse({ params: { code: 'c', state: 'x' }, expectedState: 's' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, OAUTH_PKCE_REASONS.STATE_MISMATCH);
  });
  it('rejects a missing code', () => {
    const r = validateAuthorizationResponse({ params: { state: 's' }, expectedState: 's' });
    assert.equal(r.reason, OAUTH_PKCE_REASONS.MISSING_CODE);
  });
  it('surfaces a known authorization-server error code without free text', () => {
    const r = validateAuthorizationResponse({ params: { error: 'access_denied', error_description: 'user said no <script>' }, expectedState: 's' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, OAUTH_PKCE_REASONS.AUTHORIZATION_SERVER_ERROR);
    assert.equal(r.errorCode, 'access_denied');
  });
  it('does not surface an unknown/forged error code', () => {
    const r = validateAuthorizationResponse({ params: { error: '<script>alert(1)</script>' }, expectedState: 's' });
    assert.equal(r.reason, OAUTH_PKCE_REASONS.AUTHORIZATION_SERVER_ERROR);
    assert.equal(r.errorCode, undefined);
  });
  it('validates iss when expectedIssuer + iss both present (RFC 9207)', () => {
    const ok = validateAuthorizationResponse({ params: { code: 'c', state: 's', iss: 'https://knowtation.store' }, expectedState: 's', expectedIssuer: 'https://knowtation.store' });
    assert.equal(ok.ok, true);
    const bad = validateAuthorizationResponse({ params: { code: 'c', state: 's', iss: 'https://evil.example' }, expectedState: 's', expectedIssuer: 'https://knowtation.store' });
    assert.equal(bad.reason, OAUTH_PKCE_REASONS.ISSUER_MISMATCH);
  });
  it('tolerates a missing iss for back-compat when expectedIssuer is set', () => {
    const r = validateAuthorizationResponse({ params: { code: 'c', state: 's' }, expectedState: 's', expectedIssuer: 'https://knowtation.store' });
    assert.equal(r.ok, true);
  });
});

describe('buildTokenRequest', () => {
  it('builds an authorization_code grant carrying the code_verifier (PKCE binding) and no secret', () => {
    const req = buildTokenRequest({ tokenEndpoint: TOKEN_EP, clientId: CLIENT_ID, code: 'authcode', codeVerifier: RFC7636_VERIFIER, redirectUri: REDIRECT });
    assert.equal(req.method, 'POST');
    assert.equal(req.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(req.bodyParams.grant_type, 'authorization_code');
    assert.equal(req.bodyParams.code, 'authcode');
    assert.equal(req.bodyParams.code_verifier, RFC7636_VERIFIER);
    assert.equal(req.bodyParams.redirect_uri, REDIRECT);
    assert.equal(req.bodyParams.client_id, CLIENT_ID);
    assert.equal(req.bodyParams.client_secret, undefined);
    assert.ok(!req.body.includes('client_secret'));
  });
  it('throws on a non-https token endpoint', () => {
    assert.throws(() => buildTokenRequest({ tokenEndpoint: 'http://x/token', clientId: CLIENT_ID, code: 'c', codeVerifier: RFC7636_VERIFIER, redirectUri: REDIRECT }), /https/);
  });
  it('throws on a malformed verifier', () => {
    assert.throws(() => buildTokenRequest({ tokenEndpoint: TOKEN_EP, clientId: CLIENT_ID, code: 'c', codeVerifier: 'tooshort', redirectUri: REDIRECT }), /verifier/);
  });
});

describe('buildRefreshRequest', () => {
  it('builds a refresh_token grant with no client_secret', () => {
    const req = buildRefreshRequest({ tokenEndpoint: TOKEN_EP, clientId: CLIENT_ID, refreshToken: 'r-1' });
    assert.equal(req.bodyParams.grant_type, 'refresh_token');
    assert.equal(req.bodyParams.refresh_token, 'r-1');
    assert.equal(req.bodyParams.client_id, CLIENT_ID);
    assert.equal(req.bodyParams.client_secret, undefined);
  });
  it('includes scope when provided', () => {
    const req = buildRefreshRequest({ tokenEndpoint: TOKEN_EP, clientId: CLIENT_ID, refreshToken: 'r-1', scopes: ['vault:read'] });
    assert.equal(req.bodyParams.scope, 'vault:read');
  });
});

describe('validateTokenResponse — RFC 6749 §5.1/§5.2', () => {
  it('accepts a well-formed bearer response', () => {
    const r = validateTokenResponse({ access_token: 'jwt', token_type: 'Bearer', expires_in: 3600, refresh_token: 'r', scope: 'vault:read vault:write' });
    assert.equal(r.ok, true);
    assert.equal(r.accessToken, 'jwt');
    assert.equal(r.refreshToken, 'r');
    assert.equal(r.expiresIn, 3600);
    assert.equal(r.tokenType, 'Bearer');
    assert.equal(r.scope, 'vault:read vault:write');
  });
  it('accepts a response without a refresh token', () => {
    const r = validateTokenResponse({ access_token: 'jwt', token_type: 'bearer', expires_in: 60 });
    assert.equal(r.ok, true);
    assert.equal(r.refreshToken, null);
  });
  it('rejects a wrong token_type', () => {
    assert.equal(validateTokenResponse({ access_token: 'jwt', token_type: 'mac', expires_in: 60 }).ok, false);
  });
  it('rejects a missing/zero/negative expires_in', () => {
    assert.equal(validateTokenResponse({ access_token: 'jwt', token_type: 'Bearer' }).ok, false);
    assert.equal(validateTokenResponse({ access_token: 'jwt', token_type: 'Bearer', expires_in: 0 }).ok, false);
    assert.equal(validateTokenResponse({ access_token: 'jwt', token_type: 'Bearer', expires_in: -1 }).ok, false);
  });
  it('surfaces invalid_grant as an errorCode', () => {
    const r = validateTokenResponse({ error: 'invalid_grant' });
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, 'invalid_grant');
  });
});

describe('decideTokenRefresh', () => {
  it("returns 'valid' well before expiry", () => {
    assert.equal(decideTokenRefresh({ expiresAt: 100_000, now: 0, skewMs: 1000 }), 'valid');
  });
  it("returns 'refresh' inside the skew window", () => {
    assert.equal(decideTokenRefresh({ expiresAt: 1000, now: 990, skewMs: 30 }), 'refresh');
  });
  it("returns 'refresh' past expiry when a refresh window remains", () => {
    assert.equal(decideTokenRefresh({ expiresAt: 1000, now: 2000, refreshExpiresAt: 10_000 }), 'refresh');
  });
  it("returns 'reauth' once the refresh window has elapsed", () => {
    assert.equal(decideTokenRefresh({ expiresAt: 1000, now: 20_000, refreshExpiresAt: 10_000 }), 'reauth');
  });
  it("fails closed to 'reauth' on malformed input", () => {
    assert.equal(decideTokenRefresh({ expiresAt: NaN, now: 0 }), 'reauth');
    assert.equal(decideTokenRefresh({ expiresAt: 1000, now: 'x' }), 'reauth');
    assert.equal(decideTokenRefresh(undefined), 'reauth');
  });
});

describe('constantTimeEqual', () => {
  it('is correct as a primitive', () => {
    assert.equal(constantTimeEqual('abc', 'abc'), true);
    assert.equal(constantTimeEqual('abc', 'abd'), false);
    assert.equal(constantTimeEqual('', 'abc'), false);
    assert.equal(constantTimeEqual('abc', 'abcd'), false);
    assert.equal(constantTimeEqual(undefined, 'abc'), false);
  });
});

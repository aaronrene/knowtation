/**
 * Tier 2 — INTEGRATION: the pure functions composed across the real OAuth/PKCE sequence
 * (no I/O): pair → authorization URL → parse callback params → validate response → token request
 * → validate token response → refresh decision. Asserts the pieces fit and the state/PKCE bindings
 * survive a round-trip through a URL.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createPkcePair,
  createOAuthState,
  buildAuthorizationUrl,
  validateAuthorizationResponse,
  buildTokenRequest,
  validateTokenResponse,
  decideTokenRefresh,
} from '../lib/companion-oauth-pkce.mjs';

const AUTH_EP = 'https://knowtation.store/authorize';
const TOKEN_EP = 'https://knowtation.store/token';
const ISSUER = 'https://knowtation.store';
const CLIENT_ID = 'companion-public-client';
const REDIRECT = 'http://127.0.0.1:49321/callback';
const SCOPES = ['vault:read', 'vault:write'];

describe('Integration — authorization request round-trips through a URL', () => {
  it('the challenge, state, and redirect survive serialization into the auth URL', () => {
    const { codeChallenge } = createPkcePair();
    const state = createOAuthState();
    const url = new URL(buildAuthorizationUrl({
      authorizationEndpoint: AUTH_EP, clientId: CLIENT_ID, redirectUri: REDIRECT,
      scopes: SCOPES, state, codeChallenge,
    }));
    assert.equal(url.searchParams.get('code_challenge'), codeChallenge);
    assert.equal(url.searchParams.get('state'), state);
    assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
  });
});

describe('Integration — callback validation feeds the token request', () => {
  it('a matching-state callback yields a code that buildTokenRequest consumes with the verifier', () => {
    const { codeVerifier, codeChallenge } = createPkcePair();
    const state = createOAuthState();
    // The auth server (simulated) verifies S256(verifier) === challenge and returns a code.
    assert.equal(crypto.createHash('sha256').update(codeVerifier, 'ascii').digest('base64url'), codeChallenge);
    const callbackParams = { code: 'srv-issued-code', state, iss: ISSUER };

    const resp = validateAuthorizationResponse({ params: callbackParams, expectedState: state, expectedIssuer: ISSUER });
    assert.equal(resp.ok, true);

    const tokenReq = buildTokenRequest({
      tokenEndpoint: TOKEN_EP, clientId: CLIENT_ID, code: resp.code, codeVerifier, redirectUri: REDIRECT,
    });
    assert.equal(tokenReq.bodyParams.code, 'srv-issued-code');
    assert.equal(tokenReq.bodyParams.code_verifier, codeVerifier);
  });
});

describe('Integration — token response drives the refresh decision', () => {
  it('a validated token response gives an expiry the refresh decision can act on', () => {
    const tr = validateTokenResponse({ access_token: 'jwt', token_type: 'Bearer', expires_in: 3600, refresh_token: 'r' });
    assert.equal(tr.ok, true);
    const now = 1_000_000;
    const expiresAt = now + tr.expiresIn * 1000;
    assert.equal(decideTokenRefresh({ expiresAt, now, skewMs: 30_000 }), 'valid');
    assert.equal(decideTokenRefresh({ expiresAt, now: expiresAt - 10, skewMs: 30_000 }), 'refresh');
    assert.equal(decideTokenRefresh({ expiresAt, now: expiresAt + 1, refreshExpiresAt: expiresAt + 100 }), 'refresh');
    assert.equal(decideTokenRefresh({ expiresAt, now: expiresAt + 1000, refreshExpiresAt: expiresAt + 100 }), 'reauth');
  });
});

describe('Integration — a denied authorization aborts before any token request', () => {
  it('an access_denied callback never produces a code', () => {
    const state = createOAuthState();
    const resp = validateAuthorizationResponse({ params: { error: 'access_denied', state }, expectedState: state });
    assert.equal(resp.ok, false);
    assert.equal(resp.errorCode, 'access_denied');
    assert.equal(resp.code, undefined);
  });
});

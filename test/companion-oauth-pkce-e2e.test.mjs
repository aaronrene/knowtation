/**
 * Tier 3 — END-TO-END: drive the full client sequence against a simulated authorization server
 * and token endpoint (pure, in-process — NO real sockets/network, which are Phase 5). This proves
 * the client core interoperates with a server that enforces PKCE S256, state echo, and RFC 9207
 * iss, including the success path and representative failure paths.
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
} from '../lib/companion-oauth-pkce.mjs';

const AUTH_EP = 'https://knowtation.store/authorize';
const TOKEN_EP = 'https://knowtation.store/token';
const ISSUER = 'https://knowtation.store';
const CLIENT_ID = 'companion-public-client';
const REDIRECT = 'http://127.0.0.1:49321/callback';
const SCOPES = ['vault:read', 'vault:write'];

/**
 * A minimal simulated authorization server: it parses the authorization URL, stores the pending
 * challenge by state, and on the token request verifies S256(code_verifier) === stored challenge
 * (this is exactly what a correct PKCE server does — mirroring the MCP SDK token handler).
 */
function makeSimulatedServer() {
  const pending = new Map(); // state -> { challenge, method, redirectUri }
  const codes = new Map(); // code -> { state, challenge }
  return {
    authorize(authUrl, { approve = true } = {}) {
      const u = new URL(authUrl);
      assert.equal(u.searchParams.get('response_type'), 'code');
      assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
      const state = u.searchParams.get('state');
      const challenge = u.searchParams.get('code_challenge');
      const redirectUri = u.searchParams.get('redirect_uri');
      pending.set(state, { challenge, redirectUri });
      if (!approve) {
        return { code: undefined, error: 'access_denied', state, iss: ISSUER };
      }
      const code = 'code-' + crypto.randomBytes(8).toString('hex');
      codes.set(code, { state, challenge });
      return { code, state, iss: ISSUER };
    },
    token(bodyParams) {
      // Public client: never require/accept a client_secret.
      assert.equal(bodyParams.client_secret, undefined);
      const rec = codes.get(bodyParams.code);
      if (!rec) return { error: 'invalid_grant' };
      codes.delete(bodyParams.code); // single-use code
      const verifierChallenge = crypto.createHash('sha256').update(bodyParams.code_verifier, 'ascii').digest('base64url');
      if (verifierChallenge !== rec.challenge) return { error: 'invalid_grant' }; // PKCE mismatch
      if (bodyParams.redirect_uri !== REDIRECT) return { error: 'invalid_grant' };
      return {
        access_token: crypto.randomBytes(24).toString('base64url'),
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: crypto.randomBytes(24).toString('base64url'),
        scope: SCOPES.join(' '),
      };
    },
  };
}

describe('E2E — happy path: sign-in → code → token', () => {
  it('completes a full PKCE + loopback authorization-code exchange', () => {
    const server = makeSimulatedServer();
    const { codeVerifier, codeChallenge } = createPkcePair();
    const state = createOAuthState();

    const authUrl = buildAuthorizationUrl({
      authorizationEndpoint: AUTH_EP, clientId: CLIENT_ID, redirectUri: REDIRECT,
      scopes: SCOPES, state, codeChallenge,
    });

    const callback = server.authorize(authUrl);
    const resp = validateAuthorizationResponse({ params: callback, expectedState: state, expectedIssuer: ISSUER });
    assert.equal(resp.ok, true);

    const req = buildTokenRequest({ tokenEndpoint: TOKEN_EP, clientId: CLIENT_ID, code: resp.code, codeVerifier, redirectUri: REDIRECT });
    const tokenJson = server.token(req.bodyParams);
    const tr = validateTokenResponse(tokenJson);

    assert.equal(tr.ok, true);
    assert.ok(tr.accessToken.length > 0);
    assert.ok(tr.refreshToken.length > 0);
    assert.equal(tr.expiresIn, 3600);
  });
});

describe('E2E — PKCE interception attack fails at the token endpoint', () => {
  it('an attacker who stole the code but lacks the verifier cannot exchange it', () => {
    const server = makeSimulatedServer();
    const { codeChallenge } = createPkcePair();
    const state = createOAuthState();
    const authUrl = buildAuthorizationUrl({
      authorizationEndpoint: AUTH_EP, clientId: CLIENT_ID, redirectUri: REDIRECT,
      scopes: SCOPES, state, codeChallenge,
    });
    const callback = server.authorize(authUrl);
    const resp = validateAuthorizationResponse({ params: callback, expectedState: state });
    assert.equal(resp.ok, true);

    // Attacker presents the stolen code with their OWN (wrong) verifier.
    const attackerVerifier = createPkcePair().codeVerifier;
    const req = buildTokenRequest({ tokenEndpoint: TOKEN_EP, clientId: CLIENT_ID, code: resp.code, codeVerifier: attackerVerifier, redirectUri: REDIRECT });
    const tokenJson = server.token(req.bodyParams);
    const tr = validateTokenResponse(tokenJson);
    assert.equal(tr.ok, false);
    assert.equal(tr.errorCode, 'invalid_grant');
  });
});

describe('E2E — user denies consent', () => {
  it('an access_denied callback aborts before any token exchange', () => {
    const server = makeSimulatedServer();
    const { codeChallenge } = createPkcePair();
    const state = createOAuthState();
    const authUrl = buildAuthorizationUrl({
      authorizationEndpoint: AUTH_EP, clientId: CLIENT_ID, redirectUri: REDIRECT,
      scopes: SCOPES, state, codeChallenge,
    });
    const callback = server.authorize(authUrl, { approve: false });
    const resp = validateAuthorizationResponse({ params: callback, expectedState: state });
    assert.equal(resp.ok, false);
    assert.equal(resp.errorCode, 'access_denied');
  });
});

describe('E2E — single-use code: replaying the same code fails', () => {
  it('a second exchange of an already-used code is rejected', () => {
    const server = makeSimulatedServer();
    const { codeVerifier, codeChallenge } = createPkcePair();
    const state = createOAuthState();
    const authUrl = buildAuthorizationUrl({
      authorizationEndpoint: AUTH_EP, clientId: CLIENT_ID, redirectUri: REDIRECT,
      scopes: SCOPES, state, codeChallenge,
    });
    const callback = server.authorize(authUrl);
    const resp = validateAuthorizationResponse({ params: callback, expectedState: state });
    const req = buildTokenRequest({ tokenEndpoint: TOKEN_EP, clientId: CLIENT_ID, code: resp.code, codeVerifier, redirectUri: REDIRECT });

    assert.equal(validateTokenResponse(server.token(req.bodyParams)).ok, true);
    // Replay the identical exchange.
    assert.equal(validateTokenResponse(server.token(req.bodyParams)).ok, false);
  });
});

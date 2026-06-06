/**
 * Tier 5 — DATA INTEGRITY: determinism, purity, and non-mutation of inputs. The protocol core
 * must be a pure function of its arguments (no env, no clock, no hidden state) so its behavior is
 * reproducible and auditable.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCodeChallenge,
  buildAuthorizationUrl,
  buildTokenRequest,
  validateAuthorizationResponse,
  validateTokenResponse,
  decideTokenRefresh,
  createPkcePair,
} from '../lib/companion-oauth-pkce.mjs';

const AUTH_EP = 'https://knowtation.store/authorize';
const TOKEN_EP = 'https://knowtation.store/token';
const CLIENT_ID = 'companion-public-client';
const REDIRECT = 'http://127.0.0.1:49321/callback';
const SCOPES = ['vault:read', 'vault:write'];

describe('Data integrity — determinism', () => {
  it('computeCodeChallenge is a pure function of the verifier', () => {
    const v = createPkcePair().codeVerifier;
    const a = computeCodeChallenge(v);
    for (let i = 0; i < 1000; i++) assert.equal(computeCodeChallenge(v), a);
  });
  it('buildAuthorizationUrl is deterministic given identical inputs', () => {
    const args = { authorizationEndpoint: AUTH_EP, clientId: CLIENT_ID, redirectUri: REDIRECT, scopes: SCOPES, state: 's', codeChallenge: 'c' };
    assert.equal(buildAuthorizationUrl(args), buildAuthorizationUrl(args));
  });
  it('decideTokenRefresh is deterministic', () => {
    const args = { expiresAt: 5000, now: 4000, skewMs: 500 };
    const first = decideTokenRefresh(args);
    for (let i = 0; i < 100; i++) assert.equal(decideTokenRefresh(args), first);
  });
});

describe('Data integrity — inputs are never mutated', () => {
  it('buildAuthorizationUrl does not mutate the params object or the scopes array', () => {
    const scopes = [...SCOPES];
    const params = { authorizationEndpoint: AUTH_EP, clientId: CLIENT_ID, redirectUri: REDIRECT, scopes, state: 's', codeChallenge: 'c', extraParams: { prompt: 'consent' } };
    const snapshot = JSON.stringify(params);
    buildAuthorizationUrl(params);
    assert.equal(JSON.stringify(params), snapshot);
    assert.deepEqual(scopes, SCOPES);
  });
  it('buildTokenRequest does not mutate its params', () => {
    const verifier = createPkcePair().codeVerifier;
    const params = { tokenEndpoint: TOKEN_EP, clientId: CLIENT_ID, code: 'c', codeVerifier: verifier, redirectUri: REDIRECT };
    const snapshot = JSON.stringify(params);
    buildTokenRequest(params);
    assert.equal(JSON.stringify(params), snapshot);
  });
  it('validateAuthorizationResponse does not mutate the params it inspects', () => {
    const params = { code: 'c', state: 's', iss: 'https://knowtation.store' };
    const snapshot = JSON.stringify(params);
    validateAuthorizationResponse({ params, expectedState: 's', expectedIssuer: 'https://knowtation.store' });
    assert.equal(JSON.stringify(params), snapshot);
  });
  it('validateTokenResponse does not mutate its input', () => {
    const json = { access_token: 'jwt', token_type: 'Bearer', expires_in: 60, refresh_token: 'r' };
    const snapshot = JSON.stringify(json);
    validateTokenResponse(json);
    assert.equal(JSON.stringify(json), snapshot);
  });
});

describe('Data integrity — environment independence', () => {
  it('behavior does not depend on process.env', () => {
    const v = createPkcePair().codeVerifier;
    const before = computeCodeChallenge(v);
    process.env.KNOWTATION_PKCE_TEST_FLAG = 'tampered';
    const after = computeCodeChallenge(v);
    delete process.env.KNOWTATION_PKCE_TEST_FLAG;
    assert.equal(before, after);
  });
});

describe('Data integrity — verdict shapes are stable', () => {
  it('a success verdict has exactly { ok, code }', () => {
    const r = validateAuthorizationResponse({ params: { code: 'c', state: 's' }, expectedState: 's' });
    assert.deepEqual(Object.keys(r).sort(), ['code', 'ok']);
  });
  it('a token success verdict has the documented fields', () => {
    const r = validateTokenResponse({ access_token: 'jwt', token_type: 'Bearer', expires_in: 60 });
    assert.deepEqual(Object.keys(r).sort(), ['accessToken', 'expiresIn', 'ok', 'refreshToken', 'scope', 'tokenType']);
  });
});

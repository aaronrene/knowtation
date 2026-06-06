/**
 * Tier 6 — PERFORMANCE: the protocol core is on the interactive sign-in / refresh path, so each
 * operation must be cheap. These are coarse upper bounds chosen to catch a pathological regression
 * (e.g. an accidental O(n^2) or a synchronous blocking call), not micro-benchmarks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPkcePair,
  computeCodeChallenge,
  buildAuthorizationUrl,
  validateAuthorizationResponse,
  validateTokenResponse,
  decideTokenRefresh,
} from '../lib/companion-oauth-pkce.mjs';

const AUTH_EP = 'https://knowtation.store/authorize';
const CLIENT_ID = 'companion-public-client';
const REDIRECT = 'http://127.0.0.1:49321/callback';
const SCOPES = ['vault:read', 'vault:write'];

function timed(fn) {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe('Performance — bounds', () => {
  it('10k PKCE pairs in well under 3s', () => {
    const ms = timed(() => { for (let i = 0; i < 10_000; i++) createPkcePair(); });
    assert.ok(ms < 3000, `createPkcePair x10k took ${ms.toFixed(0)}ms`);
  });

  it('100k computeCodeChallenge in well under 3s', () => {
    const v = createPkcePair().codeVerifier;
    const ms = timed(() => { for (let i = 0; i < 100_000; i++) computeCodeChallenge(v); });
    assert.ok(ms < 3000, `computeCodeChallenge x100k took ${ms.toFixed(0)}ms`);
  });

  it('100k buildAuthorizationUrl in under 4s', () => {
    const args = { authorizationEndpoint: AUTH_EP, clientId: CLIENT_ID, redirectUri: REDIRECT, scopes: SCOPES, state: 's', codeChallenge: 'c' };
    const ms = timed(() => { for (let i = 0; i < 100_000; i++) buildAuthorizationUrl(args); });
    assert.ok(ms < 4000, `buildAuthorizationUrl x100k took ${ms.toFixed(0)}ms`);
  });

  it('200k validateAuthorizationResponse in under 4s', () => {
    const args = { params: { code: 'c', state: 's' }, expectedState: 's' };
    const ms = timed(() => { for (let i = 0; i < 200_000; i++) validateAuthorizationResponse(args); });
    assert.ok(ms < 4000, `validateAuthorizationResponse x200k took ${ms.toFixed(0)}ms`);
  });

  it('200k validateTokenResponse + decideTokenRefresh in under 3s', () => {
    const json = { access_token: 'jwt', token_type: 'Bearer', expires_in: 3600, refresh_token: 'r' };
    const ms = timed(() => {
      for (let i = 0; i < 200_000; i++) {
        validateTokenResponse(json);
        decideTokenRefresh({ expiresAt: 5000, now: i % 6000, skewMs: 100 });
      }
    });
    assert.ok(ms < 3000, `validate+decide x200k took ${ms.toFixed(0)}ms`);
  });
});

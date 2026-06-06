/**
 * Tier 7 — SECURITY (the centerpiece): adversarial properties of the Phase 3 OAuth/PKCE core.
 *
 * Each block maps to an attacker capability from the Phase 3 threat model and asserts the exact
 * control that stops it. A subtle deviation here is an account-compromise path, so these tests
 * are the proof the protocol core is correct BEFORE any socket/network/keychain I/O exists
 * (deferred to Phase 5).
 *
 * Mandatory coverage (Phase 3 prompt + gate §10 security tier):
 *   - code_challenge is the correct S256 of the verifier (RFC 7636 §4.1) + verifier entropy/length
 *   - 'plain' method is rejected (no downgrade)
 *   - state mismatch → reject (constant-time, no oracle)
 *   - an authorization-server error is surfaced without leaking
 *   - a non-loopback / wildcard / foreign redirect_uri is rejected (RFC 8252)
 *   - the authorization URL never contains a client secret and uses response_type=code + S256
 *   - the token request carries the code_verifier (PKCE binding) and no client secret
 *   - a malformed / oversized token response fails closed
 *   - replay (reused state) is rejected
 *   - NO secret (code, code_verifier, state, access/refresh token, JWT) appears in any output,
 *     reason, log, or thrown error
 *
 * Reference: RFC 7636 (PKCE), RFC 8252 (native apps), RFC 9207 (iss); design doc threat model.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  OAUTH_PKCE_REASONS,
  computeCodeChallenge,
  createPkcePair,
  createOAuthState,
  constantTimeEqual,
  validateRedirectUri,
  buildAuthorizationUrl,
  validateAuthorizationResponse,
  buildTokenRequest,
  validateTokenResponse,
} from '../lib/companion-oauth-pkce.mjs';

const AUTH_EP = 'https://knowtation.store/authorize';
const TOKEN_EP = 'https://knowtation.store/token';
const CLIENT_ID = 'companion-public-client';
const REDIRECT = 'http://127.0.0.1:49321/callback';
const SCOPES = ['vault:read', 'vault:write'];

// ── Attacker A — code interception on the loopback redirect (PKCE S256 binds code↔verifier) ──
describe('Security — PKCE S256 correctly binds the code to the verifier (RFC 7636 §4.1/§4.2)', () => {
  it('code_challenge is exactly base64url(SHA-256(verifier)) for fresh pairs', () => {
    for (let i = 0; i < 1000; i++) {
      const { codeVerifier, codeChallenge } = createPkcePair();
      const expected = crypto.createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
      assert.equal(codeChallenge, expected);
    }
  });
  it('the verifier has sufficient entropy/length (≥ 43 chars, unreserved charset)', () => {
    const seen = new Set();
    for (let i = 0; i < 5000; i++) {
      const { codeVerifier } = createPkcePair();
      assert.ok(codeVerifier.length >= 43, 'RFC 7636 §4.1 minimum length');
      assert.match(codeVerifier, /^[A-Za-z0-9\-._~]+$/);
      seen.add(codeVerifier);
    }
    assert.equal(seen.size, 5000, 'every verifier is unique (CSPRNG, no collisions)');
  });
  it('a wrong verifier does NOT reproduce the challenge (a stolen code is useless without it)', () => {
    const { codeVerifier, codeChallenge } = createPkcePair();
    const other = createPkcePair().codeVerifier;
    assert.notEqual(computeCodeChallenge(other), codeChallenge);
    assert.equal(computeCodeChallenge(codeVerifier), codeChallenge);
  });
});

// ── Attacker D — PKCE downgrade to 'plain' ────────────────────────────────────
describe("Security — 'plain' PKCE is rejected (no downgrade) (RFC 7636 §7.2)", () => {
  it('buildAuthorizationUrl refuses any method other than S256', () => {
    for (const method of ['plain', 'PLAIN', 'none', 's256', '']) {
      assert.throws(() => buildAuthorizationUrl({
        authorizationEndpoint: AUTH_EP, clientId: CLIENT_ID, redirectUri: REDIRECT,
        scopes: SCOPES, state: 's', codeChallenge: 'c', codeChallengeMethod: method,
      }), `method ${JSON.stringify(method)} must be rejected`);
    }
  });
  it('a built URL always advertises S256, never plain', () => {
    const url = new URL(buildAuthorizationUrl({
      authorizationEndpoint: AUTH_EP, clientId: CLIENT_ID, redirectUri: REDIRECT,
      scopes: SCOPES, state: 's', codeChallenge: 'c',
    }));
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  });
});

// ── Attacker B — CSRF / session-fixation on the callback (state, constant-time) ──
describe('Security — state defends CSRF/fixation; compare is constant-time (RFC 6749 §10.12)', () => {
  it('a forged/mismatched state is rejected', () => {
    const r = validateAuthorizationResponse({ params: { code: 'c', state: 'attacker' }, expectedState: createOAuthState() });
    assert.equal(r.reason, OAUTH_PKCE_REASONS.STATE_MISMATCH);
  });
  it('an absent state is rejected (fail-closed)', () => {
    const r = validateAuthorizationResponse({ params: { code: 'c' }, expectedState: 'legit' });
    assert.equal(r.reason, OAUTH_PKCE_REASONS.STATE_MISSING);
  });
  it('the state compare is constant-time (no early-exit position oracle)', () => {
    const state = 'S'.repeat(43);
    const early = '!' + state.slice(1);
    const late = state.slice(0, -1) + '!';
    const ITER = 150_000;
    for (let i = 0; i < 10_000; i++) { constantTimeEqual(early, state); constantTimeEqual(late, state); }
    const t0 = performance.now();
    for (let i = 0; i < ITER; i++) constantTimeEqual(early, state);
    const earlyT = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < ITER; i++) constantTimeEqual(late, state);
    const lateT = performance.now() - t1;
    const ratio = earlyT / lateT;
    assert.ok(ratio > 0.25 && ratio < 4, `timing ratio ${ratio.toFixed(3)} suggests non-constant-time compare`);
  });
});

// ── Attacker C — authorization-server / redirect mix-up (RFC 9207 iss) ────────
describe('Security — issuer mix-up defense (RFC 9207)', () => {
  it('a present-but-foreign iss is rejected even with a valid state', () => {
    const state = createOAuthState();
    const r = validateAuthorizationResponse({
      params: { code: 'c', state, iss: 'https://attacker.example' },
      expectedState: state, expectedIssuer: 'https://knowtation.store',
    });
    assert.equal(r.reason, OAUTH_PKCE_REASONS.ISSUER_MISMATCH);
  });
});

// ── Attacker E — open-redirect / redirect_uri manipulation (RFC 8252) ─────────
describe('Security — strict loopback redirect allowlist, no wildcard (RFC 8252 §7.3/§8.3)', () => {
  it('rejects foreign, LAN, https, wildcard, and schemeless redirect targets', () => {
    const bad = [
      'https://evil.example/cb',
      'http://evil.example:80/cb',
      'http://192.168.1.50:8080/cb',
      'http://127.0.0.1.evil.example:49321/cb',
      'http://0.0.0.0:49321/cb',
      'http://*.127.0.0.1:49321/cb',
      'https://127.0.0.1:49321/cb',
      'ftp://127.0.0.1:49321/cb',
      'javascript:alert(1)',
    ];
    for (const uri of bad) {
      assert.equal(validateRedirectUri(uri).ok, false, `${uri} must be rejected`);
    }
  });
  it('build* functions refuse to emit a request to a non-loopback redirect', () => {
    assert.throws(() => buildAuthorizationUrl({
      authorizationEndpoint: AUTH_EP, clientId: CLIENT_ID, redirectUri: 'https://evil.example/cb',
      scopes: SCOPES, state: 's', codeChallenge: 'c',
    }));
    assert.throws(() => buildTokenRequest({
      tokenEndpoint: TOKEN_EP, clientId: CLIENT_ID, code: 'c',
      codeVerifier: createPkcePair().codeVerifier, redirectUri: 'http://evil.example:1/cb',
    }));
  });
});

// ── Attacker G — client-secret extraction from the distributed binary ─────────
describe('Security — public client: NO client secret anywhere (RFC 8252 §8.5)', () => {
  it('the authorization URL never carries a client secret and uses response_type=code + S256', () => {
    const url = buildAuthorizationUrl({
      authorizationEndpoint: AUTH_EP, clientId: CLIENT_ID, redirectUri: REDIRECT,
      scopes: SCOPES, state: createOAuthState(), codeChallenge: createPkcePair().codeChallenge,
      extraParams: { client_secret: 'should-be-dropped' },
    });
    assert.ok(!/client_secret/i.test(url), 'no client_secret param in the authorization URL');
    const u = new URL(url);
    assert.equal(u.searchParams.get('response_type'), 'code');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  });
  it('the token request carries the code_verifier (PKCE proof) and no client secret', () => {
    const { codeVerifier } = createPkcePair();
    const req = buildTokenRequest({ tokenEndpoint: TOKEN_EP, clientId: CLIENT_ID, code: 'authcode', codeVerifier, redirectUri: REDIRECT });
    assert.equal(req.bodyParams.code_verifier, codeVerifier);
    assert.ok(!/client_secret/i.test(req.body));
    assert.equal(req.bodyParams.client_secret, undefined);
  });
});

// ── Attacker — authorization-server error response leakage ────────────────────
describe('Security — auth-server errors surface without leaking free text', () => {
  it('a known error code is surfaced; error_description is never echoed', () => {
    const r = validateAuthorizationResponse({
      params: { error: 'invalid_scope', error_description: 'leak <img src=x onerror=alert(1)>', state: 'x' },
      expectedState: 's',
    });
    assert.equal(r.reason, OAUTH_PKCE_REASONS.AUTHORIZATION_SERVER_ERROR);
    assert.equal(r.errorCode, 'invalid_scope');
    assert.ok(!JSON.stringify(r).includes('leak'));
    assert.ok(!JSON.stringify(r).includes('onerror'));
  });
});

// ── Attacker H — authorization-response replay (one-time state, single-use code) ──
describe('Security — replay of a reused state is rejected (single-use contract)', () => {
  it('once the caller has consumed (cleared) the expected state, a replayed callback fails closed', () => {
    const state = createOAuthState();
    const first = validateAuthorizationResponse({ params: { code: 'c1', state }, expectedState: state });
    assert.equal(first.ok, true);
    // Caller discards the one-time state after success → a replayed callback has no expectedState.
    const replay = validateAuthorizationResponse({ params: { code: 'c1', state }, expectedState: '' });
    assert.equal(replay.ok, false);
    assert.equal(replay.reason, OAUTH_PKCE_REASONS.STATE_MISSING);
  });
  it('a different (attacker) state never validates against the pending one', () => {
    const pending = createOAuthState();
    const attacker = createOAuthState();
    const r = validateAuthorizationResponse({ params: { code: 'c', state: attacker }, expectedState: pending });
    assert.equal(r.reason, OAUTH_PKCE_REASONS.STATE_MISMATCH);
  });
});

// ── Malformed / oversized token response fails closed ─────────────────────────
describe('Security — malformed/oversized token response fails closed', () => {
  it('rejects non-objects, arrays, and missing fields', () => {
    for (const bad of [null, undefined, 'str', 42, [], {}, { access_token: 'x' }, { token_type: 'Bearer' }]) {
      assert.equal(validateTokenResponse(bad).ok, false);
    }
  });
  it('rejects an oversized access token', () => {
    const huge = 'a'.repeat(9000);
    assert.equal(validateTokenResponse({ access_token: huge, token_type: 'Bearer', expires_in: 60 }).ok, false);
  });
  it('rejects an oversized refresh token', () => {
    assert.equal(validateTokenResponse({ access_token: 'jwt', token_type: 'Bearer', expires_in: 60, refresh_token: 'r'.repeat(9000) }).ok, false);
  });
});

// ── Attacker F — token theft at rest is out of scope for THIS module (custody owns it) ──
// (Covered by companion-token-custody-security.test.mjs: keychain-only, never plaintext/log.)

// ── No secret in any output / reason / thrown error ───────────────────────────
describe('Security — no secret in any output, reason, or thrown error', () => {
  const SECRET_CODE = 'AUTHCODE-' + 'C'.repeat(40);
  const SECRET_STATE = 'STATE-' + 'S'.repeat(40);

  it('a state-mismatch verdict never echoes either state value', () => {
    const r = validateAuthorizationResponse({ params: { code: SECRET_CODE, state: SECRET_STATE }, expectedState: 'expected-different' });
    const s = JSON.stringify(r);
    assert.ok(!s.includes(SECRET_STATE));
    assert.ok(!s.includes(SECRET_CODE));
    assert.ok(!s.includes('expected-different'));
  });

  it('the success channel returns the code (legitimate) but reasons never carry it', () => {
    const ok = validateAuthorizationResponse({ params: { code: SECRET_CODE, state: SECRET_STATE }, expectedState: SECRET_STATE });
    assert.equal(ok.code, SECRET_CODE); // legitimate return channel
    const deny = validateAuthorizationResponse({ params: { state: SECRET_STATE }, expectedState: SECRET_STATE });
    assert.ok(!JSON.stringify(deny).includes(SECRET_CODE));
  });

  it('thrown configuration errors never contain the verifier or code', () => {
    const verifier = createPkcePair().codeVerifier;
    try {
      buildTokenRequest({ tokenEndpoint: 'http://insecure/token', clientId: CLIENT_ID, code: SECRET_CODE, codeVerifier: verifier, redirectUri: REDIRECT });
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(!String(e.message).includes(verifier));
      assert.ok(!String(e.message).includes(SECRET_CODE));
    }
  });

  it('computeCodeChallenge throws without leaking the verifier', () => {
    const bad = 'short-but-secret-' + 'Z'.repeat(5);
    try {
      computeCodeChallenge(bad);
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(!String(e.message).includes(bad));
    }
  });

  it('every validator reason is a fixed constant (never attacker-controlled text)', () => {
    const reasons = new Set(Object.values(OAUTH_PKCE_REASONS));
    const probes = [
      validateAuthorizationResponse({ params: { error: '"; DROP TABLE x; --', state: 'x' }, expectedState: 's' }),
      validateAuthorizationResponse({ params: 'not-an-object', expectedState: 's' }),
      validateTokenResponse({ error: '<script>' }),
      validateRedirectUri('http://evil.example:1/x'),
    ];
    for (const p of probes) {
      assert.ok(reasons.has(p.reason), `reason ${p.reason} must be a fixed constant`);
    }
  });

  it('validators never throw on hostile input (fail-closed, no leak)', () => {
    const hostile = [undefined, null, {}, { params: 42 }, { params: { code: {} } }, 'x', 123];
    for (const h of hostile) {
      let r;
      assert.doesNotThrow(() => { r = validateAuthorizationResponse(h); });
      assert.equal(r.ok, false);
    }
  });
});

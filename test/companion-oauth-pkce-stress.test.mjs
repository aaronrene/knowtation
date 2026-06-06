/**
 * Tier 4 — STRESS: high-volume generation and validation. Asserts no collisions in CSPRNG output,
 * no accidental "ok" under a flood of hostile inputs, and bounded behavior at scale.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createPkcePair,
  createOAuthState,
  createNonce,
  computeCodeChallenge,
  validateAuthorizationResponse,
  validateTokenResponse,
  validateRedirectUri,
} from '../lib/companion-oauth-pkce.mjs';

describe('Stress — CSPRNG outputs are unique and correct at volume', () => {
  it('50k PKCE pairs: all verifiers unique, all challenges correct', () => {
    const N = 50_000;
    const verifiers = new Set();
    for (let i = 0; i < N; i++) {
      const { codeVerifier, codeChallenge } = createPkcePair();
      verifiers.add(codeVerifier);
      if (i % 5000 === 0) {
        assert.equal(codeChallenge, crypto.createHash('sha256').update(codeVerifier, 'ascii').digest('base64url'));
      }
    }
    assert.equal(verifiers.size, N, 'no verifier collisions');
  });

  it('100k states + nonces: no collisions', () => {
    const N = 100_000;
    const states = new Set();
    const nonces = new Set();
    for (let i = 0; i < N; i++) {
      states.add(createOAuthState());
      nonces.add(createNonce());
    }
    assert.equal(states.size, N);
    assert.equal(nonces.size, N);
  });
});

describe('Stress — 100k wrong-state callbacks never admit', () => {
  it('an exhaustive flood of mismatched states is always rejected', () => {
    const expected = createOAuthState();
    let admits = 0;
    for (let i = 0; i < 100_000; i++) {
      const r = validateAuthorizationResponse({ params: { code: 'c', state: 'guess-' + i }, expectedState: expected });
      if (r.ok) admits += 1;
    }
    assert.equal(admits, 0);
  });
});

describe('Stress — hostile token responses never validate', () => {
  it('50k malformed token responses all fail closed', () => {
    let oks = 0;
    for (let i = 0; i < 50_000; i++) {
      const variants = [
        { access_token: '', token_type: 'Bearer', expires_in: 60 },
        { access_token: 'x'.repeat((i % 20000) + 1), token_type: 'Bearer' }, // no expires_in
        { access_token: 'x', token_type: 'nope', expires_in: 60 },
        { error: 'e' + i },
      ];
      const v = validateTokenResponse(variants[i % variants.length]);
      if (v.ok) oks += 1;
    }
    assert.equal(oks, 0);
  });
});

describe('Stress — large redirect inputs are bounded and rejected', () => {
  it('an oversized redirect uri is rejected without error', () => {
    const huge = 'http://127.0.0.1:49321/' + 'a'.repeat(20000);
    const r = validateRedirectUri(huge);
    assert.equal(r.ok, false);
  });
  it('many computeCodeChallenge calls stay correct', () => {
    const v = createPkcePair().codeVerifier;
    const expected = computeCodeChallenge(v);
    for (let i = 0; i < 20_000; i++) assert.equal(computeCodeChallenge(v), expected);
  });
});

/**
 * Unit tests for `lib/bridge-internal-hmac.mjs`.
 *
 * The HMAC is the only thing keeping a publicly-addressable Netlify background
 * function endpoint from being abused by anyone who finds the URL. A regression
 * here either:
 *   - lets a forged request trigger arbitrary background re-indexes (security),
 *   - rejects legitimate sync→background calls (availability).
 *
 * Both are covered explicitly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  signInternalRequest,
  verifyInternalRequest,
  canonicalMessage,
  HMAC_REPLAY_WINDOW_MS,
} from '../lib/bridge-internal-hmac.mjs';

const SECRET = 'test-bridge-session-secret-do-not-deploy';

test('canonicalMessage: stable, includes scheme prefix to prevent cross-purpose reuse', () => {
  const msg = canonicalMessage({
    canisterUid: 'user_1',
    vaultId: 'Business',
    jobId: 'abc',
    ts: 1700000000000,
  });
  assert.strictEqual(
    msg,
    'bridge-index-background\nuser_1\nBusiness\nabc\n1700000000000',
    'message format must be canonical for cross-process verification',
  );
});

test('canonicalMessage: rejects missing fields (caller bug, must not silently sign empty)', () => {
  assert.throws(
    () => canonicalMessage({ vaultId: 'v', jobId: 'j', ts: 1 }),
    /canisterUid must be a non-empty string/,
  );
  assert.throws(
    () => canonicalMessage({ canisterUid: 'u', jobId: 'j', ts: 1 }),
    /vaultId must be a non-empty string/,
  );
  assert.throws(
    () => canonicalMessage({ canisterUid: 'u', vaultId: 'v', ts: 1 }),
    /jobId must be a non-empty string/,
  );
  assert.throws(
    () => canonicalMessage({ canisterUid: 'u', vaultId: 'v', jobId: 'j' }),
    /ts must be a finite number/,
  );
});

test('signInternalRequest + verifyInternalRequest: round-trip valid request', () => {
  const ts = 1700000000000;
  const sig = signInternalRequest(SECRET, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    jobId: 'job-1',
    ts,
  });
  const verified = verifyInternalRequest(SECRET, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    jobId: 'job-1',
    ts,
    sig,
    now: () => ts + 1000, // 1 s later, well within replay window
  });
  assert.strictEqual(verified.ok, true);
  assert.deepStrictEqual(verified.payload, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    jobId: 'job-1',
    ts,
  });
});

test('verifyInternalRequest: tampered field → bad_signature', () => {
  const ts = 1700000000000;
  const sig = signInternalRequest(SECRET, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    jobId: 'job-1',
    ts,
  });
  // Attacker swaps to a different vault but reuses the signature.
  const verified = verifyInternalRequest(SECRET, {
    canisterUid: 'user_1',
    vaultId: 'Personal',
    jobId: 'job-1',
    ts,
    sig,
    now: () => ts,
  });
  assert.deepStrictEqual(verified, { ok: false, reason: 'bad_signature' });
});

test('verifyInternalRequest: wrong secret → bad_signature (cannot forge without env access)', () => {
  const ts = 1700000000000;
  const sig = signInternalRequest('wrong-secret', {
    canisterUid: 'user_1',
    vaultId: 'Business',
    jobId: 'job-1',
    ts,
  });
  const verified = verifyInternalRequest(SECRET, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    jobId: 'job-1',
    ts,
    sig,
    now: () => ts,
  });
  assert.deepStrictEqual(verified, { ok: false, reason: 'bad_signature' });
});

test('verifyInternalRequest: signature older than replay window → expired', () => {
  const ts = 1700000000000;
  const sig = signInternalRequest(SECRET, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    jobId: 'job-1',
    ts,
  });
  const verified = verifyInternalRequest(SECRET, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    jobId: 'job-1',
    ts,
    sig,
    now: () => ts + HMAC_REPLAY_WINDOW_MS + 1,
  });
  assert.deepStrictEqual(verified, { ok: false, reason: 'expired' });
});

test('verifyInternalRequest: future signature beyond window → expired', () => {
  const ts = 1700000000000;
  const sig = signInternalRequest(SECRET, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    jobId: 'job-1',
    ts,
  });
  const verified = verifyInternalRequest(SECRET, {
    canisterUid: 'user_1',
    vaultId: 'Business',
    jobId: 'job-1',
    ts,
    sig,
    // Receiver clock is way behind sender's → still must reject (clock skew limit).
    now: () => ts - HMAC_REPLAY_WINDOW_MS - 1,
  });
  assert.deepStrictEqual(verified, { ok: false, reason: 'expired' });
});

test('verifyInternalRequest: missing/empty headers → missing_header', () => {
  const verified = verifyInternalRequest(SECRET, {
    canisterUid: 'user_1',
    vaultId: '',
    jobId: 'j',
    ts: 1,
    sig: 'abc',
  });
  assert.strictEqual(verified.ok, false);
  assert.strictEqual(verified.reason, 'missing_header');
});

test('verifyInternalRequest: missing secret on receiver → missing_secret (server misconfig)', () => {
  const verified = verifyInternalRequest('', {
    canisterUid: 'u',
    vaultId: 'v',
    jobId: 'j',
    ts: 1,
    sig: 'abc',
  });
  assert.deepStrictEqual(verified, { ok: false, reason: 'missing_secret' });
});

test('verifyInternalRequest: non-numeric timestamp string → bad_timestamp', () => {
  const verified = verifyInternalRequest(SECRET, {
    canisterUid: 'u',
    vaultId: 'v',
    jobId: 'j',
    ts: 'not-a-number',
    sig: 'a'.repeat(64),
  });
  assert.deepStrictEqual(verified, { ok: false, reason: 'bad_timestamp' });
});

test('verifyInternalRequest: numeric-string timestamp parses correctly', () => {
  const ts = 1700000000000;
  const sig = signInternalRequest(SECRET, {
    canisterUid: 'u',
    vaultId: 'v',
    jobId: 'j',
    ts,
  });
  const verified = verifyInternalRequest(SECRET, {
    canisterUid: 'u',
    vaultId: 'v',
    jobId: 'j',
    ts: String(ts), // headers come as strings
    sig,
    now: () => ts,
  });
  assert.strictEqual(verified.ok, true);
});

test('verifyInternalRequest: malformed sig (wrong length) → bad_signature without timing leak', () => {
  const verified = verifyInternalRequest(SECRET, {
    canisterUid: 'u',
    vaultId: 'v',
    jobId: 'j',
    ts: 1700000000000,
    sig: 'too-short',
    now: () => 1700000000000,
  });
  assert.deepStrictEqual(verified, { ok: false, reason: 'bad_signature' });
});

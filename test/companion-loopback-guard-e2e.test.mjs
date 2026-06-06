/**
 * Tier 3 — END-TO-END: realistic caller scenarios end to end.
 *
 * Models the decision flow a Phase 5 listener would run for representative real-world callers,
 * WITHOUT binding a socket (the bind is out of scope per the gate). Each scenario asserts the
 * full verdict, demonstrating the guard behaves correctly for the legitimate companion UI, a
 * legitimate non-browser local client, and the headline attacks (cross-origin page,
 * DNS-rebinding, token theft attempt).
 *
 * Reference: docs/COMPANION-APP-PHASE-2-LOOPBACK-SECURITY.md (threat-model → control mapping).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyLoopbackRequest,
  createLoopbackRateState,
  recordLoopbackRequest,
  shouldCountTowardRateLimit,
} from '../lib/companion-loopback-guard.mjs';

const PORT = '52310';
const SESSION_TOKEN = 'kc_' + 'd9f3a1b2'.repeat(8); // high-entropy per-session token (stand-in)
const ALLOWED_HOSTS = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
const LOOPBACK_ORIGIN = `http://127.0.0.1:${PORT}`;

function listenerDecide(request, state) {
  const verdict = verifyLoopbackRequest({ ...request, allowedHosts: ALLOWED_HOSTS, expectedToken: SESSION_TOKEN, rateState: state });
  const nextState = shouldCountTowardRateLimit(verdict) ? recordLoopbackRequest(state, request.now) : state;
  return { verdict, nextState };
}

describe('E2E — legitimate companion UI (same-origin browser tab)', () => {
  it('a same-origin POST with the session token is admitted', () => {
    const state = createLoopbackRateState();
    const { verdict } = listenerDecide({
      method: 'POST',
      headers: {
        Host: `127.0.0.1:${PORT}`,
        Origin: LOOPBACK_ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SESSION_TOKEN}`,
      },
      token: SESSION_TOKEN,
      now: 1,
    }, state);
    assert.deepEqual(verdict, { allow: true, status: 200, reason: 'ok' });
  });
});

describe('E2E — legitimate non-browser local client (CLI / companion backend)', () => {
  it('a request with no Origin and no Sec-Fetch-Site but a valid token is admitted', () => {
    const state = createLoopbackRateState();
    const { verdict } = listenerDecide({
      method: 'POST',
      headers: { Host: `localhost:${PORT}`, Authorization: `Bearer ${SESSION_TOKEN}` },
      token: SESSION_TOKEN,
      now: 1,
    }, state);
    assert.equal(verdict.allow, true);
  });
});

describe('E2E — malicious cross-origin web page', () => {
  it('a fetch from https://evil.example to the loopback is rejected (cross-site)', () => {
    const state = createLoopbackRateState();
    const { verdict, nextState } = listenerDecide({
      method: 'POST',
      headers: {
        Host: `127.0.0.1:${PORT}`,
        Origin: 'https://evil.example',
        'Sec-Fetch-Site': 'cross-site',
      },
      token: '', // attacker has no token
      now: 1,
    }, state);
    assert.equal(verdict.allow, false);
    assert.equal(verdict.status, 403);
    assert.equal(nextState.timestamps.length, 0, 'cross-site probe consumes no budget');
  });
});

describe('E2E — DNS-rebinding attack', () => {
  it('a rebound domain (Host: attacker-rebind.example) is rejected before any model work', () => {
    const state = createLoopbackRateState();
    const { verdict } = listenerDecide({
      method: 'POST',
      // Browser connected to 127.0.0.1 via rebinding, but the URL/Host is the attacker domain.
      headers: { Host: 'attacker-rebind.example:' + PORT, 'Sec-Fetch-Site': 'same-origin' },
      token: SESSION_TOKEN, // even if the attacker somehow learned the token, host check stops it
      now: 1,
    }, state);
    assert.equal(verdict.allow, false);
    assert.equal(verdict.status, 403);
    assert.equal(verdict.reason, 'host_not_allowed');
  });
});

describe('E2E — stolen/guessed token still blocked by network identity', () => {
  it('a cross-site page that somehow holds the token is STILL rejected (origin defense)', () => {
    const state = createLoopbackRateState();
    const { verdict } = listenerDecide({
      method: 'POST',
      headers: { Host: `127.0.0.1:${PORT}`, Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
      token: SESSION_TOKEN,
      now: 1,
    }, state);
    assert.equal(verdict.allow, false);
    assert.equal(verdict.status, 403);
  });
});

describe('E2E — full session: warm-up, steady use, attack interleaved', () => {
  it('legitimate traffic flows while interleaved attacks are all rejected and unbilled', () => {
    let state = createLoopbackRateState({ windowMs: 10_000, maxRequests: 100 });
    let admitted = 0;
    let rejected = 0;
    for (let i = 0; i < 60; i++) {
      const now = 1000 + i * 10;
      // legit request
      const legit = listenerDecide({
        method: i % 5 === 0 ? 'GET' : 'POST',
        headers: { Host: `127.0.0.1:${PORT}`, Origin: LOOPBACK_ORIGIN, 'Sec-Fetch-Site': 'same-origin' },
        token: SESSION_TOKEN,
        now,
      }, state);
      state = legit.nextState;
      if (legit.verdict.allow) admitted++;
      // interleaved attack (does not touch budget)
      const attack = listenerDecide({
        method: 'POST',
        headers: { Host: `127.0.0.1:${PORT}`, Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
        token: 'stolen?',
        now: now + 1,
      }, state);
      state = attack.nextState;
      if (!attack.verdict.allow) rejected++;
    }
    assert.equal(admitted, 60, 'all 60 legit requests admitted');
    assert.equal(rejected, 60, 'all 60 attacks rejected');
    assert.equal(state.timestamps.length, 60, 'only legit requests consumed budget');
  });
});

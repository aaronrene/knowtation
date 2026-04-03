/**
 * Integration tests for the ICP attestation canister.
 *
 * Requires a local dfx replica with the attestation canister deployed:
 *   cd hub/icp && dfx start --background && dfx deploy attestation
 *
 * Run:
 *   ATTESTATION_CANISTER_URL=http://localhost:4943/?canisterId=<id> \
 *     node --test test/attestation-canister.test.mjs
 *
 * These tests verify the canister's HTTP query interface (read-only).
 * The Candid storeAttestation method requires an authorized caller identity,
 * so write tests use @icp-sdk/core agent calls.
 *
 * When ATTESTATION_CANISTER_URL is not set, all tests are skipped gracefully.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const CANISTER_URL = process.env.ATTESTATION_CANISTER_URL;
const skipReason = CANISTER_URL
  ? null
  : 'ATTESTATION_CANISTER_URL not set (requires local dfx replica)';

describe('attestation canister HTTP interface', { skip: skipReason }, () => {
  test('GET /health returns ok', async () => {
    const res = await fetch(`${CANISTER_URL}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.canister, 'attestation');
  });

  test('GET /stats returns total and next_seq', async () => {
    const res = await fetch(`${CANISTER_URL}/stats`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.total === 'number', 'total should be a number');
    assert.ok(typeof body.next_seq === 'number', 'next_seq should be a number');
    assert.ok(body.total >= 0);
  });

  test('GET /attest/nonexistent-id returns 404', async () => {
    const res = await fetch(`${CANISTER_URL}/attest/air-00000000-0000-0000-0000-000000000000`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.code, 'NOT_FOUND');
  });

  test('GET /unknown returns 404', async () => {
    const res = await fetch(`${CANISTER_URL}/unknown-path`);
    assert.equal(res.status, 404);
  });

  test('OPTIONS returns 204 with CORS headers', async () => {
    const res = await fetch(`${CANISTER_URL}/health`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    const allow = res.headers.get('access-control-allow-origin');
    assert.equal(allow, '*');
  });
});

describe('attestation canister Candid interface', { skip: skipReason }, () => {
  let canisterId;

  test('can query getStats via Candid', async () => {
    if (!process.env.ATTESTATION_CANISTER_ID_LOCAL) {
      return;
    }
    canisterId = process.env.ATTESTATION_CANISTER_ID_LOCAL;

    const { HttpAgent, Actor } = await import('@icp-sdk/core/agent');
    const { IDL } = await import('@icp-sdk/core/candid');

    const idlFactory = ({ IDL: _IDL }) => {
      return IDL.Service({
        getStats: IDL.Func([], [IDL.Record({ total: IDL.Nat, nextSeq: IDL.Nat })], ['query']),
      });
    };

    const agent = await HttpAgent.create({ host: 'http://localhost:4943' });
    await agent.fetchRootKey();

    const actor = Actor.createActor(idlFactory, { agent, canisterId });
    const stats = await actor.getStats();
    assert.ok(typeof stats.total === 'bigint' || typeof stats.total === 'number');
    assert.ok(stats.total >= 0n || stats.total >= 0);
  });
});

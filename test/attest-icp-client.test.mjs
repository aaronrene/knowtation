import { test, beforeEach, afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';

let savedCanisterId;
let savedKey;
let savedHost;

beforeEach(() => {
  savedCanisterId = process.env.ICP_ATTESTATION_CANISTER_ID;
  savedKey = process.env.ICP_ATTESTATION_KEY;
  savedHost = process.env.ICP_ATTESTATION_HOST;
  delete process.env.ICP_ATTESTATION_CANISTER_ID;
  delete process.env.ICP_ATTESTATION_KEY;
  delete process.env.ICP_ATTESTATION_HOST;
});

afterEach(() => {
  if (savedCanisterId !== undefined) process.env.ICP_ATTESTATION_CANISTER_ID = savedCanisterId;
  else delete process.env.ICP_ATTESTATION_CANISTER_ID;
  if (savedKey !== undefined) process.env.ICP_ATTESTATION_KEY = savedKey;
  else delete process.env.ICP_ATTESTATION_KEY;
  if (savedHost !== undefined) process.env.ICP_ATTESTATION_HOST = savedHost;
  else delete process.env.ICP_ATTESTATION_HOST;
});

describe('isIcpAttestationConfigured', () => {
  test('returns false when neither env var is set', async () => {
    const { isIcpAttestationConfigured, resetClient } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    resetClient();
    assert.equal(isIcpAttestationConfigured(), false);
  });

  test('returns false when only canister ID is set', async () => {
    process.env.ICP_ATTESTATION_CANISTER_ID = 'aaaaa-aa';
    const { isIcpAttestationConfigured, resetClient } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    resetClient();
    assert.equal(isIcpAttestationConfigured(), false);
  });

  test('returns false when only key is set', async () => {
    process.env.ICP_ATTESTATION_KEY = 'a'.repeat(64);
    const { isIcpAttestationConfigured, resetClient } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    resetClient();
    assert.equal(isIcpAttestationConfigured(), false);
  });

  test('returns true when both env vars are set', async () => {
    process.env.ICP_ATTESTATION_CANISTER_ID = 'aaaaa-aa';
    process.env.ICP_ATTESTATION_KEY = 'a'.repeat(64);
    const { isIcpAttestationConfigured, resetClient } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    resetClient();
    assert.equal(isIcpAttestationConfigured(), true);
  });

  test('returns false when key is too short', async () => {
    process.env.ICP_ATTESTATION_CANISTER_ID = 'aaaaa-aa';
    process.env.ICP_ATTESTATION_KEY = 'tooshort';
    const { isIcpAttestationConfigured, resetClient } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    resetClient();
    assert.equal(isIcpAttestationConfigured(), false);
  });
});

describe('getAttestationCanisterId', () => {
  test('returns null when not configured', async () => {
    const { getAttestationCanisterId } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    assert.equal(getAttestationCanisterId(), null);
  });

  test('returns the canister ID when set', async () => {
    process.env.ICP_ATTESTATION_CANISTER_ID = 'rsovz-byaaa-aaaaa-qgira-cai';
    const { getAttestationCanisterId } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    assert.equal(getAttestationCanisterId(), 'rsovz-byaaa-aaaaa-qgira-cai');
  });

  test('trims whitespace from canister ID', async () => {
    process.env.ICP_ATTESTATION_CANISTER_ID = '  rsovz-byaaa-aaaaa-qgira-cai  ';
    const { getAttestationCanisterId } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    assert.equal(getAttestationCanisterId(), 'rsovz-byaaa-aaaaa-qgira-cai');
  });
});

describe('anchorAttestation', () => {
  test('returns null when not configured', async () => {
    const { anchorAttestation, resetClient } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    resetClient();
    const result = await anchorAttestation({
      id: 'air-test',
      action: 'write',
      path: 'notes/test.md',
      timestamp: new Date().toISOString(),
      content_hash: '',
      sig: 'abc',
    });
    assert.equal(result, null);
  });
});

describe('queryAttestation', () => {
  test('returns null when canister ID not set', async () => {
    const { queryAttestation, resetClient } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    resetClient();
    const result = await queryAttestation('air-test');
    assert.equal(result, null);
  });
});

describe('getGatewayPrincipal', () => {
  test('returns null when key not set', async () => {
    const { getGatewayPrincipal, resetClient } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    resetClient();
    const result = await getGatewayPrincipal();
    assert.equal(result, null);
  });

  test('returns a principal string when key is set', async () => {
    process.env.ICP_ATTESTATION_KEY =
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const { getGatewayPrincipal, resetClient } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    resetClient();
    const principal = await getGatewayPrincipal();
    assert.ok(principal, 'should return a non-null principal');
    assert.ok(principal.includes('-'), 'principal should contain dashes');
  });

  test('same key produces same principal deterministically', async () => {
    process.env.ICP_ATTESTATION_KEY =
      'cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe';
    const { getGatewayPrincipal, resetClient } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    resetClient();
    const p1 = await getGatewayPrincipal();
    resetClient();
    const p2 = await getGatewayPrincipal();
    assert.equal(p1, p2, 'same seed must produce same principal');
  });
});

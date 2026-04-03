/**
 * Tests for AIR Improvement E — dual-write (Blobs + ICP) and verifyWithIcp.
 *
 * Uses _setTestOverrides from icp-attestation-client.mjs to inject mock
 * anchor/query implementations without fighting ESM module binding rules.
 */

import { test, beforeEach, afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';

const TEST_SECRET = 'test-attestation-secret-that-is-at-least-32-characters-long';
const TEST_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const TEST_KEY = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

function createStubBlobStore() {
  const map = new Map();
  return {
    _map: map,
    async get(key, opts) {
      const raw = map.get(key);
      if (raw === undefined) return null;
      if (opts && opts.type === 'json') return JSON.parse(raw);
      return raw;
    },
    async setJSON(key, value) {
      map.set(key, JSON.stringify(value));
    },
  };
}

let savedSecret, savedCanisterId, savedKey, savedEndpoint;

beforeEach(() => {
  savedSecret = process.env.ATTESTATION_SECRET;
  savedCanisterId = process.env.ICP_ATTESTATION_CANISTER_ID;
  savedKey = process.env.ICP_ATTESTATION_KEY;
  savedEndpoint = process.env.KNOWTATION_AIR_ENDPOINT;

  process.env.ATTESTATION_SECRET = TEST_SECRET;
  delete process.env.KNOWTATION_AIR_ENDPOINT;
  globalThis.__knowtation_attest_blob = createStubBlobStore();
});

afterEach(async () => {
  if (savedSecret !== undefined) process.env.ATTESTATION_SECRET = savedSecret;
  else delete process.env.ATTESTATION_SECRET;
  if (savedCanisterId !== undefined) process.env.ICP_ATTESTATION_CANISTER_ID = savedCanisterId;
  else delete process.env.ICP_ATTESTATION_CANISTER_ID;
  if (savedKey !== undefined) process.env.ICP_ATTESTATION_KEY = savedKey;
  else delete process.env.ICP_ATTESTATION_KEY;
  if (savedEndpoint !== undefined) process.env.KNOWTATION_AIR_ENDPOINT = savedEndpoint;
  else delete process.env.KNOWTATION_AIR_ENDPOINT;
  delete globalThis.__knowtation_attest_blob;

  const { _setTestOverrides, resetClient } = await import(
    '../hub/gateway/icp-attestation-client.mjs'
  );
  _setTestOverrides({});
  resetClient();
});

function enableIcpEnv() {
  process.env.ICP_ATTESTATION_CANISTER_ID = TEST_CANISTER_ID;
  process.env.ICP_ATTESTATION_KEY = TEST_KEY;
}

describe('createAttestation with ICP disabled', () => {
  test('sets icp_status to "disabled" when ICP not configured', async () => {
    delete process.env.ICP_ATTESTATION_CANISTER_ID;
    delete process.env.ICP_ATTESTATION_KEY;

    const { createAttestation } = await import('../hub/gateway/attest-store.mjs');
    const result = await createAttestation('write', 'notes/test.md');

    assert.match(result.id, /^air-/);
    assert.equal(result.icp_status, 'disabled');

    const store = globalThis.__knowtation_attest_blob;
    const raw = await store.get(`attestation/${result.id}`, { type: 'json' });
    assert.equal(raw.icp_status, 'disabled');
  });
});

describe('createAttestation with ICP enabled (mocked)', () => {
  test('sets icp_status to "anchored" when ICP succeeds', async () => {
    enableIcpEnv();
    const { _setTestOverrides, resetClient } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    resetClient();
    _setTestOverrides({ anchor: async () => ({ seq: 42 }) });

    const { createAttestation } = await import('../hub/gateway/attest-store.mjs');
    const result = await createAttestation('write', 'notes/icp-test.md');

    assert.equal(result.icp_status, 'anchored');

    const store = globalThis.__knowtation_attest_blob;
    const raw = await store.get(`attestation/${result.id}`, { type: 'json' });
    assert.equal(raw.icp_status, 'anchored');
    assert.equal(raw.icp_seq, 42);
    assert.equal(raw.canister_id, TEST_CANISTER_ID);
  });

  test('sets icp_status to "pending" when ICP returns null', async () => {
    enableIcpEnv();
    const { _setTestOverrides, resetClient } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    resetClient();
    _setTestOverrides({ anchor: async () => null });

    const { createAttestation } = await import('../hub/gateway/attest-store.mjs');
    const result = await createAttestation('write', 'notes/fail-test.md');

    assert.equal(result.icp_status, 'pending');
  });

  test('sets icp_status to "pending" when ICP throws', async () => {
    enableIcpEnv();
    const { _setTestOverrides, resetClient } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    resetClient();
    _setTestOverrides({
      anchor: async () => {
        throw new Error('canister unreachable');
      },
    });

    const { createAttestation } = await import('../hub/gateway/attest-store.mjs');
    const result = await createAttestation('write', 'notes/error-test.md');

    assert.equal(result.icp_status, 'pending');
  });

  test('Blob record is always created even when ICP fails', async () => {
    enableIcpEnv();
    const { _setTestOverrides, resetClient } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    resetClient();
    _setTestOverrides({
      anchor: async () => {
        throw new Error('timeout');
      },
    });

    const { createAttestation, verifyAttestation } = await import(
      '../hub/gateway/attest-store.mjs'
    );
    const result = await createAttestation('write', 'notes/blob-always.md');

    const verification = await verifyAttestation(result.id);
    assert.equal(verification.verified, true);
    assert.equal(verification.record.id, result.id);
  });
});

describe('verifyWithIcp', () => {
  test('returns icp_not_configured when ICP is disabled', async () => {
    delete process.env.ICP_ATTESTATION_CANISTER_ID;
    delete process.env.ICP_ATTESTATION_KEY;

    const { createAttestation, verifyWithIcp } = await import(
      '../hub/gateway/attest-store.mjs'
    );
    const { id } = await createAttestation('write', 'notes/verify-test.md');

    const result = await verifyWithIcp(id);
    assert.equal(result.consensus, 'icp_not_configured');
    assert.equal(result.verified, true);
    assert.equal(result.sources.blobs.found, true);
    assert.equal(result.sources.blobs.hmac_valid, true);
    assert.equal(result.sources.icp.found, false);
  });

  test('returns not_found for nonexistent attestation', async () => {
    delete process.env.ICP_ATTESTATION_CANISTER_ID;
    const { verifyWithIcp } = await import('../hub/gateway/attest-store.mjs');
    const result = await verifyWithIcp('air-00000000-0000-0000-0000-000000000000');
    assert.equal(result.consensus, 'not_found');
    assert.equal(result.verified, false);
  });

  test('returns match when Blobs and ICP agree', async () => {
    enableIcpEnv();
    const { _setTestOverrides, resetClient } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    resetClient();
    _setTestOverrides({ anchor: async () => ({ seq: 99 }) });

    const { createAttestation, verifyWithIcp } = await import(
      '../hub/gateway/attest-store.mjs'
    );
    const { id } = await createAttestation('write', 'notes/match-test.md');

    const store = globalThis.__knowtation_attest_blob;
    const blobRec = await store.get(`attestation/${id}`, { type: 'json' });

    _setTestOverrides({
      anchor: async () => ({ seq: 99 }),
      query: async () => ({
        id: blobRec.id,
        action: blobRec.action,
        path: blobRec.path,
        timestamp: blobRec.timestamp,
        content_hash: blobRec.content_hash || '',
        sig: blobRec.sig,
        seq: 99,
        stored_at: new Date().toISOString(),
      }),
    });

    const result = await verifyWithIcp(id);
    assert.equal(result.consensus, 'match');
    assert.equal(result.verified, true);
    assert.equal(result.sources.blobs.found, true);
    assert.equal(result.sources.icp.found, true);
    assert.equal(result.sources.icp.seq, 99);
  });

  test('returns mismatch when Blobs and ICP disagree', async () => {
    enableIcpEnv();
    const { _setTestOverrides, resetClient } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    resetClient();
    _setTestOverrides({ anchor: async () => ({ seq: 1 }) });

    const { createAttestation, verifyWithIcp } = await import(
      '../hub/gateway/attest-store.mjs'
    );
    const { id } = await createAttestation('write', 'notes/mismatch-test.md');

    _setTestOverrides({
      anchor: async () => ({ seq: 1 }),
      query: async () => ({
        id,
        action: 'TAMPERED',
        path: 'notes/mismatch-test.md',
        timestamp: '2026-01-01T00:00:00.000Z',
        content_hash: '',
        sig: 'wrong',
        seq: 1,
        stored_at: new Date().toISOString(),
      }),
    });

    const result = await verifyWithIcp(id);
    assert.equal(result.consensus, 'mismatch');
  });

  test('returns icp_pending when Blob is pending and ICP not found', async () => {
    enableIcpEnv();
    const { _setTestOverrides, resetClient } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    resetClient();
    _setTestOverrides({ anchor: async () => null });

    const { createAttestation, verifyWithIcp } = await import(
      '../hub/gateway/attest-store.mjs'
    );
    const { id } = await createAttestation('write', 'notes/pending-test.md');

    _setTestOverrides({ anchor: async () => null, query: async () => null });

    const result = await verifyWithIcp(id);
    assert.equal(result.consensus, 'icp_pending');
    assert.equal(result.verified, true);
  });
});

describe('anchorPendingAttestations', () => {
  test('returns early when ICP not configured', async () => {
    delete process.env.ICP_ATTESTATION_CANISTER_ID;
    delete process.env.ICP_ATTESTATION_KEY;

    const { anchorPendingAttestations } = await import('../hub/gateway/attest-store.mjs');
    const result = await anchorPendingAttestations(['air-123']);
    assert.equal(result.anchored, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /not configured/);
  });

  test('returns early for empty ids list', async () => {
    enableIcpEnv();
    const { anchorPendingAttestations } = await import('../hub/gateway/attest-store.mjs');
    const result = await anchorPendingAttestations([]);
    assert.equal(result.anchored, 0);
    assert.equal(result.failed, 0);
  });

  test('anchors a pending record successfully', async () => {
    enableIcpEnv();
    const { _setTestOverrides, resetClient } = await import(
      '../hub/gateway/icp-attestation-client.mjs'
    );
    resetClient();
    _setTestOverrides({ anchor: async () => null });

    const { createAttestation, anchorPendingAttestations } = await import(
      '../hub/gateway/attest-store.mjs'
    );
    const { id } = await createAttestation('write', 'notes/reconcile-test.md');

    _setTestOverrides({ anchor: async () => ({ seq: 777 }) });

    const result = await anchorPendingAttestations([id]);
    assert.equal(result.anchored, 1);
    assert.equal(result.failed, 0);

    const store = globalThis.__knowtation_attest_blob;
    const raw = await store.get(`attestation/${id}`, { type: 'json' });
    assert.equal(raw.icp_status, 'anchored');
    assert.equal(raw.icp_seq, 777);
  });
});

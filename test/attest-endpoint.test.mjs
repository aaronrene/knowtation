import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const TEST_SECRET = 'test-attestation-secret-that-is-at-least-32-characters-long';

/**
 * Stub blob store backed by a Map — mirrors the subset of @netlify/blobs
 * API that attest-store.mjs uses (get, setJSON).
 */
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
    async delete(key) {
      map.delete(key);
    },
  };
}

let savedSecret;
let savedEndpoint;

beforeEach(() => {
  savedSecret = process.env.ATTESTATION_SECRET;
  savedEndpoint = process.env.KNOWTATION_AIR_ENDPOINT;
  process.env.ATTESTATION_SECRET = TEST_SECRET;
  delete process.env.KNOWTATION_AIR_ENDPOINT;
  globalThis.__knowtation_attest_blob = createStubBlobStore();
});

afterEach(() => {
  if (savedSecret !== undefined) process.env.ATTESTATION_SECRET = savedSecret;
  else delete process.env.ATTESTATION_SECRET;
  if (savedEndpoint !== undefined) process.env.KNOWTATION_AIR_ENDPOINT = savedEndpoint;
  else delete process.env.KNOWTATION_AIR_ENDPOINT;
  delete globalThis.__knowtation_attest_blob;
});

test('createAttestation returns id with air- prefix and ISO timestamp', async () => {
  const { createAttestation } = await import('../hub/gateway/attest-store.mjs');
  const result = await createAttestation('write', 'notes/test.md');
  assert.match(result.id, /^air-[0-9a-f-]{36}$/);
  assert.match(result.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('verifyAttestation returns verified: true for a valid record', async () => {
  const { createAttestation, verifyAttestation } = await import('../hub/gateway/attest-store.mjs');
  const { id } = await createAttestation('write', 'notes/test.md');
  const result = await verifyAttestation(id);
  assert.equal(result.verified, true);
  assert.equal(result.record.id, id);
  assert.equal(result.record.action, 'write');
  assert.equal(result.record.path, 'notes/test.md');
  assert.equal(result.record.sig, undefined, 'sig must not be exposed');
});

test('verifyAttestation returns record: null for nonexistent id', async () => {
  const { verifyAttestation } = await import('../hub/gateway/attest-store.mjs');
  const result = await verifyAttestation('air-00000000-0000-0000-0000-000000000000');
  assert.equal(result.verified, false);
  assert.equal(result.record, null);
});

test('createAttestation throws when ATTESTATION_SECRET is missing', async () => {
  delete process.env.ATTESTATION_SECRET;
  const { createAttestation } = await import('../hub/gateway/attest-store.mjs');
  await assert.rejects(
    () => createAttestation('write', 'notes/test.md'),
    { message: 'ATTESTATION_SECRET is not configured' }
  );
});

test('createAttestation throws when ATTESTATION_SECRET is too short', async () => {
  process.env.ATTESTATION_SECRET = 'short';
  const { createAttestation } = await import('../hub/gateway/attest-store.mjs');
  await assert.rejects(
    () => createAttestation('write', 'notes/test.md'),
    { message: 'ATTESTATION_SECRET is not configured' }
  );
});

test('tampered record fails verification', async () => {
  const { createAttestation, verifyAttestation } = await import('../hub/gateway/attest-store.mjs');
  const { id } = await createAttestation('write', 'notes/test.md');

  const store = globalThis.__knowtation_attest_blob;
  const raw = await store.get(`attestation/${id}`, { type: 'json' });
  raw.action = 'tampered';
  await store.setJSON(`attestation/${id}`, raw);

  const result = await verifyAttestation(id);
  assert.equal(result.verified, false);
  assert.ok(result.record, 'record should still be returned even if tampered');
});

test('content_hash is stored and returned when provided', async () => {
  const { createAttestation, verifyAttestation } = await import('../hub/gateway/attest-store.mjs');
  const hash = 'abc123def456';
  const { id } = await createAttestation('write', 'notes/test.md', hash);
  const result = await verifyAttestation(id);
  assert.equal(result.verified, true);
  assert.equal(result.record.content_hash, hash);
});

test('isAttestationConfigured reflects ATTESTATION_SECRET state', async () => {
  const { isAttestationConfigured } = await import('../hub/gateway/attest-store.mjs');
  assert.equal(isAttestationConfigured(), true);
  delete process.env.ATTESTATION_SECRET;
  assert.equal(isAttestationConfigured(), false);
});
